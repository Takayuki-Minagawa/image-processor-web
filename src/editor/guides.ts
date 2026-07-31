import type { BoundsRect } from './alignment'

export type GuideAxis = 'x' | 'y'

export interface EditorGuide {
  id: string
  axis: GuideAxis
  position: number
}

export interface SnappableObject extends BoundsRect {
  id: string
}

export type SnapTargetKind =
  'guide' | 'canvas-edge' | 'canvas-center' | 'object-edge' | 'object-center'

export interface SnapTarget {
  axis: GuideAxis
  position: number
  kind: SnapTargetKind
  sourceId?: string
}

export type MovingAnchor =
  'left' | 'horizontal-center' | 'right' | 'top' | 'vertical-center' | 'bottom'

export interface SnapMatch {
  axis: GuideAxis
  anchor: MovingAnchor
  anchorPosition: number
  target: SnapTarget
  delta: number
}

export interface SnapResult {
  left: number
  top: number
  deltaX: number
  deltaY: number
  matches: SnapMatch[]
}

export interface BuildSnapTargetsInput {
  canvas: { width: number; height: number }
  guides?: readonly EditorGuide[]
  objects?: readonly SnappableObject[]
  excludeObjectIds?: ReadonlySet<string>
  includeCanvasEdges?: boolean
  includeCanvasCenter?: boolean
}

const TARGET_PRIORITY: Record<SnapTargetKind, number> = {
  guide: 0,
  'canvas-center': 1,
  'canvas-edge': 2,
  'object-center': 3,
  'object-edge': 4,
}

const assertFinitePosition = (value: number, label: string): number => {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`)
  }
  return value
}

const assertBounds = (bounds: BoundsRect, label: string): void => {
  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width < 0 ||
    bounds.height < 0
  ) {
    throw new TypeError(`${label} must contain finite, non-negative bounds.`)
  }
}

export const guidePositionIsValid = (
  guide: EditorGuide,
  canvas: { width: number; height: number },
): boolean =>
  typeof guide.id === 'string' &&
  guide.id.length > 0 &&
  (guide.axis === 'x' || guide.axis === 'y') &&
  Number.isFinite(guide.position) &&
  guide.position >= 0 &&
  guide.position <= (guide.axis === 'x' ? canvas.width : canvas.height)

export function clampGuideToCanvas(
  guide: EditorGuide,
  canvas: { width: number; height: number },
): EditorGuide {
  if (
    !Number.isFinite(canvas.width) ||
    !Number.isFinite(canvas.height) ||
    canvas.width < 0 ||
    canvas.height < 0
  ) {
    throw new TypeError('Canvas dimensions must be finite and non-negative.')
  }
  const maximum = guide.axis === 'x' ? canvas.width : canvas.height
  return {
    ...guide,
    position: Math.min(
      maximum,
      Math.max(0, assertFinitePosition(guide.position, 'Guide position')),
    ),
  }
}

const pushTarget = (
  targets: SnapTarget[],
  axis: GuideAxis,
  position: number,
  kind: SnapTargetKind,
  sourceId?: string,
): void => {
  targets.push({ axis, position, kind, sourceId })
}

/**
 * Creates document-space snap targets. A caller that stores tolerance in screen
 * pixels should divide it by the current zoom before calling `snapBounds`.
 */
export function buildSnapTargets(input: BuildSnapTargetsInput): SnapTarget[] {
  const { width, height } = input.canvas
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0 ||
    height < 0
  ) {
    throw new TypeError('Canvas dimensions must be finite and non-negative.')
  }

  const targets: SnapTarget[] = []
  if (input.includeCanvasEdges !== false) {
    pushTarget(targets, 'x', 0, 'canvas-edge', 'canvas-left')
    pushTarget(targets, 'x', width, 'canvas-edge', 'canvas-right')
    pushTarget(targets, 'y', 0, 'canvas-edge', 'canvas-top')
    pushTarget(targets, 'y', height, 'canvas-edge', 'canvas-bottom')
  }
  if (input.includeCanvasCenter !== false) {
    pushTarget(
      targets,
      'x',
      width / 2,
      'canvas-center',
      'canvas-horizontal-center',
    )
    pushTarget(
      targets,
      'y',
      height / 2,
      'canvas-center',
      'canvas-vertical-center',
    )
  }

  for (const guide of input.guides ?? []) {
    if (!guidePositionIsValid(guide, input.canvas)) {
      continue
    }
    pushTarget(targets, guide.axis, guide.position, 'guide', guide.id)
  }

  const seenObjectIds = new Set<string>()
  for (const object of input.objects ?? []) {
    assertBounds(object, `Object "${object.id}"`)
    if (
      typeof object.id !== 'string' ||
      object.id.length === 0 ||
      seenObjectIds.has(object.id)
    ) {
      throw new TypeError('Snappable objects require unique, non-empty ids.')
    }
    seenObjectIds.add(object.id)
    if (input.excludeObjectIds?.has(object.id)) {
      continue
    }

    pushTarget(targets, 'x', object.left, 'object-edge', object.id)
    pushTarget(
      targets,
      'x',
      object.left + object.width / 2,
      'object-center',
      object.id,
    )
    pushTarget(
      targets,
      'x',
      object.left + object.width,
      'object-edge',
      object.id,
    )
    pushTarget(targets, 'y', object.top, 'object-edge', object.id)
    pushTarget(
      targets,
      'y',
      object.top + object.height / 2,
      'object-center',
      object.id,
    )
    pushTarget(
      targets,
      'y',
      object.top + object.height,
      'object-edge',
      object.id,
    )
  }

  return targets
}

const movingAnchors = (
  bounds: BoundsRect,
  axis: GuideAxis,
): Array<{ anchor: MovingAnchor; position: number }> =>
  axis === 'x'
    ? [
        { anchor: 'left', position: bounds.left },
        {
          anchor: 'horizontal-center',
          position: bounds.left + bounds.width / 2,
        },
        { anchor: 'right', position: bounds.left + bounds.width },
      ]
    : [
        { anchor: 'top', position: bounds.top },
        {
          anchor: 'vertical-center',
          position: bounds.top + bounds.height / 2,
        },
        { anchor: 'bottom', position: bounds.top + bounds.height },
      ]

const bestSnapOnAxis = (
  bounds: BoundsRect,
  targets: readonly SnapTarget[],
  axis: GuideAxis,
  tolerance: number,
): SnapMatch | null => {
  const candidates: SnapMatch[] = []
  for (const anchor of movingAnchors(bounds, axis)) {
    for (const target of targets) {
      if (target.axis !== axis || !Number.isFinite(target.position)) {
        continue
      }
      const delta = target.position - anchor.position
      if (Math.abs(delta) <= tolerance) {
        candidates.push({
          axis,
          anchor: anchor.anchor,
          anchorPosition: anchor.position,
          target,
          delta,
        })
      }
    }
  }
  candidates.sort(
    (left, right) =>
      Math.abs(left.delta) - Math.abs(right.delta) ||
      TARGET_PRIORITY[left.target.kind] - TARGET_PRIORITY[right.target.kind] ||
      left.target.position - right.target.position ||
      left.anchor.localeCompare(right.anchor) ||
      (left.target.sourceId ?? '').localeCompare(right.target.sourceId ?? ''),
  )
  return candidates[0] ?? null
}

export function snapBounds(
  bounds: BoundsRect,
  targets: readonly SnapTarget[],
  tolerance: number,
): SnapResult {
  assertBounds(bounds, 'Moving bounds')
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new TypeError('Snap tolerance must be finite and non-negative.')
  }

  const horizontal = bestSnapOnAxis(bounds, targets, 'x', tolerance)
  const vertical = bestSnapOnAxis(bounds, targets, 'y', tolerance)
  const deltaX = horizontal?.delta ?? 0
  const deltaY = vertical?.delta ?? 0
  return {
    left: bounds.left + deltaX,
    top: bounds.top + deltaY,
    deltaX,
    deltaY,
    matches: [horizontal, vertical].filter(
      (match): match is SnapMatch => match !== null,
    ),
  }
}
