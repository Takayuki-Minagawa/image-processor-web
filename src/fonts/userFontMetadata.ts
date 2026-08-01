import type {
  FontFamilyDefinition,
  FontStyle,
  ProjectFontReference,
} from './types'

export const USER_FONT_METADATA_SCHEMA_VERSION = 1 as const
export const MAX_USER_FONT_BYTES = 32 * 1024 * 1024

export type UserFontFormat = 'woff2' | 'ttf' | 'otf'

const USER_FONT_MIME_FORMATS: Readonly<Record<string, UserFontFormat>> = {
  'application/font-sfnt': 'ttf',
  'application/font-woff2': 'woff2',
  'application/vnd.ms-opentype': 'otf',
  'application/x-font-opentype': 'otf',
  'application/x-font-ttf': 'ttf',
  'application/x-font-woff2': 'woff2',
  'font/opentype': 'otf',
  'font/otf': 'otf',
  'font/sfnt': 'ttf',
  'font/truetype': 'ttf',
  'font/ttf': 'ttf',
  'font/woff2': 'woff2',
}

const firstFourBytes = (input: ArrayBuffer | ArrayBufferView): Uint8Array =>
  input instanceof ArrayBuffer
    ? new Uint8Array(input, 0, Math.min(4, input.byteLength))
    : new Uint8Array(
        input.buffer,
        input.byteOffset,
        Math.min(4, input.byteLength),
      )

/**
 * Resolves the real file extension returned by the Local Font Access API.
 * The SFNT signature is authoritative because browser MIME values are often
 * blank or use the generic `application/font-sfnt` value.
 */
export function detectUserFontFormat(
  input: ArrayBuffer | ArrayBufferView,
  mimeType = '',
): UserFontFormat {
  const bytes = firstFourBytes(input)
  if (bytes.byteLength >= 4) {
    const tag = String.fromCharCode(...bytes)
    if (tag === 'wOF2') return 'woff2'
    if (tag === 'OTTO') return 'otf'
    if (
      (bytes[0] === 0x00 &&
        bytes[1] === 0x01 &&
        bytes[2] === 0x00 &&
        bytes[3] === 0x00) ||
      tag === 'true' ||
      tag === 'typ1'
    ) {
      return 'ttf'
    }
  }
  const normalizedMimeType = mimeType.split(';', 1)[0].trim().toLowerCase()
  const mimeFormat = USER_FONT_MIME_FORMATS[normalizedMimeType]
  if (mimeFormat) return mimeFormat
  throw new TypeError('The local font format could not be identified.')
}

export interface UserFontMetadata {
  schemaVersion: typeof USER_FONT_METADATA_SCHEMA_VERSION
  id: string
  family: string
  displayName: string
  fileName: string
  format: UserFontFormat
  byteLength: number
  sha256: string
  style: FontStyle
  weightMinimum: number
  weightMaximum: number
  fallback: string
  addedAt: string
  licenseAcknowledged: true
  storage: 'opfs'
  projectEmbedding: 'reference-only'
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

const stringValue = (value: unknown, path: string, maximum: number): string => {
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

const weight = (value: unknown, path: string): number => {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 1_000
  ) {
    return fail(path, 'must be an integer from 1 to 1000')
  }
  return value as number
}

export function parseUserFontMetadata(value: unknown): UserFontMetadata {
  if (!isRecord(value)) return fail('$', 'must be an object')
  if (value.schemaVersion !== USER_FONT_METADATA_SCHEMA_VERSION) {
    return fail('$.schemaVersion', 'is unsupported')
  }
  const id = stringValue(value.id, '$.id', 80)
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
    return fail('$.id', 'must be a lowercase slug')
  }
  const formats = ['woff2', 'ttf', 'otf'] as const
  if (!formats.includes(value.format as UserFontFormat)) {
    return fail('$.format', 'must be woff2, ttf, or otf')
  }
  if (
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) <= 0 ||
    (value.byteLength as number) > MAX_USER_FONT_BYTES
  ) {
    return fail('$.byteLength', 'is outside the allowed range')
  }
  const sha256 = stringValue(value.sha256, '$.sha256', 64).toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    return fail('$.sha256', 'must be a SHA-256 hex digest')
  }
  if (value.style !== 'normal' && value.style !== 'italic') {
    return fail('$.style', 'must be normal or italic')
  }
  const weightMinimum = weight(value.weightMinimum, '$.weightMinimum')
  const weightMaximum = weight(value.weightMaximum, '$.weightMaximum')
  if (weightMinimum > weightMaximum) {
    return fail('$.weightMinimum', 'must not exceed weightMaximum')
  }
  const addedAt = stringValue(value.addedAt, '$.addedAt', 64)
  if (!Number.isFinite(Date.parse(addedAt))) {
    return fail('$.addedAt', 'must be a valid timestamp')
  }
  if (value.licenseAcknowledged !== true) {
    return fail(
      '$.licenseAcknowledged',
      'must record confirmation that the font may be used locally',
    )
  }
  return {
    schemaVersion: USER_FONT_METADATA_SCHEMA_VERSION,
    id,
    family: stringValue(value.family, '$.family', 120),
    displayName: stringValue(value.displayName, '$.displayName', 120),
    fileName: stringValue(value.fileName, '$.fileName', 255).replace(
      /[\\/]/gu,
      '_',
    ),
    format: value.format as UserFontFormat,
    byteLength: value.byteLength as number,
    sha256,
    style: value.style,
    weightMinimum,
    weightMaximum,
    fallback: stringValue(value.fallback, '$.fallback', 200),
    addedAt,
    licenseAcknowledged: true,
    storage: 'opfs',
    projectEmbedding: 'reference-only',
  }
}

export const userFontToDefinition = (
  metadata: UserFontMetadata,
): FontFamilyDefinition => ({
  id: metadata.id,
  family: metadata.family,
  displayName: metadata.displayName,
  category: 'sans-serif',
  scripts: ['latin', 'japanese'],
  weights: {
    minimum: metadata.weightMinimum,
    maximum: metadata.weightMaximum,
  },
  styles: [metadata.style],
  fallbackStack: metadata.fallback,
  variable: metadata.weightMinimum !== metadata.weightMaximum,
  source: {
    type: 'user',
    metadataId: metadata.id,
    projectEmbedding: 'reference-only',
  },
})

/** Project files retain only a family reference and fallback, never font bytes. */
export const userFontProjectReference = (
  metadata: UserFontMetadata,
): ProjectFontReference => ({
  family: metadata.family,
  fallback: metadata.fallback,
  sourceId: metadata.id,
})

export interface FontFaceLike {
  load(): Promise<FontFaceLike>
}

export interface FontFaceSetLike {
  add(font: FontFaceLike): unknown
}

export type FontFaceFactory = (
  family: string,
  source: ArrayBuffer,
  descriptors: FontFaceDescriptors,
) => FontFaceLike

/**
 * Loads already-validated local bytes through FontFace. Persistence and OPFS
 * retrieval intentionally stay outside this renderer-independent module.
 */
export async function loadUserFontFace(
  metadata: UserFontMetadata,
  bytes: ArrayBuffer,
  dependencies: {
    createFontFace?: FontFaceFactory
    fontSet?: FontFaceSetLike
  } = {},
): Promise<FontFaceLike> {
  if (
    bytes.byteLength !== metadata.byteLength ||
    bytes.byteLength > MAX_USER_FONT_BYTES
  ) {
    throw new RangeError(
      'User font bytes do not match their validated metadata.',
    )
  }
  const createFontFace =
    dependencies.createFontFace ??
    ((family, source, descriptors) =>
      new FontFace(family, source, descriptors) as unknown as FontFaceLike)
  const fontSet =
    dependencies.fontSet ??
    (globalThis.document?.fonts as unknown as FontFaceSetLike | undefined)
  if (!fontSet || typeof fontSet.add !== 'function') {
    throw new Error('The CSS Font Loading API is unavailable.')
  }
  const weightDescriptor =
    metadata.weightMinimum === metadata.weightMaximum
      ? `${metadata.weightMinimum}`
      : `${metadata.weightMinimum} ${metadata.weightMaximum}`
  const face = createFontFace(metadata.family, bytes, {
    style: metadata.style,
    weight: weightDescriptor,
  })
  const loaded = await face.load()
  fontSet.add(loaded)
  return loaded
}
