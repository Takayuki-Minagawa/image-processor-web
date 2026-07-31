import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BUNDLED_LOGO_FONT_FAMILIES,
  BUNDLED_LOGO_FONT_LICENSES,
  BUNDLED_LOGO_FONT_WEIGHTS,
  ensureLogoFontsLoaded,
} from './fonts'
import { DEFAULT_LOGO_FONT_PAIRS } from './generator'

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')

const stubFontSet = (load: (value: string) => Promise<unknown>): void => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load },
  })
}

afterEach(() => {
  if (originalFonts) {
    Object.defineProperty(document, 'fonts', originalFonts)
  } else {
    Reflect.deleteProperty(document, 'fonts')
  }
})

describe('bundled logo fonts', () => {
  it('bundles every non-system family the default font pairings request', () => {
    const systemFamilies = new Set([
      'system-ui',
      'sans-serif',
      'serif',
      'Georgia',
      'Times New Roman',
      'Arial',
    ])
    const requested = new Set(
      DEFAULT_LOGO_FONT_PAIRS.flatMap((pair) =>
        [pair.display, pair.body].flatMap((stack) =>
          stack.split(',').map((family) => family.trim().replace(/^"|"$/g, '')),
        ),
      ).filter((family) => !systemFamilies.has(family)),
    )

    // Every family a pairing names must either be bundled or be a system
    // font, otherwise the pairing silently renders as an OS fallback.
    expect([...requested].sort()).toEqual(
      [...BUNDLED_LOGO_FONT_FAMILIES].sort(),
    )
  })

  it('documents a license and source for every bundled family', () => {
    expect(
      BUNDLED_LOGO_FONT_LICENSES.map(({ family }) => family).sort(),
    ).toEqual([...BUNDLED_LOGO_FONT_FAMILIES].sort())
    for (const { license, url } of BUNDLED_LOGO_FONT_LICENSES) {
      expect(license).toMatch(/Open Font License/u)
      expect(url).toMatch(/^https:\/\//u)
    }
  })

  it('requests each bundled family at every weight the templates use', async () => {
    const requests: string[] = []
    stubFontSet((value) => {
      requests.push(value)
      return Promise.resolve([])
    })

    await ensureLogoFontsLoaded()

    expect(requests).toHaveLength(
      BUNDLED_LOGO_FONT_FAMILIES.length * BUNDLED_LOGO_FONT_WEIGHTS.length,
    )
    expect(requests).toContain('700 16px "Inter"')
    expect(requests).toContain('500 16px "Space Grotesk"')
  })

  it('resolves even when a font fails to load so insertion is never blocked', async () => {
    stubFontSet(() => Promise.reject(new Error('network down')))
    await expect(ensureLogoFontsLoaded()).resolves.toBeUndefined()
  })

  it('resolves where the CSS Font Loading API is unavailable', async () => {
    Reflect.deleteProperty(document, 'fonts')
    await expect(ensureLogoFontsLoaded()).resolves.toBeUndefined()
  })

  it('does not reach the network itself', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    stubFontSet(() => Promise.resolve([]))
    await ensureLogoFontsLoaded()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
