import type { ProjectPagePhysicalSize } from '../editor/types'
import { assertSafeImageDimensions } from '../lib/imageSafety'

export const MILLIMETERS_PER_INCH = 25.4
export const PDF_POINTS_PER_INCH = 72

export interface RasterPdfGeometryInput {
  trimWidthMm: number
  trimHeightMm: number
  bleedMm: number
  dpi: number
}

export interface RasterPdfGeometry {
  trimWidthMm: number
  trimHeightMm: number
  bleedMm: number
  mediaWidthMm: number
  mediaHeightMm: number
  dpi: number
  rasterWidth: number
  rasterHeight: number
  mediaBoxPoints: readonly [number, number, number, number]
  trimBoxPoints: readonly [number, number, number, number]
  bleedBoxPoints: readonly [number, number, number, number]
}

export interface RasterPdfPageSource {
  width: number
  height: number
  physicalSize?: ProjectPagePhysicalSize
}

export interface RasterPdfPageExportPlan {
  geometry: RasterPdfGeometry
  renderMultiplier: number
}

export type RasterPdfPage =
  | {
      width: number
      height: number
      encoding: 'rgb'
      data: Uint8Array
    }
  | {
      width: number
      height: number
      encoding: 'jpeg'
      data: Uint8Array
    }

export interface PdfExportProgress {
  phase: 'prepare' | 'pages' | 'finalize'
  completedPages: number
  totalPages: number
  progress: number
}

export interface BuildRasterPdfOptions {
  signal?: AbortSignal
  onProgress?(progress: PdfExportProgress): void
  /** Lets a Worker receive cancellation messages between page objects. */
  yieldControl?(): Promise<void>
}

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value)

const assertPositiveFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`)
  }
}

const assertNonNegativeFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number.`)
  }
}

export const millimetersToPdfPoints = (millimeters: number): number => {
  if (!Number.isFinite(millimeters)) {
    throw new RangeError('Millimeters must be finite.')
  }
  return (millimeters / MILLIMETERS_PER_INCH) * PDF_POINTS_PER_INCH
}

export const millimetersToPixels = (
  millimeters: number,
  dpi: number,
): number => {
  assertPositiveFinite(millimeters, 'Millimeters')
  assertPositiveFinite(dpi, 'DPI')
  return Math.max(1, Math.round((millimeters / MILLIMETERS_PER_INCH) * dpi))
}

/**
 * Resolves both the physical PDF boxes and the raster dimensions. PDF page
 * dimensions stay exact; rounding is isolated to the pixel canvas.
 */
export const calculateRasterPdfGeometry = (
  input: RasterPdfGeometryInput,
): RasterPdfGeometry => {
  assertPositiveFinite(input.trimWidthMm, 'Trim width')
  assertPositiveFinite(input.trimHeightMm, 'Trim height')
  assertNonNegativeFinite(input.bleedMm, 'Bleed')
  assertPositiveFinite(input.dpi, 'DPI')

  const mediaWidthMm = input.trimWidthMm + input.bleedMm * 2
  const mediaHeightMm = input.trimHeightMm + input.bleedMm * 2
  const mediaWidthPoints = millimetersToPdfPoints(mediaWidthMm)
  const mediaHeightPoints = millimetersToPdfPoints(mediaHeightMm)
  const bleedPoints = millimetersToPdfPoints(input.bleedMm)

  return {
    ...input,
    mediaWidthMm,
    mediaHeightMm,
    rasterWidth: millimetersToPixels(mediaWidthMm, input.dpi),
    rasterHeight: millimetersToPixels(mediaHeightMm, input.dpi),
    mediaBoxPoints: [0, 0, mediaWidthPoints, mediaHeightPoints],
    trimBoxPoints: [
      bleedPoints,
      bleedPoints,
      bleedPoints + millimetersToPdfPoints(input.trimWidthMm),
      bleedPoints + millimetersToPdfPoints(input.trimHeightMm),
    ],
    bleedBoxPoints: [0, 0, mediaWidthPoints, mediaHeightPoints],
  }
}

/**
 * Keeps print-oriented millimetre pages at their authored trim size while the
 * requested DPI controls raster density only. Pixel documents intentionally
 * retain the legacy interpretation where their pixel dimensions and export
 * DPI together determine the physical PDF size.
 */
export const resolveRasterPdfPageExport = (
  page: RasterPdfPageSource,
  dpi: number,
  bleedMm: number,
): RasterPdfPageExportPlan => {
  assertPositiveFinite(page.width, 'Page width')
  assertPositiveFinite(page.height, 'Page height')
  const physicalSize = page.physicalSize
  if (physicalSize) {
    assertPositiveFinite(physicalSize.widthMm, 'Physical width')
    assertPositiveFinite(physicalSize.heightMm, 'Physical height')
    assertPositiveFinite(physicalSize.sourceDpi, 'Source DPI')
  }
  const geometry = calculateRasterPdfGeometry({
    trimWidthMm:
      physicalSize?.widthMm ?? (page.width / dpi) * MILLIMETERS_PER_INCH,
    trimHeightMm:
      physicalSize?.heightMm ?? (page.height / dpi) * MILLIMETERS_PER_INCH,
    bleedMm,
    dpi,
  })
  assertSafeImageDimensions({
    width: geometry.rasterWidth,
    height: geometry.rasterHeight,
  })
  return {
    geometry,
    renderMultiplier: physicalSize ? dpi / physicalSize.sourceDpi : 1,
  }
}

const abortError = (): DOMException =>
  new DOMException('PDF export was cancelled.', 'AbortError')

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError()
}

const defaultYieldControl = (): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, 0))

const pdfNumber = (value: number): string => {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')
}

const pdfBox = (box: readonly [number, number, number, number]): string =>
  `[${box.map(pdfNumber).join(' ')}]`

const byteLength = (parts: readonly Uint8Array[]): number =>
  parts.reduce((total, part) => total + part.byteLength, 0)

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(byteLength(parts))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const pdfObject = (
  objectNumber: number,
  body: readonly Uint8Array[],
): Uint8Array[] => [
  ascii(`${objectNumber} 0 obj\n`),
  ...body,
  ascii('\nendobj\n'),
]

const pdfStream = (dictionary: string, data: Uint8Array): Uint8Array[] => [
  ascii(`<< ${dictionary} /Length ${data.byteLength} >>\nstream\n`),
  data,
  ascii('\nendstream'),
]

const validateRasterPage = (
  page: RasterPdfPage,
  geometry: RasterPdfGeometry,
  index: number,
): void => {
  if (
    page.width !== geometry.rasterWidth ||
    page.height !== geometry.rasterHeight
  ) {
    throw new RangeError(
      `PDF page ${index + 1} must be ${geometry.rasterWidth}x${geometry.rasterHeight} pixels.`,
    )
  }
  if (page.encoding === 'rgb') {
    const expectedLength = page.width * page.height * 3
    if (page.data.byteLength !== expectedLength) {
      throw new RangeError(
        `PDF page ${index + 1} RGB data must contain ${expectedLength} bytes.`,
      )
    }
  } else if (page.data.byteLength === 0) {
    throw new RangeError(`PDF page ${index + 1} JPEG data cannot be empty.`)
  }
}

/**
 * Builds a dependency-free PDF 1.7 file with one full-bleed raster XObject per
 * page. JPEG input stays compressed; RGB input is intentionally uncompressed
 * and is mainly useful for deterministic tests or an upstream compressor.
 */
export const buildRasterPdf = async (
  pages: readonly RasterPdfPage[],
  geometry: RasterPdfGeometry | readonly RasterPdfGeometry[],
  options: BuildRasterPdfOptions = {},
): Promise<Uint8Array> => {
  if (pages.length === 0) {
    throw new RangeError('A PDF must contain at least one page.')
  }
  const geometries = Array.isArray(geometry)
    ? geometry
    : pages.map(() => geometry as RasterPdfGeometry)
  if (geometries.length !== pages.length) {
    throw new RangeError('Each PDF page must have matching geometry.')
  }
  pages.forEach((page, index) =>
    validateRasterPage(page, geometries[index], index),
  )
  throwIfAborted(options.signal)

  const totalPages = pages.length
  const report = (
    phase: PdfExportProgress['phase'],
    completedPages: number,
    progress: number,
  ): void =>
    options.onProgress?.({
      phase,
      completedPages,
      totalPages,
      progress: Math.min(1, Math.max(0, progress)),
    })

  report('prepare', 0, 0)
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3)
  const objects: Uint8Array[][] = []
  objects.push(
    pdfObject(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]),
    pdfObject(2, [
      ascii(
        `<< /Type /Pages /Count ${totalPages} /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] >>`,
      ),
    ]),
  )

  const yieldControl = options.yieldControl ?? defaultYieldControl
  for (let index = 0; index < pages.length; index += 1) {
    throwIfAborted(options.signal)
    const page = pages[index]
    const pageGeometry = geometries[index]
    const pageObjectNumber = pageObjectNumbers[index]
    const imageObjectNumber = pageObjectNumber + 1
    const contentObjectNumber = pageObjectNumber + 2
    const imageName = `Im${index + 1}`
    const imageFilter = page.encoding === 'jpeg' ? ' /Filter /DCTDecode' : ''
    const content = ascii(
      `q\n${pdfNumber(pageGeometry.mediaBoxPoints[2])} 0 0 ${pdfNumber(pageGeometry.mediaBoxPoints[3])} 0 0 cm\n/${imageName} Do\nQ`,
    )

    objects.push(
      pdfObject(pageObjectNumber, [
        ascii(
          `<< /Type /Page /Parent 2 0 R /MediaBox ${pdfBox(pageGeometry.mediaBoxPoints)} /BleedBox ${pdfBox(pageGeometry.bleedBoxPoints)} /TrimBox ${pdfBox(pageGeometry.trimBoxPoints)} /Resources << /XObject << /${imageName} ${imageObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
        ),
      ]),
      pdfObject(
        imageObjectNumber,
        pdfStream(
          `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${imageFilter}`,
          page.data,
        ),
      ),
      pdfObject(contentObjectNumber, pdfStream('', content)),
    )

    report('pages', index + 1, (index + 1) / totalPages)
    await yieldControl()
  }

  throwIfAborted(options.signal)
  report('finalize', totalPages, 1)

  const header = concatBytes([
    ascii('%PDF-1.7\n'),
    new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  ])
  const offsets = [0]
  let offset = header.byteLength
  for (const object of objects) {
    offsets.push(offset)
    offset += byteLength(object)
  }

  const xrefOffset = offset
  const xrefEntries = offsets
    .slice(1)
    .map(
      (objectOffset) => `${String(objectOffset).padStart(10, '0')} 00000 n \n`,
    )
    .join('')
  const trailer = ascii(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefEntries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  )

  throwIfAborted(options.signal)
  return concatBytes([header, ...objects.flat(), trailer])
}
