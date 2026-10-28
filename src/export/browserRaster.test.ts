import { inflateSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RGB332_PALETTE,
  calculateCropMarkSegments,
  dataUrlToPdfRaster,
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

describe('PDF canvas conversion', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const setupCanvas = () => {
    class TestImage extends EventTarget {
      set src(value: string) {
        if (value) queueMicrotask(() => this.dispatchEvent(new Event('load')))
      }
    }
    vi.stubGlobal('Image', TestImage)
    const canvas = document.createElement('canvas')
    const context = {
      canvas,
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([255, 255, 255, 255, 12, 34, 56, 255]),
      })),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    )
    return { canvas, context }
  }
  const geometry = calculateRasterPdfGeometry({
    trimWidthMm: 2,
    trimHeightMm: 1,
    bleedMm: 0,
    dpi: 25.4,
  })

  it('uses lossless RGB by default, composites white, and releases its canvas', async () => {
    const { canvas, context } = setupCanvas()
    const page = await dataUrlToPdfRaster(
      'data:image/png;base64,AA==',
      geometry,
    )
    expect(page.encoding).toBe('flate')
    expect([...inflateSync(page.data)]).toEqual([255, 255, 255, 12, 34, 56])
    expect(context.fillStyle).toBe('#ffffff')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 2, 1)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })

  it('passes JPEG quality and rejects cancellation after encoding', async () => {
    const { canvas } = setupCanvas()
    const bytes = new Uint8Array([255, 216, 255, 217])
    const encode = vi
      .spyOn(canvas, 'toBlob')
      .mockImplementation((callback) =>
        callback({ arrayBuffer: async () => bytes.buffer } as Blob),
      )
    const page = await dataUrlToPdfRaster(
      'data:image/png;base64,AA==',
      geometry,
      undefined,
      { compression: 'jpeg', jpegQuality: 0.8 },
    )
    expect(page.encoding).toBe('jpeg')
    expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8)
    const controller = new AbortController()
    encode.mockImplementation((callback) => {
      controller.abort()
      callback({ arrayBuffer: async () => bytes.buffer } as Blob)
    })
    await expect(
      dataUrlToPdfRaster(
        'data:image/png;base64,AA==',
        geometry,
        controller.signal,
        { compression: 'jpeg' },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(canvas.width).toBe(0)
  })
})
