import type { AssetSafetyMetadata } from './types'

export const USER_ASSET_METADATA_SCHEMA_VERSION = 1 as const
export const MAX_USER_ASSET_BYTES = 64 * 1024 * 1024

export interface UserAssetMetadata {
  schemaVersion: typeof USER_ASSET_METADATA_SCHEMA_VERSION
  id: string
  name: string
  fileName: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
  byteLength: number
  width: number
  height: number
  sha256: string
  createdAt: string
  lastUsedAt?: string
  safety: AssetSafetyMetadata
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`)
}

const requiredText = (value: unknown, path: string, max: number): string => {
  if (typeof value !== 'string') return fail(path, 'must be a string')
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > max) {
    return fail(path, `must contain 1 to ${max} characters`)
  }
  return normalized
}

export function parseUserAssetMetadata(value: unknown): UserAssetMetadata {
  if (!isRecord(value)) return fail('$', 'must be an object')
  if (value.schemaVersion !== USER_ASSET_METADATA_SCHEMA_VERSION) {
    return fail('$.schemaVersion', 'is unsupported')
  }
  const id = requiredText(value.id, '$.id', 80)
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
    return fail('$.id', 'must be a lowercase slug')
  }
  const mediaTypes = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
  ] as const
  if (!mediaTypes.includes(value.mediaType as (typeof mediaTypes)[number])) {
    return fail('$.mediaType', 'is not a supported local asset type')
  }
  if (
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) <= 0 ||
    (value.byteLength as number) > MAX_USER_ASSET_BYTES
  ) {
    return fail('$.byteLength', 'is outside the allowed range')
  }
  for (const dimension of ['width', 'height'] as const) {
    if (
      !Number.isSafeInteger(value[dimension]) ||
      (value[dimension] as number) <= 0 ||
      (value[dimension] as number) > 16_384
    ) {
      return fail(`$.${dimension}`, 'must be an integer from 1 to 16384')
    }
  }
  const sha256 = requiredText(value.sha256, '$.sha256', 64).toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    return fail('$.sha256', 'must be a SHA-256 hex digest')
  }
  const createdAt = requiredText(value.createdAt, '$.createdAt', 64)
  if (!Number.isFinite(Date.parse(createdAt))) {
    return fail('$.createdAt', 'must be a valid timestamp')
  }
  const lastUsedAt =
    value.lastUsedAt === undefined
      ? undefined
      : requiredText(value.lastUsedAt, '$.lastUsedAt', 64)
  if (lastUsedAt !== undefined && !Number.isFinite(Date.parse(lastUsedAt))) {
    return fail('$.lastUsedAt', 'must be a valid timestamp')
  }
  const mediaType = value.mediaType as UserAssetMetadata['mediaType']
  return {
    schemaVersion: USER_ASSET_METADATA_SCHEMA_VERSION,
    id,
    name: requiredText(value.name, '$.name', 120),
    fileName: requiredText(value.fileName, '$.fileName', 255).replace(
      /[\\/]/gu,
      '_',
    ),
    mediaType,
    byteLength: value.byteLength as number,
    width: value.width as number,
    height: value.height as number,
    sha256,
    createdAt,
    ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
    safety: {
      origin: 'user',
      mediaType:
        mediaType === 'image/svg+xml' ? 'image/svg+xml' : 'image/raster',
      sanitizer:
        mediaType === 'image/svg+xml' ? 'svg-sanitizer-v1' : 'image-decoder-v1',
      externalReferences: 'forbidden',
      maxBytes: MAX_USER_ASSET_BYTES,
    },
  }
}
