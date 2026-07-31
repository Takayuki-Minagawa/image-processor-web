import { describe, expect, it, vi } from 'vitest'
import { createIdentityCurve, type FilterOperation } from './types'
import { __webGlFilterTesting, tryApplyFilterChainWebGl } from './webgl'

const pixel = {
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([10, 20, 30, 255]),
}

describe('advanced filter WebGL capability boundary', () => {
  it('returns null without OffscreenCanvas so the exact CPU path can run', () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    try {
      expect(
        tryApplyFilterChainWebGl(pixel, [
          {
            id: 'levels',
            params: {
              inputBlack: 0,
              inputWhite: 255,
              gamma: 1,
              outputBlack: 0,
              outputWhite: 255,
            },
          },
        ]),
      ).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('declines unsupported chains instead of returning a partial result', () => {
    const getContext = vi.fn()
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}

      getContext = getContext
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    try {
      expect(
        tryApplyFilterChainWebGl(
          {
            width: 1,
            height: 1,
            data: new Uint8ClampedArray([10, 20, 30, 255]),
          },
          [
            {
              id: 'sharpen',
              params: { amount: 0.5 },
            },
          ],
        ),
      ).toBeNull()
      expect(getContext).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('recognizes every custom shader before checking WebGL availability', () => {
    const getContext = vi.fn(() => null)
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}

      getContext = getContext
    }
    const identity = createIdentityCurve()
    const operations: FilterOperation[] = [
      {
        id: 'curves',
        params: {
          master: identity,
          red: identity,
          green: identity,
          blue: identity,
        },
      },
      {
        id: 'halftone',
        params: {
          size: 4,
          angle: 45,
          foreground: { r: 0, g: 0, b: 0 },
          background: { r: 255, g: 255, b: 255 },
        },
      },
      {
        id: 'glitch',
        params: { amount: 0.5, offset: 8, scanlines: 0.2, seed: 1 },
      },
    ]
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    try {
      operations.forEach((operation) => {
        expect(tryApplyFilterChainWebGl(pixel, [operation])).toBeNull()
      })
      expect(getContext).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('advanced filter WebGL lookup and shader parity', () => {
  it('combines the channel and master curves into an exact byte LUT', () => {
    const identity = createIdentityCurve()
    const inverse = identity.map((value) => 255 - value)
    const half = identity.map((value) => Math.floor(value / 2))
    const lookup = __webGlFilterTesting.curvesLookupTexture({
      id: 'curves',
      params: {
        master: inverse,
        red: identity,
        green: inverse,
        blue: half,
      },
    })

    expect({ width: lookup.width, height: lookup.height }).toEqual({
      width: 256,
      height: 1,
    })
    expect([...lookup.data.slice(10 * 4, 10 * 4 + 4)]).toEqual([
      245, 10, 250, 255,
    ])
    expect([...lookup.data.slice(255 * 4)]).toEqual([0, 255, 128, 255])
  })

  it('encodes the CPU glitch row shifts losslessly and deterministically', () => {
    const lookup = __webGlFilterTesting.glitchLookupTexture(
      {
        id: 'glitch',
        params: {
          amount: 0.65,
          offset: 23,
          scanlines: 0.3,
          seed: 0x12345678,
        },
      },
      12,
    )
    const shifts = Array.from({ length: lookup.height }, (_, y) => {
      const offset = y * 4
      return lookup.data[offset] * 256 + lookup.data[offset + 1] - 256
    })

    expect({ width: lookup.width, height: lookup.height }).toEqual({
      width: 1,
      height: 12,
    })
    expect(shifts).toEqual([0, -17, -6, -19, 0, 23, -20, 0, 20, -21, 0, 14])
  })

  it('generates WebGL 1 fragment programs for all three spatial strategies', () => {
    const identity = createIdentityCurve()
    const curves = __webGlFilterTesting.fragmentSource(
      {
        id: 'curves',
        params: {
          master: identity,
          red: identity,
          green: identity,
          blue: identity,
        },
      },
      8,
      6,
    )
    const halftone = __webGlFilterTesting.fragmentSource(
      {
        id: 'halftone',
        params: {
          size: 4,
          angle: 30,
          foreground: { r: 0, g: 0, b: 0 },
          background: { r: 255, g: 255, b: 255 },
        },
      },
      8,
      6,
    )
    const glitch = __webGlFilterTesting.fragmentSource(
      {
        id: 'glitch',
        params: { amount: 0.5, offset: 9, scanlines: 0.2, seed: 42 },
      },
      8,
      6,
    )

    expect(curves).toContain('texture2D(uLookup')
    expect(curves).toContain('floor(source.r * 255.0 + 0.5)')
    expect(halftone).toContain('vec2 samplePixel = clamp')
    expect(halftone).toContain('float radius = sqrt(darkness)')
    expect(glitch).toContain('vec4 rowData = texture2D')
    expect(glitch).toContain('floor(rowData.r * 255.0 + 0.5) * 256.0')
  })
})
