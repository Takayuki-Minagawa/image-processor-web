import { describe, expect, it } from 'vitest'
import { shapeDefinitionToPath } from './shapeGeometry'

describe('shapeDefinitionToPath', () => {
  it('produces portable closed paths for polygons, stars, arrows and bubbles', () => {
    const polygon = shapeDefinitionToPath(
      { type: 'polygon', sides: 6 },
      100,
      80,
    )
    const star = shapeDefinitionToPath(
      { type: 'star', points: 5, innerRadiusRatio: 0.4 },
      100,
      100,
    )
    const arrow = shapeDefinitionToPath(
      {
        type: 'arrow',
        direction: 'left',
        shaftRatio: 0.4,
        headLengthRatio: 0.3,
      },
      120,
      60,
    )
    const bubble = shapeDefinitionToPath(
      {
        type: 'speech-bubble',
        cornerRadiusRatio: 0.1,
        tailPositionRatio: 0.7,
        tailWidthRatio: 0.2,
        tailHeightRatio: 0.2,
      },
      200,
      100,
    )
    for (const path of [polygon, star, arrow, bubble]) {
      expect(path).toMatch(/^M /u)
      expect(path).toMatch(/ Z$/u)
      expect(path).not.toMatch(/NaN|Infinity/u)
    }
    expect((polygon.match(/ L /gu) ?? []).length).toBe(5)
    expect((star.match(/ L /gu) ?? []).length).toBe(9)
  })

  it('represents straight and elbow connectors without renderer types', () => {
    expect(
      shapeDefinitionToPath(
        {
          type: 'line',
          routing: 'straight',
          startMarker: 'none',
          endMarker: 'arrow',
        },
        100,
        20,
      ),
    ).toBe('M 0 10 L 100 10')
    expect(
      shapeDefinitionToPath(
        {
          type: 'line',
          routing: 'elbow',
          startMarker: 'none',
          endMarker: 'none',
        },
        100,
        50,
      ),
    ).toContain('L 50 0 L 100 0')
  })

  it('rejects malformed definitions before they reach a renderer', () => {
    expect(() =>
      shapeDefinitionToPath({ type: 'polygon', sides: 2 }, 100, 100),
    ).toThrow(/3 to 64/u)
    expect(() =>
      shapeDefinitionToPath(
        { type: 'star', points: 5, innerRadiusRatio: 2 },
        100,
        100,
      ),
    ).toThrow(/inner radius/u)
    expect(() =>
      shapeDefinitionToPath(
        { type: 'rounded-rectangle', cornerRadiusRatio: 0.2 },
        0,
        100,
      ),
    ).toThrow(/dimensions/u)
  })
})
