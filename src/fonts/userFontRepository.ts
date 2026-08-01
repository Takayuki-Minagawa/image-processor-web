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
  detectUserFontFormat,
  MAX_USER_FONT_BYTES,
  parseUserFontMetadata,
  USER_FONT_METADATA_SCHEMA_VERSION,
  type UserFontFormat,
  type UserFontMetadata,
} from './userFontMetadata'
import type { FontStyle } from './types'

export const MAX_USER_FONT_REPOSITORY_ENTRIES = 100
export const MAX_USER_FONT_REPOSITORY_BYTES = 128 * 1024 * 1024
export const MAX_USER_FONT_FALLBACK_ENTRY_BYTES = 2 * 1024 * 1024
export const MAX_USER_FONT_FALLBACK_TOTAL_BYTES = 3 * 1024 * 1024

export type UserFontRepositoryErrorCode =
  UserBinaryRepositoryErrorCode | 'unsupported-format' | 'invalid-font'

export class UserFontRepositoryError extends Error {
  readonly code: UserFontRepositoryErrorCode

  constructor(
    code: UserFontRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'UserFontRepositoryError'
    this.code = code
  }
}

export interface SaveUserFontInput {
  id?: string
  family: string
  displayName?: string
  fileName: string
  format?: UserFontFormat
  bytes: ArrayBuffer | ArrayBufferView
  style?: FontStyle
  weightMinimum?: number
  weightMaximum?: number
  fallback?: string
  addedAt?: string
  /** Callers must explicitly acknowledge that the local font may be used. */
  licenseAcknowledged: true
}

export interface SavedUserFont {
  metadata: UserFontMetadata
  backend: UserBinaryPersistenceBackend
}

export interface StoredUserFont extends SavedUserFont {
  /** Exact verified bytes accepted by `loadUserFontFace`. */
  bytes: ArrayBuffer
}

export interface UserFontRepository {
  save(input: SaveUserFontInput): Promise<SavedUserFont>
  list(): Promise<UserFontMetadata[]>
  get(id: string): Promise<StoredUserFont | null>
  remove(id: string): Promise<boolean>
}

export interface BrowserUserFontRepositoryOptions {
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

const EXTENSION_FORMATS: Readonly<Record<string, UserFontFormat>> = {
  woff2: 'woff2',
  ttf: 'ttf',
  otf: 'otf',
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

const fontError = (
  code: UserFontRepositoryErrorCode,
  message: string,
  cause?: unknown,
): UserFontRepositoryError =>
  new UserFontRepositoryError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  )

const signatureMatches = (
  format: UserFontFormat,
  bytes: Uint8Array<ArrayBuffer>,
): boolean => {
  try {
    return detectUserFontFormat(bytes) === format
  } catch {
    return false
  }
}

/** OPFS-first, signature- and hash-verified storage for local web fonts. */
export class BrowserUserFontRepository implements UserFontRepository {
  readonly #binary: BrowserUserBinaryRepository<UserFontMetadata>
  readonly #now: () => Date

  constructor(options: BrowserUserFontRepositoryOptions = {}) {
    const getOpfsDirectory =
      options.getOpfsDirectory === undefined
        ? createUserBinaryOpfsProvider('user-fonts')
        : options.getOpfsDirectory
    const storage =
      options.storage === undefined
        ? defaultUserBinaryStorage()
        : options.storage
    this.#now = options.now ?? (() => new Date())
    this.#binary = new BrowserUserBinaryRepository({
      namespace: 'user-fonts',
      storageKey: 'pixelweave:user-fonts:v1',
      maxEntries: positiveInteger(
        options.maxEntries ?? MAX_USER_FONT_REPOSITORY_ENTRIES,
        'maxEntries',
      ),
      maxTotalBytes: positiveInteger(
        options.maxTotalBytes ?? MAX_USER_FONT_REPOSITORY_BYTES,
        'maxTotalBytes',
      ),
      maxFallbackEntryBytes: positiveInteger(
        options.maxFallbackEntryBytes ?? MAX_USER_FONT_FALLBACK_ENTRY_BYTES,
        'maxFallbackEntryBytes',
      ),
      maxFallbackTotalBytes: positiveInteger(
        options.maxFallbackTotalBytes ?? MAX_USER_FONT_FALLBACK_TOTAL_BYTES,
        'maxFallbackTotalBytes',
      ),
      parseMetadata: parseUserFontMetadata,
      extension: (metadata) => metadata.format,
      makeError: fontError,
      getOpfsDirectory,
      storage,
    })
  }

  async save(input: SaveUserFontInput): Promise<SavedUserFont> {
    const bytes = copyBytes(input.bytes)
    const format = this.#format(input.fileName, input.format)
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_USER_FONT_BYTES) {
      throw fontError(
        'invalid-font',
        `Font files must contain 1 to ${MAX_USER_FONT_BYTES} bytes.`,
      )
    }
    if (!signatureMatches(format, bytes)) {
      throw fontError(
        'invalid-font',
        `The file header is not a valid ${format.toUpperCase()} signature.`,
      )
    }
    const sha256 = await sha256Bytes(bytes).catch((cause: unknown) => {
      throw fontError(
        'unsupported',
        'Web Crypto SHA-256 is required to store user fonts.',
        cause,
      )
    })
    const metadata = this.#metadata(input, format, bytes, sha256)
    const backend = await this.#binary.put(metadata, bytes)
    return { metadata, backend }
  }

  list(): Promise<UserFontMetadata[]> {
    return this.#binary.list()
  }

  async get(id: string): Promise<StoredUserFont | null> {
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

  #format(
    fileName: string,
    requested: UserFontFormat | undefined,
  ): UserFontFormat {
    const extension = extensionOf(fileName)
    const inferred = Object.hasOwn(EXTENSION_FORMATS, extension)
      ? EXTENSION_FORMATS[extension]
      : undefined
    if (requested && inferred && requested !== inferred) {
      throw fontError(
        'unsupported-format',
        `The ${requested} format does not match ${fileName}.`,
      )
    }
    const format = requested ?? inferred
    if (!format || !Object.hasOwn(EXTENSION_FORMATS, format)) {
      throw fontError(
        'unsupported-format',
        'User fonts must be WOFF2, TTF, or OTF files.',
      )
    }
    return format
  }

  #metadata(
    input: SaveUserFontInput,
    format: UserFontFormat,
    bytes: Uint8Array<ArrayBuffer>,
    sha256: string,
  ): UserFontMetadata {
    try {
      return parseUserFontMetadata({
        schemaVersion: USER_FONT_METADATA_SCHEMA_VERSION,
        id: input.id ?? `font-${sha256.slice(0, 16)}`,
        family: input.family,
        displayName: input.displayName ?? input.family,
        fileName: input.fileName,
        format,
        byteLength: bytes.byteLength,
        sha256,
        style: input.style ?? 'normal',
        weightMinimum: input.weightMinimum ?? 400,
        weightMaximum: input.weightMaximum ?? input.weightMinimum ?? 400,
        fallback: input.fallback ?? 'sans-serif',
        addedAt: input.addedAt ?? this.#now().toISOString(),
        licenseAcknowledged: input.licenseAcknowledged,
      })
    } catch (cause) {
      throw fontError(
        'invalid-font',
        'User font metadata failed validation.',
        cause,
      )
    }
  }
}

export const createUserFontRepository = (
  options?: BrowserUserFontRepositoryOptions,
): UserFontRepository => new BrowserUserFontRepository(options)
