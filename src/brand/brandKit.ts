import type { ProjectFontReference } from '../fonts/types'
import type {
  BrandColorRole,
  BrandFontRole,
  BrandLogoRole,
  DesignTemplate,
  DesignTemplateElement,
  TemplateAssetReference,
  TemplateColor,
  TemplateFont,
} from '../templates/schema'

export const BRAND_KIT_SCHEMA_VERSION = 1 as const
export const MAX_BRAND_PALETTES = 20
export const MAX_BRAND_LOGOS = 20

export interface BrandColorPalette {
  id: string
  name: string
  colors: Record<BrandColorRole, string>
}

export interface BrandLogoReference {
  id: string
  name: string
  role: BrandLogoRole
  assetId: string
}

export interface BrandKit {
  schemaVersion: typeof BRAND_KIT_SCHEMA_VERSION
  id: string
  name: string
  palettes: BrandColorPalette[]
  fonts: {
    heading: ProjectFontReference
    subheading?: ProjectFontReference
    body: ProjectFontReference
  }
  logos: BrandLogoReference[]
  updatedAt: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`)
}

const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })

const text = (value: unknown, path: string, maximum = 120): string => {
  if (typeof value !== 'string') return fail(path, 'must be a string')
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    hasControlCharacters(normalized)
  ) {
    return fail(path, `must contain 1 to ${maximum} safe characters`)
  }
  return normalized
}

const slug = (value: unknown, path: string): string => {
  const result = text(value, path, 80)
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(result)) {
    return fail(path, 'must be a lowercase slug')
  }
  return result
}

const color = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/iu.test(value)) {
    return fail(path, 'must be a six-digit hex color')
  }
  return value.toLowerCase()
}

const fontReference = (value: unknown, path: string): ProjectFontReference => {
  if (!isRecord(value)) return fail(path, 'must be an object')
  return {
    family: text(value.family, `${path}.family`),
    fallback: text(value.fallback, `${path}.fallback`, 200),
    ...(value.sourceId === undefined
      ? {}
      : { sourceId: slug(value.sourceId, `${path}.sourceId`) }),
  }
}

const COLOR_ROLES: readonly BrandColorRole[] = [
  'primary',
  'secondary',
  'accent',
  'background',
  'foreground',
]

export function parseBrandKit(value: unknown): BrandKit {
  if (!isRecord(value)) return fail('$', 'must be an object')
  if (value.schemaVersion !== BRAND_KIT_SCHEMA_VERSION) {
    return fail('$.schemaVersion', 'is unsupported')
  }
  if (
    !Array.isArray(value.palettes) ||
    value.palettes.length === 0 ||
    value.palettes.length > MAX_BRAND_PALETTES
  ) {
    return fail(
      '$.palettes',
      `must contain 1 to ${MAX_BRAND_PALETTES} palettes`,
    )
  }
  const paletteIds = new Set<string>()
  const palettes = value.palettes.map((palette, index): BrandColorPalette => {
    const path = `$.palettes[${index}]`
    if (!isRecord(palette) || !isRecord(palette.colors)) {
      return fail(path, 'must contain a colors object')
    }
    const paletteColors = palette.colors
    const id = slug(palette.id, `${path}.id`)
    if (paletteIds.has(id)) return fail(`${path}.id`, 'must be unique')
    paletteIds.add(id)
    return {
      id,
      name: text(palette.name, `${path}.name`),
      colors: Object.fromEntries(
        COLOR_ROLES.map((role) => [
          role,
          color(paletteColors[role], `${path}.colors.${role}`),
        ]),
      ) as Record<BrandColorRole, string>,
    }
  })
  if (!isRecord(value.fonts)) return fail('$.fonts', 'must be an object')
  if (!Array.isArray(value.logos) || value.logos.length > MAX_BRAND_LOGOS) {
    return fail('$.logos', `must contain at most ${MAX_BRAND_LOGOS} logos`)
  }
  const logoIds = new Set<string>()
  const logoRoles = new Set<BrandLogoRole>()
  const logos = value.logos.map((logo, index): BrandLogoReference => {
    const path = `$.logos[${index}]`
    if (!isRecord(logo)) return fail(path, 'must be an object')
    const id = slug(logo.id, `${path}.id`)
    if (logoIds.has(id)) return fail(`${path}.id`, 'must be unique')
    logoIds.add(id)
    if (logo.role !== 'primary' && logo.role !== 'secondary') {
      return fail(`${path}.role`, 'must be primary or secondary')
    }
    if (logoRoles.has(logo.role)) {
      return fail(`${path}.role`, 'may only be assigned once')
    }
    logoRoles.add(logo.role)
    return {
      id,
      name: text(logo.name, `${path}.name`),
      role: logo.role,
      assetId: slug(logo.assetId, `${path}.assetId`),
    }
  })
  const updatedAt = text(value.updatedAt, '$.updatedAt', 64)
  if (!Number.isFinite(Date.parse(updatedAt))) {
    return fail('$.updatedAt', 'must be a valid timestamp')
  }
  return {
    schemaVersion: BRAND_KIT_SCHEMA_VERSION,
    id: slug(value.id, '$.id'),
    name: text(value.name, '$.name'),
    palettes,
    fonts: {
      heading: fontReference(value.fonts.heading, '$.fonts.heading'),
      ...(value.fonts.subheading === undefined
        ? {}
        : {
            subheading: fontReference(
              value.fonts.subheading,
              '$.fonts.subheading',
            ),
          }),
      body: fontReference(value.fonts.body, '$.fonts.body'),
    },
    logos,
    updatedAt,
  }
}

const selectedPalette = (
  kit: BrandKit,
  paletteId?: string,
): BrandColorPalette => {
  const palette =
    paletteId === undefined
      ? kit.palettes[0]
      : kit.palettes.find(({ id }) => id === paletteId)
  if (!palette) throw new RangeError(`Unknown brand palette: ${paletteId}`)
  return palette
}

export const resolveBrandColor = (
  kit: BrandKit,
  role: BrandColorRole,
  paletteId?: string,
): string => selectedPalette(kit, paletteId).colors[role]

export const resolveBrandFont = (
  kit: BrandKit,
  role: BrandFontRole,
): ProjectFontReference =>
  role === 'body'
    ? kit.fonts.body
    : role === 'subheading'
      ? (kit.fonts.subheading ?? kit.fonts.heading)
      : kit.fonts.heading

export const resolveBrandLogo = (
  kit: BrandKit,
  role: BrandLogoRole,
): BrandLogoReference | undefined =>
  kit.logos.find((logo) => logo.role === role)

const appliedColor = (
  value: TemplateColor,
  kit: BrandKit,
  paletteId?: string,
): string =>
  typeof value === 'string'
    ? value
    : resolveBrandColor(kit, value.role, paletteId)

const appliedFont = (
  value: TemplateFont,
  kit: BrandKit,
): ProjectFontReference =>
  'type' in value ? { ...resolveBrandFont(kit, value.role) } : { ...value }

export interface BrandApplicationWarning {
  elementId: string
  message: string
}

export interface BrandApplicationResult {
  template: DesignTemplate
  warnings: BrandApplicationWarning[]
}

const applyElement = (
  element: DesignTemplateElement,
  kit: BrandKit,
  paletteId: string | undefined,
  warnings: BrandApplicationWarning[],
): DesignTemplateElement => {
  if (element.kind === 'text') {
    return {
      ...element,
      font: appliedFont(element.font, kit),
      color: appliedColor(element.color, kit, paletteId),
    }
  }
  if (element.kind === 'shape') {
    return {
      ...element,
      fill:
        element.fill === 'none'
          ? 'none'
          : appliedColor(element.fill, kit, paletteId),
      stroke:
        element.stroke === 'none'
          ? 'none'
          : appliedColor(element.stroke, kit, paletteId),
    }
  }
  if (element.kind === 'asset') {
    let reference: TemplateAssetReference = element.reference
    if (reference.type === 'brand-logo') {
      const logo = resolveBrandLogo(kit, reference.role)
      if (logo) {
        reference = { type: 'asset', assetId: logo.assetId }
      } else {
        warnings.push({
          elementId: element.id,
          message: `No ${reference.role} brand logo is registered.`,
        })
      }
    }
    return {
      ...element,
      reference,
      ...(element.tint === undefined
        ? {}
        : { tint: appliedColor(element.tint, kit, paletteId) }),
    }
  }
  return { ...element, acceptedMediaTypes: [...element.acceptedMediaTypes] }
}

/** Expands brand tokens without mutating the reusable source template. */
export function applyBrandKitToTemplate(
  template: DesignTemplate,
  kit: BrandKit,
  paletteId?: string,
): BrandApplicationResult {
  // Validate the palette before mapping so an empty template cannot hide a bad id.
  selectedPalette(kit, paletteId)
  const warnings: BrandApplicationWarning[] = []
  return {
    template: {
      ...template,
      document: {
        ...template.document,
        pages: template.document.pages.map((page) => ({
          ...page,
          background: appliedColor(page.background, kit, paletteId),
          elements: page.elements.map((element) =>
            applyElement(element, kit, paletteId, warnings),
          ),
        })),
      },
    },
    warnings,
  }
}
