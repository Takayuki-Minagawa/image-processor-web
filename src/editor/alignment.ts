export interface AlignableBounds {
  id: string
  left: number
  top: number
  width: number
  height: number
}

export interface BoundsRect {
  left: number
  top: number
  width: number
  height: number
}

export interface AlignmentUpdate {
  id: string
  left: number
  top: number
}

export type AlignmentKind =
  'left' | 'horizontal-center' | 'right' | 'top' | 'vertical-center' | 'bottom'

export type DistributionAxis = 'horizontal' | 'vertical'
export type CenteringAxis = 'horizontal' | 'vertical' | 'both'

const assertFiniteRect = (bounds: BoundsRect, label = 'Bounds'): BoundsRect => {
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
  return bounds
}

const assertAlignable = (item: AlignableBounds): AlignableBounds => {
  if (typeof item.id !== 'string' || item.id.length === 0) {
    throw new TypeError('Alignable bounds require a non-empty id.')
  }
  assertFiniteRect(item, `Bounds for "${item.id}"`)
  return item
}

const normalizedItems = (
  items: readonly AlignableBounds[],
): readonly AlignableBounds[] => {
  const ids = new Set<string>()
  return items.map((item) => {
    assertAlignable(item)
    if (ids.has(item.id)) {
      throw new TypeError(`Duplicate alignable id: ${item.id}`)
    }
    ids.add(item.id)
    return item
  })
}

export function boundsUnion(items: readonly BoundsRect[]): BoundsRect | null {
  if (items.length === 0) {
    return null
  }
  items.forEach((item) => assertFiniteRect(item))
  const left = Math.min(...items.map((item) => item.left))
  const top = Math.min(...items.map((item) => item.top))
  const right = Math.max(...items.map((item) => item.left + item.width))
  const bottom = Math.max(...items.map((item) => item.top + item.height))
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  }
}

/**
 * Aligns every item to either the supplied reference bounds or the union of the
 * selection. Returned coordinates preserve the input order and untouched axis.
 */
export function alignBounds(
  items: readonly AlignableBounds[],
  kind: AlignmentKind,
  reference?: BoundsRect,
): AlignmentUpdate[] {
  const safeItems = normalizedItems(items)
  if (safeItems.length === 0) {
    return []
  }
  const target =
    reference === undefined
      ? boundsUnion(safeItems)!
      : assertFiniteRect(reference, 'Alignment reference')

  return safeItems.map((item) => {
    let left = item.left
    let top = item.top
    switch (kind) {
      case 'left':
        left = target.left
        break
      case 'horizontal-center':
        left = target.left + (target.width - item.width) / 2
        break
      case 'right':
        left = target.left + target.width - item.width
        break
      case 'top':
        top = target.top
        break
      case 'vertical-center':
        top = target.top + (target.height - item.height) / 2
        break
      case 'bottom':
        top = target.top + target.height - item.height
        break
      default: {
        const exhaustive: never = kind
        throw new TypeError(`Unknown alignment: ${String(exhaustive)}`)
      }
    }
    return { id: item.id, left, top }
  })
}

/**
 * Distributes three or more objects with equal edge-to-edge gaps.
 *
 * The outermost two objects stay fixed. Negative gaps are valid when the
 * selection is too narrow to avoid overlap.
 */
export function distributeBounds(
  items: readonly AlignableBounds[],
  axis: DistributionAxis,
): AlignmentUpdate[] {
  const safeItems = normalizedItems(items)
  if (safeItems.length < 3) {
    return safeItems.map(({ id, left, top }) => ({ id, left, top }))
  }

  const sorted = [...safeItems].sort((leftItem, rightItem) => {
    const leftPosition = axis === 'horizontal' ? leftItem.left : leftItem.top
    const rightPosition = axis === 'horizontal' ? rightItem.left : rightItem.top
    return (
      leftPosition - rightPosition || leftItem.id.localeCompare(rightItem.id)
    )
  })
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const spanStart = axis === 'horizontal' ? first.left : first.top
  const spanEnd =
    axis === 'horizontal' ? last.left + last.width : last.top + last.height
  const totalSize = sorted.reduce(
    (sum, item) => sum + (axis === 'horizontal' ? item.width : item.height),
    0,
  )
  const gap = (spanEnd - spanStart - totalSize) / (sorted.length - 1)
  const positions = new Map<string, number>()
  let cursor = spanStart
  for (const item of sorted) {
    positions.set(item.id, cursor)
    cursor += (axis === 'horizontal' ? item.width : item.height) + gap
  }

  return safeItems.map((item) => ({
    id: item.id,
    left:
      axis === 'horizontal' ? (positions.get(item.id) ?? item.left) : item.left,
    top: axis === 'vertical' ? (positions.get(item.id) ?? item.top) : item.top,
  }))
}

/**
 * Moves a selection as a group so its union is centered in the reference.
 */
export function centerBounds(
  items: readonly AlignableBounds[],
  reference: BoundsRect,
  axis: CenteringAxis = 'both',
): AlignmentUpdate[] {
  const safeItems = normalizedItems(items)
  if (safeItems.length === 0) {
    return []
  }
  const target = assertFiniteRect(reference, 'Centering reference')
  const selection = boundsUnion(safeItems)!
  const deltaX =
    target.left + target.width / 2 - (selection.left + selection.width / 2)
  const deltaY =
    target.top + target.height / 2 - (selection.top + selection.height / 2)

  return safeItems.map((item) => ({
    id: item.id,
    left: item.left + (axis === 'vertical' ? 0 : deltaX),
    top: item.top + (axis === 'horizontal' ? 0 : deltaY),
  }))
}

export const canvasBounds = (width: number, height: number): BoundsRect =>
  assertFiniteRect({ left: 0, top: 0, width, height }, 'Canvas')
