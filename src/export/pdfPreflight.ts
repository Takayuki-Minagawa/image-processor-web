import {
  resolveRasterPdfPageExport,
  type RasterPdfPageExportPlan,
  type RasterPdfPageSource,
} from './pdf'

export const MAX_PDF_EXPORT_PIXELS = 64 * 1024 * 1024
export const MAX_PDF_EXPORT_BYTES = 128 * 1024 * 1024
export const MAX_PDF_EXPORT_PAGES = 100

export interface PdfExportPageSource extends RasterPdfPageSource {
  /** Only PDF-imported raster backgrounds have a known import resolution. */
  pdfImportDpi?: number
}

export interface PdfExportPreflight {
  plans: RasterPdfPageExportPlan[]
  totalPixels: number
  /** RGB image data before compression; actual output depends on its content. */
  uncompressedBytes: number
  mixedSizes: boolean
  upscaledPages: number[]
}

export const createPdfExportPreflight = (
  pages: readonly PdfExportPageSource[],
  dpi: number,
  bleedMm: number,
): PdfExportPreflight => {
  if (pages.length === 0 || pages.length > MAX_PDF_EXPORT_PAGES) {
    throw new RangeError('Select between 1 and 100 pages for PDF export.')
  }
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 600) {
    throw new RangeError('PDF export DPI must be between 72 and 600.')
  }
  if (!Number.isFinite(bleedMm) || bleedMm < 0 || bleedMm > 20) {
    throw new RangeError('PDF bleed must be between 0 and 20 mm.')
  }
  const plans = pages.map((page) =>
    resolveRasterPdfPageExport(page, dpi, bleedMm),
  )
  const totalPixels = plans.reduce(
    (total, { geometry }) =>
      total + geometry.rasterWidth * geometry.rasterHeight,
    0,
  )
  if (totalPixels > MAX_PDF_EXPORT_PIXELS) {
    throw new RangeError(
      'PDF export exceeds the 64 MP total raster limit. Select fewer pages or lower the output DPI.',
    )
  }
  const first = plans[0].geometry
  return {
    plans,
    totalPixels,
    uncompressedBytes: totalPixels * 3,
    mixedSizes: plans.some(
      ({ geometry }) =>
        Math.abs(geometry.trimWidthMm - first.trimWidthMm) > 0.01 ||
        Math.abs(geometry.trimHeightMm - first.trimHeightMm) > 0.01,
    ),
    upscaledPages: pages.flatMap((page, index) =>
      page.pdfImportDpi !== undefined && dpi > page.pdfImportDpi
        ? [index + 1]
        : [],
    ),
  }
}

export const assertPdfEncodedByteBudget = (bytes: number): void => {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > MAX_PDF_EXPORT_BYTES
  ) {
    throw Object.assign(
      new RangeError(
        'PDF images exceed the 128 MiB encoded-data limit. Select fewer pages or use JPEG compression.',
      ),
      { code: 'pdf-encoded-limit' },
    )
  }
}
