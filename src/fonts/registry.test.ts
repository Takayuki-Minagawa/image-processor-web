import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUNDLED_LOGO_FONT_FAMILIES } from '../logo/fonts'
import { BUILTIN_FONT_REGISTRATIONS } from './builtinCatalog'
import { FontRegistry, FontRegistryError } from './registry'
import type { FontRegistration } from './types'

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')

const registration = (
  overrides: Partial<FontRegistration['definition']> = {},
  load?: () => Promise<void>,
): FontRegistration => ({
  definition: {
    id: 'test-sans',
    family: 'Test Sans',
    displayName: 'Test Sans',
    localizedName: 'テスト角ゴ',
    category: 'sans-serif',
    scripts: ['latin', 'japanese'],
    weights: { minimum: 100, maximum: 900 },
    styles: ['normal'],
    fallbackStack: 'system-ui, sans-serif',
    variable: true,
    source: { type: 'system' },
    ...overrides,
  },
  load,
})

afterEach(() => {
  if (originalFonts) {
    Object.defineProperty(document, 'fonts', originalFonts)
  } else {
    Reflect.deleteProperty(document, 'fonts')
  }
})

describe('FontRegistry', () => {
  it('contains the existing logo fonts without changing the logo API', () => {
    const registeredFamilies = BUILTIN_FONT_REGISTRATIONS.map(
      ({ definition }) => definition.family,
    )
    expect(
      BUNDLED_LOGO_FONT_FAMILIES.every((family) =>
        registeredFamilies.includes(family),
      ),
    ).toBe(true)
    expect(
      BUILTIN_FONT_REGISTRATIONS.filter(({ definition }) =>
        definition.scripts.includes('japanese'),
      ).map(({ definition }) => definition.id),
    ).toEqual(expect.arrayContaining(['noto-sans-jp', 'noto-serif-jp']))
    for (const id of ['noto-sans-jp', 'noto-serif-jp']) {
      const registration = BUILTIN_FONT_REGISTRATIONS.find(
        ({ definition }) => definition.id === id,
      )
      expect(registration?.load).toEqual(expect.any(Function))
      expect(registration?.definition.source).toMatchObject({
        type: 'bundled',
        license: { id: 'OFL-1.1' },
      })
    }
  })

  it('searches localized metadata and resolves a safe fallback stack', () => {
    const registry = new FontRegistry([registration()])
    expect(registry.search('テスト')[0]?.id).toBe('test-sans')
    expect(registry.search('japanese')[0]?.id).toBe('test-sans')
    expect(registry.resolveStack('test-sans')).toBe(
      '"Test Sans", system-ui, sans-serif',
    )
  })

  it('loads a deferred chunk once and asks FontFaceSet for requested variants', async () => {
    const chunkLoader = vi.fn().mockResolvedValue(undefined)
    const fontLoader = vi.fn().mockResolvedValue([])
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: fontLoader },
    })
    const registry = new FontRegistry([registration({}, chunkLoader)])

    const first = await registry.ensureLoaded('test-sans', [
      { weight: 700, sample: '日本語' },
      { weight: 400 },
    ])
    const second = await registry.ensureLoaded('test-sans')

    expect(first.available).toBe(true)
    expect(chunkLoader).toHaveBeenCalledTimes(1)
    expect(fontLoader).toHaveBeenCalledWith(
      'normal 700 16px "Test Sans"',
      '日本語',
    )
    expect(second.requests).toEqual(['normal 400 16px "Test Sans"'])
  })

  it('reports font failures without blocking fallback rendering', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: () => Promise.reject(new Error('not available')) },
    })
    const registry = new FontRegistry([registration()])
    await expect(registry.ensureLoaded('test-sans')).resolves.toMatchObject({
      available: false,
      failedRequests: ['normal 400 16px "Test Sans"'],
    })
  })

  it('retries a deferred font chunk after a transient rejection', async () => {
    const chunkLoader = vi
      .fn()
      .mockRejectedValueOnce(new Error('stale chunk'))
      .mockResolvedValue(undefined)
    const registry = new FontRegistry([registration({}, chunkLoader)])

    await expect(registry.ensureLoaded('test-sans')).resolves.toMatchObject({
      available: false,
    })
    await expect(registry.ensureLoaded('test-sans')).resolves.toMatchObject({
      available: true,
    })
    expect(chunkLoader).toHaveBeenCalledTimes(2)
  })

  it('rejects duplicate, malformed, and unknown registrations', async () => {
    expect(() => new FontRegistry([registration(), registration()])).toThrow(
      expect.objectContaining({ code: 'duplicate-font' }),
    )
    expect(() => new FontRegistry([registration({ id: '../bad' })])).toThrow(
      expect.objectContaining({ code: 'invalid-font' }),
    )
    const registry = new FontRegistry()
    await expect(registry.ensureLoaded('missing')).rejects.toBeInstanceOf(
      FontRegistryError,
    )
  })
})
