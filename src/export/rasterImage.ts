import { assertSafeImageDimensions } from '../lib/imageSafety'
import type { ImageDimensions } from '../lib/imageMetadata'

export type RasterImageFormat = 'png' | 'jpeg' | 'webp'

export class RasterExportError extends Error {
  constructor(
    readonly code: 'unsupported-format' | 'encoding-failed',
    readonly format: RasterImageFormat,
  ) {
    super(
      code === 'unsupported-format'
        ? `The browser cannot export ${format.toUpperCase()} images.`
        : `The browser could not encode the ${format.toUpperCase()} image.`,
    )
    this.name = 'RasterExportError'
  }
}

/** Match the integer bitmap dimensions assigned by Fabric to HTMLCanvasElement. */
export const calculateRasterExportDimensions = (
  width: number,
  height: number,
  multiplier: number,
): ImageDimensions => ({
  width: Math.floor(width * multiplier),
  height: Math.floor(height * multiplier),
})

export const resolveRasterExportMultiplier = (
  width: number,
  height: number,
  multiplier: number,
  exactSafeMultiplier = false,
): number => {
  const resolved = exactSafeMultiplier
    ? multiplier
    : Math.min(8, Math.max(0.1, Number.isFinite(multiplier) ? multiplier : 1))
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError('Export multiplier must be positive and finite.')
  }
  assertSafeImageDimensions(
    calculateRasterExportDimensions(width, height, resolved),
  )
  return resolved
}

const exportQuality = (quality: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(quality) ? quality : 0.92))

export const encodeRasterDataUrl = (
  canvas: HTMLCanvasElement,
  format: RasterImageFormat,
  quality: number,
): string => {
  const dataUrl = canvas.toDataURL(`image/${format}`, exportQuality(quality))
  const mimeType = /^data:([^;,]+)[;,]/i.exec(dataUrl)?.[1].toLowerCase()
  if (!mimeType) throw new RasterExportError('encoding-failed', format)
  if (mimeType !== `image/${format}`) {
    throw new RasterExportError('unsupported-format', format)
  }
  return dataUrl
}

export const encodeRasterBlob = (
  canvas: HTMLCanvasElement,
  format: RasterImageFormat,
  quality: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0) {
          reject(new RasterExportError('encoding-failed', format))
        } else if (blob.type.toLowerCase() !== `image/${format}`) {
          reject(new RasterExportError('unsupported-format', format))
        } else {
          resolve(blob)
        }
      },
      `image/${format}`,
      exportQuality(quality),
    )
  })

/** Release the backing bitmap once its encoded output no longer needs it. */
export const releaseRasterCanvas = (canvas: HTMLCanvasElement): void => {
  canvas.width = 0
  canvas.height = 0
}
