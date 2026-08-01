import {
  BrowserUserBinaryRepository,
  createUserBinaryOpfsProvider,
  defaultUserBinaryStorage,
  sha256Bytes,
  type UserBinaryDirectoryProvider,
  type UserBinaryPersistenceBackend,
  type UserBinaryRepositoryErrorCode,
  type UserBinaryStorage,
} from '../lib/userBinaryRepository'
import {
  IMAGE_HEADER_READ_BYTES,
  parseImageDimensions,
  type ImageDimensions,
} from '../lib/imageMetadata'
import {
  assertSafeImageDimensions,
  imageDimensionsMatchHeader,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  type SupportedImageMimeType,
} from '../lib/imageSafety'
import { MAX_SVG_BYTES, sanitizeSvg } from '../lib/svgSafety'
import {
  parseUserAssetMetadata,
  USER_ASSET_METADATA_SCHEMA_VERSION,
  type UserAssetMetadata,
} from './userAssetMetadata'

export const MAX_USER_ASSET_REPOSITORY_ENTRIES = 500
export const MAX_USER_ASSET_REPOSITORY_BYTES = 512 * 1024 * 1024
export const MAX_USER_ASSET_FALLBACK_ENTRY_BYTES = 2 * 1024 * 1024
export const MAX_USER_ASSET_FALLBACK_TOTAL_BYTES = 3 * 1024 * 1024

export type UserAssetRepositoryErrorCode =
  | UserBinaryRepositoryErrorCode
  | 'unsupported-media'
  | 'invalid-image'
  | 'invalid-svg'
  | 'invalid-metadata'

export class UserAssetRepositoryError extends Error {
  readonly code: UserAssetRepositoryErrorCode

  constructor(
    code: UserAssetRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'UserAssetRepositoryError'
    this.code = code
  }
}

export interface SaveUserAssetInput {
  id?: string
  name: string
  fileName: string
  mediaType?: UserAssetMetadata['mediaType']
  bytes: ArrayBuffer | ArrayBufferView
  /** Decoder dimensions may be supplied to cross-check orientation-aware headers. */
  declaredDimensions?: ImageDimensions
  createdAt?: string
}

export interface SavedUserAsset {
  metadata: UserAssetMetadata
  backend: UserBinaryPersistenceBackend
}

export interface StoredUserAsset extends SavedUserAsset {
  bytes: ArrayBuffer
}

export interface UserAssetRepository {
  save(input: SaveUserAssetInput): Promise<SavedUserAsset>
  list(): Promise<UserAssetMetadata[]>
  get(id: string): Promise<StoredUserAsset | null>
  remove(id: string): Promise<boolean>
}

export interface BrowserUserAssetRepositoryOptions {
  /** `undefined` detects OPFS; `null` disables it. */
  getOpfsDirectory?: UserBinaryDirectoryProvider | null
  /** `undefined` detects localStorage; `null` disables fallback storage. */
  storage?: UserBinaryStorage | null
  now?: () => Date
  maxEntries?: number
  maxTotalBytes?: number
  maxFallbackEntryBytes?: number
  maxFallbackTotalBytes?: number
}

const EXTENSION_MEDIA_TYPES: Readonly<
  Record<string, UserAssetMetadata['mediaType']>
> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

const MEDIA_TYPE_EXTENSIONS: Readonly<
  Record<UserAssetMetadata['mediaType'], string>
> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

const copyBytes = (
  input: ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> => {
  const view =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  return Uint8Array.from(view)
}

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`)
  }
  return value
}

const extensionOf = (fileName: string): string => {
  const index = fileName.lastIndexOf('.')
  return index === -1 ? '' : fileName.slice(index + 1).toLowerCase()
}

const assetError = (
  code: UserAssetRepositoryErrorCode,
  message: string,
  cause?: unknown,
): UserAssetRepositoryError =>
  new UserAssetRepositoryError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  )

const normalizedDimensions = (value: ImageDimensions): ImageDimensions => ({
  width: Math.ceil(value.width),
  height: Math.ceil(value.height),
})

const rasterSignatureMatches = (
  mediaType: SupportedImageMimeType,
  bytes: Uint8Array<ArrayBuffer>,
): boolean => {
  if (mediaType === 'image/png') {
    const expected = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    return expected.every((value, index) => bytes[index] === value)
  }
  if (mediaType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8
  }
  return (
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
}

/** OPFS-first, hash-verified storage for reusable local images and SVGs. */
export class BrowserUserAssetRepository implements UserAssetRepository {
  readonly #binary: BrowserUserBinaryRepository<UserAssetMetadata>
  readonly #now: () => Date

  constructor(options: BrowserUserAssetRepositoryOptions = {}) {
    const getOpfsDirectory =
      options.getOpfsDirectory === undefined
        ? createUserBinaryOpfsProvider('user-assets')
        : options.getOpfsDirectory
    const storage =
      options.storage === undefined
        ? defaultUserBinaryStorage()
        : options.storage
    this.#now = options.now ?? (() => new Date())
    this.#binary = new BrowserUserBinaryRepository({
      namespace: 'user-assets',
      storageKey: 'pixelweave:user-assets:v1',
      maxEntries: positiveInteger(
        options.maxEntries ?? MAX_USER_ASSET_REPOSITORY_ENTRIES,
        'maxEntries',
      ),
      maxTotalBytes: positiveInteger(
        options.maxTotalBytes ?? MAX_USER_ASSET_REPOSITORY_BYTES,
        'maxTotalBytes',
      ),
      maxFallbackEntryBytes: positiveInteger(
        options.maxFallbackEntryBytes ?? MAX_USER_ASSET_FALLBACK_ENTRY_BYTES,
        'maxFallbackEntryBytes',
      ),
      maxFallbackTotalBytes: positiveInteger(
        options.maxFallbackTotalBytes ?? MAX_USER_ASSET_FALLBACK_TOTAL_BYTES,
        'maxFallbackTotalBytes',
      ),
      parseMetadata: parseUserAssetMetadata,
      extension: (metadata) => MEDIA_TYPE_EXTENSIONS[metadata.mediaType],
      makeError: assetError,
      getOpfsDirectory,
      storage,
    })
  }

  async save(input: SaveUserAssetInput): Promise<SavedUserAsset> {
    const originalBytes = copyBytes(input.bytes)
    const mediaType = this.#mediaType(input.fileName, input.mediaType)
    const prepared = this.#prepare(
      mediaType,
      originalBytes,
      input.declaredDimensions,
    )
    const sha256 = await sha256Bytes(prepared.bytes).catch((cause: unknown) => {
      throw assetError(
        'unsupported',
        'Web Crypto SHA-256 is required to store user assets.',
        cause,
      )
    })
    const metadata = this.#metadata(input, mediaType, prepared, sha256)
    const backend = await this.#binary.put(metadata, prepared.bytes)
    return { metadata, backend }
  }

  list(): Promise<UserAssetMetadata[]> {
    return this.#binary.list()
  }

  async get(id: string): Promise<StoredUserAsset | null> {
    const record = await this.#binary.get(id)
    return record === null
      ? null
      : {
          metadata: record.metadata,
          bytes: record.bytes,
          backend: record.backend,
        }
  }

  remove(id: string): Promise<boolean> {
    return this.#binary.remove(id)
  }

  #mediaType(
    fileName: string,
    requested: UserAssetMetadata['mediaType'] | undefined,
  ): UserAssetMetadata['mediaType'] {
    const extension = extensionOf(fileName)
    const inferred = Object.hasOwn(EXTENSION_MEDIA_TYPES, extension)
      ? EXTENSION_MEDIA_TYPES[extension]
      : undefined
    if (requested && inferred && requested !== inferred) {
      throw assetError(
        'unsupported-media',
        `The ${requested} media type does not match ${fileName}.`,
      )
    }
    const mediaType = requested ?? inferred
    if (!mediaType || !Object.hasOwn(MEDIA_TYPE_EXTENSIONS, mediaType)) {
      throw assetError(
        'unsupported-media',
        'User assets must be PNG, JPEG, WebP, or SVG files.',
      )
    }
    return mediaType
  }

  #prepare(
    mediaType: UserAssetMetadata['mediaType'],
    bytes: Uint8Array<ArrayBuffer>,
    declared: ImageDimensions | undefined,
  ): { bytes: Uint8Array<ArrayBuffer>; dimensions: ImageDimensions } {
    if (bytes.byteLength === 0) {
      throw assetError('invalid-image', 'User asset files must not be empty.')
    }
    if (mediaType === 'image/svg+xml') {
      return this.#prepareSvg(bytes, declared)
    }
    return this.#prepareRaster(mediaType, bytes, declared)
  }

  #prepareRaster(
    mediaType: SupportedImageMimeType,
    bytes: Uint8Array<ArrayBuffer>,
    declared: ImageDimensions | undefined,
  ): { bytes: Uint8Array<ArrayBuffer>; dimensions: ImageDimensions } {
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw assetError(
        'invalid-image',
        `Raster assets may contain at most ${MAX_IMAGE_BYTES} bytes.`,
      )
    }
    try {
      if (!rasterSignatureMatches(mediaType, bytes)) {
        throw new TypeError('The file signature does not match its media type.')
      }
      const dimensions = parseImageDimensions(
        bytes.subarray(0, IMAGE_HEADER_READ_BYTES),
        mediaType,
      )
      if (!dimensions) {
        throw new TypeError('The file header is invalid or truncated.')
      }
      assertSafeImageDimensions(dimensions)
      if (declared) {
        assertSafeImageDimensions(declared)
        if (!imageDimensionsMatchHeader(dimensions, declared)) {
          throw new TypeError(
            'Declared image dimensions do not match the image header.',
          )
        }
      }
      return { bytes, dimensions }
    } catch (cause) {
      throw assetError(
        'invalid-image',
        'The raster asset failed header or dimension validation.',
        cause,
      )
    }
  }

  #prepareSvg(
    bytes: Uint8Array<ArrayBuffer>,
    declared: ImageDimensions | undefined,
  ): { bytes: Uint8Array<ArrayBuffer>; dimensions: ImageDimensions } {
    if (bytes.byteLength > MAX_SVG_BYTES) {
      throw assetError(
        'invalid-svg',
        `SVG assets may contain at most ${MAX_SVG_BYTES} bytes.`,
      )
    }
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const sanitized = sanitizeSvg(source, {
        maxBytes: MAX_SVG_BYTES,
        maxDimension: MAX_IMAGE_DIMENSION,
        maxPixels: MAX_IMAGE_PIXELS,
      })
      const dimensions = normalizedDimensions(sanitized)
      assertSafeImageDimensions(dimensions)
      if (declared) {
        assertSafeImageDimensions(declared)
        if (!imageDimensionsMatchHeader(dimensions, declared)) {
          throw new TypeError(
            'Declared SVG dimensions do not match the sanitized root.',
          )
        }
      }
      const sanitizedBytes = new TextEncoder().encode(sanitized.source)
      if (sanitizedBytes.byteLength > MAX_SVG_BYTES) {
        throw new RangeError('Sanitized SVG exceeds the byte limit.')
      }
      return { bytes: sanitizedBytes, dimensions }
    } catch (cause) {
      throw assetError(
        'invalid-svg',
        'The SVG asset failed parsing, sanitization, or dimension validation.',
        cause,
      )
    }
  }

  #metadata(
    input: SaveUserAssetInput,
    mediaType: UserAssetMetadata['mediaType'],
    prepared: {
      bytes: Uint8Array<ArrayBuffer>
      dimensions: ImageDimensions
    },
    sha256: string,
  ): UserAssetMetadata {
    try {
      return parseUserAssetMetadata({
        schemaVersion: USER_ASSET_METADATA_SCHEMA_VERSION,
        id: input.id ?? `asset-${sha256.slice(0, 16)}`,
        name: input.name,
        fileName: input.fileName,
        mediaType,
        byteLength: prepared.bytes.byteLength,
        width: prepared.dimensions.width,
        height: prepared.dimensions.height,
        sha256,
        createdAt: input.createdAt ?? this.#now().toISOString(),
      })
    } catch (cause) {
      throw assetError(
        'invalid-metadata',
        'User asset metadata failed validation.',
        cause,
      )
    }
  }
}

export const createUserAssetRepository = (
  options?: BrowserUserAssetRepositoryOptions,
): UserAssetRepository => new BrowserUserAssetRepository(options)
