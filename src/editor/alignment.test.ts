import { describe, expect, it } from 'vitest'
import {
  alignBounds,
  boundsUnion,
  canvasBounds,
  centerBounds,
  distributeBounds,
  type AlignableBounds,
} from './alignment'

const items: AlignableBounds[] = [
  { id: 'a', left: 10, top: 20, width: 20, height: 10 },
  { id: 'b', left: 50, top: 40, width: 30, height: 20 },
  { id: 'c', left: 110, top: 80, width: 10, height: 30 },
]

describe('boundsUnion and alignment', () => {
  it('computes the union and handles an empty selection', () => {
    expect(boundsUnion(items)).toEqual({
      left: 10,
      top: 20,
      width: 110,
      height: 90,
    })
    expect(boundsUnion([])).toBeNull()
  })

  it.each([
    ['left', [10, 10, 10]],
    ['horizontal-center', [55, 50, 60]],
    ['right', [100, 90, 110]],
  ] as const)('aligns %s inside the selection union', (kind, expected) => {
    expect(alignBounds(items, kind).map(({ left }) => left)).toEqual(expected)
    expect(alignBounds(items, kind).map(({ top }) => top)).toEqual([20, 40, 80])
  })

  it.each([
    ['top', [20, 20, 20]],
    ['vertical-center', [60, 55, 50]],
    ['bottom', [100, 90, 80]],
  ] as const)('aligns %s inside the selection union', (kind, expected) => {
    expect(alignBounds(items, kind).map(({ top }) => top)).toEqual(expected)
    expect(alignBounds(items, kind).map(({ left }) => left)).toEqual([
      10, 50, 110,
    ])
  })

  it('aligns against explicit canvas bounds', () => {
    expect(
      alignBounds(
        items.slice(0, 2),
        'horizontal-center',
        canvasBounds(200, 100),
      ),
    ).toEqual([
      { id: 'a', left: 90, top: 20 },
      { id: 'b', left: 85, top: 40 },
    ])
    expect(
      alignBounds(items.slice(0, 2), 'bottom', canvasBounds(200, 100)),
    ).toEqual([
      { id: 'a', left: 10, top: 90 },
      { id: 'b', left: 50, top: 80 },
    ])
  })
})

describe('distribution and centering', () => {
  it('distributes objects with equal horizontal edge gaps', () => {
    const result = distributeBounds(items, 'horizontal')
    expect(result).toEqual([
      { id: 'a', left: 10, top: 20 },
      { id: 'b', left: 55, top: 40 },
      { id: 'c', left: 110, top: 80 },
    ])
    expect(result[1].left - (result[0].left + items[0].width)).toBe(25)
    expect(result[2].left - (result[1].left + items[1].width)).toBe(25)
  })

  it('distributes vertically and preserves caller order', () => {
    const shuffled = [items[2], items[0], items[1]]
    expect(distributeBounds(shuffled, 'vertical')).toEqual([
      { id: 'c', left: 110, top: 80 },
      { id: 'a', left: 10, top: 20 },
      { id: 'b', left: 50, top: 45 },
    ])
  })

  it('leaves fewer than three objects unchanged', () => {
    expect(distributeBounds(items.slice(0, 2), 'horizontal')).toEqual([
      { id: 'a', left: 10, top: 20 },
      { id: 'b', left: 50, top: 40 },
    ])
  })

  it('centers the selection as one group on either or both axes', () => {
    expect(centerBounds(items, canvasBounds(200, 200))).toEqual([
      { id: 'a', left: 45, top: 55 },
      { id: 'b', left: 85, top: 75 },
      { id: 'c', left: 145, top: 115 },
    ])
    expect(
      centerBounds(items, canvasBounds(200, 200), 'horizontal').map(
        ({ left, top }) => [left, top],
      ),
    ).toEqual([
      [45, 20],
      [85, 40],
      [145, 80],
    ])
  })

  it('rejects invalid bounds and duplicate ids', () => {
    expect(() =>
      alignBounds(
        [{ id: 'bad', left: 0, top: 0, width: Number.NaN, height: 1 }],
        'left',
      ),
    ).toThrow(TypeError)
    expect(() =>
      distributeBounds([items[0], { ...items[1], id: 'a' }], 'horizontal'),
    ).toThrow(/duplicate/i)
  })
})
