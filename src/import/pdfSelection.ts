import { PDF_LIMITS } from './pdfGeometry'

/** Bounds apply before allocation; the UI never silently reduces DPI or pages. */
export const PDF_IMPORT_LIMITS = {
  selectedPages: PDF_LIMITS.maxSelectedPages,
  dimension: PDF_LIMITS.maxDimension,
  pagePixels: PDF_LIMITS.maxPagePixels,
  totalPixels: PDF_LIMITS.maxTotalPixels,
  encodedCharacters: PDF_LIMITS.maxEncodedBytes,
} as const

export function parsePdfPageRange(source: string, pageCount: number): number[] {
  if (!source.trim() || source.length > 2000) throw new RangeError('range')
  const pages = new Set<number>()
  for (const token of source.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(token)
    if (!match) throw new RangeError('range')
    const start = Number(match[1])
    const end = Number(match[2] ?? match[1])
    if (start < 1 || end > pageCount || end < start)
      throw new RangeError('range')
    if (end - start + 1 > PDF_IMPORT_LIMITS.selectedPages)
      throw new RangeError('selection-limit')
    for (let page = start; page <= end; page++) pages.add(page)
    if (pages.size > PDF_IMPORT_LIMITS.selectedPages)
      throw new RangeError('selection-limit')
  }
  return [...pages].sort((a, b) => a - b)
}

export function estimatePdfSelection(
  pages: readonly { widthPoints: number; heightPoints: number }[],
  dpi: number,
): { totalPixels: number; largestPixels: number; memoryMiB: number } {
  if (
    !Number.isFinite(dpi) ||
    dpi < 36 ||
    dpi > 600 ||
    !pages.length ||
    pages.length > PDF_IMPORT_LIMITS.selectedPages
  )
    throw new RangeError('selection-limit')
  let totalPixels = 0
  let largestPixels = 0
  for (const page of pages) {
    const width = Math.round((page.widthPoints * dpi) / 72)
    const height = Math.round((page.heightPoints * dpi) / 72)
    const pixels = width * height
    if (
      ![width, height].every(
        (n) =>
          Number.isSafeInteger(n) && n > 0 && n <= PDF_IMPORT_LIMITS.dimension,
      ) ||
      pixels > PDF_IMPORT_LIMITS.pagePixels
    )
      throw new RangeError('page-size-limit')
    totalPixels += pixels
    largestPixels = Math.max(largestPixels, pixels)
  }
  if (totalPixels > PDF_IMPORT_LIMITS.totalPixels)
    throw new RangeError('selection-limit')
  // Six RGBA-sized copies: decoded assets, edit/history overhead and processing.
  return {
    totalPixels,
    largestPixels,
    memoryMiB: Math.ceil((totalPixels * 24) / 1024 / 1024),
  }
}
