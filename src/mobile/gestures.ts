export interface PointerSample {
  id: number
  x: number
  y: number
}

export interface TwoPointerGestureDelta {
  scale: number
  panX: number
  panY: number
  anchorX: number
  anchorY: number
  previousDistance: number
  currentDistance: number
}

export interface ViewportTransform {
  zoom: number
  panX: number
  panY: number
}

export interface ViewportZoomLimits {
  minimumZoom: number
  maximumZoom: number
}

export interface LongPressCandidate {
  pointerType: 'mouse' | 'pen' | 'touch'
  elapsedMs: number
  movementPx: number
  primaryButton?: boolean
  cancelled?: boolean
}

export interface LongPressOptions {
  delayMs?: number
  movementTolerancePx?: number
}

const assertFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`)
}

const assertPositiveFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`)
  }
}

const midpoint = (
  first: PointerSample,
  second: PointerSample,
): { x: number; y: number } => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
})

const orderedPair = (
  pointers: readonly PointerSample[],
  label: string,
): readonly [PointerSample, PointerSample] => {
  if (pointers.length !== 2) {
    throw new RangeError(`${label} must contain exactly two pointers.`)
  }
  for (const pointer of pointers) {
    if (!Number.isInteger(pointer.id)) {
      throw new RangeError(`${label} pointer ids must be integers.`)
    }
    assertFinite(pointer.x, `${label} pointer x`)
    assertFinite(pointer.y, `${label} pointer y`)
  }
  if (pointers[0].id === pointers[1].id) {
    throw new RangeError(`${label} pointer ids must be unique.`)
  }
  return pointers[0].id < pointers[1].id
    ? [pointers[0], pointers[1]]
    : [pointers[1], pointers[0]]
}

/** Produces simultaneous pinch scale and two-finger pan deltas. */
export const calculateTwoPointerGesture = (
  previousPointers: readonly PointerSample[],
  currentPointers: readonly PointerSample[],
): TwoPointerGestureDelta => {
  const previous = orderedPair(previousPointers, 'Previous gesture')
  const current = orderedPair(currentPointers, 'Current gesture')
  if (previous[0].id !== current[0].id || previous[1].id !== current[1].id) {
    throw new RangeError('Gesture pointer ids changed between samples.')
  }

  const previousDistance = Math.hypot(
    previous[1].x - previous[0].x,
    previous[1].y - previous[0].y,
  )
  const currentDistance = Math.hypot(
    current[1].x - current[0].x,
    current[1].y - current[0].y,
  )
  assertPositiveFinite(previousDistance, 'Previous pointer distance')
  assertPositiveFinite(currentDistance, 'Current pointer distance')
  const previousCenter = midpoint(previous[0], previous[1])
  const currentCenter = midpoint(current[0], current[1])

  return {
    scale: currentDistance / previousDistance,
    panX: currentCenter.x - previousCenter.x,
    panY: currentCenter.y - previousCenter.y,
    anchorX: previousCenter.x,
    anchorY: previousCenter.y,
    previousDistance,
    currentDistance,
  }
}

/** Keeps the document point under the old centroid anchored while zooming. */
export const applyTwoPointerGesture = (
  transform: ViewportTransform,
  gesture: TwoPointerGestureDelta,
  limits: ViewportZoomLimits,
): ViewportTransform => {
  assertPositiveFinite(transform.zoom, 'Viewport zoom')
  assertFinite(transform.panX, 'Viewport pan x')
  assertFinite(transform.panY, 'Viewport pan y')
  assertPositiveFinite(gesture.scale, 'Gesture scale')
  assertPositiveFinite(limits.minimumZoom, 'Minimum zoom')
  assertPositiveFinite(limits.maximumZoom, 'Maximum zoom')
  if (limits.minimumZoom > limits.maximumZoom) {
    throw new RangeError('Minimum zoom cannot exceed maximum zoom.')
  }

  const zoom = Math.min(
    limits.maximumZoom,
    Math.max(limits.minimumZoom, transform.zoom * gesture.scale),
  )
  const appliedScale = zoom / transform.zoom
  return {
    zoom,
    panX:
      gesture.anchorX -
      (gesture.anchorX - transform.panX) * appliedScale +
      gesture.panX,
    panY:
      gesture.anchorY -
      (gesture.anchorY - transform.panY) * appliedScale +
      gesture.panY,
  }
}

/** Pure long-press predicate for touch/pen context-menu adapters. */
export const longPressShouldOpenContextMenu = (
  candidate: LongPressCandidate,
  options: LongPressOptions = {},
): boolean => {
  const delayMs = options.delayMs ?? 500
  const movementTolerancePx = options.movementTolerancePx ?? 10
  assertPositiveFinite(delayMs, 'Long-press delay')
  if (!Number.isFinite(movementTolerancePx) || movementTolerancePx < 0) {
    throw new RangeError(
      'Long-press movement tolerance must be a non-negative finite number.',
    )
  }
  if (!Number.isFinite(candidate.elapsedMs) || candidate.elapsedMs < 0) {
    throw new RangeError(
      'Long-press elapsed time must be a non-negative finite number.',
    )
  }
  if (!Number.isFinite(candidate.movementPx) || candidate.movementPx < 0) {
    throw new RangeError(
      'Long-press movement must be a non-negative finite number.',
    )
  }
  return (
    candidate.pointerType !== 'mouse' &&
    candidate.primaryButton !== false &&
    candidate.cancelled !== true &&
    candidate.elapsedMs >= delayMs &&
    candidate.movementPx <= movementTolerancePx
  )
}
