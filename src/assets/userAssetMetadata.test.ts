import { describe, expect, it } from 'vitest'
import { parseUserAssetMetadata } from './userAssetMetadata'

const metadata = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: 'my-logo',
  name: 'My logo',
  fileName: '../logo.svg',
  mediaType: 'image/svg+xml',
  byteLength: 1024,
  width: 400,
  height: 300,
  sha256: 'a'.repeat(64),
  createdAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
})

describe('parseUserAssetMetadata', () => {
  it('normalizes filenames and derives mandatory sanitizer policy', () => {
    expect(parseUserAssetMetadata(metadata())).toMatchObject({
      fileName: '.._logo.svg',
      safety: {
        origin: 'user',
        mediaType: 'image/svg+xml',
        sanitizer: 'svg-sanitizer-v1',
        externalReferences: 'forbidden',
      },
    })
    expect(
      parseUserAssetMetadata(metadata({ mediaType: 'image/png' })).safety
        .sanitizer,
    ).toBe('image-decoder-v1')
  })

  it('rejects unsupported media, invalid hashes, and oversized dimensions', () => {
    expect(() =>
      parseUserAssetMetadata(metadata({ mediaType: 'text/html' })),
    ).toThrow(/supported/u)
    expect(() =>
      parseUserAssetMetadata(metadata({ sha256: '../bad' })),
    ).toThrow(/SHA-256/u)
    expect(() => parseUserAssetMetadata(metadata({ width: 99_999 }))).toThrow(
      /width/u,
    )
  })
})
