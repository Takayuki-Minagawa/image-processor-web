import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPaletteImageFile } from './paletteSource'

const pngHeader = (width: number, height: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('readPaletteImageFile', () => {
  it('validates, downsamples, and closes a decoded local image', async () => {
    const close = vi.fn()
    const bitmap = {
      width: 1_024,
      height: 512,
      close,
    } as unknown as ImageBitmap
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    )

    const pixels = new Uint8ClampedArray(512 * 256 * 4)
    const drawImage = vi.fn()
    const getImageData = vi.fn(() => ({
      width: 512,
      height: 256,
      data: pixels,
    }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData,
    } as unknown as CanvasRenderingContext2D)

    const file = new File([pngHeader(1_024, 512)], 'brand.png', {
      type: 'image/png',
    })
    const result = await readPaletteImageFile(file)

    expect(result).toEqual({ width: 512, height: 256, data: pixels })
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 512, 256)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects unsupported files before attempting to decode them', async () => {
    const createImageBitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const file = new File(['not an image'], 'brand.gif', {
      type: 'image/gif',
    })

    await expect(readPaletteImageFile(file)).rejects.toThrow(/PNG、JPEG、WebP/u)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })
})
