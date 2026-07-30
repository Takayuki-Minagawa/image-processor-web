import { describe, expect, it } from 'vitest'
import { parseImageDimensions } from './imageMetadata'

describe('parseImageDimensions', () => {
  it('reads PNG IHDR dimensions', () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    bytes.set([0, 0, 0x07, 0x80], 16)
    bytes.set([0, 0, 0x04, 0x38], 20)

    expect(parseImageDimensions(bytes, 'image/png')).toEqual({
      width: 1920,
      height: 1080,
    })
  })

  it('reads JPEG start-of-frame dimensions after metadata', () => {
    const bytes = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0,
      4,
      0,
      0,
      0xff,
      0xc0,
      0,
      11,
      8,
      0x04,
      0x38,
      0x07,
      0x80,
      3,
      0,
      0,
      0,
    ])

    expect(parseImageDimensions(bytes, 'image/jpeg')).toEqual({
      width: 1920,
      height: 1080,
    })
  })

  it('reads extended WebP dimensions', () => {
    const bytes = new Uint8Array(30)
    bytes.set([0x52, 0x49, 0x46, 0x46], 0)
    bytes.set([0x57, 0x45, 0x42, 0x50], 8)
    bytes.set([0x56, 0x50, 0x38, 0x58], 12)
    bytes.set([0x7f, 0x07, 0], 24)
    bytes.set([0x37, 0x04, 0], 27)

    expect(parseImageDimensions(bytes, 'image/webp')).toEqual({
      width: 1920,
      height: 1080,
    })
  })

  it('rejects an unsupported or incomplete header', () => {
    expect(
      parseImageDimensions(new Uint8Array([0xff, 0xd8]), 'image/jpeg'),
    ).toBeNull()
    expect(
      parseImageDimensions(new Uint8Array(30), 'image/gif'),
    ).toBeNull()
  })
})
