import { describe, expect, it } from 'vitest'
import { createMagicResizePlan } from './magicResize'

describe('magic resize', () => {
  it('centers a square design in a story canvas with proportional sizing', () => {
    const plan = createMagicResizePlan(
      { width: 1080, height: 1080 },
      { width: 1080, height: 1920 },
      [{ id: 'photo', x: 100, y: 100, width: 400, height: 300 }],
    )

    expect(plan).toMatchObject({
      anchor: 'center',
      scaleMode: 'proportional',
      scaleX: 1,
      scaleY: 1,
      layers: [{ id: 'photo', x: 100, y: 520, width: 400, height: 300 }],
    })
  })

  it('supports all anchor positions without scaling the layer', () => {
    const topLeft = createMagicResizePlan(
      { width: 100, height: 100 },
      { width: 200, height: 300 },
      [{ id: 'text', x: 10, y: 20, width: 30, height: 10 }],
      { anchor: 'top-left', scaleMode: 'none' },
    )
    const bottomRight = createMagicResizePlan(
      { width: 100, height: 100 },
      { width: 200, height: 300 },
      [{ id: 'text', x: 10, y: 20, width: 30, height: 10 }],
      { anchor: 'bottom-right', scaleMode: 'none' },
    )

    expect(topLeft.layers[0]).toMatchObject({ x: 10, y: 20 })
    expect(bottomRight.layers[0]).toMatchObject({ x: 110, y: 220 })
  })

  it('stretches geometry and scales text/strokes by the smaller axis', () => {
    const result = createMagicResizePlan(
      { width: 100, height: 100 },
      { width: 200, height: 300 },
      [
        {
          id: 'heading',
          x: 10,
          y: 20,
          width: 20,
          height: 30,
          fontSize: 12,
          strokeWidth: 2,
        },
      ],
      { scaleMode: 'stretch' },
    ).layers[0]

    expect(result).toMatchObject({
      x: 20,
      y: 60,
      width: 40,
      height: 90,
      fontSize: 24,
      strokeWidth: 4,
      scaleX: 2,
      scaleY: 3,
    })
  })

  it('repairs oversized and off-canvas elements by default', () => {
    const result = createMagicResizePlan(
      { width: 100, height: 100 },
      { width: 50, height: 50 },
      [{ id: 'outside', x: -20, y: 90, width: 200, height: 100 }],
      { scaleMode: 'none' },
    ).layers[0]

    expect(result.x).toBe(0)
    expect(result.y).toBe(25)
    expect(result.width).toBe(50)
    expect(result.height).toBe(25)
  })

  it('rejects invalid canvas sizes and duplicate layer ids', () => {
    expect(() =>
      createMagicResizePlan(
        { width: 0, height: 100 },
        { width: 100, height: 100 },
        [],
      ),
    ).toThrow(RangeError)
    expect(() =>
      createMagicResizePlan(
        { width: 100, height: 100 },
        { width: 100, height: 100 },
        [
          { id: 'same', x: 0, y: 0, width: 1, height: 1 },
          { id: 'same', x: 1, y: 1, width: 1, height: 1 },
        ],
      ),
    ).toThrow(TypeError)
  })
})
