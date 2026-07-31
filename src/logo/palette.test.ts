import { describe, expect, it } from 'vitest'
import { extractPalette, PaletteExtractionError } from './palette'

const image = (
  pixels: ReadonlyArray<readonly [number, number, number, number]>,
  width = pixels.length,
) => ({
  width,
  height: pixels.length / width,
  data: new Uint8ClampedArray(pixels.flat()),
})

describe('extractPalette', () => {
  it('preserves dominant populations for simple source colors', () => {
    const pixels = [
      ...Array.from({ length: 7 }, () => [255, 0, 0, 255] as const),
      ...Array.from({ length: 3 }, () => [0, 0, 255, 255] as const),
    ]
    const palette = extractPalette(image(pixels), {
      maxColors: 2,
      maxSamples: 100,
    })

    expect(palette).toEqual([
      {
        hex: '#ff0000',
        rgb: { r: 255, g: 0, b: 0 },
        population: 7,
        ratio: 0.7,
      },
      {
        hex: '#0000ff',
        rgb: { r: 0, g: 0, b: 255 },
        population: 3,
        ratio: 0.3,
      },
    ])
  })

  it('uses weighted median cut and obeys the requested color limit', () => {
    const source = image([
      [0, 0, 0, 255],
      [20, 20, 20, 255],
      [220, 220, 220, 255],
      [255, 255, 255, 255],
    ])
    const palette = extractPalette(source, { maxColors: 2 })

    expect(palette).toHaveLength(2)
    expect(palette.map(({ hex }) => hex)).toEqual(['#0a0a0a', '#eeeeee'])
    expect(palette.reduce((sum, color) => sum + color.ratio, 0)).toBeCloseTo(1)
  })

  it('ignores pixels below the alpha threshold', () => {
    expect(
      extractPalette(
        image([
          [0, 255, 0, 0],
          [255, 0, 0, 255],
        ]),
        { maxColors: 4 },
      ),
    ).toEqual([
      {
        hex: '#ff0000',
        rgb: { r: 255, g: 0, b: 0 },
        population: 1,
        ratio: 1,
      },
    ])
    expect(
      extractPalette(image([[0, 255, 0, 0]]), {
        alphaThreshold: 1,
      }),
    ).toEqual([])
  })

  it('samples large inputs deterministically', () => {
    const pixels = Array.from({ length: 400 }, (_, index) => {
      const value = index % 256
      return [value, 255 - value, (value * 7) % 256, 255] as const
    })
    const source = image(pixels, 20)
    const first = extractPalette(source, { maxColors: 6, maxSamples: 25 })
    const second = extractPalette(source, { maxColors: 6, maxSamples: 25 })

    expect(first).toEqual(second)
    expect(first.length).toBeLessThanOrEqual(6)
    expect(
      first.reduce((sum, color) => sum + color.population, 0),
    ).toBeLessThanOrEqual(25)
  })

  it('rejects inconsistent ImageData-like input', () => {
    expect(() =>
      extractPalette({ width: 0, height: 1, data: new Uint8Array() }),
    ).toThrow(PaletteExtractionError)
    expect(() =>
      extractPalette({ width: 2, height: 2, data: new Uint8Array(12) }),
    ).toThrow(/four channels/i)
  })
})
