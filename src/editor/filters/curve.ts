import { createIdentityCurve } from './types'

export interface ToneCurvePoint {
  x: number
  y: number
}

const CURVE_MIN = 0
const CURVE_MAX = 255

const clampByte = (value: number): number =>
  Math.min(CURVE_MAX, Math.max(CURVE_MIN, Math.round(value)))

export const validateToneCurvePoints = (
  candidate: readonly ToneCurvePoint[],
): ToneCurvePoint[] => {
  if (candidate.length < 2 || candidate.length > 32) {
    throw new RangeError('A tone curve must contain from 2 to 32 points.')
  }

  const points = candidate.map((point, index) => {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < CURVE_MIN ||
      point.x > CURVE_MAX ||
      point.y < CURVE_MIN ||
      point.y > CURVE_MAX
    ) {
      throw new RangeError(
        `Tone curve point ${index + 1} must use values from 0 to 255.`,
      )
    }
    return {
      x: clampByte(point.x),
      y: clampByte(point.y),
    }
  })

  if (points[0].x !== CURVE_MIN || points.at(-1)?.x !== CURVE_MAX) {
    throw new RangeError('A tone curve must start at x=0 and end at x=255.')
  }
  points.forEach((point, index) => {
    if (index > 0 && point.x <= points[index - 1].x) {
      throw new RangeError('Tone curve x coordinates must be increasing.')
    }
  })
  return points
}

/**
 * Expands editable control points into the registry's deterministic 256-entry
 * lookup table. Linear interpolation keeps preset JSON portable and CPU
 * rendering identical across browsers.
 */
export const toneCurvePointsToLut = (
  candidate: readonly ToneCurvePoint[],
): number[] => {
  const points = validateToneCurvePoints(candidate)
  const result = createIdentityCurve()
  let segment = 0

  for (let x = CURVE_MIN; x <= CURVE_MAX; x += 1) {
    while (segment < points.length - 2 && x > points[segment + 1].x) {
      segment += 1
    }
    const left = points[segment]
    const right = points[segment + 1]
    const progress = (x - left.x) / (right.x - left.x)
    result[x] = clampByte(left.y + (right.y - left.y) * progress)
  }
  return result
}

export const toneCurveLutToPoints = (
  candidate: readonly number[],
  pointCount = 5,
): ToneCurvePoint[] => {
  if (
    candidate.length !== 256 ||
    candidate.some(
      (value) =>
        !Number.isInteger(value) || value < CURVE_MIN || value > CURVE_MAX,
    )
  ) {
    throw new RangeError(
      'A tone curve lookup table must contain 256 byte values.',
    )
  }
  const safeCount = Math.min(16, Math.max(2, Math.round(pointCount)))
  return Array.from({ length: safeCount }, (_, index) => {
    const x = Math.round((index / (safeCount - 1)) * CURVE_MAX)
    return { x, y: candidate[x] }
  })
}
