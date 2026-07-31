import { validateImageHeader } from '../lib/files'
import type { ImageDataLike } from './palette'

const MAX_PALETTE_PREVIEW_DIMENSION = 512

interface DecodedPaletteImage {
  width: number
  height: number
  source: CanvasImageSource
  close?(): void
}

const scaledDimensions = (
  width: number,
  height: number,
): { width: number; height: number } => {
  const scale = Math.min(
    1,
    MAX_PALETTE_PREVIEW_DIMENSION / Math.max(width, height),
  )
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

const decodeWithImageElement = (file: File): Promise<DecodedPaletteImage> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    const release = (): void => URL.revokeObjectURL(url)

    image.addEventListener(
      'load',
      () => {
        release()
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight,
          source: image,
        })
      },
      { once: true },
    )
    image.addEventListener(
      'error',
      () => {
        release()
        reject(new Error('画像をデコードできませんでした。'))
      },
      { once: true },
    )
    image.src = url
  })

const decodePaletteImage = async (file: File): Promise<DecodedPaletteImage> => {
  if (typeof globalThis.createImageBitmap !== 'function') {
    return decodeWithImageElement(file)
  }
  const bitmap = await globalThis.createImageBitmap(file)
  return {
    width: bitmap.width,
    height: bitmap.height,
    source: bitmap,
    close: () => bitmap.close(),
  }
}

/**
 * Safely decodes a local PNG/JPEG/WebP and downsamples it before palette
 * extraction. The original pixels never leave the browser.
 */
export async function readPaletteImageFile(file: File): Promise<ImageDataLike> {
  await validateImageHeader(file)
  const decoded = await decodePaletteImage(file)
  try {
    if (
      !Number.isSafeInteger(decoded.width) ||
      !Number.isSafeInteger(decoded.height) ||
      decoded.width <= 0 ||
      decoded.height <= 0
    ) {
      throw new Error('画像の寸法を取得できませんでした。')
    }

    const dimensions = scaledDimensions(decoded.width, decoded.height)
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d', {
      willReadFrequently: true,
    })
    if (!context) {
      throw new Error('画像の色を読み取るCanvasを作成できませんでした。')
    }
    context.drawImage(decoded.source, 0, 0, dimensions.width, dimensions.height)
    return context.getImageData(0, 0, dimensions.width, dimensions.height)
  } finally {
    decoded.close?.()
  }
}
