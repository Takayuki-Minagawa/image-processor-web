import type { SelectionPoint } from './algorithms'

export interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}

const assertPositiveDimension = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`)
  }
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

/**
 * Converts a pointer position from the rendered lasso surface into immutable
 * document-space coordinates. Clamping lets a stroke end safely at an edge
 * even when pointer capture reports a position just outside the surface.
 */
export const clientPointToDocumentPoint = (
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  documentWidth: number,
  documentHeight: number,
): SelectionPoint => {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    throw new RangeError('Pointer coordinates must be finite numbers.')
  }
  assertPositiveDimension(rect.width, 'Viewport width')
  assertPositiveDimension(rect.height, 'Viewport height')
  assertPositiveDimension(documentWidth, 'Document width')
  assertPositiveDimension(documentHeight, 'Document height')

  return {
    x: clamp(
      ((clientX - rect.left) / rect.width) * documentWidth,
      0,
      documentWidth,
    ),
    y: clamp(
      ((clientY - rect.top) / rect.height) * documentHeight,
      0,
      documentHeight,
    ),
  }
}

/**
 * Avoids collecting thousands of identical pointer samples while preserving
 * corners and the final pointer-up position.
 */
export const appendDistinctLassoPoint = (
  points: readonly SelectionPoint[],
  point: SelectionPoint,
  minimumDistance = 0,
): SelectionPoint[] => {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(minimumDistance) ||
    minimumDistance < 0
  ) {
    throw new RangeError('Lasso points and minimum distance must be finite.')
  }
  const previous = points.at(-1)
  if (
    previous &&
    Math.hypot(point.x - previous.x, point.y - previous.y) <= minimumDistance
  ) {
    return [...points]
  }
  return [...points, { x: point.x, y: point.y }]
}
