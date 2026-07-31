import { SelectionMask } from './mask'

export interface SelectionBoundaryOptions {
  threshold?: number
  maximumSegments?: number
  maximumSampleCells?: number
}

export interface SelectionBoundary {
  path: string
  segmentCount: number
  sampleStep: number
  truncated: boolean
}

const assertIntegerBetween = (
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    )
  }
  return value
}

/**
 * Builds an SVG edge path for an 8-bit mask. Large documents are sampled for
 * a responsive preview; the authoritative selection remains full resolution.
 */
export const traceSelectionBoundary = (
  mask: SelectionMask,
  options: SelectionBoundaryOptions = {},
): SelectionBoundary => {
  const threshold = assertIntegerBetween(
    options.threshold ?? 128,
    1,
    255,
    'Selection boundary threshold',
  )
  const maximumSegments = assertIntegerBetween(
    options.maximumSegments ?? 20_000,
    1,
    100_000,
    'Selection boundary segment limit',
  )
  const maximumSampleCells = assertIntegerBetween(
    options.maximumSampleCells ?? 1_000_000,
    1,
    4_000_000,
    'Selection boundary sample limit',
  )
  const bytes = mask.toBytes()
  const sampleStep = Math.max(
    1,
    Math.ceil(Math.sqrt(mask.pixelCount / maximumSampleCells)),
  )
  const commands: string[] = []
  let segmentCount = 0
  let truncated = false

  const selected = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < mask.width &&
    y < mask.height &&
    bytes[y * mask.width + x] >= threshold

  const append = (command: string): boolean => {
    if (segmentCount >= maximumSegments) {
      truncated = true
      return false
    }
    commands.push(command)
    segmentCount += 1
    return true
  }

  outer: for (let y = 0; y < mask.height; y += sampleStep) {
    for (let x = 0; x < mask.width; x += sampleStep) {
      if (!selected(x, y)) continue
      const right = Math.min(mask.width, x + sampleStep)
      const bottom = Math.min(mask.height, y + sampleStep)
      if (!selected(x, y - sampleStep) && !append(`M${x} ${y}H${right}`)) {
        break outer
      }
      if (!selected(x + sampleStep, y) && !append(`M${right} ${y}V${bottom}`)) {
        break outer
      }
      if (!selected(x, y + sampleStep) && !append(`M${right} ${bottom}H${x}`)) {
        break outer
      }
      if (!selected(x - sampleStep, y) && !append(`M${x} ${bottom}V${y}`)) {
        break outer
      }
    }
  }

  return {
    path: commands.join(''),
    segmentCount,
    sampleStep,
    truncated,
  }
}
