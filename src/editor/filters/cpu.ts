import { validateFilterOperation } from './registry'
import type {
  CurvesParameters,
  FilterOperation,
  GradientStop,
  PixelBuffer,
  RgbColor,
} from './types'

const MAX_CPU_PIXELS = 64 * 1024 * 1024

const clampByte = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)))

const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const normalized = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return normalized * normalized * (3 - 2 * normalized)
}

const assertPixelBuffer = (image: PixelBuffer): void => {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.width * image.height > MAX_CPU_PIXELS ||
    !(image.data instanceof Uint8ClampedArray) ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new RangeError('Invalid or oversized RGBA pixel buffer.')
  }
}

const cloneImage = (image: PixelBuffer): PixelBuffer => ({
  width: image.width,
  height: image.height,
  data: new Uint8ClampedArray(image.data),
})

const pixelOffset = (width: number, x: number, y: number): number =>
  (y * width + x) * 4

const sourceChannel = (
  image: PixelBuffer,
  x: number,
  y: number,
  channel: number,
): number => {
  const safeX = Math.max(0, Math.min(image.width - 1, x))
  const safeY = Math.max(0, Math.min(image.height - 1, y))
  return image.data[pixelOffset(image.width, safeX, safeY) + channel]
}

const applyConvolution = (
  image: PixelBuffer,
  kernel: readonly number[],
  bias = 0,
): PixelBuffer => {
  const output = cloneImage(image)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const outputOffset = pixelOffset(image.width, x, y)
      for (let channel = 0; channel < 3; channel += 1) {
        let value = bias
        for (let kernelY = -1; kernelY <= 1; kernelY += 1) {
          for (let kernelX = -1; kernelX <= 1; kernelX += 1) {
            const coefficient = kernel[(kernelY + 1) * 3 + (kernelX + 1)]
            value +=
              sourceChannel(image, x + kernelX, y + kernelY, channel) *
              coefficient
          }
        }
        output.data[outputOffset + channel] = clampByte(value)
      }
    }
  }
  return output
}

const mixRgb = (
  data: Uint8ClampedArray,
  offset: number,
  target: RgbColor,
  amount: number,
): void => {
  data[offset] = clampByte(lerp(data[offset], target.r, amount))
  data[offset + 1] = clampByte(lerp(data[offset + 1], target.g, amount))
  data[offset + 2] = clampByte(lerp(data[offset + 2], target.b, amount))
}

const luminanceAt = (data: Uint8ClampedArray, offset: number): number =>
  (data[offset] * 0.2126 +
    data[offset + 1] * 0.7152 +
    data[offset + 2] * 0.0722) /
  255

const hash32 = (seed: number, value: number): number => {
  let hash = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d) >>> 0
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b) >>> 0
  return (hash ^ (hash >>> 16)) >>> 0
}

const randomUnit = (seed: number, value: number): number =>
  hash32(seed, value) / 0xffffffff

const applySharpen = (image: PixelBuffer, amount: number): PixelBuffer =>
  applyConvolution(image, [
    0,
    -amount,
    0,
    -amount,
    1 + amount * 4,
    -amount,
    0,
    -amount,
    0,
  ])

// The kernel already sums to 1, so flat regions keep their original value and
// strength 0 is the identity. Adding a 128*strength bias on top of that (as an
// earlier revision did) pushed every mid-tone past 255: a flat 128 image came
// back pure white at the default strength.
const applyEmboss = (image: PixelBuffer, strength: number): PixelBuffer =>
  applyConvolution(image, [
    -2 * strength,
    -strength,
    0,
    -strength,
    1,
    strength,
    0,
    strength,
    2 * strength,
  ])

const applyNoise = (
  image: PixelBuffer,
  amount: number,
  seed: number,
  monochrome: boolean,
): PixelBuffer => {
  const output = cloneImage(image)
  const amplitude = amount * 255
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const offset = pixel * 4
    const shared = (randomUnit(seed, pixel * 3) * 2 - 1) * amplitude
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = monochrome
        ? shared
        : (randomUnit(seed, pixel * 3 + channel) * 2 - 1) * amplitude
      output.data[offset + channel] = clampByte(
        image.data[offset + channel] + delta,
      )
    }
  }
  return output
}

const applyPixelate = (image: PixelBuffer, size: number): PixelBuffer => {
  const output = cloneImage(image)
  for (let top = 0; top < image.height; top += size) {
    for (let left = 0; left < image.width; left += size) {
      const right = Math.min(image.width, left + size)
      const bottom = Math.min(image.height, top + size)
      // Colour is averaged weighted by alpha. These buffers hold straight
      // (un-premultiplied) alpha, so averaging RGB flat would let the
      // arbitrary colour under fully transparent pixels drag the block toward
      // black and leave a dark fringe around every transparent edge.
      let alphaTotal = 0
      let weightedRed = 0
      let weightedGreen = 0
      let weightedBlue = 0
      let count = 0
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = pixelOffset(image.width, x, y)
          const alpha = image.data[offset + 3]
          weightedRed += image.data[offset] * alpha
          weightedGreen += image.data[offset + 1] * alpha
          weightedBlue += image.data[offset + 2] * alpha
          alphaTotal += alpha
          count += 1
        }
      }
      const average =
        alphaTotal === 0
          ? [0, 0, 0, 0]
          : [
              clampByte(weightedRed / alphaTotal),
              clampByte(weightedGreen / alphaTotal),
              clampByte(weightedBlue / alphaTotal),
              clampByte(alphaTotal / count),
            ]
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = pixelOffset(image.width, x, y)
          for (let channel = 0; channel < 4; channel += 1) {
            output.data[offset + channel] = average[channel]
          }
        }
      }
    }
  }
  return output
}

const applySepia = (image: PixelBuffer, amount: number): PixelBuffer => {
  const output = cloneImage(image)
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset]
    const green = image.data[offset + 1]
    const blue = image.data[offset + 2]
    output.data[offset] = clampByte(
      lerp(red, red * 0.393 + green * 0.769 + blue * 0.189, amount),
    )
    output.data[offset + 1] = clampByte(
      lerp(green, red * 0.349 + green * 0.686 + blue * 0.168, amount),
    )
    output.data[offset + 2] = clampByte(
      lerp(blue, red * 0.272 + green * 0.534 + blue * 0.131, amount),
    )
  }
  return output
}

const applyInvert = (image: PixelBuffer, amount: number): PixelBuffer => {
  const output = cloneImage(image)
  for (let offset = 0; offset < image.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const source = image.data[offset + channel]
      output.data[offset + channel] = clampByte(
        lerp(source, 255 - source, amount),
      )
    }
  }
  return output
}

const applyLevels = (
  image: PixelBuffer,
  inputBlack: number,
  inputWhite: number,
  gamma: number,
  outputBlack: number,
  outputWhite: number,
): PixelBuffer => {
  const output = cloneImage(image)
  const inputRange = inputWhite - inputBlack
  const outputRange = outputWhite - outputBlack
  const inverseGamma = 1 / gamma
  const lut = new Uint8ClampedArray(256)
  for (let value = 0; value < 256; value += 1) {
    const normalized = Math.max(
      0,
      Math.min(1, (value - inputBlack) / inputRange),
    )
    lut[value] = clampByte(
      outputBlack + Math.pow(normalized, inverseGamma) * outputRange,
    )
  }
  for (let offset = 0; offset < image.data.length; offset += 4) {
    output.data[offset] = lut[image.data[offset]]
    output.data[offset + 1] = lut[image.data[offset + 1]]
    output.data[offset + 2] = lut[image.data[offset + 2]]
  }
  return output
}

const applyCurves = (
  image: PixelBuffer,
  curves: CurvesParameters,
): PixelBuffer => {
  const output = cloneImage(image)
  const channelCurves = [curves.red, curves.green, curves.blue]
  for (let offset = 0; offset < image.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const channelMapped = channelCurves[channel][image.data[offset + channel]]
      output.data[offset + channel] = curves.master[channelMapped]
    }
  }
  return output
}

const applyWhiteBalance = (
  image: PixelBuffer,
  temperature: number,
  tint: number,
): PixelBuffer => {
  const output = cloneImage(image)
  const temperatureShift = temperature * 48
  const tintShift = tint * 36
  for (let offset = 0; offset < image.data.length; offset += 4) {
    output.data[offset] = clampByte(
      image.data[offset] + temperatureShift - tintShift * 0.25,
    )
    output.data[offset + 1] = clampByte(image.data[offset + 1] + tintShift)
    output.data[offset + 2] = clampByte(
      image.data[offset + 2] - temperatureShift - tintShift * 0.25,
    )
  }
  return output
}

const applyVignette = (
  image: PixelBuffer,
  amount: number,
  midpoint: number,
  softness: number,
  color: RgbColor,
): PixelBuffer => {
  const output = cloneImage(image)
  const centerX = (image.width - 1) / 2
  const centerY = (image.height - 1) / 2
  const scaleX = Math.max(1, centerX)
  const scaleY = Math.max(1, centerY)
  const end = Math.min(1, midpoint + softness)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const normalizedX = (x - centerX) / scaleX
      const normalizedY = (y - centerY) / scaleY
      const distance =
        Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY) /
        Math.SQRT2
      const strength = smoothstep(midpoint, end, distance) * amount
      mixRgb(output.data, pixelOffset(image.width, x, y), color, strength)
    }
  }
  return output
}

const interpolateGradient = (
  stops: readonly GradientStop[],
  position: number,
): RgbColor => {
  const upperIndex = stops.findIndex((stop) => stop.offset >= position)
  if (upperIndex <= 0) return stops[0].color
  const lower = stops[upperIndex - 1]
  const upper = stops[upperIndex]
  const amount = (position - lower.offset) / (upper.offset - lower.offset)
  return {
    r: clampByte(lerp(lower.color.r, upper.color.r, amount)),
    g: clampByte(lerp(lower.color.g, upper.color.g, amount)),
    b: clampByte(lerp(lower.color.b, upper.color.b, amount)),
  }
}

const applyGradientMap = (
  image: PixelBuffer,
  stops: readonly GradientStop[],
): PixelBuffer => {
  const output = cloneImage(image)
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const color = interpolateGradient(stops, luminanceAt(image.data, offset))
    output.data[offset] = color.r
    output.data[offset + 1] = color.g
    output.data[offset + 2] = color.b
  }
  return output
}

const applyDuotone = (
  image: PixelBuffer,
  shadows: RgbColor,
  highlights: RgbColor,
): PixelBuffer =>
  applyGradientMap(image, [
    { offset: 0, color: shadows },
    { offset: 1, color: highlights },
  ])

const applyHalftone = (
  image: PixelBuffer,
  size: number,
  angle: number,
  foreground: RgbColor,
  background: RgbColor,
): PixelBuffer => {
  const output = cloneImage(image)
  const radians = (angle * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const centerX = (image.width - 1) / 2
  const centerY = (image.height - 1) / 2

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const relativeX = x - centerX
      const relativeY = y - centerY
      const rotatedX = relativeX * cosine + relativeY * sine
      const rotatedY = -relativeX * sine + relativeY * cosine
      const cellX = Math.floor(rotatedX / size) * size + size / 2
      const cellY = Math.floor(rotatedY / size) * size + size / 2
      const sampleX = Math.max(
        0,
        Math.min(
          image.width - 1,
          Math.round(cellX * cosine - cellY * sine + centerX),
        ),
      )
      const sampleY = Math.max(
        0,
        Math.min(
          image.height - 1,
          Math.round(cellX * sine + cellY * cosine + centerY),
        ),
      )
      const sampleOffset = pixelOffset(image.width, sampleX, sampleY)
      const darkness = 1 - luminanceAt(image.data, sampleOffset)
      const radius = Math.sqrt(darkness) * size * 0.52
      const distance = Math.hypot(rotatedX - cellX, rotatedY - cellY)
      const color = distance <= radius ? foreground : background
      const offset = pixelOffset(image.width, x, y)
      output.data[offset] = color.r
      output.data[offset + 1] = color.g
      output.data[offset + 2] = color.b
    }
  }
  return output
}

const wrap = (value: number, maximum: number): number =>
  ((value % maximum) + maximum) % maximum

const applyGlitch = (
  image: PixelBuffer,
  amount: number,
  maximumOffset: number,
  scanlines: number,
  seed: number,
): PixelBuffer => {
  const output = cloneImage(image)
  for (let y = 0; y < image.height; y += 1) {
    const active = randomUnit(seed, y * 2) < amount
    const direction = randomUnit(seed, y * 2 + 1) < 0.5 ? -1 : 1
    const rowShift = active
      ? Math.round(randomUnit(seed ^ 0xa5a5a5a5, y) * maximumOffset * direction)
      : 0
    const colorSplit = Math.round(maximumOffset * amount * 0.5)
    const darken = y % 2 === 1 ? 1 - scanlines * 0.55 : 1
    for (let x = 0; x < image.width; x += 1) {
      const outputOffset = pixelOffset(image.width, x, y)
      const redX = wrap(x + rowShift + colorSplit, image.width)
      const greenX = wrap(x + rowShift, image.width)
      const blueX = wrap(x + rowShift - colorSplit, image.width)
      output.data[outputOffset] = clampByte(
        sourceChannel(image, redX, y, 0) * darken,
      )
      output.data[outputOffset + 1] = clampByte(
        sourceChannel(image, greenX, y, 1) * darken,
      )
      output.data[outputOffset + 2] = clampByte(
        sourceChannel(image, blueX, y, 2) * darken,
      )
    }
  }
  return output
}

export const applyFilterCpu = (
  image: PixelBuffer,
  candidate: FilterOperation,
): PixelBuffer => {
  assertPixelBuffer(image)
  const operation = validateFilterOperation(candidate)
  switch (operation.id) {
    case 'sharpen':
      return applySharpen(image, operation.params.amount)
    case 'emboss':
      return applyEmboss(image, operation.params.strength)
    case 'noise':
      return applyNoise(
        image,
        operation.params.amount,
        operation.params.seed,
        operation.params.monochrome,
      )
    case 'pixelate':
      return applyPixelate(image, operation.params.size)
    case 'sepia':
      return applySepia(image, operation.params.amount)
    case 'invert':
      return applyInvert(image, operation.params.amount)
    case 'levels':
      return applyLevels(
        image,
        operation.params.inputBlack,
        operation.params.inputWhite,
        operation.params.gamma,
        operation.params.outputBlack,
        operation.params.outputWhite,
      )
    case 'curves':
      return applyCurves(image, operation.params)
    case 'white-balance':
      return applyWhiteBalance(
        image,
        operation.params.temperature,
        operation.params.tint,
      )
    case 'vignette':
      return applyVignette(
        image,
        operation.params.amount,
        operation.params.midpoint,
        operation.params.softness,
        operation.params.color,
      )
    case 'gradient-map':
      return applyGradientMap(image, operation.params.stops)
    case 'duotone':
      return applyDuotone(
        image,
        operation.params.shadows,
        operation.params.highlights,
      )
    case 'halftone':
      return applyHalftone(
        image,
        operation.params.size,
        operation.params.angle,
        operation.params.foreground,
        operation.params.background,
      )
    case 'glitch':
      return applyGlitch(
        image,
        operation.params.amount,
        operation.params.offset,
        operation.params.scanlines,
        operation.params.seed,
      )
  }
}

export const applyFilterChainCpu = (
  image: PixelBuffer,
  operations: readonly FilterOperation[],
): PixelBuffer => {
  assertPixelBuffer(image)
  return operations.reduce(
    (current, operation) => applyFilterCpu(current, operation),
    cloneImage(image),
  )
}
