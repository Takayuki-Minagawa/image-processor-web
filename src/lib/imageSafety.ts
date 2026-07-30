import type { ImageDimensions } from './imageMetadata'

export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_DIMENSION = 8_192
export const MAX_IMAGE_PIXELS = 64 * 1_024 * 1_024

const EMBEDDED_IMAGE_DATA_URL_METADATA =
  /^data:(image\/(?:png|jpeg|webp))(?:;charset=[^;,]+)?;base64,/i

export interface EmbeddedImageDataUrlMetadata {
  mimeType: SupportedImageMimeType
  prefixLength: number
}

export const matchEmbeddedImageDataUrl = (
  dataUrl: string,
): EmbeddedImageDataUrlMetadata | null => {
  const match = EMBEDDED_IMAGE_DATA_URL_METADATA.exec(dataUrl)
  if (!match) {
    return null
  }

  return {
    mimeType: match[1].toLowerCase() as SupportedImageMimeType,
    prefixLength: match[0].length,
  }
}

export const imageDimensionsAreSafe = (dimensions: ImageDimensions): boolean =>
  Number.isSafeInteger(dimensions.width) &&
  Number.isSafeInteger(dimensions.height) &&
  dimensions.width > 0 &&
  dimensions.height > 0 &&
  dimensions.width <= MAX_IMAGE_DIMENSION &&
  dimensions.height <= MAX_IMAGE_DIMENSION &&
  dimensions.width * dimensions.height <= MAX_IMAGE_PIXELS

export const assertSafeImageDimensions = (
  dimensions: ImageDimensions,
): ImageDimensions => {
  if (!imageDimensionsAreSafe(dimensions)) {
    throw new RangeError(
      'Image dimensions exceed the 8,192 px / 64 MP safety limit.',
    )
  }
  return dimensions
}

export const imageDimensionsMatchHeader = (
  decoded: ImageDimensions,
  declared: ImageDimensions,
): boolean =>
  (decoded.width === declared.width && decoded.height === declared.height) ||
  (decoded.width === declared.height && decoded.height === declared.width)
