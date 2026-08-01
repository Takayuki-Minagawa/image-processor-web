import { describe, expect, it, vi } from 'vitest'
import {
  buildRasterPdf,
  calculateRasterPdfGeometry,
  millimetersToPdfPoints,
  resolveRasterPdfPageExport,
  type RasterPdfPage,
} from './pdf'

describe('raster PDF geometry', () => {
  it('resolves A4 at 300 DPI with a 3 mm bleed', () => {
    const geometry = calculateRasterPdfGeometry({
      trimWidthMm: 210,
      trimHeightMm: 297,
      bleedMm: 3,
      dpi: 300,
    })

    expect(geometry.mediaWidthMm).toBe(216)
    expect(geometry.mediaHeightMm).toBe(303)
    expect(geometry.rasterWidth).toBe(2551)
    expect(geometry.rasterHeight).toBe(3579)
    expect(geometry.mediaBoxPoints[2]).toBeCloseTo(612.28346, 5)
    expect(geometry.mediaBoxPoints[3]).toBeCloseTo(858.89764, 5)
    expect(geometry.trimBoxPoints).toEqual([
      millimetersToPdfPoints(3),
      millimetersToPdfPoints(3),
      millimetersToPdfPoints(213),
      millimetersToPdfPoints(300),
    ])
  })

  it('rejects invalid print dimensions', () => {
    expect(() =>
      calculateRasterPdfGeometry({
        trimWidthMm: 0,
        trimHeightMm: 297,
        bleedMm: 3,
        dpi: 300,
      }),
    ).toThrow(RangeError)
    expect(() =>
      calculateRasterPdfGeometry({
        trimWidthMm: 210,
        trimHeightMm: 297,
        bleedMm: -1,
        dpi: 300,
      }),
    ).toThrow(RangeError)
  })

  it('keeps authored millimetres while changing only raster density', () => {
    const plan = resolveRasterPdfPageExport(
      {
        width: 2_480,
        height: 3_508,
        physicalSize: {
          unit: 'mm',
          widthMm: 210,
          heightMm: 297,
          sourceDpi: 300,
        },
      },
      350,
      3,
    )

    expect(plan.geometry.trimWidthMm).toBe(210)
    expect(plan.geometry.trimHeightMm).toBe(297)
    expect(plan.geometry.rasterWidth).toBe(2_976)
    expect(plan.geometry.rasterHeight).toBe(4_175)
    expect(plan.renderMultiplier).toBeCloseTo(350 / 300)
  })

  it('retains pixel-document PDF semantics', () => {
    const plan = resolveRasterPdfPageExport(
      { width: 1_500, height: 750 },
      300,
      0,
    )

    expect(plan.geometry.trimWidthMm).toBeCloseTo(127)
    expect(plan.geometry.trimHeightMm).toBeCloseTo(63.5)
    expect(plan.geometry.rasterWidth).toBe(1_500)
    expect(plan.geometry.rasterHeight).toBe(750)
    expect(plan.renderMultiplier).toBe(1)
  })

  it('rejects a print raster that exceeds the shared canvas safety budget', () => {
    expect(() =>
      resolveRasterPdfPageExport(
        {
          width: 1_417,
          height: 1_417,
          physicalSize: {
            unit: 'mm',
            widthMm: 1_000,
            heightMm: 1_000,
            sourceDpi: 36,
          },
        },
        600,
        0,
      ),
    ).toThrow(/safety limit/u)
  })
})

describe('raster PDF byte writer', () => {
  const geometry = calculateRasterPdfGeometry({
    trimWidthMm: 2,
    trimHeightMm: 1,
    bleedMm: 0,
    dpi: 25.4,
  })
  const page = (seed: number): RasterPdfPage => ({
    width: 2,
    height: 1,
    encoding: 'rgb',
    data: new Uint8Array([seed, 2, 3, 4, 5, 6]),
  })

  it('writes page boxes, raster streams, and a byte-accurate xref', async () => {
    const progress = vi.fn()
    const bytes = await buildRasterPdf([page(1), page(7)], geometry, {
      onProgress: progress,
      yieldControl: () => Promise.resolve(),
    })
    const text = new TextDecoder('latin1').decode(bytes)

    expect(text).toMatch(/^%PDF-1\.7/)
    expect(text).toContain('/Type /Pages /Count 2')
    expect(text).toContain('/Width 2 /Height 1 /ColorSpace /DeviceRGB')
    expect(text).toContain('/TrimBox [0 0 5.66929 2.83465]')
    expect(text.endsWith('%%EOF\n')).toBe(true)

    const startXref = Number(/startxref\n(\d+)/.exec(text)?.[1])
    expect(text.slice(startXref, startXref + 4)).toBe('xref')

    const firstObjectOffset = Number(
      /xref\n0 \d+\n0000000000 65535 f \n(\d{10}) 00000 n/.exec(text)?.[1],
    )
    expect(text.slice(firstObjectOffset, firstObjectOffset + 7)).toBe('1 0 obj')
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'finalize',
      completedPages: 2,
      totalPages: 2,
      progress: 1,
    })
  })

  it('keeps JPEG page data compressed through DCTDecode', async () => {
    const bytes = await buildRasterPdf(
      [
        {
          width: 2,
          height: 1,
          encoding: 'jpeg',
          data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        },
      ],
      geometry,
      { yieldControl: () => Promise.resolve() },
    )

    expect(new TextDecoder('latin1').decode(bytes)).toContain(
      '/Filter /DCTDecode',
    )
  })

  it('writes independent boxes and raster dimensions for mixed page sizes', async () => {
    const portrait = calculateRasterPdfGeometry({
      trimWidthMm: 1,
      trimHeightMm: 2,
      bleedMm: 0,
      dpi: 25.4,
    })
    const bytes = await buildRasterPdf(
      [
        page(1),
        {
          width: 1,
          height: 2,
          encoding: 'rgb',
          data: new Uint8Array([1, 2, 3, 4, 5, 6]),
        },
      ],
      [geometry, portrait],
      { yieldControl: () => Promise.resolve() },
    )
    const text = new TextDecoder('latin1').decode(bytes)

    expect(text).toContain('/MediaBox [0 0 5.66929 2.83465]')
    expect(text).toContain('/MediaBox [0 0 2.83465 5.66929]')
    expect(text).toContain('/Width 2 /Height 1')
    expect(text).toContain('/Width 1 /Height 2')
  })

  it('stops between pages when cancellation is requested', async () => {
    const controller = new AbortController()
    const phases: string[] = []

    await expect(
      buildRasterPdf([page(1), page(2), page(3)], geometry, {
        signal: controller.signal,
        onProgress: (update) => {
          phases.push(`${update.phase}:${update.completedPages}`)
          if (update.phase === 'pages' && update.completedPages === 1) {
            controller.abort()
          }
        },
        yieldControl: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(phases).toEqual(['prepare:0', 'pages:1'])
  })

  it('validates page dimensions and RGB length before writing', async () => {
    await expect(
      buildRasterPdf(
        [
          {
            width: 1,
            height: 1,
            encoding: 'rgb',
            data: new Uint8Array(3),
          },
        ],
        geometry,
      ),
    ).rejects.toThrow('must be 2x1 pixels')
  })
})
