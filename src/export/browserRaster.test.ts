import { describe, expect, it } from 'vitest'
import {
  RGB332_PALETTE,
  calculateCropMarkSegments,
  quantizeRgbaToRgb332,
} from './browserRaster'
import { calculateRasterPdfGeometry } from './pdf'

describe('RGB332 browser raster helpers', () => {
  it('builds a complete 256-color palette', () => {
    expect(RGB332_PALETTE).toHaveLength(768)
    expect([...RGB332_PALETTE.slice(0, 3)]).toEqual([0, 0, 0])
    expect([...RGB332_PALETTE.slice(-3)]).toEqual([255, 255, 255])
  })

  it('quantizes opaque and transparent pixels deterministically', () => {
    const pixels = quantizeRgbaToRgb332(
      new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]),
    )
    expect([...pixels]).toEqual([0xe0, 0xff])
  })

  it('rejects incomplete RGBA input', () => {
    expect(() =>
      quantizeRgbaToRgb332(new Uint8ClampedArray([1, 2, 3])),
    ).toThrow(/complete pixels/u)
  })

  it('places eight crop marks outside a non-zero trim bleed', () => {
    const geometry = calculateRasterPdfGeometry({
      trimWidthMm: 210,
      trimHeightMm: 297,
      bleedMm: 3,
      dpi: 300,
    })
    const marks = calculateCropMarkSegments(geometry)
    expect(marks).toHaveLength(8)
    expect(marks.every(({ x1, y1, x2, y2 }) => x1 === x2 || y1 === y2)).toBe(
      true,
    )
    expect(calculateCropMarkSegments({ ...geometry, bleedMm: 0 })).toEqual([])
  })
})
