import {
  generateColorHarmony,
  parseHexColor,
  readableOnSurface,
  rgbToHex,
  type ColorHarmonyRule,
  type HexColor,
} from './colors'
import { BUILTIN_LOGO_TEMPLATES } from './templates'
import {
  LOGO_COLOR_SLOTS,
  type LogoColorSlot,
  type LogoTemplate,
  type LogoTemplateShapeElement,
  type LogoTemplateTextElement,
} from './templateSchema'

export interface LogoGeneratorInput {
  name: string
  initials?: string
  tagline?: string
}

export interface LogoPalette {
  id: string
  name: string
  colors: Record<LogoColorSlot, HexColor>
}

export interface LogoFontPair {
  id: string
  name: string
  display: string
  body: string
}

export interface LogoVariationLocks {
  layoutId?: string
  paletteId?: string
  fontPairId?: string
}

export interface LogoLockSelection {
  layout?: boolean
  colors?: boolean
  fonts?: boolean
}

export interface GenerateLogoVariationOptions {
  count?: number
  seed?: string | number
  templates?: readonly LogoTemplate[]
  palettes?: readonly LogoPalette[]
  fontPairs?: readonly LogoFontPair[]
  locks?: LogoVariationLocks
}

interface ResolvedElementBase {
  id: string
  x: number
  y: number
  rotation: number
  opacity: number
}

export interface ResolvedLogoTextElement extends ResolvedElementBase {
  kind: 'text'
  slot: LogoTemplateTextElement['slot']
  text: string
  fontFamily: string
  color: HexColor
  fontSize: number
  fontWeight: number
  maxWidth: number
  letterSpacing: number
  lineHeight: number
  align: LogoTemplateTextElement['align']
}

export interface ResolvedLogoShapeElement extends ResolvedElementBase {
  kind: 'shape'
  shape: LogoTemplateShapeElement['shape']
  width: number
  height: number
  cornerRadius: number
  fill: HexColor | 'none'
  stroke: HexColor | 'none'
  strokeWidth: number
}

export type ResolvedLogoElement =
  ResolvedLogoTextElement | ResolvedLogoShapeElement

export interface LogoVariation {
  id: string
  templateId: string
  templateName: string
  paletteId: string
  fontPairId: string
  canvas: LogoTemplate['canvas']
  input: Required<LogoGeneratorInput>
  palette: LogoPalette
  fontPair: LogoFontPair
  elements: ResolvedLogoElement[]
}

export const DEFAULT_LOGO_FONT_PAIRS: readonly LogoFontPair[] = [
  {
    id: 'modern-sans',
    name: 'Modern Sans',
    display: 'Inter, system-ui, sans-serif',
    body: 'Inter, system-ui, sans-serif',
  },
  {
    id: 'geometric',
    name: 'Geometric',
    display: '"Space Grotesk", system-ui, sans-serif',
    body: 'Inter, system-ui, sans-serif',
  },
  {
    id: 'editorial',
    name: 'Editorial',
    display: 'Bitter, Georgia, serif',
    body: 'Inter, system-ui, sans-serif',
  },
  {
    id: 'rounded',
    name: 'Rounded',
    display: 'Manrope, system-ui, sans-serif',
    body: 'Manrope, system-ui, sans-serif',
  },
  {
    id: 'classic',
    name: 'Classic',
    display: 'Georgia, "Times New Roman", serif',
    body: 'Arial, system-ui, sans-serif',
  },
]

const HARMONY_RULES: readonly ColorHarmonyRule[] = [
  'complementary',
  'analogous',
  'triadic',
  'monochromatic',
]

/**
 * The surface a generated logo is judged against: the candidate previews
 * render on white, and a new document defaults to a transparent canvas that
 * the editor also shows on white.
 */
export const LOGO_SURFACE_COLOR = '#ffffff'

const normalizeId = (value: string, label: string): string => {
  const normalized = value.trim()
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase slug.`)
  }
  return normalized
}

const normalizedHex = (value: string): HexColor =>
  rgbToHex(parseHexColor(value))

export function createHarmonyPalettes(baseColor: string): LogoPalette[] {
  return HARMONY_RULES.map((rule) => {
    const harmony = generateColorHarmony(baseColor, rule)
    const background = harmony[3]
    return {
      id: `harmony-${rule}`,
      name:
        rule === 'complementary'
          ? 'Complementary'
          : rule === 'analogous'
            ? 'Analogous'
            : rule === 'triadic'
              ? 'Triadic'
              : 'Monochromatic',
      colors: {
        primary: harmony[0],
        secondary: harmony[1],
        accent: harmony[2],
        background,
        // `foreground` colours the elements drawn straight onto the canvas
        // (the name, the tagline, a rule). The `background` swatch is never
        // painted behind them, so deriving this from `background` produced
        // white-on-white text - for some base colours every one of the twelve
        // candidates rendered its name invisibly. Pick the most on-brand
        // colour that is actually legible on the surface instead.
        foreground: readableOnSurface(
          [harmony[0], harmony[3], harmony[1], harmony[2]],
          LOGO_SURFACE_COLOR,
        ),
      },
    }
  })
}

export const DEFAULT_LOGO_PALETTES: readonly LogoPalette[] =
  createHarmonyPalettes('#6757e8')

const normalizeInput = (
  input: LogoGeneratorInput,
): Required<LogoGeneratorInput> => {
  const name = input.name.trim().replace(/\s+/gu, ' ')
  if (name.length === 0 || name.length > 120) {
    throw new TypeError('Logo name must contain 1 to 120 characters.')
  }
  const tagline = (input.tagline ?? '').trim().replace(/\s+/gu, ' ')
  if (tagline.length > 160) {
    throw new TypeError('Logo tagline may contain at most 160 characters.')
  }
  const providedInitials = (input.initials ?? '').trim().toLocaleUpperCase()
  const initials = providedInitials || deriveInitials(name)
  if (Array.from(initials).length > 6) {
    throw new TypeError('Logo initials may contain at most 6 characters.')
  }
  return { name, initials, tagline }
}

export function deriveInitials(name: string, maximum = 3): string {
  const safeMaximum = Math.min(6, Math.max(1, Math.round(maximum)))
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? []
  if (words.length === 0) {
    return ''
  }
  const characters =
    words.length > 1
      ? words.slice(0, safeMaximum).map((word) => Array.from(word)[0] ?? '')
      : Array.from(words[0] ?? '').slice(0, Math.min(2, safeMaximum))
  return characters.join('').toLocaleUpperCase()
}

const validatePalette = (palette: LogoPalette): LogoPalette => {
  const id = normalizeId(palette.id, 'Palette id')
  const name = palette.name.trim()
  if (name.length === 0 || name.length > 80) {
    throw new TypeError('Palette name must contain 1 to 80 characters.')
  }
  return {
    id,
    name,
    colors: Object.fromEntries(
      LOGO_COLOR_SLOTS.map((slot) => [
        slot,
        normalizedHex(palette.colors[slot]),
      ]),
    ) as Record<LogoColorSlot, HexColor>,
  }
}

const validateFontPair = (fontPair: LogoFontPair): LogoFontPair => {
  const id = normalizeId(fontPair.id, 'Font pair id')
  const values = [fontPair.name, fontPair.display, fontPair.body].map((value) =>
    value.trim(),
  )
  if (values.some((value) => value.length === 0 || value.length > 160)) {
    throw new TypeError(
      'Font pair names and families must contain 1 to 160 characters.',
    )
  }
  return {
    id,
    name: values[0],
    display: values[1],
    body: values[2],
  }
}

const assertUniqueIds = (
  values: readonly { id: string }[],
  label: string,
): void => {
  const ids = new Set<string>()
  for (const value of values) {
    if (ids.has(value.id)) {
      throw new TypeError(`${label} contains duplicate id "${value.id}".`)
    }
    ids.add(value.id)
  }
}

const filterByLock = <T extends { id: string }>(
  values: readonly T[],
  lockedId: string | undefined,
  label: string,
): readonly T[] => {
  if (!lockedId) {
    return values
  }
  const match = values.find(({ id }) => id === lockedId)
  if (!match) {
    throw new TypeError(`Locked ${label} "${lockedId}" is not available.`)
  }
  return [match]
}

const hashSeed = (value: string | number): number => {
  const source = String(value)
  let hash = 0x811c9dc5
  for (const character of source) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

const shuffled = <T>(values: readonly T[], random: () => number): T[] => {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1))
    ;[result[index], result[selected]] = [result[selected], result[index]]
  }
  return result
}

const resolveColor = (
  slot: LogoColorSlot | 'none',
  palette: LogoPalette,
): HexColor | 'none' => (slot === 'none' ? slot : palette.colors[slot])

const resolveElements = (
  template: LogoTemplate,
  input: Required<LogoGeneratorInput>,
  palette: LogoPalette,
  fontPair: LogoFontPair,
): ResolvedLogoElement[] =>
  template.elements.flatMap((element): ResolvedLogoElement[] => {
    const common = {
      id: element.id,
      x: element.x,
      y: element.y,
      rotation: element.rotation,
      opacity: element.opacity,
    }
    if (element.kind === 'shape') {
      return [
        {
          ...common,
          kind: 'shape',
          shape: element.shape,
          width: element.width,
          height: element.height,
          cornerRadius: element.cornerRadius,
          fill: resolveColor(element.fill, palette),
          stroke: resolveColor(element.stroke, palette),
          strokeWidth: element.strokeWidth,
        },
      ]
    }

    const rawText = input[element.slot]
    if (rawText.length === 0) {
      return []
    }
    return [
      {
        ...common,
        kind: 'text',
        slot: element.slot,
        text: element.uppercase ? rawText.toLocaleUpperCase() : rawText,
        fontFamily:
          element.font === 'display' ? fontPair.display : fontPair.body,
        color: palette.colors[element.color],
        fontSize: element.fontSize,
        fontWeight: element.fontWeight,
        maxWidth: element.maxWidth,
        letterSpacing: element.letterSpacing,
        lineHeight: element.lineHeight,
        align: element.align,
      },
    ]
  })

interface Combination {
  template: LogoTemplate
  palette: LogoPalette
  fontPair: LogoFontPair
}

/**
 * Generates a deterministic candidate grid. If every dimension is locked, the
 * requested grid size is retained so the preview UI does not collapse.
 */
export function generateLogoVariations(
  input: LogoGeneratorInput,
  options: GenerateLogoVariationOptions = {},
): LogoVariation[] {
  const normalizedInput = normalizeInput(input)
  const templates = options.templates ?? BUILTIN_LOGO_TEMPLATES
  const palettes = (options.palettes ?? DEFAULT_LOGO_PALETTES).map(
    validatePalette,
  )
  const fontPairs = (options.fontPairs ?? DEFAULT_LOGO_FONT_PAIRS).map(
    validateFontPair,
  )
  if (
    templates.length === 0 ||
    palettes.length === 0 ||
    fontPairs.length === 0
  ) {
    throw new TypeError(
      'Logo generation requires templates, palettes, and font pairs.',
    )
  }
  assertUniqueIds(templates, 'Templates')
  assertUniqueIds(palettes, 'Palettes')
  assertUniqueIds(fontPairs, 'Font pairs')

  const lockedTemplates = filterByLock(
    templates,
    options.locks?.layoutId,
    'layout',
  )
  const lockedPalettes = filterByLock(
    palettes,
    options.locks?.paletteId,
    'palette',
  )
  const lockedFonts = filterByLock(
    fontPairs,
    options.locks?.fontPairId,
    'font pair',
  )
  const combinations: Combination[] = []
  for (const template of lockedTemplates) {
    for (const palette of lockedPalettes) {
      for (const fontPair of lockedFonts) {
        combinations.push({ template, palette, fontPair })
      }
    }
  }

  const seedSource = options.seed ?? `${normalizedInput.name}:pixelweave`
  const seed = hashSeed(seedSource)
  const randomized = shuffled(combinations, seededRandom(seed))
  const count = Math.min(
    100,
    Math.max(
      1,
      Math.round(
        typeof options.count === 'number' && Number.isFinite(options.count)
          ? options.count
          : 12,
      ),
    ),
  )

  return Array.from({ length: count }, (_, index) => {
    const combination = randomized[index % randomized.length]
    const { template, palette, fontPair } = combination
    return {
      id: `logo-${seed.toString(36)}-${index + 1}-${template.id}-${palette.id}-${fontPair.id}`,
      templateId: template.id,
      templateName: template.name,
      paletteId: palette.id,
      fontPairId: fontPair.id,
      canvas: { ...template.canvas },
      input: { ...normalizedInput },
      palette,
      fontPair,
      elements: resolveElements(template, normalizedInput, palette, fontPair),
    }
  })
}

export function locksFromVariation(
  variation: LogoVariation,
  selection: LogoLockSelection,
): LogoVariationLocks {
  return {
    layoutId: selection.layout ? variation.templateId : undefined,
    paletteId: selection.colors ? variation.paletteId : undefined,
    fontPairId: selection.fonts ? variation.fontPairId : undefined,
  }
}
