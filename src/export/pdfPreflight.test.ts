import { describe, expect, it } from 'vitest'
import {
  assertPdfEncodedByteBudget,
  createPdfExportPreflight,
  MAX_PDF_EXPORT_BYTES,
} from './pdfPreflight'

describe('PDF export preflight', () => {
  const a4 = {
    width: 1240,
    height: 1754,
    physicalSize: {
      unit: 'mm' as const,
      widthMm: 210,
      heightMm: 297,
      sourceDpi: 150,
    },
  }

  it('reports mixed physical sizes and only warns about known raster backgrounds', () => {
    const preflight = createPdfExportPreflight(
      [{ ...a4, pdfImportDpi: 150 }, a4, { width: 600, height: 300 }],
      300,
      0,
    )
    expect(preflight.mixedSizes).toBe(true)
    expect(preflight.upscaledPages).toEqual([1])
    expect(preflight.plans[0].geometry.trimWidthMm).toBe(210)
    expect(preflight.plans[0].geometry.rasterWidth).toBe(2480)
    expect(preflight.uncompressedBytes).toBe(preflight.totalPixels * 3)
  })

  it('rejects excessive aggregate pixels even when each page is safe', () => {
    expect(() =>
      createPdfExportPreflight(
        Array.from({ length: 8 }, () => a4),
        300,
        0,
      ),
    ).toThrow(/64 MP total/)
    expect(() => createPdfExportPreflight([a4], 1200, 0)).toThrow(/72 and 600/)
    expect(() => createPdfExportPreflight([], 300, 0)).toThrow(/1 and 100/)
    expect(() => createPdfExportPreflight([a4], 300, -1)).toThrow(/0 and 20/)
    expect(() =>
      createPdfExportPreflight(
        Array.from({ length: 101 }, () => ({ width: 1, height: 1 })),
        300,
        0,
      ),
    ).toThrow(/1 and 100/)
  })

  it('caps cumulative encoded data without silently changing quality', () => {
    expect(() => assertPdfEncodedByteBudget(MAX_PDF_EXPORT_BYTES)).not.toThrow()
    expect(() => assertPdfEncodedByteBudget(MAX_PDF_EXPORT_BYTES + 1)).toThrow(
      /128 MiB/,
    )
  })
})
