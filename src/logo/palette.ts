import { rgbToHex, type HexColor, type RgbColor } from './colors'

export interface ImageDataLike {
  width: number
  height: number
  data: ArrayLike<number>
}

export interface PaletteExtractionOptions {
  maxColors?: number
  alphaThreshold?: number
  maxSamples?: number
}

export interface ExtractedPaletteColor {
  hex: HexColor
  rgb: RgbColor
  population: number
  ratio: number
}

interface WeightedColor extends RgbColor {
  count: number
}

interface ColorBox {
  colors: WeightedColor[]
  population: number
  range: RgbColor
}

export class PaletteExtractionError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'PaletteExtractionError'
  }
}

const clampInteger = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number =>
  Math.min(
    maximum,
    Math.max(
      minimum,
      Math.round(
        typeof value === 'number' && Number.isFinite(value) ? value : fallback,
      ),
    ),
  )

const validateImageData = (image: ImageDataLike): void => {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new PaletteExtractionError(
      'Image dimensions must be positive safe integers.',
    )
  }
  const requiredLength = image.width * image.height * 4
  if (
    !image.data ||
    !Number.isSafeInteger(image.data.length) ||
    image.data.length < requiredLength
  ) {
    throw new PaletteExtractionError(
      'Pixel data must contain four channels for every pixel.',
    )
  }
}

const channel = (value: number): number =>
  Math.min(255, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))

const collectColors = (
  image: ImageDataLike,
  alphaThreshold: number,
  maxSamples: number,
): WeightedColor[] => {
  const totalPixels = image.width * image.height
  const gridStep = Math.max(1, Math.ceil(Math.sqrt(totalPixels / maxSamples)))
  const colors = new Map<string, WeightedColor>()

  for (let y = 0; y < image.height; y += gridStep) {
    for (let x = 0; x < image.width; x += gridStep) {
      const offset = (y * image.width + x) * 4
      const alpha = channel(image.data[offset + 3])
      if (alpha < alphaThreshold) {
        continue
      }
      const red = channel(image.data[offset])
      const green = channel(image.data[offset + 1])
      const blue = channel(image.data[offset + 2])
      const key = `${red},${green},${blue}`
      const existing = colors.get(key)
      if (existing) {
        existing.count += 1
      } else {
        colors.set(key, { r: red, g: green, b: blue, count: 1 })
      }
    }
  }
  return [...colors.values()]
}

const createBox = (colors: WeightedColor[]): ColorBox => {
  const values = {
    r: colors.map((color) => color.r),
    g: colors.map((color) => color.g),
    b: colors.map((color) => color.b),
  }
  return {
    colors,
    population: colors.reduce((sum, color) => sum + color.count, 0),
    range: {
      r: Math.max(...values.r) - Math.min(...values.r),
      g: Math.max(...values.g) - Math.min(...values.g),
      b: Math.max(...values.b) - Math.min(...values.b),
    },
  }
}

const splitChannel = (box: ColorBox): keyof RgbColor => {
  if (box.range.g > box.range.r && box.range.g >= box.range.b) {
    return 'g'
  }
  if (box.range.b > box.range.r && box.range.b > box.range.g) {
    return 'b'
  }
  return 'r'
}

const splitBox = (box: ColorBox): [ColorBox, ColorBox] | null => {
  if (
    box.colors.length < 2 ||
    Math.max(box.range.r, box.range.g, box.range.b) === 0
  ) {
    return null
  }
  const selected = splitChannel(box)
  const secondary: keyof RgbColor =
    selected === 'r' ? 'g' : selected === 'g' ? 'b' : 'r'
  const tertiary: keyof RgbColor =
    selected === 'r' ? 'b' : selected === 'g' ? 'r' : 'g'
  const sorted = [...box.colors].sort(
    (left, right) =>
      left[selected] - right[selected] ||
      left[secondary] - right[secondary] ||
      left[tertiary] - right[tertiary],
  )
  const midpoint = box.population / 2
  let cumulative = 0
  let splitIndex = 1
  for (let index = 0; index < sorted.length - 1; index += 1) {
    cumulative += sorted[index].count
    if (cumulative >= midpoint) {
      splitIndex = index + 1
      break
    }
  }
  splitIndex = Math.min(sorted.length - 1, Math.max(1, splitIndex))
  return [
    createBox(sorted.slice(0, splitIndex)),
    createBox(sorted.slice(splitIndex)),
  ]
}

const averageBox = (box: ColorBox): WeightedColor => {
  const totals = box.colors.reduce(
    (result, color) => ({
      r: result.r + color.r * color.count,
      g: result.g + color.g * color.count,
      b: result.b + color.b * color.count,
    }),
    { r: 0, g: 0, b: 0 },
  )
  return {
    r: Math.round(totals.r / box.population),
    g: Math.round(totals.g / box.population),
    b: Math.round(totals.b / box.population),
    count: box.population,
  }
}

/**
 * Extracts dominant colors using weighted median-cut quantization.
 *
 * Large inputs are sampled on a deterministic two-dimensional grid, keeping
 * CPU and transferred Worker payloads bounded.
 */
export function extractPalette(
  image: ImageDataLike,
  options: PaletteExtractionOptions = {},
): ExtractedPaletteColor[] {
  validateImageData(image)
  const maxColors = clampInteger(options.maxColors, 8, 1, 32)
  const alphaThreshold = clampInteger(options.alphaThreshold, 16, 0, 255)
  const maxSamples = clampInteger(options.maxSamples, 100_000, 16, 1_000_000)
  const colors = collectColors(image, alphaThreshold, maxSamples)
  if (colors.length === 0) {
    return []
  }

  const boxes = [createBox(colors)]
  while (boxes.length < maxColors) {
    const candidates = boxes
      .map((box, index) => ({
        box,
        index,
        score: Math.max(box.range.r, box.range.g, box.range.b) * box.population,
      }))
      .filter(({ box, score }) => box.colors.length > 1 && score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.box.population - left.box.population ||
          left.index - right.index,
      )
    const candidate = candidates[0]
    if (!candidate) {
      break
    }
    const split = splitBox(candidate.box)
    if (!split) {
      break
    }
    boxes.splice(candidate.index, 1, ...split)
  }

  const merged = new Map<HexColor, WeightedColor>()
  for (const box of boxes) {
    const color = averageBox(box)
    const hex = rgbToHex(color)
    const existing = merged.get(hex)
    if (existing) {
      const population = existing.count + color.count
      existing.r = Math.round(
        (existing.r * existing.count + color.r * color.count) / population,
      )
      existing.g = Math.round(
        (existing.g * existing.count + color.g * color.count) / population,
      )
      existing.b = Math.round(
        (existing.b * existing.count + color.b * color.count) / population,
      )
      existing.count = population
    } else {
      merged.set(hex, { ...color })
    }
  }

  const totalPopulation = [...merged.values()].reduce(
    (sum, color) => sum + color.count,
    0,
  )
  return [...merged.entries()]
    .map(([hex, color]) => ({
      hex,
      rgb: { r: color.r, g: color.g, b: color.b },
      population: color.count,
      ratio: color.count / totalPopulation,
    }))
    .sort(
      (left, right) =>
        right.population - left.population || left.hex.localeCompare(right.hex),
    )
}
