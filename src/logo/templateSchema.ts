export const LOGO_TEMPLATE_SCHEMA_VERSION = 1 as const
export const MAX_LOGO_TEMPLATE_ELEMENTS = 40
export const MAX_LOGO_TEMPLATE_DIMENSION = 4_096
export const MAX_LOGO_TEMPLATE_PIXELS = 16 * 1024 * 1024

export const LOGO_COLOR_SLOTS = [
  'primary',
  'secondary',
  'accent',
  'background',
  'foreground',
] as const
export type LogoColorSlot = (typeof LOGO_COLOR_SLOTS)[number]

export const LOGO_TEXT_SLOTS = ['name', 'initials', 'tagline'] as const
export type LogoTextSlot = (typeof LOGO_TEXT_SLOTS)[number]

export const LOGO_FONT_SLOTS = ['display', 'body'] as const
export type LogoFontSlot = (typeof LOGO_FONT_SLOTS)[number]

export interface LogoTemplateCanvas {
  width: number
  height: number
}

interface LogoTemplateElementBase {
  id: string
  x: number
  y: number
  rotation: number
  opacity: number
}

export interface LogoTemplateTextElement extends LogoTemplateElementBase {
  kind: 'text'
  slot: LogoTextSlot
  font: LogoFontSlot
  color: LogoColorSlot
  fontSize: number
  fontWeight: number
  maxWidth: number
  letterSpacing: number
  lineHeight: number
  align: 'left' | 'center' | 'right'
  uppercase: boolean
}

export interface LogoTemplateShapeElement extends LogoTemplateElementBase {
  kind: 'shape'
  shape: 'rect' | 'ellipse'
  width: number
  height: number
  cornerRadius: number
  fill: LogoColorSlot | 'none'
  stroke: LogoColorSlot | 'none'
  strokeWidth: number
}

export type LogoTemplateElement =
  LogoTemplateTextElement | LogoTemplateShapeElement

export interface LogoTemplate {
  schemaVersion: typeof LOGO_TEMPLATE_SCHEMA_VERSION
  id: string
  name: string
  category: string
  canvas: LogoTemplateCanvas
  elements: LogoTemplateElement[]
}

export type LogoTemplateErrorCode =
  | 'invalid-template'
  | 'unsupported-template-version'
  | 'template-element-limit'
  | 'template-dimension-limit'

export class LogoTemplateValidationError extends Error {
  readonly code: LogoTemplateErrorCode
  readonly path: string

  constructor(code: LogoTemplateErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'LogoTemplateValidationError'
    this.code = code
    this.path = path
  }
}

export interface LogoTemplateLoadFailure {
  index: number
  error: LogoTemplateValidationError
}

export interface LogoTemplateLoadResult {
  templates: LogoTemplate[]
  failures: LogoTemplateLoadFailure[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (
  path: string,
  message: string,
  code: LogoTemplateErrorCode = 'invalid-template',
): never => {
  throw new LogoTemplateValidationError(code, path, message)
}

const requiredString = (
  value: unknown,
  path: string,
  maximumLength: number,
): string => {
  if (typeof value !== 'string') {
    return fail(path, 'must be a string')
  }
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximumLength) {
    return fail(path, `must contain 1 to ${maximumLength} characters`)
  }
  return normalized
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

const booleanValue = (
  value: unknown,
  path: string,
  fallback: boolean,
): boolean => {
  if (value === undefined) {
    return fallback
  }
  if (typeof value !== 'boolean') {
    return fail(path, 'must be a boolean')
  }
  return value
}

const parseElementBase = (
  value: Record<string, unknown>,
  path: string,
  canvas: LogoTemplateCanvas,
): LogoTemplateElementBase => {
  const coordinateLimit = Math.max(canvas.width, canvas.height) * 4
  return {
    id: requiredString(value.id, `${path}.id`, 64),
    x: finiteNumber(value.x, `${path}.x`, -coordinateLimit, coordinateLimit),
    y: finiteNumber(value.y, `${path}.y`, -coordinateLimit, coordinateLimit),
    rotation: finiteNumber(value.rotation, `${path}.rotation`, -360, 360, 0),
    opacity: finiteNumber(value.opacity, `${path}.opacity`, 0, 1, 1),
  }
}

const parseTextElement = (
  value: Record<string, unknown>,
  path: string,
  canvas: LogoTemplateCanvas,
): LogoTemplateTextElement => ({
  ...parseElementBase(value, path, canvas),
  kind: 'text',
  slot: enumValue(value.slot, `${path}.slot`, LOGO_TEXT_SLOTS),
  font: enumValue(value.font, `${path}.font`, LOGO_FONT_SLOTS),
  color: enumValue(value.color, `${path}.color`, LOGO_COLOR_SLOTS),
  fontSize: finiteNumber(
    value.fontSize,
    `${path}.fontSize`,
    4,
    canvas.height * 2,
  ),
  fontWeight: finiteNumber(
    value.fontWeight,
    `${path}.fontWeight`,
    100,
    900,
    600,
  ),
  maxWidth: finiteNumber(
    value.maxWidth,
    `${path}.maxWidth`,
    1,
    canvas.width * 4,
  ),
  letterSpacing: finiteNumber(
    value.letterSpacing,
    `${path}.letterSpacing`,
    -200,
    1_000,
    0,
  ),
  lineHeight: finiteNumber(value.lineHeight, `${path}.lineHeight`, 0.5, 4, 1.1),
  align: enumValue(value.align ?? 'left', `${path}.align`, [
    'left',
    'center',
    'right',
  ] as const),
  uppercase: booleanValue(value.uppercase, `${path}.uppercase`, false),
})

const parseShapeElement = (
  value: Record<string, unknown>,
  path: string,
  canvas: LogoTemplateCanvas,
): LogoTemplateShapeElement => {
  const fillSlots = [...LOGO_COLOR_SLOTS, 'none'] as const
  return {
    ...parseElementBase(value, path, canvas),
    kind: 'shape',
    shape: enumValue(value.shape, `${path}.shape`, [
      'rect',
      'ellipse',
    ] as const),
    width: finiteNumber(value.width, `${path}.width`, 1, canvas.width * 4),
    height: finiteNumber(value.height, `${path}.height`, 1, canvas.height * 4),
    cornerRadius: finiteNumber(
      value.cornerRadius,
      `${path}.cornerRadius`,
      0,
      Math.max(canvas.width, canvas.height),
      0,
    ),
    fill: enumValue(value.fill ?? 'none', `${path}.fill`, fillSlots),
    stroke: enumValue(value.stroke ?? 'none', `${path}.stroke`, fillSlots),
    strokeWidth: finiteNumber(
      value.strokeWidth,
      `${path}.strokeWidth`,
      0,
      Math.max(canvas.width, canvas.height),
      0,
    ),
  }
}

const parseElement = (
  value: unknown,
  path: string,
  canvas: LogoTemplateCanvas,
): LogoTemplateElement => {
  if (!isRecord(value)) {
    return fail(path, 'must be an object')
  }
  if (value.kind === 'text') {
    return parseTextElement(value, path, canvas)
  }
  if (value.kind === 'shape') {
    return parseShapeElement(value, path, canvas)
  }
  return fail(`${path}.kind`, 'must be "text" or "shape"')
}

export function parseLogoTemplate(value: unknown): LogoTemplate {
  if (!isRecord(value)) {
    return fail('$', 'must be an object')
  }
  if (value.schemaVersion !== LOGO_TEMPLATE_SCHEMA_VERSION) {
    return fail(
      '$.schemaVersion',
      `only version ${LOGO_TEMPLATE_SCHEMA_VERSION} is supported`,
      'unsupported-template-version',
    )
  }
  const id = requiredString(value.id, '$.id', 64)
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
    return fail('$.id', 'must use lowercase letters, numbers, and hyphens')
  }
  const name = requiredString(value.name, '$.name', 80)
  const category = requiredString(value.category, '$.category', 40)
  if (!isRecord(value.canvas)) {
    return fail('$.canvas', 'must be an object')
  }
  const canvas = {
    width: finiteNumber(
      value.canvas.width,
      '$.canvas.width',
      1,
      MAX_LOGO_TEMPLATE_DIMENSION,
    ),
    height: finiteNumber(
      value.canvas.height,
      '$.canvas.height',
      1,
      MAX_LOGO_TEMPLATE_DIMENSION,
    ),
  }
  if (canvas.width * canvas.height > MAX_LOGO_TEMPLATE_PIXELS) {
    return fail(
      '$.canvas',
      `must not exceed ${MAX_LOGO_TEMPLATE_PIXELS} pixels`,
      'template-dimension-limit',
    )
  }
  if (!Array.isArray(value.elements) || value.elements.length === 0) {
    return fail('$.elements', 'must be a non-empty array')
  }
  if (value.elements.length > MAX_LOGO_TEMPLATE_ELEMENTS) {
    return fail(
      '$.elements',
      `may contain at most ${MAX_LOGO_TEMPLATE_ELEMENTS} elements`,
      'template-element-limit',
    )
  }
  const elements = value.elements.map((element, index) =>
    parseElement(element, `$.elements[${index}]`, canvas),
  )
  const elementIds = new Set<string>()
  for (const element of elements) {
    if (elementIds.has(element.id)) {
      return fail('$.elements', `contains duplicate id "${element.id}"`)
    }
    elementIds.add(element.id)
  }
  if (!elements.some((element) => element.kind === 'text')) {
    return fail('$.elements', 'must contain at least one text slot')
  }

  return {
    schemaVersion: LOGO_TEMPLATE_SCHEMA_VERSION,
    id,
    name,
    category,
    canvas,
    elements,
  }
}

export function loadValidLogoTemplates(
  values: readonly unknown[],
): LogoTemplateLoadResult {
  const templates: LogoTemplate[] = []
  const failures: LogoTemplateLoadFailure[] = []
  const templateIds = new Set<string>()

  values.forEach((value, index) => {
    try {
      const template = parseLogoTemplate(value)
      if (templateIds.has(template.id)) {
        fail('$.id', `duplicates template id "${template.id}"`)
      }
      templateIds.add(template.id)
      templates.push(template)
    } catch (error) {
      failures.push({
        index,
        error:
          error instanceof LogoTemplateValidationError
            ? error
            : new LogoTemplateValidationError(
                'invalid-template',
                '$',
                'could not be validated',
              ),
      })
    }
  })

  return { templates, failures }
}
