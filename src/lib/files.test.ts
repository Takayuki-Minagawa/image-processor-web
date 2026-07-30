import { describe, expect, it, vi } from 'vitest'
import {
  FileValidationError,
  downloadText,
  sanitizeFileStem,
  validateImageHeader,
} from './files'

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
    const file = new File(
      [
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
        ]),
      ],
      'image.png',
      { type: 'image/png' },
    )

    await expect(validateImageHeader(file)).resolves.toBeUndefined()
  })

  it('rejects mismatched MIME and magic bytes', async () => {
    const file = new File(['not an image'], 'image.png', {
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
