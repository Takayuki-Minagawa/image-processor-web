import type { PixelBuffer } from '../editor/filters/types'
import { SelectionMask } from '../selection/mask'

export type BackgroundRemovalSource = 'model' | 'deterministic-fallback'

export interface BackgroundRemovalOptions {
  backgroundTolerance?: number
  edgeSoftness?: number
  modelThreshold?: number
  modelSoftness?: number
  fallbackOnModelError?: boolean
}

export interface SegmentationContext {
  signal?: AbortSignal
  reportProgress?(
    progress: number,
    stage: 'prepare' | 'infer' | 'compose',
  ): void
}

export interface BackgroundSegmentationAdapter {
  readonly id: string
  segment(
    image: PixelBuffer,
    context: SegmentationContext,
  ): Promise<Uint8Array | Float32Array>
}

export interface BackgroundRemovalResult {
  width: number
  height: number
  mask: SelectionMask
  rgba: Uint8ClampedArray
  source: BackgroundRemovalSource
  warning?: string
}

const assertImage = (image: PixelBuffer): number => {
  const pixelCount = image.width * image.height
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    !Number.isSafeInteger(pixelCount) ||
    pixelCount > 64 * 1024 * 1024 ||
    !(image.data instanceof Uint8ClampedArray) ||
    image.data.length !== pixelCount * 4
  ) {
    throw new RangeError('Background removal requires a bounded RGBA image.')
  }
  return pixelCount
}

const boundedNumber = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number => {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new RangeError(`${name} must be from ${minimum} to ${maximum}.`)
  }
  return resolved
}

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const position = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return position * position * (3 - 2 * position)
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

const estimateBorderColor = (image: PixelBuffer): readonly number[] => {
  const totals = [0, 0, 0]
  let samples = 0
  const add = (x: number, y: number): void => {
    const offset = (y * image.width + x) * 4
    const alpha = image.data[offset + 3] / 255
    totals[0] += image.data[offset] * alpha
    totals[1] += image.data[offset + 1] * alpha
    totals[2] += image.data[offset + 2] * alpha
    samples += alpha
  }
  for (let x = 0; x < image.width; x += 1) {
    add(x, 0)
    if (image.height > 1) add(x, image.height - 1)
  }
  for (let y = 1; y + 1 < image.height; y += 1) {
    add(0, y)
    if (image.width > 1) add(image.width - 1, y)
  }
  if (samples === 0) return [0, 0, 0]
  return totals.map((total) => total / samples)
}

export const deterministicSubjectMask = (
  image: PixelBuffer,
  options: BackgroundRemovalOptions = {},
  context: SegmentationContext = {},
): SelectionMask => {
  const pixelCount = assertImage(image)
  const tolerance = boundedNumber(
    options.backgroundTolerance,
    24,
    0,
    255,
    'backgroundTolerance',
  )
  const softness = boundedNumber(
    options.edgeSoftness,
    36,
    1,
    255,
    'edgeSoftness',
  )
  const background = estimateBorderColor(image)
  const mask = new Uint8Array(pixelCount)
  context.reportProgress?.(0.05, 'prepare')

  for (let y = 0; y < image.height; y += 1) {
    if ((y & 31) === 0) {
      throwIfAborted(context.signal)
      context.reportProgress?.(0.05 + (y / image.height) * 0.85, 'infer')
    }
    for (let x = 0; x < image.width; x += 1) {
      const pixel = y * image.width + x
      const offset = pixel * 4
      const red = image.data[offset] - background[0]
      const green = image.data[offset + 1] - background[1]
      const blue = image.data[offset + 2] - background[2]
      const distance = Math.sqrt((red * red + green * green + blue * blue) / 3)
      const subject = smoothstep(
        tolerance,
        Math.min(255, tolerance + softness),
        distance,
      )
      mask[pixel] = Math.round(subject * image.data[offset + 3])
    }
  }
  context.reportProgress?.(0.95, 'compose')
  return SelectionMask.fromBytes(image.width, image.height, mask)
}

const normalizeModelMask = (
  output: Uint8Array | Float32Array,
  pixelCount: number,
  threshold: number,
  softness: number,
): Uint8Array => {
  if (!(output instanceof Uint8Array) && !(output instanceof Float32Array)) {
    throw new TypeError('Segmentation adapter returned an unsupported mask.')
  }
  if (output.length !== pixelCount) {
    throw new RangeError(
      'Segmentation adapter mask length does not match the image.',
    )
  }
  const normalized = new Uint8Array(pixelCount)
  for (let index = 0; index < output.length; index += 1) {
    const probability =
      output instanceof Uint8Array
        ? output[index] / 255
        : Math.max(0, Math.min(1, output[index]))
    normalized[index] = Math.round(
      smoothstep(
        Math.max(0, threshold - softness),
        Math.min(1, threshold + softness),
        probability,
      ) * 255,
    )
  }
  return normalized
}

export const applySubjectMask = (
  image: PixelBuffer,
  mask: SelectionMask,
): Uint8ClampedArray => {
  assertImage(image)
  if (image.width !== mask.width || image.height !== mask.height) {
    throw new RangeError('Background mask dimensions must match the image.')
  }
  const output = new Uint8ClampedArray(image.data)
  const alpha = mask.toBytes()
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    output[pixel * 4 + 3] = Math.round(
      (output[pixel * 4 + 3] * alpha[pixel]) / 255,
    )
  }
  return output
}

export const removeBackground = async (
  image: PixelBuffer,
  options: BackgroundRemovalOptions = {},
  context: SegmentationContext = {},
  adapter?: BackgroundSegmentationAdapter,
): Promise<BackgroundRemovalResult> => {
  const pixelCount = assertImage(image)
  throwIfAborted(context.signal)
  let mask: SelectionMask
  let source: BackgroundRemovalSource
  let warning: string | undefined

  if (adapter) {
    try {
      context.reportProgress?.(0.02, 'prepare')
      const modelOutput = await adapter.segment(image, context)
      throwIfAborted(context.signal)
      const threshold = boundedNumber(
        options.modelThreshold,
        0.5,
        0,
        1,
        'modelThreshold',
      )
      const softness = boundedNumber(
        options.modelSoftness,
        0.08,
        0,
        0.5,
        'modelSoftness',
      )
      mask = SelectionMask.fromBytes(
        image.width,
        image.height,
        normalizeModelMask(modelOutput, pixelCount, threshold, softness),
      )
      source = 'model'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }
      if (!(options.fallbackOnModelError ?? false)) {
        throw error
      }
      mask = deterministicSubjectMask(image, options, context)
      source = 'deterministic-fallback'
      warning =
        error instanceof Error
          ? `Model inference failed: ${error.message}`
          : 'Model inference failed.'
    }
  } else {
    mask = deterministicSubjectMask(image, options, context)
    source = 'deterministic-fallback'
  }

  throwIfAborted(context.signal)
  context.reportProgress?.(1, 'compose')
  return {
    width: image.width,
    height: image.height,
    mask,
    rgba: applySubjectMask(image, mask),
    source,
    ...(warning === undefined ? {} : { warning }),
  }
}
