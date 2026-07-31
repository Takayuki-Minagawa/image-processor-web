import { describe, expect, it } from 'vitest'
import {
  buildSnapTargets,
  clampGuideToCanvas,
  guidePositionIsValid,
  snapBounds,
  type EditorGuide,
} from './guides'

describe('guide helpers', () => {
  const canvas = { width: 200, height: 100 }

  it('validates and clamps guide positions', () => {
    const guide: EditorGuide = { id: 'g1', axis: 'x', position: 40 }
    expect(guidePositionIsValid(guide, canvas)).toBe(true)
    expect(guidePositionIsValid({ ...guide, position: 201 }, canvas)).toBe(
      false,
    )
    expect(clampGuideToCanvas({ ...guide, position: 250 }, canvas)).toEqual({
      id: 'g1',
      axis: 'x',
      position: 200,
    })
    expect(
      clampGuideToCanvas({ id: 'g2', axis: 'y', position: -20 }, canvas),
    ).toEqual({ id: 'g2', axis: 'y', position: 0 })
  })

  it('builds canvas, guide, and object edge/center targets', () => {
    const targets = buildSnapTargets({
      canvas,
      guides: [
        { id: 'vertical', axis: 'x', position: 40 },
        { id: 'outside', axis: 'y', position: 120 },
      ],
      objects: [
        { id: 'keep', left: 20, top: 10, width: 40, height: 30 },
        { id: 'moving', left: 70, top: 20, width: 10, height: 10 },
      ],
      excludeObjectIds: new Set(['moving']),
    })

    expect(targets.filter(({ kind }) => kind === 'canvas-edge')).toHaveLength(4)
    expect(targets.filter(({ kind }) => kind === 'canvas-center')).toHaveLength(
      2,
    )
    expect(targets).toContainEqual({
      axis: 'x',
      position: 40,
      kind: 'guide',
      sourceId: 'vertical',
    })
    expect(targets.some(({ sourceId }) => sourceId === 'outside')).toBe(false)
    expect(targets.filter(({ sourceId }) => sourceId === 'keep')).toHaveLength(
      6,
    )
    expect(targets.some(({ sourceId }) => sourceId === 'moving')).toBe(false)
  })
})

describe('snapBounds', () => {
  it('snaps both axes to their nearest targets within tolerance', () => {
    const result = snapBounds(
      { left: 47, top: 78, width: 20, height: 20 },
      [
        { axis: 'x', position: 50, kind: 'guide', sourceId: 'x-guide' },
        { axis: 'x', position: 75, kind: 'object-edge', sourceId: 'object' },
        { axis: 'y', position: 80, kind: 'canvas-center' },
      ],
      4,
    )

    expect(result).toMatchObject({
      left: 50,
      top: 80,
      deltaX: 3,
      deltaY: 2,
    })
    expect(result.matches.map(({ anchor }) => anchor)).toEqual(['left', 'top'])
  })

  it('can snap a moving center or far edge', () => {
    const result = snapBounds(
      { left: 41, top: 10, width: 20, height: 10 },
      [
        { axis: 'x', position: 50, kind: 'canvas-center' },
        { axis: 'y', position: 21, kind: 'guide' },
      ],
      2,
    )

    expect(result.deltaX).toBe(-1)
    expect(result.matches[0].anchor).toBe('horizontal-center')
    expect(result.deltaY).toBe(1)
    expect(result.matches[1].anchor).toBe('bottom')
  })

  it('prefers guide targets when distances tie', () => {
    const result = snapBounds(
      { left: 9, top: 0, width: 10, height: 10 },
      [
        { axis: 'x', position: 10, kind: 'object-edge', sourceId: 'shape' },
        { axis: 'x', position: 10, kind: 'guide', sourceId: 'guide' },
      ],
      2,
    )

    expect(result.matches[0].target).toMatchObject({
      kind: 'guide',
      sourceId: 'guide',
    })
  })

  it('does not snap outside tolerance and rejects invalid input', () => {
    expect(
      snapBounds(
        { left: 0, top: 0, width: 10, height: 10 },
        [{ axis: 'x', position: 20, kind: 'guide' }],
        4,
      ),
    ).toEqual({
      left: 0,
      top: 0,
      deltaX: 0,
      deltaY: 0,
      matches: [],
    })
    expect(() =>
      snapBounds({ left: 0, top: 0, width: 10, height: 10 }, [], -1),
    ).toThrow(/tolerance/i)
    expect(() =>
      buildSnapTargets({
        canvas: { width: 100, height: 100 },
        objects: [
          { id: 'duplicate', left: 0, top: 0, width: 1, height: 1 },
          { id: 'duplicate', left: 2, top: 2, width: 1, height: 1 },
        ],
      }),
    ).toThrow(/unique/i)
  })
})
