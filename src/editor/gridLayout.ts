export type GridBoundaryAxis = 'x' | 'y'

export interface GridCellLayout {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface GridBoundary {
  id: string
  axis: GridBoundaryAxis
  position: number
  minimum: number
  maximum: number
  beforeCellIds: string[]
  afterCellIds: string[]
  gap: number
}

const EPSILON = 0.000_1
const MAX_ADJACENT_GAP = 0.1
export const MIN_GRID_CELL_RATIO = 0.08

const overlaps = (
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): boolean =>
  Math.min(firstEnd, secondEnd) - Math.max(firstStart, secondStart) > EPSILON

const safeCells = (cells: readonly GridCellLayout[]): GridCellLayout[] =>
  cells.filter(
    (cell) =>
      cell.id.length > 0 &&
      [cell.x, cell.y, cell.width, cell.height].every(Number.isFinite) &&
      cell.width > 0 &&
      cell.height > 0,
  )

/** Finds shared horizontal/vertical gaps in a normalized grid layout. */
export const gridBoundaries = (
  cells: readonly GridCellLayout[],
): GridBoundary[] => {
  const normalized = safeCells(cells)
  const candidates: Array<{
    axis: GridBoundaryAxis
    position: number
    gap: number
    beforeId: string
    afterId: string
  }> = []

  normalized.forEach((first, firstIndex) => {
    normalized.slice(firstIndex + 1).forEach((second) => {
      const [left, right] =
        first.x <= second.x ? [first, second] : [second, first]
      const horizontalGap = right.x - (left.x + left.width)
      if (
        horizontalGap >= -EPSILON &&
        horizontalGap <= MAX_ADJACENT_GAP + EPSILON &&
        overlaps(left.y, left.y + left.height, right.y, right.y + right.height)
      ) {
        candidates.push({
          axis: 'x',
          position: left.x + left.width + horizontalGap / 2,
          gap: Math.max(0, horizontalGap),
          beforeId: left.id,
          afterId: right.id,
        })
      }

      const [top, bottom] =
        first.y <= second.y ? [first, second] : [second, first]
      const verticalGap = bottom.y - (top.y + top.height)
      if (
        verticalGap >= -EPSILON &&
        verticalGap <= MAX_ADJACENT_GAP + EPSILON &&
        overlaps(top.x, top.x + top.width, bottom.x, bottom.x + bottom.width)
      ) {
        candidates.push({
          axis: 'y',
          position: top.y + top.height + verticalGap / 2,
          gap: Math.max(0, verticalGap),
          beforeId: top.id,
          afterId: bottom.id,
        })
      }
    })
  })

  const grouped = new Map<string, typeof candidates>()
  candidates.forEach((candidate) => {
    const key = `${candidate.axis}:${candidate.position.toFixed(4)}`
    const group = grouped.get(key) ?? []
    group.push(candidate)
    grouped.set(key, group)
  })

  return [...grouped.values()]
    .map((group): GridBoundary | null => {
      const axis = group[0].axis
      const position =
        group.reduce((sum, candidate) => sum + candidate.position, 0) /
        group.length
      const gap =
        group.reduce((sum, candidate) => sum + candidate.gap, 0) / group.length
      const beforeCellIds = [
        ...new Set(group.map(({ beforeId }) => beforeId)),
      ].sort()
      const afterCellIds = [
        ...new Set(group.map(({ afterId }) => afterId)),
      ].sort()
      const byId = new Map(normalized.map((cell) => [cell.id, cell]))
      const minimum = Math.max(
        ...beforeCellIds.map((id) => {
          const cell = byId.get(id)!
          return (
            (axis === 'x' ? cell.x : cell.y) + MIN_GRID_CELL_RATIO + gap / 2
          )
        }),
      )
      const maximum = Math.min(
        ...afterCellIds.map((id) => {
          const cell = byId.get(id)!
          const end = axis === 'x' ? cell.x + cell.width : cell.y + cell.height
          return end - MIN_GRID_CELL_RATIO - gap / 2
        }),
      )
      if (minimum > maximum) return null
      return {
        id: `${axis}:${beforeCellIds.join(',')}:${afterCellIds.join(',')}`,
        axis,
        position,
        minimum,
        maximum,
        beforeCellIds,
        afterCellIds,
        gap,
      }
    })
    .filter((boundary): boundary is GridBoundary => boundary !== null)
    .sort((left, right) =>
      left.axis === right.axis
        ? left.position - right.position
        : left.axis.localeCompare(right.axis),
    )
}

/** Applies one divider move while retaining its gap and minimum cell size. */
export const moveGridBoundary = (
  cells: readonly GridCellLayout[],
  boundaryId: string,
  requestedPosition: number,
): GridCellLayout[] => {
  const boundary = gridBoundaries(cells).find(({ id }) => id === boundaryId)
  if (!boundary || !Number.isFinite(requestedPosition)) return [...cells]
  const position = Math.min(
    boundary.maximum,
    Math.max(boundary.minimum, requestedPosition),
  )
  const before = new Set(boundary.beforeCellIds)
  const after = new Set(boundary.afterCellIds)
  const beforeEdge = position - boundary.gap / 2
  const afterEdge = position + boundary.gap / 2

  return cells.map((cell) => {
    if (before.has(cell.id)) {
      return boundary.axis === 'x'
        ? { ...cell, width: beforeEdge - cell.x }
        : { ...cell, height: beforeEdge - cell.y }
    }
    if (after.has(cell.id)) {
      return boundary.axis === 'x'
        ? { ...cell, x: afterEdge, width: cell.x + cell.width - afterEdge }
        : { ...cell, y: afterEdge, height: cell.y + cell.height - afterEdge }
    }
    return { ...cell }
  })
}
