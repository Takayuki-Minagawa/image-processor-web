import type { PixelBuffer } from '../editor/filters/types'
import type {
  BackgroundSegmentationAdapter,
  SegmentationContext,
} from './segmentation'

export const DEFAULT_ONNX_SEGMENTATION_INPUT_SIZE = 320
export const MAX_ONNX_SEGMENTATION_INPUT_PIXELS = 4 * 1024 * 1024

export type OnnxNumericData = ArrayLike<number>

/**
 * Small structural subset of an ONNX tensor. A bridge for onnxruntime-web can
 * return its native Tensor because it exposes the same data/dims properties.
 */
export interface OnnxTensorLike {
  readonly data: OnnxNumericData
  readonly dims: readonly number[]
}

/** Minimal inference-session surface required by the segmentation adapter. */
export interface OnnxInferenceSessionLike {
  run(
    feeds: Readonly<Record<string, OnnxTensorLike>>,
  ): Promise<Readonly<Record<string, OnnxTensorLike>>>
}

/**
 * Runtime-neutral factory. The application supplies this from a dynamic import
 * so onnxruntime-web and its WASM assets never enter the initial bundle.
 */
export interface OnnxSessionFactory {
  createTensor(data: Float32Array, dims: readonly number[]): OnnxTensorLike
  createSession(modelBytes: Uint8Array): Promise<OnnxInferenceSessionLike>
}

export type OnnxSessionFactoryLoader = () => Promise<OnnxSessionFactory>

export type RgbTuple = readonly [number, number, number]

export interface OnnxInputSize {
  width: number
  height: number
}

export interface RgbaToNchwOptions {
  inputSize?: number | OnnxInputSize
  mean?: RgbTuple
  standardDeviation?: RgbTuple
  channelOrder?: 'rgb' | 'bgr'
  alphaBackground?: RgbTuple
}

export interface OnnxSegmentationAdapterOptions extends RgbaToNchwOptions {
  id: string
  modelBytes: Uint8Array
  loadSessionFactory: OnnxSessionFactoryLoader
  inputName?: string
  outputName?: string
  outputChannel?: number
  outputActivation?: 'probability' | 'sigmoid'
  outputScale?: number
}

interface ResolvedPreprocessOptions {
  inputSize: OnnxInputSize
  mean: RgbTuple
  standardDeviation: RgbTuple
  channelOrder: 'rgb' | 'bgr'
  alphaBackground: RgbTuple
}

interface OutputPlane {
  data: OnnxNumericData
  offset: number
  width: number
  height: number
}

const DEFAULT_MEAN: RgbTuple = [0.485, 0.456, 0.406]
const DEFAULT_STANDARD_DEVIATION: RgbTuple = [0.229, 0.224, 0.225]
const DEFAULT_ALPHA_BACKGROUND: RgbTuple = [0, 0, 0]

const abortError = (): DOMException =>
  new DOMException('ONNX segmentation was cancelled.', 'AbortError')

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw abortError()
  }
}

const finiteInteger = (
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    )
  }
  return value
}

const finiteTuple = (
  value: RgbTuple | undefined,
  fallback: RgbTuple,
  label: string,
  minimum: number,
  maximum: number,
  disallowZero = false,
): RgbTuple => {
  const resolved = value ?? fallback
  if (
    resolved.length !== 3 ||
    resolved.some(
      (entry) =>
        !Number.isFinite(entry) ||
        entry < minimum ||
        entry > maximum ||
        (disallowZero && entry === 0),
    )
  ) {
    throw new RangeError(
      `${label} must contain three finite values from ${minimum} to ${maximum}.`,
    )
  }
  return [resolved[0], resolved[1], resolved[2]]
}

const resolveInputSize = (
  value: number | OnnxInputSize | undefined,
): OnnxInputSize => {
  const candidate =
    typeof value === 'number'
      ? { width: value, height: value }
      : (value ?? {
          width: DEFAULT_ONNX_SEGMENTATION_INPUT_SIZE,
          height: DEFAULT_ONNX_SEGMENTATION_INPUT_SIZE,
        })
  const width = finiteInteger(candidate.width, 1, 4_096, 'ONNX input width')
  const height = finiteInteger(candidate.height, 1, 4_096, 'ONNX input height')
  if (width * height > MAX_ONNX_SEGMENTATION_INPUT_PIXELS) {
    throw new RangeError(
      `ONNX input must not exceed ${MAX_ONNX_SEGMENTATION_INPUT_PIXELS} pixels.`,
    )
  }
  return { width, height }
}

const resolvePreprocessOptions = (
  options: RgbaToNchwOptions,
): ResolvedPreprocessOptions => {
  const channelOrder = options.channelOrder ?? 'rgb'
  if (channelOrder !== 'rgb' && channelOrder !== 'bgr') {
    throw new TypeError('channelOrder must be "rgb" or "bgr".')
  }
  return {
    inputSize: resolveInputSize(options.inputSize),
    mean: finiteTuple(options.mean, DEFAULT_MEAN, 'mean', -10, 10),
    standardDeviation: finiteTuple(
      options.standardDeviation,
      DEFAULT_STANDARD_DEVIATION,
      'standardDeviation',
      0,
      10,
      true,
    ),
    channelOrder,
    alphaBackground: finiteTuple(
      options.alphaBackground,
      DEFAULT_ALPHA_BACKGROUND,
      'alphaBackground',
      0,
      255,
    ),
  }
}

const assertPixelBuffer = (image: PixelBuffer): void => {
  const pixels = image.width * image.height
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    !Number.isSafeInteger(pixels) ||
    pixels > 64 * 1024 * 1024 ||
    !(image.data instanceof Uint8ClampedArray) ||
    image.data.length !== pixels * 4
  ) {
    throw new RangeError('ONNX preprocessing requires a bounded RGBA image.')
  }
}

const sampledRgba = (
  image: PixelBuffer,
  sourceX: number,
  sourceY: number,
): readonly [number, number, number, number] => {
  const left = Math.max(0, Math.min(image.width - 1, Math.floor(sourceX)))
  const top = Math.max(0, Math.min(image.height - 1, Math.floor(sourceY)))
  const right = Math.min(image.width - 1, left + 1)
  const bottom = Math.min(image.height - 1, top + 1)
  const xWeight = Math.max(0, Math.min(1, sourceX - left))
  const yWeight = Math.max(0, Math.min(1, sourceY - top))
  const sample = (x: number, y: number, channel: number): number =>
    image.data[(y * image.width + x) * 4 + channel]
  const channels = [0, 1, 2, 3].map((channel) => {
    const upper =
      sample(left, top, channel) * (1 - xWeight) +
      sample(right, top, channel) * xWeight
    const lower =
      sample(left, bottom, channel) * (1 - xWeight) +
      sample(right, bottom, channel) * xWeight
    return upper * (1 - yWeight) + lower * yWeight
  })
  return [channels[0], channels[1], channels[2], channels[3]]
}

/**
 * Bilinearly resizes RGBA pixels and emits a normalized planar [1,3,H,W]
 * tensor payload. Transparent pixels are composited over alphaBackground
 * before normalization so hidden RGB bytes cannot influence inference.
 */
export const rgbaToNchw = (
  image: PixelBuffer,
  options: RgbaToNchwOptions = {},
): {
  data: Float32Array
  dims: readonly [1, 3, number, number]
  width: number
  height: number
} => {
  assertPixelBuffer(image)
  const resolved = resolvePreprocessOptions(options)
  const { width, height } = resolved.inputSize
  const planeSize = width * height
  const output = new Float32Array(planeSize * 3)
  const channelIndices =
    resolved.channelOrder === 'rgb'
      ? ([0, 1, 2] as const)
      : ([2, 1, 0] as const)

  for (let y = 0; y < height; y += 1) {
    const sourceY = ((y + 0.5) * image.height) / height - 0.5
    for (let x = 0; x < width; x += 1) {
      const sourceX = ((x + 0.5) * image.width) / width - 0.5
      const rgba = sampledRgba(image, sourceX, sourceY)
      const alpha = rgba[3] / 255
      const destination = y * width + x
      channelIndices.forEach((sourceChannel, outputChannel) => {
        const composed =
          rgba[sourceChannel] * alpha +
          resolved.alphaBackground[sourceChannel] * (1 - alpha)
        output[outputChannel * planeSize + destination] =
          (composed / 255 - resolved.mean[outputChannel]) /
          resolved.standardDeviation[outputChannel]
      })
    }
  }

  return {
    data: output,
    dims: [1, 3, height, width],
    width,
    height,
  }
}

/**
 * Center-aligned bilinear resize for a single-channel probability plane.
 */
export const bilinearUpsampleMask = (
  source: OnnxNumericData,
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
  sourceOffset = 0,
): Float32Array => {
  finiteInteger(sourceWidth, 1, 65_536, 'Source mask width')
  finiteInteger(sourceHeight, 1, 65_536, 'Source mask height')
  finiteInteger(destinationWidth, 1, 65_536, 'Destination mask width')
  finiteInteger(destinationHeight, 1, 65_536, 'Destination mask height')
  const sourcePixels = sourceWidth * sourceHeight
  const destinationPixels = destinationWidth * destinationHeight
  if (
    !Number.isSafeInteger(sourcePixels) ||
    sourcePixels > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset + sourcePixels > source.length ||
    !Number.isSafeInteger(destinationPixels) ||
    destinationPixels > 64 * 1024 * 1024
  ) {
    throw new RangeError('The ONNX output mask has invalid dimensions.')
  }

  const output = new Float32Array(destinationPixels)
  const read = (x: number, y: number): number => {
    const value = Number(source[sourceOffset + y * sourceWidth + x])
    if (!Number.isFinite(value)) {
      throw new TypeError('The ONNX output mask contains a non-finite value.')
    }
    return value
  }

  for (let y = 0; y < destinationHeight; y += 1) {
    const sourceY = ((y + 0.5) * sourceHeight) / destinationHeight - 0.5
    const top = Math.max(0, Math.min(sourceHeight - 1, Math.floor(sourceY)))
    const bottom = Math.min(sourceHeight - 1, top + 1)
    const yWeight = Math.max(0, Math.min(1, sourceY - top))
    for (let x = 0; x < destinationWidth; x += 1) {
      const sourceX = ((x + 0.5) * sourceWidth) / destinationWidth - 0.5
      const left = Math.max(0, Math.min(sourceWidth - 1, Math.floor(sourceX)))
      const right = Math.min(sourceWidth - 1, left + 1)
      const xWeight = Math.max(0, Math.min(1, sourceX - left))
      const upper = read(left, top) * (1 - xWeight) + read(right, top) * xWeight
      const lower =
        read(left, bottom) * (1 - xWeight) + read(right, bottom) * xWeight
      output[y * destinationWidth + x] = upper * (1 - yWeight) + lower * yWeight
    }
  }
  return output
}

const dimension = (value: number, label: string): number =>
  finiteInteger(value, 1, 65_536, label)

const resolveOutputPlane = (
  tensor: OnnxTensorLike,
  outputChannel: number,
): OutputPlane => {
  const dims = [...tensor.dims]
  if (dims.some((entry) => !Number.isSafeInteger(entry) || entry <= 0)) {
    throw new RangeError('The ONNX output tensor has invalid dimensions.')
  }

  let channels: number
  let width: number
  let height: number
  if (dims.length === 4) {
    if (dims[0] !== 1) {
      throw new RangeError('The ONNX output tensor batch dimension must be 1.')
    }
    channels = dimension(dims[1], 'ONNX output channels')
    height = dimension(dims[2], 'ONNX output height')
    width = dimension(dims[3], 'ONNX output width')
  } else if (dims.length === 3) {
    channels = dimension(dims[0], 'ONNX output channels')
    height = dimension(dims[1], 'ONNX output height')
    width = dimension(dims[2], 'ONNX output width')
  } else if (dims.length === 2) {
    channels = 1
    height = dimension(dims[0], 'ONNX output height')
    width = dimension(dims[1], 'ONNX output width')
  } else {
    throw new RangeError(
      'The ONNX output tensor must have [1,C,H,W], [C,H,W], or [H,W] dimensions.',
    )
  }

  if (
    !Number.isSafeInteger(outputChannel) ||
    outputChannel < 0 ||
    outputChannel >= channels
  ) {
    throw new RangeError('The configured ONNX output channel is unavailable.')
  }
  const planePixels = width * height
  const expectedValues = channels * planePixels
  if (
    !Number.isSafeInteger(planePixels) ||
    planePixels > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(expectedValues) ||
    expectedValues > tensor.data.length
  ) {
    throw new RangeError('The ONNX output tensor data is truncated.')
  }
  return {
    data: tensor.data,
    offset: outputChannel * planePixels,
    width,
    height,
  }
}

const probability = (
  value: number,
  activation: 'probability' | 'sigmoid',
  scale: number,
): number => {
  if (!Number.isFinite(value)) {
    throw new TypeError('The ONNX output mask contains a non-finite value.')
  }
  const scaled = value * scale
  const activated =
    activation === 'sigmoid'
      ? scaled >= 0
        ? 1 / (1 + Math.exp(-scaled))
        : Math.exp(scaled) / (1 + Math.exp(scaled))
      : scaled
  return Math.max(0, Math.min(1, activated))
}

/**
 * Creates a BackgroundSegmentationAdapter without importing an ONNX runtime.
 * Runtime loading and session creation are deferred until the first segment().
 */
export const createOnnxSegmentationAdapter = (
  options: OnnxSegmentationAdapterOptions,
): BackgroundSegmentationAdapter => {
  if (
    typeof options.id !== 'string' ||
    !/^[a-z0-9][a-z0-9._@-]{0,199}$/i.test(options.id)
  ) {
    throw new TypeError('The ONNX segmentation adapter id is invalid.')
  }
  if (
    !(options.modelBytes instanceof Uint8Array) ||
    options.modelBytes.length === 0
  ) {
    throw new TypeError('The ONNX model must contain bytes.')
  }
  if (typeof options.loadSessionFactory !== 'function') {
    throw new TypeError('An ONNX session factory loader is required.')
  }
  const inputName = options.inputName ?? 'input'
  const outputName = options.outputName ?? 'output'
  if (
    !/^[a-z0-9][a-z0-9_.:/-]{0,199}$/i.test(inputName) ||
    !/^[a-z0-9][a-z0-9_.:/-]{0,199}$/i.test(outputName)
  ) {
    throw new TypeError('ONNX input and output names must be safe identifiers.')
  }
  const outputChannel = options.outputChannel ?? 0
  if (!Number.isSafeInteger(outputChannel) || outputChannel < 0) {
    throw new RangeError('ONNX outputChannel must be a non-negative integer.')
  }
  const outputScale = options.outputScale ?? 1
  if (!Number.isFinite(outputScale) || outputScale <= 0) {
    throw new RangeError('ONNX outputScale must be a positive finite number.')
  }
  const outputActivation = options.outputActivation ?? 'probability'
  if (outputActivation !== 'probability' && outputActivation !== 'sigmoid') {
    throw new TypeError('ONNX outputActivation is unsupported.')
  }
  // Validate preprocessing configuration without allocating a tensor.
  resolvePreprocessOptions(options)
  const stableModel = new Uint8Array(options.modelBytes)
  let sessionPromise:
    | Promise<{
        factory: OnnxSessionFactory
        session: OnnxInferenceSessionLike
      }>
    | undefined

  const session = (): Promise<{
    factory: OnnxSessionFactory
    session: OnnxInferenceSessionLike
  }> => {
    if (!sessionPromise) {
      sessionPromise = options
        .loadSessionFactory()
        .then(async (factory) => {
          if (
            !factory ||
            typeof factory.createTensor !== 'function' ||
            typeof factory.createSession !== 'function'
          ) {
            throw new TypeError('The ONNX session factory is invalid.')
          }
          return {
            factory,
            session: await factory.createSession(new Uint8Array(stableModel)),
          }
        })
        .catch((error: unknown) => {
          sessionPromise = undefined
          throw error
        })
    }
    return sessionPromise
  }

  return {
    id: options.id,
    async segment(
      image: PixelBuffer,
      context: SegmentationContext,
    ): Promise<Float32Array> {
      throwIfAborted(context.signal)
      context.reportProgress?.(0.05, 'prepare')
      const input = rgbaToNchw(image, options)
      context.reportProgress?.(0.35, 'prepare')
      throwIfAborted(context.signal)
      const runtime = await session()
      throwIfAborted(context.signal)
      context.reportProgress?.(0.4, 'infer')
      const outputs = await runtime.session.run({
        [inputName]: runtime.factory.createTensor(input.data, input.dims),
      })
      throwIfAborted(context.signal)
      context.reportProgress?.(0.85, 'infer')
      const output = outputs[outputName]
      if (!output) {
        throw new Error(`ONNX output "${outputName}" was not returned.`)
      }
      const plane = resolveOutputPlane(output, outputChannel)
      const upsampled = bilinearUpsampleMask(
        plane.data,
        plane.width,
        plane.height,
        image.width,
        image.height,
        plane.offset,
      )
      for (let index = 0; index < upsampled.length; index += 1) {
        upsampled[index] = probability(
          upsampled[index],
          outputActivation,
          outputScale,
        )
      }
      throwIfAborted(context.signal)
      context.reportProgress?.(1, 'compose')
      return upsampled
    },
  }
}
