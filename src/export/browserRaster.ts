import type { RasterPdfGeometry, RasterPdfPage } from './pdf'

export interface IndexedRasterFrame {
  width: number
  height: number
  palette: Uint8Array
  pixels: Uint8Array
}

export interface PresentationRasterFrame extends IndexedRasterFrame {
  /** The same composited frame used by video recording. */
  dataUrl: string
}

export interface PresentationRasterTransform {
  opacity?: number
  translateXPercent?: number
}

export interface PresentationRasterLayer extends PresentationRasterTransform {
  source: string
}

export interface CropMarkSegment {
  x1: number
  y1: number
  x2: number
  y2: number
}

const abortError = (): DOMException =>
  new DOMException('Raster conversion was cancelled.', 'AbortError')

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError()
}

const loadImage = (
  source: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const onAbort = () => {
      image.src = ''
      cleanup()
      reject(abortError())
    }
    image.addEventListener(
      'load',
      () => {
        cleanup()
        resolve(image)
      },
      { once: true },
    )
    image.addEventListener(
      'error',
      () => {
        cleanup()
        reject(new TypeError('The exported page image could not be decoded.'))
      },
      { once: true },
    )
    signal?.addEventListener('abort', onAbort, { once: true })
    image.src = source
  })

const canvas2d = (width: number, height: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('A 2D canvas is required for media export.')
  return context
}

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error(`Could not encode ${type}.`)),
      type,
      quality,
    ),
  )

export const calculateCropMarkSegments = (
  geometry: RasterPdfGeometry,
): CropMarkSegment[] => {
  if (geometry.bleedMm <= 0) return []
  const bleedX = Math.round(
    (geometry.bleedMm / geometry.mediaWidthMm) * geometry.rasterWidth,
  )
  const bleedY = Math.round(
    (geometry.bleedMm / geometry.mediaHeightMm) * geometry.rasterHeight,
  )
  if (bleedX < 2 || bleedY < 2) return []
  const right = geometry.rasterWidth - bleedX
  const bottom = geometry.rasterHeight - bleedY
  return [
    { x1: 0, y1: bleedY, x2: bleedX - 1, y2: bleedY },
    { x1: bleedX, y1: 0, x2: bleedX, y2: bleedY - 1 },
    { x1: right + 1, y1: bleedY, x2: geometry.rasterWidth, y2: bleedY },
    { x1: right, y1: 0, x2: right, y2: bleedY - 1 },
    { x1: 0, y1: bottom, x2: bleedX - 1, y2: bottom },
    { x1: bleedX, y1: bottom + 1, x2: bleedX, y2: geometry.rasterHeight },
    {
      x1: right + 1,
      y1: bottom,
      x2: geometry.rasterWidth,
      y2: bottom,
    },
    {
      x1: right,
      y1: bottom + 1,
      x2: right,
      y2: geometry.rasterHeight,
    },
  ]
}

/** Places the trim image inside the requested bleed area and JPEG-encodes it. */
export async function dataUrlToPdfRaster(
  dataUrl: string,
  geometry: RasterPdfGeometry,
  signal?: AbortSignal,
  options: { cropMarks?: boolean } = {},
): Promise<RasterPdfPage> {
  throwIfAborted(signal)
  const image = await loadImage(dataUrl, signal)
  const context = canvas2d(geometry.rasterWidth, geometry.rasterHeight)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, geometry.rasterWidth, geometry.rasterHeight)
  const bleedX = Math.round(
    (geometry.bleedMm / geometry.mediaWidthMm) * geometry.rasterWidth,
  )
  const bleedY = Math.round(
    (geometry.bleedMm / geometry.mediaHeightMm) * geometry.rasterHeight,
  )
  context.drawImage(
    image,
    bleedX,
    bleedY,
    geometry.rasterWidth - bleedX * 2,
    geometry.rasterHeight - bleedY * 2,
  )
  if (options.cropMarks) {
    context.save()
    context.strokeStyle = '#111111'
    context.lineWidth = Math.max(1, Math.round(geometry.dpi / 300))
    context.beginPath()
    calculateCropMarkSegments(geometry).forEach(({ x1, y1, x2, y2 }) => {
      context.moveTo(x1, y1)
      context.lineTo(x2, y2)
    })
    context.stroke()
    context.restore()
  }
  throwIfAborted(signal)
  const blob = await canvasToBlob(context.canvas, 'image/jpeg', 0.94)
  return {
    width: geometry.rasterWidth,
    height: geometry.rasterHeight,
    encoding: 'jpeg',
    data: new Uint8Array(await blob.arrayBuffer()),
  }
}

/** Deterministic RGB332 palette used by the dependency-free GIF encoder. */
export const RGB332_PALETTE = (() => {
  const palette = new Uint8Array(256 * 3)
  for (let index = 0; index < 256; index += 1) {
    palette[index * 3] = Math.round(((index >> 5) / 7) * 255)
    palette[index * 3 + 1] = Math.round((((index >> 2) & 0x07) / 7) * 255)
    palette[index * 3 + 2] = Math.round(((index & 0x03) / 3) * 255)
  }
  return palette
})()

export const quantizeRgbaToRgb332 = (rgba: Uint8ClampedArray): Uint8Array => {
  if (rgba.byteLength % 4 !== 0) {
    throw new RangeError('RGBA data must contain complete pixels.')
  }
  const output = new Uint8Array(rgba.byteLength / 4)
  for (
    let source = 0, target = 0;
    source < rgba.length;
    source += 4, target += 1
  ) {
    const alpha = rgba[source + 3] / 255
    const red = Math.round(rgba[source] * alpha + 255 * (1 - alpha))
    const green = Math.round(rgba[source + 1] * alpha + 255 * (1 - alpha))
    const blue = Math.round(rgba[source + 2] * alpha + 255 * (1 - alpha))
    output[target] = (red & 0xe0) | ((green & 0xe0) >> 3) | (blue >> 6)
  }
  return output
}

export async function dataUrlsToPresentationRaster(
  layers: readonly PresentationRasterLayer[],
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<PresentationRasterFrame> {
  throwIfAborted(signal)
  if (layers.length === 0) {
    throw new RangeError('A presentation frame needs at least one layer.')
  }
  const images = await Promise.all(
    layers.map(({ source }) => loadImage(source, signal)),
  )
  const context = canvas2d(width, height)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  images.forEach((image, index) => {
    const presentation = layers[index]
    const scale = Math.min(
      width / image.naturalWidth,
      height / image.naturalHeight,
    )
    const drawnWidth = image.naturalWidth * scale
    const drawnHeight = image.naturalHeight * scale
    context.globalAlpha = Math.min(1, Math.max(0, presentation.opacity ?? 1))
    context.drawImage(
      image,
      (width - drawnWidth) / 2 +
        ((presentation.translateXPercent ?? 0) / 100) * width,
      (height - drawnHeight) / 2,
      drawnWidth,
      drawnHeight,
    )
  })
  context.globalAlpha = 1
  throwIfAborted(signal)
  return {
    width,
    height,
    palette: RGB332_PALETTE,
    pixels: quantizeRgbaToRgb332(
      context.getImageData(0, 0, width, height).data,
    ),
    dataUrl: context.canvas.toDataURL('image/png'),
  }
}

export const dataUrlToPresentationRaster = (
  dataUrl: string,
  width: number,
  height: number,
  signal?: AbortSignal,
  presentation: PresentationRasterTransform = {},
): Promise<PresentationRasterFrame> =>
  dataUrlsToPresentationRaster(
    [{ source: dataUrl, ...presentation }],
    width,
    height,
    signal,
  )

export async function dataUrlToIndexedRaster(
  dataUrl: string,
  width: number,
  height: number,
  signal?: AbortSignal,
  presentation: PresentationRasterTransform = {},
): Promise<IndexedRasterFrame> {
  const frame = await dataUrlToPresentationRaster(
    dataUrl,
    width,
    height,
    signal,
    presentation,
  )
  return {
    width: frame.width,
    height: frame.height,
    palette: frame.palette,
    pixels: frame.pixels,
  }
}
