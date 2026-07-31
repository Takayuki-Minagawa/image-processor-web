import { describe, expect, it } from 'vitest'
import { floodFillSelection, rasterizePolygonSelection } from './algorithms'

describe('selection algorithms', () => {
  it('rasterizes polygon coverage in document coordinates', () => {
    const mask = rasterizePolygonSelection(
      4,
      4,
      [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 3 },
        { x: 1, y: 3 },
      ],
      { samplesPerAxis: 1 },
    )

    expect([...mask.toBytes()]).toEqual([
      0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0,
    ])
  })

  it('produces partial 8-bit coverage when supersampling polygon edges', () => {
    const mask = rasterizePolygonSelection(
      2,
      2,
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ],
      { samplesPerAxis: 4 },
    )
    const bytes = [...mask.toBytes()]

    expect(bytes.some((value) => value > 0 && value < 255)).toBe(true)
  })

  it('flood-fills contiguous colors with tolerance and connectivity', () => {
    const image = {
      width: 3,
      height: 2,
      data: new Uint8ClampedArray([
        10, 10, 10, 255, 12, 10, 10, 255, 100, 100, 100, 255, 10, 10, 10, 255,
        100, 100, 100, 255, 10, 10, 10, 255,
      ]),
    }

    expect([
      ...floodFillSelection(image, 0, 0, {
        tolerance: 2,
        connectivity: 4,
      }).toBytes(),
    ]).toEqual([255, 255, 0, 255, 0, 0])

    expect([
      ...floodFillSelection(image, 0, 0, {
        tolerance: 2,
        connectivity: 8,
      }).toBytes(),
    ]).toEqual([255, 255, 0, 255, 0, 255])
  })

  it('rejects unsafe dimensions, seeds, tolerances, and polygon points', () => {
    expect(() => rasterizePolygonSelection(1, 1, [{ x: 0, y: 0 }])).toThrow(
      'requires from 3',
    )
    expect(() =>
      floodFillSelection(
        {
          width: 1,
          height: 1,
          data: new Uint8ClampedArray([0, 0, 0, 255]),
        },
        1,
        0,
      ),
    ).toThrow('outside')
    expect(() =>
      floodFillSelection(
        {
          width: 1,
          height: 1,
          data: new Uint8ClampedArray([0, 0, 0, 255]),
        },
        0,
        0,
        { tolerance: 300 },
      ),
    ).toThrow('0 to 255')
  })
})
