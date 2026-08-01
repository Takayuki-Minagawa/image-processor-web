import { describe, expect, it } from 'vitest'
import {
  MIN_GRID_CELL_RATIO,
  gridBoundaries,
  moveGridBoundary,
  type GridCellLayout,
} from './gridLayout'

const columns: GridCellLayout[] = [
  { id: 'left', x: 0, y: 0, width: 0.49, height: 1 },
  { id: 'right', x: 0.51, y: 0, width: 0.49, height: 1 },
]

describe('grid layout boundaries', () => {
  it('moves a shared divider while retaining its gap', () => {
    const [boundary] = gridBoundaries(columns)
    const moved = moveGridBoundary(columns, boundary.id, 0.7)

    expect(moved[0]).toEqual({
      id: 'left',
      x: 0,
      y: 0,
      width: 0.69,
      height: 1,
    })
    expect(moved[1]).toMatchObject({
      id: 'right',
      x: 0.71,
      y: 0,
      height: 1,
    })
    expect(moved[1].width).toBeCloseTo(0.29)
  })

  it('clamps a drag so every neighboring cell remains usable', () => {
    const [boundary] = gridBoundaries(columns)
    const moved = moveGridBoundary(columns, boundary.id, 2)

    expect(moved[1].width).toBeCloseTo(MIN_GRID_CELL_RATIO)
    expect(moved[0].width).toBeLessThan(1)
  })

  it('coalesces the feature grid shared edge and finds its nested edge', () => {
    const boundaries = gridBoundaries([
      { id: 'feature', x: 0, y: 0, width: 0.66, height: 1 },
      { id: 'top', x: 0.68, y: 0, width: 0.32, height: 0.49 },
      { id: 'bottom', x: 0.68, y: 0.51, width: 0.32, height: 0.49 },
    ])

    expect(boundaries).toEqual([
      expect.objectContaining({
        axis: 'x',
        beforeCellIds: ['feature'],
        afterCellIds: ['bottom', 'top'],
      }),
      expect.objectContaining({
        axis: 'y',
        beforeCellIds: ['top'],
        afterCellIds: ['bottom'],
      }),
    ])
  })
})
