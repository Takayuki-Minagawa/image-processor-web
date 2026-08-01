import { describe, expect, it, vi } from 'vitest'
import {
  collectProjectFontFamilies,
  findMissingProjectFontFamilies,
  isFontFamilyLocallyAvailable,
  prepareProjectFonts,
} from './projectFonts'
import type { FontFamilyDefinition } from './types'
import type { UserFontMetadata } from './userFontMetadata'

describe('project font references', () => {
  const project = {
    objects: [
      { type: 'i-text', fontFamily: '"Team Sans", system-ui, sans-serif' },
      { type: 'textbox', fontFamily: 'Noto Sans JP Variable, sans-serif' },
      { type: 'rect', label: 'fontFamily: not metadata' },
    ],
  }

  it('collects only primary renderer font families', () => {
    expect(collectProjectFontFamilies(project)).toEqual([
      'Noto Sans JP Variable',
      'Team Sans',
    ])
  })

  it('reports unavailable references while accepting known and local fonts', () => {
    expect(
      findMissingProjectFontFamilies(
        project,
        ['Noto Sans JP Variable'],
        (family) => family === 'Team Sans',
      ),
    ).toEqual([])
    expect(findMissingProjectFontFamilies(project, [])).toEqual([
      'Noto Sans JP Variable',
      'Team Sans',
    ])
  })

  it('rejects FontFaceSet fallback false positives with a canvas metric probe', () => {
    const check = vi.fn().mockReturnValue(true)
    const fallbackMeasure = (font: string): number =>
      font.includes('monospace') ? 100 : font.includes('serif') ? 120 : 110

    expect(
      isFontFamilyLocallyAvailable('Missing Family', {
        check,
        measureText: (font) => fallbackMeasure(font),
      }),
    ).toBe(false)
    expect(
      isFontFamilyLocallyAvailable('Installed Family', {
        check,
        measureText: (font) =>
          font.includes('"Installed Family"') ? 175 : fallbackMeasure(font),
      }),
    ).toBe(true)
    expect(check).toHaveBeenCalledWith(
      '72px "Missing Family"',
      expect.any(String),
    )
  })

  it('does not measure a family rejected by FontFaceSet', () => {
    const measureText = vi.fn().mockReturnValue(100)
    expect(
      isFontFamilyLocallyAvailable('Unavailable', {
        check: () => false,
        measureText,
      }),
    ).toBe(false)
    expect(measureText).not.toHaveBeenCalled()
  })

  it('loads referenced bundled and persisted fonts before reporting availability', async () => {
    const fontDefinition = (
      id: string,
      family: string,
    ): FontFamilyDefinition => ({
      id,
      family,
      displayName: family,
      category: 'sans-serif',
      scripts: ['latin'],
      weights: [400],
      styles: ['normal'],
      fallbackStack: 'sans-serif',
      variable: false,
      source: { type: 'system' },
    })
    const userFont = (id: string, family: string): UserFontMetadata => ({
      schemaVersion: 1,
      id,
      family,
      displayName: family,
      fileName: `${id}.otf`,
      format: 'otf',
      byteLength: 4,
      sha256: 'a'.repeat(64),
      style: 'normal',
      weightMinimum: 400,
      weightMaximum: 400,
      fallback: 'sans-serif',
      addedAt: '2026-08-01T00:00:00.000Z',
      licenseAcknowledged: true,
      storage: 'opfs',
      projectEmbedding: 'reference-only',
    })
    const availableUser = userFont('user-available', 'User Available')
    const missingUser = userFont('user-missing', 'User Missing')
    const ensureLoaded = vi.fn(async (id: string) => ({
      id,
      available: id === 'builtin-available',
      requests: [],
      failedRequests: [],
    }))
    const getUserFont = vi.fn(async (id: string) =>
      id === availableUser.id
        ? { metadata: availableUser, bytes: new ArrayBuffer(4) }
        : null,
    )
    const loadUserFont = vi.fn().mockResolvedValue(undefined)
    const value = {
      objects: [
        { fontFamily: 'Builtin Available, sans-serif' },
        { fontFamily: 'Builtin Failed, sans-serif' },
        { fontFamily: 'Builtin Unused, sans-serif', visible: false },
        { fontFamily: 'User Available, sans-serif' },
        { fontFamily: 'User Missing, sans-serif' },
        { fontFamily: 'Locally Installed, sans-serif' },
      ],
    }

    const result = await prepareProjectFonts(value, {
      builtinFonts: {
        list: () => [
          fontDefinition('builtin-available', 'Builtin Available'),
          fontDefinition('builtin-failed', 'Builtin Failed'),
          fontDefinition('builtin-unused', 'Not Referenced'),
        ],
        ensureLoaded,
      },
      userFonts: {
        list: async () => [availableUser, missingUser],
        get: getUserFont,
      },
      loadUserFont,
      // A managed font that failed to load must not be rescued by this check.
      isLocallyAvailable: (family) =>
        family === 'Locally Installed' || family === 'Builtin Failed',
    })

    expect(result.loadedFamilies).toEqual([
      'Builtin Available',
      'User Available',
    ])
    expect(result.missingFamilies).toEqual([
      'Builtin Failed',
      'Builtin Unused',
      'User Missing',
    ])
    expect(ensureLoaded.mock.calls.map(([id]) => id)).toEqual([
      'builtin-available',
      'builtin-failed',
    ])
    expect(getUserFont.mock.calls.map(([id]) => id)).toEqual([
      'user-available',
      'user-missing',
    ])
    expect(loadUserFont).toHaveBeenCalledWith(
      availableUser,
      expect.any(ArrayBuffer),
    )
  })

  it('opens with a warning when persisted font metadata storage is unavailable', async () => {
    const result = await prepareProjectFonts(
      { objects: [{ fontFamily: 'Unavailable User Font, sans-serif' }] },
      {
        builtinFonts: {
          list: () => [],
          ensureLoaded: vi.fn(),
        },
        userFonts: {
          list: vi.fn().mockRejectedValue(new Error('storage unavailable')),
          get: vi.fn(),
        },
        // Stay conservative while persisted-font storage cannot be inspected.
        isLocallyAvailable: () => true,
      },
    )

    expect(result.loadedFamilies).toEqual([])
    expect(result.missingFamilies).toEqual(['Unavailable User Font'])
  })
})
