/**
 * Web fonts bundled for the logo generator.
 *
 * The generator's font pairings name these families in their CSS font
 * stacks. Without the actual font files they silently fall back to whatever
 * the operating system provides, which makes the "font pairing" choice
 * cosmetic and renders logos differently on every machine.
 *
 * They are self-hosted (never fetched from a font CDN) so the editor keeps
 * working offline and never contacts a third party while editing.
 */
export const BUNDLED_LOGO_FONT_FAMILIES = [
  'Inter',
  'Space Grotesk',
  'Bitter',
  'Manrope',
] as const

/** Weights the bundled logo templates actually request. */
export const BUNDLED_LOGO_FONT_WEIGHTS = [500, 600, 700] as const

export interface BundledFontLicense {
  readonly family: string
  readonly license: string
  readonly url: string
}

export const BUNDLED_LOGO_FONT_LICENSES: readonly BundledFontLicense[] = [
  {
    family: 'Inter',
    license: 'SIL Open Font License 1.1',
    url: 'https://github.com/rsms/inter',
  },
  {
    family: 'Space Grotesk',
    license: 'SIL Open Font License 1.1',
    url: 'https://github.com/floriankarsten/space-grotesk',
  },
  {
    family: 'Bitter',
    license: 'SIL Open Font License 1.1',
    url: 'https://github.com/solmatas/Bitter',
  },
  {
    family: 'Manrope',
    license: 'SIL Open Font License 1.1',
    url: 'https://github.com/sharanda/manrope',
  },
]

/**
 * Fabric measures text the moment an IText is created, so the logo layout
 * (auto-shrink and centering) is computed from whichever font is resolved at
 * that instant. Inserting before the web font is ready would bake fallback
 * metrics into the object permanently, so callers must await this first.
 *
 * Resolves immediately in environments without the CSS Font Loading API
 * (jsdom, workers), where the system fallback is the only option anyway.
 */
export async function ensureLogoFontsLoaded(): Promise<void> {
  const fonts = globalThis.document?.fonts
  if (!fonts || typeof fonts.load !== 'function') {
    return
  }

  const requests: Promise<unknown>[] = []
  for (const family of BUNDLED_LOGO_FONT_FAMILIES) {
    for (const weight of BUNDLED_LOGO_FONT_WEIGHTS) {
      // A font that fails to load must not block insertion; the fallback
      // still renders, it just does not match the chosen pairing.
      requests.push(
        Promise.resolve(fonts.load(`${weight} 16px "${family}"`)).catch(
          () => undefined,
        ),
      )
    }
  }
  await Promise.all(requests)
}
