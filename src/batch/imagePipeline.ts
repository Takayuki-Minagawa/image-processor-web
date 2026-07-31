import {
  MAX_AUTOMATION_COMMANDS,
  type ApplyFilterCommand,
  type ResolvedAutomationCommand,
  assertBatchSafeCommands,
  validateAutomationCommand,
} from '../automation/commands'
import {
  MAX_IMAGE_BYTES,
  assertSafeImageDimensions,
  imageDimensionsMatchHeader,
} from '../lib/imageSafety'
import {
  IMAGE_HEADER_READ_BYTES,
  parseImageDimensions,
} from '../lib/imageMetadata'
import type {
  PipelineImageMimeType,
  PipelineProgressPhase,
  ProcessImageWorkerRequest,
} from './imagePipelineProtocol'

export interface DecodedPipelineImage {
  source: unknown
  width: number
  height: number
  close?: () => void
}

export interface PipelineTextMetrics {
  width: number
  actualBoundingBoxAscent?: number
  actualBoundingBoxDescent?: number
}

export interface PipelineDrawingContext {
  filter: string
  fillStyle: string | CanvasGradient | CanvasPattern
  font: string
  globalAlpha: number
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  clearRect(x: number, y: number, width: number, height: number): void
  drawImage(source: unknown, ...coordinates: number[]): void
  fillRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number, maxWidth?: number): void
  measureText(text: string): PipelineTextMetrics
  restore(): void
  save(): void
}

export interface PipelineCanvas {
  width: number
  height: number
  /** Native CanvasImageSource (OffscreenCanvas in production). */
  drawable: unknown
  getContext(): PipelineDrawingContext | null
}

export interface ImagePipelineRuntime {
  decode(
    input: ArrayBuffer,
    mimeType: PipelineImageMimeType,
  ): Promise<DecodedPipelineImage>
  createCanvas(width: number, height: number): PipelineCanvas
  encode(
    canvas: PipelineCanvas,
    mimeType: PipelineImageMimeType,
    quality: number,
  ): Promise<Blob>
}

export interface PipelineProgress {
  phase: PipelineProgressPhase
  progress: number
}

export interface ProcessImageResult {
  data: ArrayBuffer
  mimeType: PipelineImageMimeType
  width: number
  height: number
}

export interface FitRectangle {
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  destinationX: number
  destinationY: number
  destinationWidth: number
  destinationHeight: number
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const abortError = (): DOMException =>
  new DOMException('Image processing was cancelled.', 'AbortError')

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, 0))

const assertNotCancelled = (isCancelled?: () => boolean): void => {
  if (isCancelled?.()) {
    throw abortError()
  }
}

export const calculateFitRectangle = (
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
  fit: 'stretch' | 'contain' | 'cover',
): FitRectangle => {
  if (fit === 'stretch') {
    return {
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
      destinationX: 0,
      destinationY: 0,
      destinationWidth,
      destinationHeight,
    }
  }
  const scale =
    fit === 'contain'
      ? Math.min(
          destinationWidth / sourceWidth,
          destinationHeight / sourceHeight,
        )
      : Math.max(
          destinationWidth / sourceWidth,
          destinationHeight / sourceHeight,
        )
  if (fit === 'contain') {
    const renderedWidth = sourceWidth * scale
    const renderedHeight = sourceHeight * scale
    return {
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
      destinationX: (destinationWidth - renderedWidth) / 2,
      destinationY: (destinationHeight - renderedHeight) / 2,
      destinationWidth: renderedWidth,
      destinationHeight: renderedHeight,
    }
  }
  const sampledWidth = destinationWidth / scale
  const sampledHeight = destinationHeight / scale
  return {
    sourceX: (sourceWidth - sampledWidth) / 2,
    sourceY: (sourceHeight - sampledHeight) / 2,
    sourceWidth: sampledWidth,
    sourceHeight: sampledHeight,
    destinationX: 0,
    destinationY: 0,
    destinationWidth,
    destinationHeight,
  }
}

const requireContext = (canvas: PipelineCanvas): PipelineDrawingContext => {
  const context = canvas.getContext()
  if (!context) {
    throw new Error('A 2D canvas context is not available.')
  }
  return context
}

const resizeCanvas = (
  source: PipelineCanvas,
  command: Extract<ResolvedAutomationCommand, { type: 'resizeImage' }>,
  runtime: ImagePipelineRuntime,
): PipelineCanvas => {
  const destination = runtime.createCanvas(command.width, command.height)
  const context = requireContext(destination)
  context.clearRect(0, 0, destination.width, destination.height)
  if (command.background && command.background !== 'transparent') {
    context.fillStyle = command.background
    context.fillRect(0, 0, destination.width, destination.height)
  }
  const rectangle = calculateFitRectangle(
    source.width,
    source.height,
    destination.width,
    destination.height,
    command.fit ?? 'contain',
  )
  context.drawImage(
    source.drawable,
    rectangle.sourceX,
    rectangle.sourceY,
    rectangle.sourceWidth,
    rectangle.sourceHeight,
    rectangle.destinationX,
    rectangle.destinationY,
    rectangle.destinationWidth,
    rectangle.destinationHeight,
  )
  return destination
}

export const filterToCanvasExpression = (
  command: ApplyFilterCommand<number, boolean, string>,
): string | null => {
  switch (command.filter) {
    case 'brightness':
      return `brightness(${Math.round((1 + clamp(Number(command.value), -1, 1)) * 100)}%)`
    case 'contrast':
      return `contrast(${Math.round((1 + clamp(Number(command.value), -1, 1)) * 100)}%)`
    case 'saturation':
      return `saturate(${Math.round((1 + clamp(Number(command.value), -1, 1)) * 100)}%)`
    case 'hue':
      return `hue-rotate(${Math.round(clamp(Number(command.value), -1, 1) * 180)}deg)`
    case 'blur':
      return `blur(${(clamp(Number(command.value), 0, 1) * 20).toFixed(2)}px)`
    case 'grayscale':
      return command.value ? 'grayscale(100%)' : null
  }
}

const applyFilter = (
  source: PipelineCanvas,
  command: Extract<ResolvedAutomationCommand, { type: 'applyFilter' }>,
  runtime: ImagePipelineRuntime,
): PipelineCanvas => {
  const expression = filterToCanvasExpression(command)
  if (!expression) {
    return source
  }
  const destination = runtime.createCanvas(source.width, source.height)
  const context = requireContext(destination)
  context.filter = expression
  context.drawImage(source.drawable, 0, 0)
  context.filter = 'none'
  return destination
}

const fontWeight = (value: number | string | undefined): string =>
  value === undefined ? '600' : String(value)

const addWatermark = (
  canvas: PipelineCanvas,
  command: Extract<ResolvedAutomationCommand, { type: 'addWatermark' }>,
): void => {
  const context = requireContext(canvas)
  const fontSize = clamp(command.fontSize ?? 32, 1, 2_048)
  const margin = clamp(command.margin ?? Math.max(8, fontSize / 2), 0, 8_192)
  const position = command.position ?? 'bottomRight'
  context.save()
  context.globalAlpha = clamp(command.opacity ?? 0.72, 0, 1)
  context.fillStyle = command.color ?? '#ffffff'
  context.font = `${fontWeight(command.fontWeight)} ${fontSize}px ${command.fontFamily ?? 'sans-serif'}`
  context.textAlign = 'left'
  context.textBaseline = 'top'
  const metrics = context.measureText(command.text)
  const textWidth = Math.min(metrics.width, Math.max(0, canvas.width))
  const textHeight = Math.min(
    Math.max(
      fontSize,
      (metrics.actualBoundingBoxAscent ?? 0) +
        (metrics.actualBoundingBoxDescent ?? 0),
    ),
    Math.max(0, canvas.height),
  )
  let x = margin
  let y = margin
  if (position === 'topRight' || position === 'bottomRight') {
    x = canvas.width - margin - textWidth
  } else if (position === 'center') {
    x = (canvas.width - textWidth) / 2
  }
  if (position === 'bottomLeft' || position === 'bottomRight') {
    y = canvas.height - margin - textHeight
  } else if (position === 'center') {
    y = (canvas.height - textHeight) / 2
  }
  context.fillText(
    command.text,
    clamp(x, 0, Math.max(0, canvas.width - textWidth)),
    clamp(y, 0, Math.max(0, canvas.height - textHeight)),
    Math.max(0, canvas.width),
  )
  context.restore()
}

const validateResolvedCommands = (
  commands: readonly ResolvedAutomationCommand[],
): void => {
  commands.forEach((command) => {
    const validated = validateAutomationCommand(command, {
      allowParameters: false,
    })
    if (!validated.ok) {
      throw new TypeError(validated.diagnostic.message)
    }
  })
  assertBatchSafeCommands(commands)
}

export const processImageBuffer = async (
  request: Omit<ProcessImageWorkerRequest, 'type' | 'jobId' | 'sourceName'>,
  options: {
    runtime?: ImagePipelineRuntime
    isCancelled?: () => boolean
    onProgress?: (progress: PipelineProgress) => void
  } = {},
): Promise<ProcessImageResult> => {
  if (
    !(request.input instanceof ArrayBuffer) ||
    request.input.byteLength <= 0 ||
    request.input.byteLength > MAX_IMAGE_BYTES
  ) {
    throw new RangeError('Input images must be between 1 byte and 50 MB.')
  }
  if (
    request.inputMimeType !== 'image/png' &&
    request.inputMimeType !== 'image/jpeg' &&
    request.inputMimeType !== 'image/webp'
  ) {
    throw new TypeError('The input image type is unsupported.')
  }
  if (
    request.output.mimeType !== 'image/png' &&
    request.output.mimeType !== 'image/jpeg' &&
    request.output.mimeType !== 'image/webp'
  ) {
    throw new TypeError('The output image type is unsupported.')
  }
  if (
    !Array.isArray(request.commands) ||
    request.commands.length > MAX_AUTOMATION_COMMANDS
  ) {
    throw new RangeError(
      `The image pipeline supports at most ${MAX_AUTOMATION_COMMANDS} commands.`,
    )
  }
  if (
    request.output.quality !== undefined &&
    (!Number.isFinite(request.output.quality) ||
      request.output.quality <= 0 ||
      request.output.quality > 1)
  ) {
    throw new RangeError('Output quality must be greater than 0 and at most 1.')
  }
  validateResolvedCommands(request.commands)
  const header = new Uint8Array(
    request.input,
    0,
    Math.min(request.input.byteLength, IMAGE_HEADER_READ_BYTES),
  )
  const declaredDimensions = parseImageDimensions(header, request.inputMimeType)
  if (!declaredDimensions) {
    throw new TypeError('The image header is invalid or unsupported.')
  }
  assertSafeImageDimensions(declaredDimensions)
  const runtime = options.runtime ?? browserImagePipelineRuntime
  const report = (phase: PipelineProgressPhase, progress: number): void =>
    options.onProgress?.({ phase, progress: clamp(progress, 0, 1) })

  assertNotCancelled(options.isCancelled)
  report('decode', 0)
  const decoded = await runtime.decode(request.input, request.inputMimeType)
  try {
    assertSafeImageDimensions({
      width: decoded.width,
      height: decoded.height,
    })
    if (
      !imageDimensionsMatchHeader(
        { width: decoded.width, height: decoded.height },
        declaredDimensions,
      )
    ) {
      throw new TypeError(
        'The decoded dimensions do not match the image header.',
      )
    }
    assertNotCancelled(options.isCancelled)
    const initial = runtime.createCanvas(decoded.width, decoded.height)
    requireContext(initial).drawImage(decoded.source, 0, 0)
    let canvas = initial
    report('decode', 1)

    for (let index = 0; index < request.commands.length; index += 1) {
      assertNotCancelled(options.isCancelled)
      const command = request.commands[index]
      switch (command.type) {
        case 'resizeImage':
          canvas = resizeCanvas(canvas, command, runtime)
          break
        case 'applyFilter':
          canvas = applyFilter(canvas, command, runtime)
          break
        case 'addWatermark':
          addWatermark(canvas, command)
          break
        case 'resizeCanvas':
        case 'addText':
        case 'runScript':
          throw new TypeError(
            `Command "${command.type}" is not supported by the image worker.`,
          )
      }
      report('commands', (index + 1) / Math.max(1, request.commands.length))
      // Give the worker event loop a chance to receive a cancellation message.
      await yieldToEventLoop()
    }

    assertNotCancelled(options.isCancelled)
    report('encode', 0)
    const quality = clamp(request.output.quality ?? 0.92, 0.01, 1)
    const blob = await runtime.encode(canvas, request.output.mimeType, quality)
    if (blob.type && blob.type !== request.output.mimeType) {
      throw new Error(
        `The browser encoded ${blob.type} instead of ${request.output.mimeType}.`,
      )
    }
    assertNotCancelled(options.isCancelled)
    report('encode', 1)
    return {
      data: await blob.arrayBuffer(),
      mimeType: request.output.mimeType,
      width: canvas.width,
      height: canvas.height,
    }
  } finally {
    decoded.close?.()
  }
}

export const browserImagePipelineRuntime: ImagePipelineRuntime = {
  async decode(input, mimeType) {
    if (typeof globalThis.createImageBitmap !== 'function') {
      throw new Error('ImageBitmap decoding is not supported in this browser.')
    }
    const bitmap = await globalThis.createImageBitmap(
      new Blob([input], { type: mimeType }),
    )
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }
  },
  createCanvas(width, height) {
    if (typeof globalThis.OffscreenCanvas !== 'function') {
      throw new Error('OffscreenCanvas is not supported in this browser.')
    }
    const canvas = new OffscreenCanvas(width, height)
    return {
      width: canvas.width,
      height: canvas.height,
      drawable: canvas,
      getContext: () =>
        canvas.getContext('2d', {
          alpha: true,
          willReadFrequently: false,
        }) as unknown as PipelineDrawingContext | null,
      // Keep the native canvas reachable by encode and drawImage.
      nativeCanvas: canvas,
    } as PipelineCanvas & { nativeCanvas: OffscreenCanvas }
  },
  async encode(canvas, mimeType, quality) {
    const native = (
      canvas as PipelineCanvas & { nativeCanvas?: OffscreenCanvas }
    ).nativeCanvas
    if (!native) {
      throw new Error('The pipeline canvas cannot be encoded.')
    }
    return native.convertToBlob({ type: mimeType, quality })
  },
}
