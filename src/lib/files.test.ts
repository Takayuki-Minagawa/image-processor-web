import { describe, expect, it, vi } from 'vitest'
import {
  FileValidationError,
  downloadText,
  sanitizeFileStem,
  validateImageHeader,
} from './files'

const pngHeader = (width: number, height: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

const jpegHeaderAfterExif = (): Uint8Array<ArrayBuffer> =>
  new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x00, 0x00,
    0x00,
  ])

describe('sanitizeFileStem', () => {
  it('normalizes unsafe filename characters', () => {
    expect(sanitizeFileStem('  portrait:final?.png  ')).toBe('portrait-final')
  })

  it('falls back for an empty filename', () => {
    expect(sanitizeFileStem('...')).toBe('untitled')
  })
})

describe('validateImageHeader', () => {
  it('accepts a PNG signature', async () => {
    const file = new File([pngHeader(640, 480)], 'image.png', {
      type: 'image/png',
    })

    await expect(validateImageHeader(file)).resolves.toBeUndefined()
  })

  it('accepts JPEG dimensions after EXIF metadata', async () => {
    const file = new File([jpegHeaderAfterExif()], 'photo.jpg', {
      type: 'image/jpeg',
    })

    await expect(validateImageHeader(file)).resolves.toBeUndefined()
  })

  it('rejects declared dimensions above the shared safety limit', async () => {
    const file = new File([pngHeader(8_193, 1)], 'huge.png', {
      type: 'image/png',
    })

    await expect(validateImageHeader(file)).rejects.toThrow(
      '画像寸法が上限（各辺8,192 px、合計64 MP）を超えています。',
    )
  })

  it('rejects mismatched MIME and magic bytes', async () => {
    const file = new File([jpegHeaderAfterExif()], 'image.png', {
      type: 'image/png',
    })

    await expect(validateImageHeader(file)).rejects.toBeInstanceOf(
      FileValidationError,
    )
  })

  it('rejects unsupported image types', async () => {
    const file = new File(['<svg/>'], 'image.svg', {
      type: 'image/svg+xml',
    })

    await expect(validateImageHeader(file)).rejects.toThrow('PNG、JPEG、WebP')
  })

  it('rejects a valid signature when dimensions cannot be verified', async () => {
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'truncated.png',
      { type: 'image/png' },
    )

    await expect(validateImageHeader(file)).rejects.toThrow(
      '画像の寸法を安全に確認できませんでした。',
    )
  })
})

describe('downloadText', () => {
  it('revokes its Blob URL on a later task', () => {
    vi.useFakeTimers()
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:download')
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    try {
      downloadText('{"version":1}', 'project.json')

      expect(click).toHaveBeenCalledOnce()
      expect(createObjectUrl).toHaveBeenCalledOnce()
      expect(revokeObjectUrl).not.toHaveBeenCalled()

      vi.runOnlyPendingTimers()
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:download')
    } finally {
      createObjectUrl.mockRestore()
      revokeObjectUrl.mockRestore()
      click.mockRestore()
      vi.useRealTimers()
    }
  })
})
