import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOGO_FONT_PAIRS,
  DEFAULT_LOGO_PALETTES,
  LOGO_SURFACE_COLOR,
  createHarmonyPalettes,
  deriveInitials,
  generateLogoVariations,
  locksFromVariation,
} from './generator'
import { MINIMUM_TEXT_CONTRAST, contrastRatio } from './colors'

describe('logo generator inputs', () => {
  it('derives initials across words and Unicode names', () => {
    expect(deriveInitials('Pixelweave Studio')).toBe('PS')
    expect(deriveInitials('alpha beta collective')).toBe('ABC')
    expect(deriveInitials('みな川')).toBe('みな')
    expect(deriveInitials('  ---  ')).toBe('')
  })

  it('creates valid harmony palettes from a normalized base color', () => {
    const palettes = createHarmonyPalettes('#F00')
    expect(palettes).toHaveLength(4)
    expect(new Set(palettes.map(({ id }) => id)).size).toBe(4)
    for (const palette of palettes) {
      expect(palette.colors.primary).toBe('#ff0000')
      // The foreground keeps the palette's own character where it can - it is
      // only forced to plain black or white when nothing else is legible.
      expect(palette.colors.foreground).toMatch(/^#[0-9a-f]{6}$/u)
      expect(
        contrastRatio(palette.colors.foreground, LOGO_SURFACE_COLOR),
      ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
    }
  })
})

describe('generateLogoVariations', () => {
  it('generates ten or more deterministic, editable candidates', () => {
    const input = {
      name: 'Pixelweave Studio',
      tagline: 'Local creative tools',
    }
    const first = generateLogoVariations(input, {
      count: 14,
      seed: 'stable-seed',
    })
    const second = generateLogoVariations(input, {
      count: 14,
      seed: 'stable-seed',
    })

    expect(first).toHaveLength(14)
    expect(second).toEqual(first)
    expect(new Set(first.map(({ id }) => id)).size).toBe(14)
    expect(first.every(({ elements }) => elements.length > 0)).toBe(true)
    expect(
      first
        .flatMap(({ elements }) => elements)
        .every((element) => {
          if (element.kind === 'shape') {
            return element.fill === 'none' || element.fill.startsWith('#')
          }
          return (
            element.text.length > 0 &&
            element.color.startsWith('#') &&
            element.fontFamily.length > 0
          )
        }),
    ).toBe(true)
  })

  it('generates a 12-candidate interactive set within the two-second budget', () => {
    const started = performance.now()
    const candidates = generateLogoVariations(
      {
        name: 'Performance Brand',
        tagline: 'Deterministic local logo generation',
      },
      { count: 12, seed: 'performance-budget' },
    )
    const elapsed = performance.now() - started

    expect(candidates).toHaveLength(12)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('changes the deterministic order when the seed changes', () => {
    const first = generateLogoVariations(
      { name: 'Seeded' },
      { seed: 'first', count: 12 },
    )
    const second = generateLogoVariations(
      { name: 'Seeded' },
      { seed: 'second', count: 12 },
    )

    expect(second.map(({ id }) => id)).not.toEqual(first.map(({ id }) => id))
  })

  it('locks layout, colors, and fonts independently or together', () => {
    const initial = generateLogoVariations(
      { name: 'Locked Brand', tagline: 'Stable choices' },
      { seed: 7, count: 12 },
    )[0]

    const layoutLocked = generateLogoVariations(
      { name: 'Locked Brand', tagline: 'Stable choices' },
      {
        seed: 8,
        count: 12,
        locks: locksFromVariation(initial, { layout: true }),
      },
    )
    expect(
      layoutLocked.every(({ templateId }) => templateId === initial.templateId),
    ).toBe(true)
    expect(
      new Set(layoutLocked.map(({ paletteId }) => paletteId)).size,
    ).toBeGreaterThan(1)

    const allLocked = generateLogoVariations(
      { name: 'Locked Brand', tagline: 'Stable choices' },
      {
        seed: 9,
        count: 12,
        locks: locksFromVariation(initial, {
          layout: true,
          colors: true,
          fonts: true,
        }),
      },
    )
    expect(allLocked).toHaveLength(12)
    expect(
      allLocked.every(
        ({ templateId, paletteId, fontPairId }) =>
          templateId === initial.templateId &&
          paletteId === initial.paletteId &&
          fontPairId === initial.fontPairId,
      ),
    ).toBe(true)
  })

  it('omits an empty optional tagline slot and honors supplied initials', () => {
    const variations = generateLogoVariations(
      { name: 'North Star', initials: 'NSX' },
      { seed: 'text', count: 30 },
    )
    const textElements = variations.flatMap(({ elements }) =>
      elements.filter((element) => element.kind === 'text'),
    )

    expect(textElements.some(({ slot }) => slot === 'tagline')).toBe(false)
    expect(
      textElements
        .filter(({ slot }) => slot === 'initials')
        .every(({ text }) => text === 'NSX'),
    ).toBe(true)
  })

  it('rejects unavailable locks and invalid user input', () => {
    expect(() =>
      generateLogoVariations(
        { name: 'Brand' },
        { locks: { layoutId: 'missing-layout' } },
      ),
    ).toThrow(/not available/i)
    expect(() => generateLogoVariations({ name: '   ' })).toThrow(/name/i)
    expect(() =>
      generateLogoVariations({
        name: 'Brand',
        initials: 'TOO-LONG',
      }),
    ).toThrow(/initials/i)
  })

  it('exports usable default font and palette dimensions', () => {
    expect(DEFAULT_LOGO_FONT_PAIRS.length).toBeGreaterThanOrEqual(4)
    expect(DEFAULT_LOGO_PALETTES.length).toBeGreaterThanOrEqual(4)
  })

  it('keeps canvas-drawn text legible on the logo surface for every base color', () => {
    // '#0a7f4b' used to drive every harmony rule to a white foreground, so all
    // twelve candidates rendered their name white-on-white and looked empty.
    const baseColors = [
      '#0a7f4b',
      '#6757e8',
      '#ffffff',
      '#000000',
      '#808080',
      '#ffe600',
    ]

    for (const baseColor of baseColors) {
      for (const palette of createHarmonyPalettes(baseColor)) {
        expect(
          contrastRatio(palette.colors.foreground, LOGO_SURFACE_COLOR),
        ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
      }
    }
  })

  it('renders every generated candidate with a visible name', () => {
    for (const baseColor of ['#0a7f4b', '#6757e8', '#808080']) {
      const variations = generateLogoVariations(
        { name: 'North Star', tagline: 'Guiding light' },
        { palettes: createHarmonyPalettes(baseColor), seed: 7 },
      )

      for (const variation of variations) {
        const name = variation.elements.find(
          (element) => element.kind === 'text' && element.slot === 'name',
        )
        if (!name || name.kind !== 'text') continue
        expect(
          contrastRatio(name.color, LOGO_SURFACE_COLOR),
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
