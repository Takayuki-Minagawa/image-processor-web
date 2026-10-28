import type { PdfSession } from '../import/pdf'
import type { PdfPageInfo } from '../import/pdfGeometry'
import type { ProjectPagePhysicalSize } from '../editor/types'
import { inspectEmbeddedImageDataUrl } from '../editor/snapshotValidation'
import { encodeRasterDataUrl, releaseRasterCanvas } from '../export/rasterImage'

export const COMPARISON_MAX_DIMENSION = 1_600
const MAX_PREVIEW_ENCODED_CHARACTERS = 16 * 1024 * 1024

const samePhysicalEdge = (left: number, right: number): boolean => {
  const difference = Math.abs(left - right)
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    left > 0 &&
    right > 0 &&
    difference <= 0.1 + 1e-9 &&
    difference <= Math.max(left, right) * 0.001 + Number.EPSILON
  )
}

export interface ComparisonCapture {
  dataUrl: string
  width: number
  height: number
  documentWidth: number
  documentHeight: number
  name: string
  physicalSize?: ProjectPagePhysicalSize
  sourcePageNumber?: number
}

export interface ComparisonResult {
  currentUrl: string
  referenceUrl: string
  differenceUrl?: string
  currentWidth: number
  currentHeight: number
  referenceWidth: number
  referenceHeight: number
  referenceInfo: PdfPageInfo
  alignment: 'matched' | 'size-mismatch' | 'unknown-size'
}

export type PdfComparisonResult = ComparisonResult

const validatePreview = (
  source: string,
  width: number,
  height: number,
): void => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > COMPARISON_MAX_DIMENSION ||
    height > COMPARISON_MAX_DIMENSION ||
    source.length > MAX_PREVIEW_ENCODED_CHARACTERS
  )
    throw new RangeError('The comparison preview exceeds its size limit.')
  const declared = inspectEmbeddedImageDataUrl(source).dimensions
  if (declared.width !== width || declared.height !== height)
    throw new RangeError('The comparison preview dimensions are inconsistent.')
}

const decodePreview = (
  source: string,
  signal: AbortSignal,
): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const image = new Image()
    const cleanup = () => {
      image.removeEventListener('load', onLoad)
      image.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      image.src = ''
      reject(new DOMException('Comparison cancelled.', 'AbortError'))
    }
    const onLoad = () => {
      cleanup()
      resolve(image)
    }
    const onError = () => {
      cleanup()
      image.src = ''
      reject(new TypeError('The comparison preview could not be decoded.'))
    }
    image.addEventListener('load', onLoad, { once: true })
    image.addEventListener('error', onError, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })
    image.src = source
  })

const whitePreview = async (
  source: string,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<HTMLCanvasElement> => {
  signal.throwIfAborted()
  const image = await decodePreview(source, signal)
  const canvas = document.createElement('canvas')
  try {
    signal.throwIfAborted()
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('A 2D canvas is required for comparison.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    return canvas
  } catch (error) {
    releaseRasterCanvas(canvas)
    throw error
  } finally {
    image.src = ''
  }
}

/** Compare one original PDF page with a frozen current-page preview. */
export async function createPdfComparison(
  current: ComparisonCapture,
  session: PdfSession,
  pageNumber: number,
  signal: AbortSignal,
): Promise<ComparisonResult> {
  signal.throwIfAborted()
  validatePreview(current.dataUrl, current.width, current.height)
  const referenceInfo = await session.getPageInfo(pageNumber)
  signal.throwIfAborted()
  const physical = current.physicalSize
  const alignment: ComparisonResult['alignment'] = !physical
    ? 'unknown-size'
    : samePhysicalEdge(physical.widthMm, referenceInfo.widthMm) &&
        samePhysicalEdge(physical.heightMm, referenceInfo.heightMm)
      ? 'matched'
      : 'size-mismatch'
  // Matching pages use the current preview's resolution. Other pages retain
  // their own aspect ratio; fitting two unrelated page sizes would hide changes.
  const scale =
    alignment === 'matched'
      ? Math.min(
          current.width / referenceInfo.widthPoints,
          current.height / referenceInfo.heightPoints,
        )
      : COMPARISON_MAX_DIMENSION /
        Math.max(referenceInfo.widthPoints, referenceInfo.heightPoints)
  const raster = await session.renderPage(pageNumber, scale * 72, signal)
  signal.throwIfAborted()
  validatePreview(raster.dataUrl, raster.width, raster.height)
  const referenceWidth = alignment === 'matched' ? current.width : raster.width
  const referenceHeight =
    alignment === 'matched' ? current.height : raster.height
  let currentCanvas: HTMLCanvasElement | undefined
  let referenceCanvas: HTMLCanvasElement | undefined
  try {
    currentCanvas = await whitePreview(
      current.dataUrl,
      current.width,
      current.height,
      signal,
    )
    referenceCanvas = await whitePreview(
      raster.dataUrl,
      referenceWidth,
      referenceHeight,
      signal,
    )
    signal.throwIfAborted()
    const result: ComparisonResult = {
      currentUrl: encodeRasterDataUrl(currentCanvas, 'png', 1),
      referenceUrl: encodeRasterDataUrl(referenceCanvas, 'png', 1),
      currentWidth: current.width,
      currentHeight: current.height,
      referenceWidth,
      referenceHeight,
      referenceInfo,
      alignment,
    }
    if (alignment === 'matched') {
      const context = currentCanvas.getContext('2d')!
      const pixels = context.getImageData(0, 0, current.width, current.height)
      const reference = referenceCanvas
        .getContext('2d')!
        .getImageData(0, 0, referenceWidth, referenceHeight)
      for (let start = 0; start < pixels.data.length; start += 1_048_576) {
        signal.throwIfAborted()
        const end = Math.min(pixels.data.length, start + 1_048_576)
        for (let offset = start; offset < end; offset += 4) {
          pixels.data[offset] = Math.abs(
            pixels.data[offset] - reference.data[offset],
          )
          pixels.data[offset + 1] = Math.abs(
            pixels.data[offset + 1] - reference.data[offset + 1],
          )
          pixels.data[offset + 2] = Math.abs(
            pixels.data[offset + 2] - reference.data[offset + 2],
          )
          pixels.data[offset + 3] = 255
        }
        if (end < pixels.data.length)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      signal.throwIfAborted()
      context.putImageData(pixels, 0, 0)
      result.differenceUrl = encodeRasterDataUrl(currentCanvas, 'png', 1)
    }
    signal.throwIfAborted()
    return result
  } finally {
    if (currentCanvas) releaseRasterCanvas(currentCanvas)
    if (referenceCanvas) releaseRasterCanvas(referenceCanvas)
  }
}
