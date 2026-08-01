import { describe, expect, it, vi } from 'vitest'
import {
  detectUserFontFormat,
  loadUserFontFace,
  parseUserFontMetadata,
  userFontProjectReference,
  userFontToDefinition,
} from './userFontMetadata'

const source = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: 'user-mincho',
  family: 'User Mincho',
  displayName: 'My Mincho',
  fileName: '../mincho.woff2',
  format: 'woff2',
  byteLength: 128,
  sha256: 'b'.repeat(64),
  style: 'normal',
  weightMinimum: 100,
  weightMaximum: 900,
  fallback: 'serif',
  addedAt: '2026-08-01T00:00:00.000Z',
  licenseAcknowledged: true,
  ...overrides,
})

describe('user font metadata', () => {
  it('detects WOFF2, OpenType, and TrueType signatures before MIME hints', () => {
    expect(detectUserFontFormat(new TextEncoder().encode('wOF2'))).toBe('woff2')
    expect(
      detectUserFontFormat(
        new TextEncoder().encode('OTTO'),
        'application/font-sfnt',
      ),
    ).toBe('otf')
    expect(detectUserFontFormat(Uint8Array.of(0, 1, 0, 0))).toBe('ttf')
    expect(detectUserFontFormat(new TextEncoder().encode('true'))).toBe('ttf')
  })

  it('uses normalized Local Font Access MIME values when no signature is exposed', () => {
    expect(
      detectUserFontFormat(new Uint8Array(), 'font/opentype; charset=binary'),
    ).toBe('otf')
    expect(
      detectUserFontFormat(new Uint8Array(), 'application/x-font-ttf'),
    ).toBe('ttf')
    expect(detectUserFontFormat(new Uint8Array(), 'font/woff2')).toBe('woff2')
    expect(() =>
      detectUserFontFormat(new TextEncoder().encode('bad!')),
    ).toThrow(/could not be identified/u)
  })

  it('keeps font bytes out of project references and records OPFS policy', () => {
    const metadata = parseUserFontMetadata(source())
    expect(metadata).toMatchObject({
      fileName: '.._mincho.woff2',
      storage: 'opfs',
      projectEmbedding: 'reference-only',
    })
    expect(userFontProjectReference(metadata)).toEqual({
      family: 'User Mincho',
      fallback: 'serif',
      sourceId: 'user-mincho',
    })
    expect(userFontToDefinition(metadata)).toMatchObject({
      source: {
        type: 'user',
        metadataId: 'user-mincho',
        projectEmbedding: 'reference-only',
      },
      weights: { minimum: 100, maximum: 900 },
    })
  })

  it('requires a supported format, bounded bytes, valid weights, and a license acknowledgement', () => {
    expect(() => parseUserFontMetadata(source({ format: 'exe' }))).toThrow(
      /woff2/u,
    )
    expect(() =>
      parseUserFontMetadata(source({ byteLength: Number.MAX_SAFE_INTEGER })),
    ).toThrow(/byteLength/u)
    expect(() =>
      parseUserFontMetadata(source({ weightMinimum: 900, weightMaximum: 100 })),
    ).toThrow(/weightMaximum/u)
    expect(() =>
      parseUserFontMetadata(source({ licenseAcknowledged: false })),
    ).toThrow(/confirmation/u)
  })

  it('loads exact local bytes through FontFace and adds the loaded face', async () => {
    const metadata = parseUserFontMetadata(source())
    const loadedFace = { load: vi.fn() }
    loadedFace.load.mockResolvedValue(loadedFace)
    const createFontFace = vi.fn().mockReturnValue(loadedFace)
    const fontSet = { add: vi.fn() }

    await expect(
      loadUserFontFace(metadata, new ArrayBuffer(128), {
        createFontFace,
        fontSet,
      }),
    ).resolves.toBe(loadedFace)
    expect(createFontFace).toHaveBeenCalledWith(
      'User Mincho',
      expect.any(ArrayBuffer),
      { style: 'normal', weight: '100 900' },
    )
    expect(fontSet.add).toHaveBeenCalledWith(loadedFace)
  })

  it('rejects bytes that do not match the validated metadata', async () => {
    const metadata = parseUserFontMetadata(source())
    await expect(
      loadUserFontFace(metadata, new ArrayBuffer(64), {
        createFontFace: vi.fn(),
        fontSet: { add: vi.fn() },
      }),
    ).rejects.toThrow(/do not match/u)
  })
})
