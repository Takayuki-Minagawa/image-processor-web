import type { ImageFilterSettings } from '../fabricEngine'
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from '../../lib/imageSafety'
import { SelectionMask } from '../../selection/mask'
import { applyFilterChainCpu } from './cpu'
import type { FilterOperation, PixelBuffer } from './types'

const EPSILON = 0.000_001
const MAXIMUM_BLUR_RADIUS = 24
const ABORT_CHECK_ROW_INTERVAL = 16

export type SelectionFilterMask = SelectionMask | Uint8Array | Uint8ClampedArray

export type SelectionFilterProgressStage =
  'prepare' | 'adjust' | 'effects' | 'blend'

export interface SelectionFilterProgress {
  progress: number
  stage: SelectionFilterProgressStage
}

export interface SelectionFilterRuntime {
  signal?: AbortSignal
  isCancelled?: () => boolean
  onProgress?: (progress: SelectionFilterProgress) => void
}

export const DEFAULT_SELECTION_FILTER_SETTINGS: Required<ImageFilterSettings> =
  Object.freeze({
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    blur: 0,
    grayscale: false,
    sharpen: 0,
    emboss: 0,
    noise: 0,
    pixelate: 1,
    sepia: 0,
    invert: 0,
    gamma: 1,
    temperature: 0,
    tint: 0,
    vignette: 0,
    duotone: 0,
    halftone: 0,
    glitch: 0,
  })

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const clampByte = (value: number): number => clamp(Math.round(value), 0, 255)

const finiteSetting = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, minimum, maximum)
    : fallback

export const normalizeSelectionFilterSettings = (
  settings: ImageFilterSettings,
): Required<ImageFilterSettings> => ({
  brightness: finiteSetting(settings?.brightness, 0, -1, 1),
  contrast: finiteSetting(settings?.contrast, 0, -1, 1),
  saturation: finiteSetting(settings?.saturation, 0, -1, 1),
  hue: finiteSetting(settings?.hue, 0, -1, 1),
  blur: finiteSetting(settings?.blur, 0, 0, 1),
  grayscale: Boolean(settings?.grayscale),
  sharpen: finiteSetting(settings?.sharpen, 0, 0, 2),
  emboss: finiteSetting(settings?.emboss, 0, 0, 2),
  noise: finiteSetting(settings?.noise, 0, 0, 1),
  pixelate: Math.round(finiteSetting(settings?.pixelate, 1, 1, 128)),
  sepia: finiteSetting(settings?.sepia, 0, 0, 1),
  invert: finiteSetting(settings?.invert, 0, 0, 1),
  gamma: finiteSetting(settings?.gamma, 1, 0.1, 2.2),
  temperature: finiteSetting(settings?.temperature, 0, -1, 1),
  tint: finiteSetting(settings?.tint, 0, -1, 1),
  vignette: finiteSetting(settings?.vignette, 0, 0, 1),
  duotone: finiteSetting(settings?.duotone, 0, 0, 1),
  halftone: finiteSetting(settings?.halftone, 0, 0, 1),
  glitch: finiteSetting(settings?.glitch, 0, 0, 1),
})

export const assertSelectionFilterImage = (image: PixelBuffer): void => {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.width > MAX_IMAGE_DIMENSION ||
    image.height > MAX_IMAGE_DIMENSION ||
    image.width * image.height > MAX_IMAGE_PIXELS ||
    !(image.data instanceof Uint8ClampedArray) ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new RangeError(
      'Selection filter image must be valid RGBA data within the 8,192 px / 64 MP limit.',
    )
  }
}

export const selectionFilterMaskToBytes = (
  image: Pick<PixelBuffer, 'width' | 'height'>,
  mask: SelectionFilterMask,
): Uint8Array => {
  let bytes: Uint8Array
  if (mask instanceof SelectionMask) {
    if (mask.width !== image.width || mask.height !== image.height) {
      throw new RangeError(
        'Selection mask dimensions must match the filtered image.',
      )
    }
    bytes = mask.toBytes()
  } else if (mask instanceof Uint8Array || mask instanceof Uint8ClampedArray) {
    bytes = new Uint8Array(mask)
  } else {
    throw new TypeError(
      'Selection filter mask must be a SelectionMask or 8-bit byte array.',
    )
  }
  if (bytes.length !== image.width * image.height) {
    throw new RangeError(
      'Selection mask byte length must match the filtered image dimensions.',
    )
  }
  return bytes
}

const throwIfAborted = (runtime: SelectionFilterRuntime): void => {
  if (runtime.signal?.aborted || runtime.isCancelled?.()) {
    throw new DOMException('Selection filtering was cancelled.', 'AbortError')
  }
}

const reportProgress = (
  runtime: SelectionFilterRuntime,
  progress: number,
  stage: SelectionFilterProgressStage,
): void => {
  throwIfAborted(runtime)
  runtime.onProgress?.({ progress: clamp(progress, 0, 1), stage })
  throwIfAborted(runtime)
}

const cloneImage = (image: PixelBuffer): PixelBuffer => ({
  width: image.width,
  height: image.height,
  data: new Uint8ClampedArray(image.data),
})

const shouldCheckRow = (row: number): boolean =>
  row % ABORT_CHECK_ROW_INTERVAL === 0

const applyColorAdjustments = (
  image: PixelBuffer,
  settings: Required<ImageFilterSettings>,
  runtime: SelectionFilterRuntime,
): PixelBuffer => {
  const output = cloneImage(image)
  const hasColorAdjustment =
    Math.abs(settings.brightness) > EPSILON ||
    Math.abs(settings.contrast) > EPSILON ||
    Math.abs(settings.saturation) > EPSILON ||
    Math.abs(settings.hue) > EPSILON
  if (!hasColorAdjustment) {
    return output
  }

  const brightness = settings.brightness * 255
  const contrast = 1 + settings.contrast
  const saturation = 1 + settings.saturation
  const angle = settings.hue * Math.PI
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const hueMatrix = [
    0.213 + cosine * 0.787 - sine * 0.213,
    0.715 - cosine * 0.715 - sine * 0.715,
    0.072 - cosine * 0.072 + sine * 0.928,
    0.213 - cosine * 0.213 + sine * 0.143,
    0.715 + cosine * 0.285 + sine * 0.14,
    0.072 - cosine * 0.072 - sine * 0.283,
    0.213 - cosine * 0.213 - sine * 0.787,
    0.715 - cosine * 0.715 + sine * 0.715,
    0.072 + cosine * 0.928 + sine * 0.072,
  ] as const

  for (let y = 0; y < image.height; y += 1) {
    if (shouldCheckRow(y)) throwIfAborted(runtime)
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      let red = (image.data[offset] + brightness - 127.5) * contrast + 127.5
      let green =
        (image.data[offset + 1] + brightness - 127.5) * contrast + 127.5
      let blue =
        (image.data[offset + 2] + brightness - 127.5) * contrast + 127.5

      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
      red = luminance + (red - luminance) * saturation
      green = luminance + (green - luminance) * saturation
      blue = luminance + (blue - luminance) * saturation

      output.data[offset] = clampByte(
        red * hueMatrix[0] + green * hueMatrix[1] + blue * hueMatrix[2],
      )
      output.data[offset + 1] = clampByte(
        red * hueMatrix[3] + green * hueMatrix[4] + blue * hueMatrix[5],
      )
      output.data[offset + 2] = clampByte(
        red * hueMatrix[6] + green * hueMatrix[7] + blue * hueMatrix[8],
      )
    }
  }
  return output
}

/**
 * Sliding-window separable box blur. Runtime is O(width * height) regardless
 * of radius, avoiding the quadratic-per-pixel kernels that stall large images.
 */
const applySeparableBoxBlur = (
  image: PixelBuffer,
  radius: number,
  runtime: SelectionFilterRuntime,
): PixelBuffer => {
  if (radius <= 0) return cloneImage(image)
  const horizontal = new Uint8ClampedArray(image.data.length)
  const output = new Uint8ClampedArray(image.data.length)

  for (let y = 0; y < image.height; y += 1) {
    if (shouldCheckRow(y)) throwIfAborted(runtime)
    const sums = [0, 0, 0, 0]
    let count = 0
    for (let x = 0; x < image.width; x += 1) {
      const entering = x + radius
      if (entering < image.width) {
        const enteringOffset = (y * image.width + entering) * 4
        for (let channel = 0; channel < 4; channel += 1) {
          sums[channel] += image.data[enteringOffset + channel]
        }
        count += 1
      }
      if (x === 0) {
        for (
          let sampleX = 0;
          sampleX < Math.min(radius, image.width);
          sampleX += 1
        ) {
          const sampleOffset = (y * image.width + sampleX) * 4
          for (let channel = 0; channel < 4; channel += 1) {
            sums[channel] += image.data[sampleOffset + channel]
          }
          count += 1
        }
      } else {
        const leaving = x - radius - 1
        if (leaving >= 0) {
          const leavingOffset = (y * image.width + leaving) * 4
          for (let channel = 0; channel < 4; channel += 1) {
            sums[channel] -= image.data[leavingOffset + channel]
          }
          count -= 1
        }
      }
      const outputOffset = (y * image.width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        horizontal[outputOffset + channel] = Math.round(sums[channel] / count)
      }
    }
  }

  for (let x = 0; x < image.width; x += 1) {
    if (shouldCheckRow(x)) throwIfAborted(runtime)
    const sums = [0, 0, 0, 0]
    let count = 0
    for (let y = 0; y < image.height; y += 1) {
      const entering = y + radius
      if (entering < image.height) {
        const enteringOffset = (entering * image.width + x) * 4
        for (let channel = 0; channel < 4; channel += 1) {
          sums[channel] += horizontal[enteringOffset + channel]
        }
        count += 1
      }
      if (y === 0) {
        for (
          let sampleY = 0;
          sampleY < Math.min(radius, image.height);
          sampleY += 1
        ) {
          const sampleOffset = (sampleY * image.width + x) * 4
          for (let channel = 0; channel < 4; channel += 1) {
            sums[channel] += horizontal[sampleOffset + channel]
          }
          count += 1
        }
      } else {
        const leaving = y - radius - 1
        if (leaving >= 0) {
          const leavingOffset = (leaving * image.width + x) * 4
          for (let channel = 0; channel < 4; channel += 1) {
            sums[channel] -= horizontal[leavingOffset + channel]
          }
          count -= 1
        }
      }
      const outputOffset = (y * image.width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        output[outputOffset + channel] = Math.round(sums[channel] / count)
      }
    }
  }
  return { width: image.width, height: image.height, data: output }
}

const applyGrayscale = (
  image: PixelBuffer,
  runtime: SelectionFilterRuntime,
): PixelBuffer => {
  const output = cloneImage(image)
  for (let y = 0; y < image.height; y += 1) {
    if (shouldCheckRow(y)) throwIfAborted(runtime)
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      const luminance = clampByte(
        image.data[offset] * 0.2126 +
          image.data[offset + 1] * 0.7152 +
          image.data[offset + 2] * 0.0722,
      )
      output.data[offset] = luminance
      output.data[offset + 1] = luminance
      output.data[offset + 2] = luminance
    }
  }
  return output
}

const scaleColor = (
  identity: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
  amount: number,
): { r: number; g: number; b: number } => ({
  r: clampByte(identity.r + (target.r - identity.r) * amount),
  g: clampByte(identity.g + (target.g - identity.g) * amount),
  b: clampByte(identity.b + (target.b - identity.b) * amount),
})

/**
 * Maps every additional Fabric filter setting with a CPU equivalent onto the
 * registry contract. Curves and gradient-map have no scalar Fabric setting;
 * all other registry effects are represented deterministically.
 */
export const imageFilterSettingsToFilterOperations = (
  candidate: ImageFilterSettings,
): FilterOperation[] => {
  const settings = normalizeSelectionFilterSettings(candidate)
  const operations: FilterOperation[] = []
  if (settings.sharpen > EPSILON) {
    operations.push({
      id: 'sharpen',
      params: { amount: settings.sharpen },
    })
  }
  if (settings.emboss > EPSILON) {
    operations.push({
      id: 'emboss',
      params: { strength: settings.emboss },
    })
  }
  if (settings.noise > EPSILON) {
    operations.push({
      id: 'noise',
      params: {
        amount: settings.noise,
        seed: 0x51ec710f,
        monochrome: false,
      },
    })
  }
  if (settings.pixelate > 1) {
    operations.push({
      id: 'pixelate',
      params: { size: settings.pixelate },
    })
  }
  if (settings.sepia > EPSILON) {
    operations.push({ id: 'sepia', params: { amount: settings.sepia } })
  }
  if (settings.invert > EPSILON) {
    operations.push({ id: 'invert', params: { amount: settings.invert } })
  }
  if (Math.abs(settings.gamma - 1) > EPSILON) {
    operations.push({
      id: 'levels',
      params: {
        inputBlack: 0,
        inputWhite: 255,
        gamma: settings.gamma,
        outputBlack: 0,
        outputWhite: 255,
      },
    })
  }
  if (
    Math.abs(settings.temperature) > EPSILON ||
    Math.abs(settings.tint) > EPSILON
  ) {
    operations.push({
      id: 'white-balance',
      params: {
        temperature: settings.temperature,
        tint: settings.tint,
      },
    })
  }
  if (settings.vignette > EPSILON) {
    operations.push({
      id: 'vignette',
      params: {
        amount: settings.vignette,
        midpoint: 0.45,
        softness: 0.5,
        color: { r: 17, g: 24, b: 39 },
      },
    })
  }
  if (settings.duotone > EPSILON) {
    operations.push({
      id: 'duotone',
      params: {
        shadows: scaleColor(
          { r: 0, g: 0, b: 0 },
          { r: 24, g: 18, b: 64 },
          settings.duotone,
        ),
        highlights: scaleColor(
          { r: 255, g: 255, b: 255 },
          { r: 255, g: 202, b: 108 },
          settings.duotone,
        ),
      },
    })
  }
  if (settings.halftone > EPSILON) {
    operations.push({
      id: 'halftone',
      params: {
        size: clamp(Math.round(settings.halftone * 18), 2, 64),
        angle: 45,
        foreground: { r: 0, g: 0, b: 0 },
        background: { r: 255, g: 255, b: 255 },
      },
    })
  }
  if (settings.glitch > EPSILON) {
    operations.push({
      id: 'glitch',
      params: {
        amount: settings.glitch,
        offset: Math.round(4 + settings.glitch * 20),
        scanlines: settings.glitch * 0.4,
        seed: 0x6d2b79f5,
      },
    })
  }
  return operations
}

const maskHasSelection = (
  mask: Uint8Array,
  runtime: SelectionFilterRuntime,
): boolean => {
  for (let index = 0; index < mask.length; index += 1) {
    if (index % 65_536 === 0) throwIfAborted(runtime)
    if (mask[index] > 0) return true
  }
  return false
}

const blendWithMask = (
  source: PixelBuffer,
  filtered: PixelBuffer,
  mask: Uint8Array,
  runtime: SelectionFilterRuntime,
): PixelBuffer => {
  const output = cloneImage(source)
  for (let y = 0; y < source.height; y += 1) {
    if (shouldCheckRow(y)) {
      throwIfAborted(runtime)
      reportProgress(runtime, 0.75 + (y / source.height) * 0.25, 'blend')
    }
    for (let x = 0; x < source.width; x += 1) {
      const pixel = y * source.width + x
      const alpha = mask[pixel]
      if (alpha === 0) continue
      const offset = pixel * 4
      if (alpha === 255) {
        output.data.set(filtered.data.subarray(offset, offset + 4), offset)
        continue
      }
      const amount = alpha / 255
      for (let channel = 0; channel < 4; channel += 1) {
        output.data[offset + channel] = clampByte(
          source.data[offset + channel] +
            (filtered.data[offset + channel] - source.data[offset + channel]) *
              amount,
        )
      }
    }
  }
  return output
}

/**
 * Applies Fabric-compatible settings to a full RGBA buffer, then composites
 * the result through the immutable document-space selection mask.
 */
export const applySelectionFilterCpu = (
  image: PixelBuffer,
  mask: SelectionFilterMask,
  candidate: ImageFilterSettings,
  runtime: SelectionFilterRuntime = {},
): PixelBuffer => {
  throwIfAborted(runtime)
  assertSelectionFilterImage(image)
  const maskBytes = selectionFilterMaskToBytes(image, mask)
  const settings = normalizeSelectionFilterSettings(candidate)
  reportProgress(runtime, 0, 'prepare')

  if (!maskHasSelection(maskBytes, runtime)) {
    reportProgress(runtime, 1, 'blend')
    return cloneImage(image)
  }

  let filtered = applyColorAdjustments(image, settings, runtime)
  if (settings.blur > EPSILON) {
    const radius = Math.max(1, Math.round(settings.blur * MAXIMUM_BLUR_RADIUS))
    filtered = applySeparableBoxBlur(filtered, radius, runtime)
  }
  if (settings.grayscale) {
    filtered = applyGrayscale(filtered, runtime)
  }
  reportProgress(runtime, 0.35, 'adjust')

  const operations = imageFilterSettingsToFilterOperations(settings)
  if (operations.length > 0) {
    throwIfAborted(runtime)
    filtered = applyFilterChainCpu(filtered, operations)
    throwIfAborted(runtime)
  }
  reportProgress(runtime, 0.75, 'effects')

  const result = blendWithMask(image, filtered, maskBytes, runtime)
  reportProgress(runtime, 1, 'blend')
  return result
}

/**
 * Applies the exact registry operation chain in a worker-compatible CPU path,
 * then composites it through the document-space 8-bit selection mask.
 */
export const applySelectionFilterOperationsCpu = (
  image: PixelBuffer,
  mask: SelectionFilterMask,
  operations: readonly FilterOperation[],
  runtime: SelectionFilterRuntime = {},
): PixelBuffer => {
  throwIfAborted(runtime)
  assertSelectionFilterImage(image)
  const maskBytes = selectionFilterMaskToBytes(image, mask)
  reportProgress(runtime, 0, 'prepare')

  if (!maskHasSelection(maskBytes, runtime)) {
    reportProgress(runtime, 1, 'blend')
    return cloneImage(image)
  }

  throwIfAborted(runtime)
  const filtered = applyFilterChainCpu(image, operations)
  throwIfAborted(runtime)
  reportProgress(runtime, 0.75, 'effects')

  const result = blendWithMask(image, filtered, maskBytes, runtime)
  reportProgress(runtime, 1, 'blend')
  return result
}
