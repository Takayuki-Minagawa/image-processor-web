export const PDF_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxSourcePages: 1_000,
  maxSelectedPages: 20,
  maxDimension: 8_192,
  maxPagePixels: 32 * 1024 * 1024,
  maxTotalPixels: 64 * 1024 * 1024,
  maxEncodedBytes: 75 * 1024 * 1024,
} as const

export type PdfImportErrorCode =
  | 'file-too-large'
  | 'page-count-limit'
  | 'password-required'
  | 'invalid-pdf'
  | 'unsupported-xfa'
  | 'page-size-limit'
  | 'selection-limit'
  | 'encoded-size-limit'
  | 'render-failed'

export class PdfImportError extends Error {
  readonly code: PdfImportErrorCode

  constructor(code: PdfImportErrorCode) {
    super(code)
    this.name = 'PdfImportError'
    this.code = code
  }
}

export interface PdfPageInfo {
  pageNumber: number
  widthMm: number
  heightMm: number
  rotation: 0 | 90 | 180 | 270
  widthPoints: number
  heightPoints: number
}

export interface PdfRasterPage extends PdfPageInfo {
  dataUrl: string
  width: number
  height: number
  dpi: number
}

/** PDF.js already applies CropBox, page rotation and UserUnit to this viewport. */
export function pdfPageInfoFromViewport(
  pageNumber: number,
  viewport: { width: number; height: number },
  rotation: number,
): PdfPageInfo {
  const { width, height } = viewport
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isInteger(rotation) ||
    rotation % 90 !== 0
  ) {
    throw new PdfImportError('page-size-limit')
  }
  return {
    pageNumber,
    widthPoints: width,
    heightPoints: height,
    widthMm: (width * 25.4) / 72,
    heightMm: (height * 25.4) / 72,
    rotation: (((rotation % 360) + 360) % 360) as PdfPageInfo['rotation'],
  }
}

export function pdfRasterDimensions(
  info: Pick<PdfPageInfo, 'widthPoints' | 'heightPoints'>,
  dpi: number,
): { width: number; height: number } {
  const width = Math.round((info.widthPoints * dpi) / 72)
  const height = Math.round((info.heightPoints * dpi) / 72)
  if (
    !Number.isFinite(dpi) ||
    dpi <= 0 ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > PDF_LIMITS.maxDimension ||
    height > PDF_LIMITS.maxDimension ||
    width * height > PDF_LIMITS.maxPagePixels
  ) {
    throw new PdfImportError('page-size-limit')
  }
  return { width, height }
}
