import { describe, expect, it } from 'vitest'
import { applyFilterChainCpu, applyFilterCpu } from './cpu'
import { createDefaultFilterOperation } from './registry'
import {
  createIdentityCurve,
  type FilterId,
  type FilterOperation,
  type PixelBuffer,
} from './types'

const pixelBuffer = (
  width: number,
  height: number,
  values: number[],
): PixelBuffer => ({
  width,
  height,
  data: new Uint8ClampedArray(values),
})

const fixture = (): PixelBuffer =>
  pixelBuffer(
    3,
    3,
    [
      10, 20, 30, 255, 50, 60, 70, 255, 90, 100, 110, 255, 30, 40, 50, 255, 110,
      120, 130, 200, 180, 170, 160, 255, 70, 80, 90, 255, 160, 150, 140, 255,
      240, 230, 220, 128,
    ],
  )

const nonTrivialOperations: Record<FilterId, FilterOperation> = {
  sharpen: { id: 'sharpen', params: { amount: 0.75 } },
  emboss: { id: 'emboss', params: { strength: 0.5 } },
  noise: {
    id: 'noise',
    params: { amount: 0.2, seed: 42, monochrome: false },
  },
  pixelate: { id: 'pixelate', params: { size: 2 } },
  sepia: { id: 'sepia', params: { amount: 0.8 } },
  invert: { id: 'invert', params: { amount: 0.75 } },
  levels: {
    id: 'levels',
    params: {
      inputBlack: 10,
      inputWhite: 240,
      gamma: 1.2,
      outputBlack: 5,
      outputWhite: 250,
    },
  },
  curves: {
    id: 'curves',
    params: {
      master: createIdentityCurve().map((value) => 255 - value),
      red: createIdentityCurve(),
      green: createIdentityCurve(),
      blue: createIdentityCurve(),
    },
  },
  'white-balance': {
    id: 'white-balance',
    params: { temperature: 0.35, tint: -0.2 },
  },
  vignette: {
    id: 'vignette',
    params: {
      amount: 0.8,
      midpoint: 0.2,
      softness: 0.5,
      color: { r: 10, g: 5, b: 20 },
    },
  },
  'gradient-map': {
    id: 'gradient-map',
    params: {
      stops: [
        { offset: 0, color: { r: 0, g: 10, b: 20 } },
        { offset: 0.5, color: { r: 100, g: 120, b: 140 } },
        { offset: 1, color: { r: 255, g: 240, b: 220 } },
      ],
    },
  },
  duotone: {
    id: 'duotone',
    params: {
      shadows: { r: 8, g: 16, b: 32 },
      highlights: { r: 250, g: 180, b: 80 },
    },
  },
  halftone: {
    id: 'halftone',
    params: {
      size: 2,
      angle: 30,
      foreground: { r: 0, g: 0, b: 0 },
      background: { r: 255, g: 255, b: 255 },
    },
  },
  glitch: {
    id: 'glitch',
    params: { amount: 0.8, offset: 2, scanlines: 0.4, seed: 77 },
  },
}

describe('CPU filter kernels', () => {
  it.each(Object.keys(nonTrivialOperations) as FilterId[])(
    'applies %s deterministically without mutating the input',
    (id) => {
      const input = fixture()
      const original = [...input.data]
      const first = applyFilterCpu(input, nonTrivialOperations[id])
      const second = applyFilterCpu(input, nonTrivialOperations[id])

      expect([...input.data]).toEqual(original)
      expect(first).not.toBe(input)
      expect(first.width).toBe(input.width)
      expect(first.height).toBe(input.height)
      expect([...first.data]).toEqual([...second.data])
      expect(first.data).not.toBe(input.data)
    },
  )

  it('performs exact invert, pixel averaging, and curve lookup operations', () => {
    const onePixel = pixelBuffer(1, 1, [10, 20, 30, 77])
    expect([
      ...applyFilterCpu(onePixel, {
        id: 'invert',
        params: { amount: 1 },
      }).data,
    ]).toEqual([245, 235, 225, 77])

    // Colour is averaged weighted by alpha, so the twice-as-opaque right
    // pixel contributes twice as much: the premultiplied average is
    // (0*100 + 100*200) / 300 = 66.7, which at the averaged alpha of 150
    // round-trips back to a straight colour of 67.
    const block = pixelBuffer(2, 1, [0, 10, 20, 100, 100, 110, 120, 200])
    expect([
      ...applyFilterCpu(block, {
        id: 'pixelate',
        params: { size: 2 },
      }).data,
    ]).toEqual([67, 77, 87, 150, 67, 77, 87, 150])

    const inverse = createIdentityCurve().map((value) => 255 - value)
    expect([
      ...applyFilterCpu(onePixel, {
        id: 'curves',
        params: {
          master: inverse,
          red: createIdentityCurve(),
          green: createIdentityCurve(),
          blue: createIdentityCurve(),
        },
      }).data,
    ]).toEqual([245, 235, 225, 77])
  })

  it('uses a stable seed for noise and glitch effects', () => {
    const image = fixture()
    const noise = nonTrivialOperations.noise as FilterOperation<'noise'>
    const differentNoise: FilterOperation = {
      id: 'noise',
      params: { ...noise.params, seed: noise.params.seed + 1 },
    }
    expect([...applyFilterCpu(image, noise).data]).not.toEqual([
      ...applyFilterCpu(image, differentNoise).data,
    ])
  })

  it('applies a chain in order and validates every operation', () => {
    const input = pixelBuffer(1, 1, [20, 40, 60, 255])
    const chain: FilterOperation[] = [
      { id: 'invert', params: { amount: 1 } },
      { id: 'sepia', params: { amount: 1 } },
    ]

    const expected = applyFilterCpu(applyFilterCpu(input, chain[0]), chain[1])
    expect([...applyFilterChainCpu(input, chain).data]).toEqual([
      ...expected.data,
    ])

    expect(() =>
      applyFilterCpu(input, {
        ...createDefaultFilterOperation('pixelate'),
        params: { size: 0 },
      }),
    ).toThrow('must be a finite number')
  })

  it('leaves flat regions untouched when embossing instead of blowing them out', () => {
    const flat = (value: number): PixelBuffer =>
      pixelBuffer(
        3,
        3,
        Array.from({ length: 9 }, () => [value, value, value, 255]).flat(),
      )

    for (const value of [60, 128, 200]) {
      for (const strength of [0, 1, 4]) {
        const output = applyFilterCpu(flat(value), {
          ...createDefaultFilterOperation('emboss'),
          params: { strength },
        })
        // A uniform image has no relief to emboss, so every channel must come
        // back unchanged rather than clipping toward white.
        expect(output.data[0]).toBe(value)
        expect(output.data[17]).toBe(value)
      }
    }
  })

  it('keeps emboss at strength 0 an exact identity', () => {
    const input = fixture()
    const output = applyFilterCpu(input, {
      ...createDefaultFilterOperation('emboss'),
      params: { strength: 0 },
    })
    expect([...output.data]).toEqual([...input.data])
  })

  it('weights pixelate colour by alpha so transparent neighbours do not darken a block', () => {
    const input = pixelBuffer(
      2,
      2,
      [255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    )
    const output = applyFilterCpu(input, {
      ...createDefaultFilterOperation('pixelate'),
      params: { size: 2 },
    })

    // The only visible pixel is pure red, so the averaged block keeps that
    // colour and only its coverage (alpha) drops.
    expect([...output.data.slice(0, 4)]).toEqual([255, 0, 0, 64])
  })

  it('reports a fully transparent pixelate block as transparent', () => {
    const input = pixelBuffer(2, 2, new Array(16).fill(0))
    const output = applyFilterCpu(input, {
      ...createDefaultFilterOperation('pixelate'),
      params: { size: 2 },
    })
    expect([...output.data.slice(0, 4)]).toEqual([0, 0, 0, 0])
  })

  it('rejects malformed and oversized pixel buffers', () => {
    expect(() =>
      applyFilterCpu(
        { width: 2, height: 2, data: new Uint8ClampedArray(3) },
        nonTrivialOperations.invert,
      ),
    ).toThrow('Invalid or oversized')
  })
})
