import type { PixelBuffer } from '../editor/filters/types'
import { MAX_SELECTION_MASK_PIXELS, SelectionMask } from './mask'

export interface SelectionPoint {
  x: number
  y: number
}

export interface PolygonRasterizationOptions {
  samplesPerAxis?: 1 | 2 | 4
}

export interface FloodFillOptions {
  tolerance?: number
  connectivity?: 4 | 8
  includeAlpha?: boolean
}

const assertDimensions = (width: number, height: number): number => {
  const count = width * height
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(count) ||
    count > MAX_SELECTION_MASK_PIXELS
  ) {
    throw new RangeError('Selection dimensions are invalid or too large.')
  }
  return count
}

const pointInPolygon = (
  x: number,
  y: number,
  points: readonly SelectionPoint[],
): boolean => {
  let inside = false
  for (
    let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current, current += 1
  ) {
    const first = points[current]
    const second = points[previous]
    if (
      first.y > y !== second.y > y &&
      x <
        ((second.x - first.x) * (y - first.y)) / (second.y - first.y) + first.x
    ) {
      inside = !inside
    }
  }
  return inside
}

export const rasterizePolygonSelection = (
  width: number,
  height: number,
  points: readonly SelectionPoint[],
  options: PolygonRasterizationOptions = {},
): SelectionMask => {
  const pixelCount = assertDimensions(width, height)
  if (
    points.length < 3 ||
    points.length > 10_000 ||
    points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))
  ) {
    throw new RangeError(
      'A polygon selection requires from 3 to 10,000 finite points.',
    )
  }
  const samples = options.samplesPerAxis ?? 1
  if (samples !== 1 && samples !== 2 && samples !== 4) {
    throw new RangeError('Polygon samplesPerAxis must be 1, 2, or 4.')
  }

  const output = new Uint8Array(pixelCount)
  const sampleCount = samples * samples
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let insideSamples = 0
      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          if (
            pointInPolygon(
              x + (sampleX + 0.5) / samples,
              y + (sampleY + 0.5) / samples,
              points,
            )
          ) {
            insideSamples += 1
          }
        }
      }
      output[y * width + x] = Math.round((insideSamples / sampleCount) * 255)
    }
  }
  return SelectionMask.fromBytes(width, height, output)
}

const colorMatches = (
  data: Uint8ClampedArray,
  offset: number,
  target: readonly number[],
  tolerance: number,
  includeAlpha: boolean,
): boolean => {
  const channels = includeAlpha ? 4 : 3
  for (let channel = 0; channel < channels; channel += 1) {
    if (Math.abs(data[offset + channel] - target[channel]) > tolerance) {
      return false
    }
  }
  return true
}

export const floodFillSelection = (
  image: PixelBuffer,
  seedX: number,
  seedY: number,
  options: FloodFillOptions = {},
): SelectionMask => {
  const pixelCount = assertDimensions(image.width, image.height)
  if (
    !(image.data instanceof Uint8ClampedArray) ||
    image.data.length !== pixelCount * 4
  ) {
    throw new RangeError('Flood-fill image must contain RGBA pixels.')
  }
  if (
    !Number.isInteger(seedX) ||
    !Number.isInteger(seedY) ||
    seedX < 0 ||
    seedY < 0 ||
    seedX >= image.width ||
    seedY >= image.height
  ) {
    throw new RangeError('Flood-fill seed is outside the image.')
  }
  const tolerance = options.tolerance ?? 0
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) {
    throw new RangeError('Flood-fill tolerance must be from 0 to 255.')
  }
  const connectivity = options.connectivity ?? 4
  if (connectivity !== 4 && connectivity !== 8) {
    throw new RangeError('Flood-fill connectivity must be 4 or 8.')
  }
  const includeAlpha = options.includeAlpha ?? true

  const selected = new Uint8Array(pixelCount)
  const visited = new Uint8Array(pixelCount)
  const queue = new Uint32Array(pixelCount)
  const seedIndex = seedY * image.width + seedX
  const seedOffset = seedIndex * 4
  const target = [
    image.data[seedOffset],
    image.data[seedOffset + 1],
    image.data[seedOffset + 2],
    image.data[seedOffset + 3],
  ] as const
  let head = 0
  let tail = 0

  const visit = (index: number): void => {
    if (visited[index]) return
    visited[index] = 1
    if (colorMatches(image.data, index * 4, target, tolerance, includeAlpha)) {
      queue[tail] = index
      tail += 1
    }
  }

  visit(seedIndex)
  while (head < tail) {
    const index = queue[head]
    head += 1
    selected[index] = 255
    const x = index % image.width
    const y = Math.floor(index / image.width)
    if (x > 0) visit(index - 1)
    if (x + 1 < image.width) visit(index + 1)
    if (y > 0) visit(index - image.width)
    if (y + 1 < image.height) visit(index + image.width)
    if (connectivity === 8) {
      if (x > 0 && y > 0) visit(index - image.width - 1)
      if (x + 1 < image.width && y > 0) {
        visit(index - image.width + 1)
      }
      if (x > 0 && y + 1 < image.height) {
        visit(index + image.width - 1)
      }
      if (x + 1 < image.width && y + 1 < image.height) {
        visit(index + image.width + 1)
      }
    }
  }

  return SelectionMask.fromBytes(image.width, image.height, selected)
}
