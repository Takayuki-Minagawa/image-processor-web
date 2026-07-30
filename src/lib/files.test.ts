import { describe, expect, it } from 'vitest'
import {
  FileValidationError,
  sanitizeFileStem,
  validateImageHeader,
} from './files'

describe('sanitizeFileStem', () => {
  it('normalizes unsafe filename characters', () => {
    expect(sanitizeFileStem('  portrait:final?.png  ')).toBe(
      'portrait-final',
    )
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

    await expect(validateImageHeader(file)).rejects.toThrow(
      'PNG、JPEG、WebP',
    )
  })
})
