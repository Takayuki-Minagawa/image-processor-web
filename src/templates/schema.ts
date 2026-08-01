import type { ProjectFontReference } from '../fonts/types'

export const DESIGN_TEMPLATE_SCHEMA_VERSION = 1 as const
export const MAX_DESIGN_TEMPLATE_PAGES = 50
export const MAX_DESIGN_TEMPLATE_ELEMENTS_PER_PAGE = 500
export const MAX_DESIGN_TEMPLATE_DIMENSION = 16_384
export const MAX_DESIGN_TEMPLATE_TOTAL_PIXELS = 512 * 1024 * 1024

export type BrandColorRole =
  'primary' | 'secondary' | 'accent' | 'background' | 'foreground'
export type BrandFontRole = 'heading' | 'subheading' | 'body'
export type BrandLogoRole = 'primary' | 'secondary'

export type TemplateColor =
  | string
  | {
      type: 'brand-color'
      role: BrandColorRole
    }

export type TemplateFont =
  | ProjectFontReference
  | {
      type: 'brand-font'
      role: BrandFontRole
    }

export type TemplateAssetReference =
  | {
      type: 'asset'
      assetId: string
    }
  | {
      type: 'brand-logo'
      role: BrandLogoRole
    }

interface DesignTemplateElementBase {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
}

export interface DesignTemplateTextElement extends DesignTemplateElementBase {
  kind: 'text'
  text: string
  font: TemplateFont
  fontSize: number
  fontWeight: number
  color: TemplateColor
  align: 'left' | 'center' | 'right'
  lineHeight: number
  letterSpacing: number
  writingMode: 'horizontal-tb' | 'vertical-rl'
  resizeMode: 'auto-width' | 'wrap' | 'fixed'
}

export interface DesignTemplateShapeElement extends DesignTemplateElementBase {
  kind: 'shape'
  shapeAssetId: string
  fill: TemplateColor | 'none'
  stroke: TemplateColor | 'none'
  strokeWidth: number
}

export interface DesignTemplateAssetElement extends DesignTemplateElementBase {
  kind: 'asset'
  reference: TemplateAssetReference
  tint?: TemplateColor
}

export interface DesignTemplateImagePlaceholderElement extends DesignTemplateElementBase {
  kind: 'image-placeholder'
  label: string
  cropMode: 'cover' | 'contain'
  acceptedMediaTypes: ('image/png' | 'image/jpeg' | 'image/webp')[]
}

export type DesignTemplateElement =
  | DesignTemplateTextElement
  | DesignTemplateShapeElement
  | DesignTemplateAssetElement
  | DesignTemplateImagePlaceholderElement

export interface DesignTemplatePage {
  id: string
  name: string
  background: TemplateColor
  elements: DesignTemplateElement[]
}

export interface DesignTemplateDocument {
  width: number
  height: number
  pages: DesignTemplatePage[]
}

export interface DesignTemplate {
  schemaVersion: typeof DESIGN_TEMPLATE_SCHEMA_VERSION
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  document: DesignTemplateDocument
}

export type DesignTemplateErrorCode =
  | 'invalid-template'
  | 'unsupported-template-version'
  | 'template-page-limit'
  | 'template-element-limit'
  | 'template-dimension-limit'

export class DesignTemplateValidationError extends Error {
  readonly code: DesignTemplateErrorCode
  readonly path: string

  constructor(code: DesignTemplateErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'DesignTemplateValidationError'
    this.code = code
    this.path = path
  }
}

export interface DesignTemplateWarning {
  code: 'unknown-element' | 'invalid-element' | 'duplicate-element-id'
  path: string
  message: string
}

export interface ParsedDesignTemplate {
  template: DesignTemplate
  warnings: DesignTemplateWarning[]
}

export interface DesignTemplateLoadFailure {
  index: number
  error: DesignTemplateValidationError
}

export interface DesignTemplateCollectionResult {
  templates: DesignTemplate[]
  warnings: Array<{ index: number; warnings: DesignTemplateWarning[] }>
  failures: DesignTemplateLoadFailure[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (
  path: string,
  message: string,
  code: DesignTemplateErrorCode = 'invalid-template',
): never => {
  throw new DesignTemplateValidationError(code, path, message)
}

const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })

const requiredString = (
  value: unknown,
  path: string,
  maximumLength: number,
  allowEmpty = false,
): string => {
  if (typeof value !== 'string') return fail(path, 'must be a string')
  const normalized = value.trim()
  if (
    (!allowEmpty && normalized.length === 0) ||
    normalized.length > maximumLength ||
    hasControlCharacters(normalized)
  ) {
    return fail(
      path,
      `must contain ${allowEmpty ? '0' : '1'} to ${maximumLength} safe characters`,
    )
  }
  return normalized
}

const slug = (value: unknown, path: string): string => {
  const result = requiredString(value, path, 80)
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(result)) {
    return fail(path, 'must be a lowercase slug')
  }
  return result
}

const finiteNumber = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number => {
  const selected = value === undefined ? fallback : value
  if (
    typeof selected !== 'number' ||
    !Number.isFinite(selected) ||
    selected < minimum ||
    selected > maximum
  ) {
    return fail(path, `must be between ${minimum} and ${maximum}`)
  }
  return selected
}

const enumValue = <T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return fail(path, `must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

const HEX_COLOR = /^#[0-9a-f]{6}$/iu

const parseColor = (value: unknown, path: string): TemplateColor => {
  if (typeof value === 'string') {
    if (!HEX_COLOR.test(value))
      return fail(path, 'must be a six-digit hex color')
    return value.toLowerCase()
  }
  if (!isRecord(value) || value.type !== 'brand-color') {
    return fail(path, 'must be a hex color or brand-color reference')
  }
  return {
    type: 'brand-color',
    role: enumValue(value.role, `${path}.role`, [
      'primary',
      'secondary',
      'accent',
      'background',
      'foreground',
    ] as const),
  }
}

const parseFont = (value: unknown, path: string): TemplateFont => {
  if (!isRecord(value)) return fail(path, 'must be an object')
  if (value.type === 'brand-font') {
    return {
      type: 'brand-font',
      role: enumValue(value.role, `${path}.role`, [
        'heading',
        'subheading',
        'body',
      ] as const),
    }
  }
  return {
    family: requiredString(value.family, `${path}.family`, 120),
    fallback: requiredString(value.fallback, `${path}.fallback`, 200),
    ...(value.sourceId === undefined
      ? {}
      : { sourceId: slug(value.sourceId, `${path}.sourceId`) }),
  }
}

const parseAssetReference = (
  value: unknown,
  path: string,
): TemplateAssetReference => {
  if (!isRecord(value)) return fail(path, 'must be an object')
  if (value.type === 'asset') {
    return { type: 'asset', assetId: slug(value.assetId, `${path}.assetId`) }
  }
  if (value.type === 'brand-logo') {
    return {
      type: 'brand-logo',
      role: enumValue(value.role, `${path}.role`, [
        'primary',
        'secondary',
      ] as const),
    }
  }
  return fail(`${path}.type`, 'must be asset or brand-logo')
}

const parseElementBase = (
  value: Record<string, unknown>,
  path: string,
  document: { width: number; height: number },
): DesignTemplateElementBase => ({
  id: slug(value.id, `${path}.id`),
  x: finiteNumber(
    value.x,
    `${path}.x`,
    -document.width * 4,
    document.width * 4,
  ),
  y: finiteNumber(
    value.y,
    `${path}.y`,
    -document.height * 4,
    document.height * 4,
  ),
  width: finiteNumber(value.width, `${path}.width`, 1, document.width * 4),
  height: finiteNumber(value.height, `${path}.height`, 1, document.height * 4),
  rotation: finiteNumber(value.rotation, `${path}.rotation`, -360, 360, 0),
  opacity: finiteNumber(value.opacity, `${path}.opacity`, 0, 1, 1),
})

const parseElement = (
  value: Record<string, unknown>,
  path: string,
  document: { width: number; height: number },
): DesignTemplateElement => {
  const base = parseElementBase(value, path, document)
  if (value.kind === 'text') {
    return {
      ...base,
      kind: 'text',
      text: requiredString(value.text, `${path}.text`, 10_000, true),
      font: parseFont(value.font, `${path}.font`),
      fontSize: finiteNumber(
        value.fontSize,
        `${path}.fontSize`,
        1,
        document.height * 4,
      ),
      fontWeight: finiteNumber(
        value.fontWeight,
        `${path}.fontWeight`,
        1,
        1_000,
        400,
      ),
      color: parseColor(value.color, `${path}.color`),
      align: enumValue(value.align ?? 'left', `${path}.align`, [
        'left',
        'center',
        'right',
      ] as const),
      lineHeight: finiteNumber(
        value.lineHeight,
        `${path}.lineHeight`,
        0.5,
        5,
        1.2,
      ),
      letterSpacing: finiteNumber(
        value.letterSpacing,
        `${path}.letterSpacing`,
        -1_000,
        2_000,
        0,
      ),
      writingMode: enumValue(
        value.writingMode ?? 'horizontal-tb',
        `${path}.writingMode`,
        ['horizontal-tb', 'vertical-rl'] as const,
      ),
      resizeMode: enumValue(value.resizeMode ?? 'wrap', `${path}.resizeMode`, [
        'auto-width',
        'wrap',
        'fixed',
      ] as const),
    }
  }
  if (value.kind === 'shape') {
    return {
      ...base,
      kind: 'shape',
      shapeAssetId: slug(value.shapeAssetId, `${path}.shapeAssetId`),
      fill:
        value.fill === 'none' ? 'none' : parseColor(value.fill, `${path}.fill`),
      stroke:
        value.stroke === undefined || value.stroke === 'none'
          ? 'none'
          : parseColor(value.stroke, `${path}.stroke`),
      strokeWidth: finiteNumber(
        value.strokeWidth,
        `${path}.strokeWidth`,
        0,
        Math.max(document.width, document.height),
        0,
      ),
    }
  }
  if (value.kind === 'asset') {
    return {
      ...base,
      kind: 'asset',
      reference: parseAssetReference(value.reference, `${path}.reference`),
      ...(value.tint === undefined
        ? {}
        : { tint: parseColor(value.tint, `${path}.tint`) }),
    }
  }
  if (value.kind === 'image-placeholder') {
    if (
      !Array.isArray(value.acceptedMediaTypes) ||
      value.acceptedMediaTypes.length === 0 ||
      value.acceptedMediaTypes.length > 3
    ) {
      return fail(
        `${path}.acceptedMediaTypes`,
        'must be a non-empty bounded array',
      )
    }
    const allowedMedia = ['image/png', 'image/jpeg', 'image/webp'] as const
    const acceptedMediaTypes = value.acceptedMediaTypes.map(
      (mediaType, index) =>
        enumValue(
          mediaType,
          `${path}.acceptedMediaTypes[${index}]`,
          allowedMedia,
        ),
    )
    return {
      ...base,
      kind: 'image-placeholder',
      label: requiredString(value.label ?? 'Image', `${path}.label`, 120),
      cropMode: enumValue(value.cropMode ?? 'cover', `${path}.cropMode`, [
        'cover',
        'contain',
      ] as const),
      acceptedMediaTypes: [...new Set(acceptedMediaTypes)],
    }
  }
  return fail(`${path}.kind`, 'is unknown')
}

const parsePage = (
  value: unknown,
  path: string,
  document: { width: number; height: number },
  warnings: DesignTemplateWarning[],
): DesignTemplatePage => {
  if (!isRecord(value)) return fail(path, 'must be an object')
  if (!Array.isArray(value.elements)) {
    return fail(`${path}.elements`, 'must be an array')
  }
  if (value.elements.length > MAX_DESIGN_TEMPLATE_ELEMENTS_PER_PAGE) {
    return fail(
      `${path}.elements`,
      `may contain at most ${MAX_DESIGN_TEMPLATE_ELEMENTS_PER_PAGE} elements`,
      'template-element-limit',
    )
  }
  const elements: DesignTemplateElement[] = []
  const ids = new Set<string>()
  value.elements.forEach((element, index) => {
    const elementPath = `${path}.elements[${index}]`
    if (!isRecord(element)) {
      warnings.push({
        code: 'invalid-element',
        path: elementPath,
        message: 'Element is not an object and was skipped.',
      })
      return
    }
    if (
      element.kind !== 'text' &&
      element.kind !== 'shape' &&
      element.kind !== 'asset' &&
      element.kind !== 'image-placeholder'
    ) {
      warnings.push({
        code: 'unknown-element',
        path: `${elementPath}.kind`,
        message: `Unknown element kind ${String(element.kind)} was skipped.`,
      })
      return
    }
    try {
      const parsed = parseElement(element, elementPath, document)
      if (ids.has(parsed.id)) {
        warnings.push({
          code: 'duplicate-element-id',
          path: `${elementPath}.id`,
          message: `Duplicate element id ${parsed.id} was skipped.`,
        })
        return
      }
      ids.add(parsed.id)
      elements.push(parsed)
    } catch (error) {
      warnings.push({
        code: 'invalid-element',
        path:
          error instanceof DesignTemplateValidationError
            ? error.path
            : elementPath,
        message:
          error instanceof Error
            ? `${error.message} Element was skipped.`
            : 'Element was skipped.',
      })
    }
  })
  return {
    id: slug(value.id, `${path}.id`),
    name: requiredString(value.name ?? `Page ${path}`, `${path}.name`, 120),
    background: parseColor(value.background ?? '#ffffff', `${path}.background`),
    elements,
  }
}

export function parseDesignTemplate(value: unknown): ParsedDesignTemplate {
  if (!isRecord(value)) return fail('$', 'must be an object')
  if (value.schemaVersion !== DESIGN_TEMPLATE_SCHEMA_VERSION) {
    return fail(
      '$.schemaVersion',
      `only version ${DESIGN_TEMPLATE_SCHEMA_VERSION} is supported`,
      'unsupported-template-version',
    )
  }
  if (!isRecord(value.document)) return fail('$.document', 'must be an object')
  const width = finiteNumber(
    value.document.width,
    '$.document.width',
    1,
    MAX_DESIGN_TEMPLATE_DIMENSION,
  )
  const height = finiteNumber(
    value.document.height,
    '$.document.height',
    1,
    MAX_DESIGN_TEMPLATE_DIMENSION,
  )
  if (
    !Array.isArray(value.document.pages) ||
    value.document.pages.length === 0
  ) {
    return fail('$.document.pages', 'must be a non-empty array')
  }
  if (value.document.pages.length > MAX_DESIGN_TEMPLATE_PAGES) {
    return fail(
      '$.document.pages',
      `may contain at most ${MAX_DESIGN_TEMPLATE_PAGES} pages`,
      'template-page-limit',
    )
  }
  if (
    width * height * value.document.pages.length >
    MAX_DESIGN_TEMPLATE_TOTAL_PIXELS
  ) {
    return fail(
      '$.document',
      `total page area may not exceed ${MAX_DESIGN_TEMPLATE_TOTAL_PIXELS} pixels`,
      'template-dimension-limit',
    )
  }
  const warnings: DesignTemplateWarning[] = []
  const documentSize = { width, height }
  const pages = value.document.pages.map((page, index) =>
    parsePage(page, `$.document.pages[${index}]`, documentSize, warnings),
  )
  const pageIds = new Set<string>()
  for (const page of pages) {
    if (pageIds.has(page.id)) {
      return fail('$.document.pages', `contains duplicate page id ${page.id}`)
    }
    pageIds.add(page.id)
  }

  const tags = value.tags === undefined ? [] : value.tags
  if (!Array.isArray(tags) || tags.length > 30) {
    return fail('$.tags', 'must be an array of at most 30 tags')
  }
  return {
    template: {
      schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
      id: slug(value.id, '$.id'),
      name: requiredString(value.name, '$.name', 120),
      description: requiredString(
        value.description ?? '',
        '$.description',
        500,
        true,
      ),
      category: requiredString(value.category, '$.category', 80),
      tags: tags.map((tag, index) =>
        requiredString(tag, `$.tags[${index}]`, 60),
      ),
      document: { width, height, pages },
    },
    warnings,
  }
}

export function loadValidDesignTemplates(
  values: readonly unknown[],
): DesignTemplateCollectionResult {
  const templates: DesignTemplate[] = []
  const warnings: DesignTemplateCollectionResult['warnings'] = []
  const failures: DesignTemplateLoadFailure[] = []
  const ids = new Set<string>()
  values.forEach((value, index) => {
    try {
      const parsed = parseDesignTemplate(value)
      if (ids.has(parsed.template.id)) {
        fail('$.id', `duplicates template id ${parsed.template.id}`)
      }
      ids.add(parsed.template.id)
      templates.push(parsed.template)
      if (parsed.warnings.length > 0) {
        warnings.push({ index, warnings: parsed.warnings })
      }
    } catch (error) {
      failures.push({
        index,
        error:
          error instanceof DesignTemplateValidationError
            ? error
            : new DesignTemplateValidationError(
                'invalid-template',
                '$',
                'could not be validated',
              ),
      })
    }
  })
  return { templates, warnings, failures }
}
