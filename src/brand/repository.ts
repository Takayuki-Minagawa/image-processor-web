import { parseBrandKit, type BrandKit } from './brandKit'
import {
  detectBrowserLockManager,
  runWithOptionalBrowserLock,
  type BrowserLockManagerLike,
} from '../lib/browserLock'

export const BRAND_KIT_REPOSITORY_SCHEMA_VERSION = 1 as const
export const MAX_STORED_BRAND_KITS = 50

export type BrandKitPersistenceBackend = 'opfs' | 'localStorage'
export type BrandKitRepositoryErrorCode =
  'save-failed' | 'load-failed' | 'clear-failed' | 'kit-limit'

export class BrandKitRepositoryError extends Error {
  readonly code: BrandKitRepositoryErrorCode

  constructor(
    code: BrandKitRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BrandKitRepositoryError'
    this.code = code
  }
}

export interface StoredBrandKitCollection {
  schemaVersion: typeof BRAND_KIT_REPOSITORY_SCHEMA_VERSION
  updatedAt: string
  kits: BrandKit[]
}

export interface BrandKitRepository {
  save(kit: BrandKit): Promise<BrandKitPersistenceBackend>
  get(id: string): Promise<BrandKit | null>
  list(): Promise<BrandKit[]>
  remove(id: string): Promise<boolean>
  clear(): Promise<void>
}

export interface BrandKitStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface BrandKitFile {
  text(): Promise<string>
}

export interface BrandKitWritable {
  write(data: string): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}

export interface BrandKitFileHandle {
  getFile(): Promise<BrandKitFile>
  createWritable(): Promise<BrandKitWritable>
}

export interface BrandKitDirectoryHandle {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<BrandKitFileHandle>
  removeEntry(name: string): Promise<void>
}

interface BrandKitRootDirectoryHandle extends BrandKitDirectoryHandle {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<BrandKitRootDirectoryHandle>
}

export type BrandKitOpfsDirectoryProvider =
  () => Promise<BrandKitDirectoryHandle>

export interface BrowserBrandKitRepositoryOptions {
  fileName?: string
  storageKey?: string
  /** `undefined` detects OPFS; `null` disables OPFS. */
  getOpfsDirectory?: BrandKitOpfsDirectoryProvider | null
  /** `undefined` detects localStorage; `null` disables fallback storage. */
  storage?: BrandKitStorage | null
  /** `undefined` detects Web Locks; `null` disables cross-tab locking. */
  lockManager?: BrowserLockManagerLike | null
  now?: () => Date
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNotFoundError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'NotFoundError'

const cloneKit = (kit: BrandKit): BrandKit => parseBrandKit(kit)

const assertSafeKey = (value: string, label: string): string => {
  if (
    value.length === 0 ||
    value.length > 200 ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new TypeError(`${label} must be a bounded plain name.`)
  }
  return value
}

export function parseStoredBrandKitCollection(
  source: string,
): StoredBrandKitCollection {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new BrandKitRepositoryError(
      'load-failed',
      'Stored brand kits are not valid JSON.',
      { cause: error },
    )
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== BRAND_KIT_REPOSITORY_SCHEMA_VERSION ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.kits) ||
    value.kits.length > MAX_STORED_BRAND_KITS
  ) {
    throw new BrandKitRepositoryError(
      'load-failed',
      'Stored brand kits do not match the supported schema.',
    )
  }
  const ids = new Set<string>()
  const kits = value.kits.map((kit) => {
    const parsed = parseBrandKit(kit)
    if (ids.has(parsed.id)) {
      throw new BrandKitRepositoryError(
        'load-failed',
        `Stored brand kit id ${parsed.id} is duplicated.`,
      )
    }
    ids.add(parsed.id)
    return parsed
  })
  return {
    schemaVersion: BRAND_KIT_REPOSITORY_SCHEMA_VERSION,
    updatedAt: value.updatedAt,
    kits,
  }
}

export function serializeStoredBrandKitCollection(
  collection: StoredBrandKitCollection,
): string {
  const normalized = parseStoredBrandKitCollection(JSON.stringify(collection))
  return JSON.stringify(normalized)
}

const defaultOpfsProvider = (): BrandKitOpfsDirectoryProvider | null => {
  if (typeof navigator === 'undefined' || navigator.storage === undefined) {
    return null
  }
  const storageManager = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>
  }
  if (typeof storageManager.getDirectory !== 'function') return null
  return async () => {
    const root = (await storageManager.getDirectory.call(
      storageManager,
    )) as unknown as BrandKitRootDirectoryHandle
    const application = await root.getDirectoryHandle('pixelweave', {
      create: true,
    })
    return application.getDirectoryHandle('brand-kits', { create: true })
  }
}

const defaultStorage = (): BrandKitStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

interface ReadCandidate {
  collection: StoredBrandKitCollection | null
  available: boolean
  invalid: boolean
  error?: unknown
}

const missingCandidate = (available: boolean): ReadCandidate => ({
  collection: null,
  available,
  invalid: false,
})

/** OPFS-first repository with a freshness-aware localStorage fallback. */
export class BrowserBrandKitRepository implements BrandKitRepository {
  readonly #fileName: string
  readonly #storageKey: string
  readonly #getOpfsDirectory: BrandKitOpfsDirectoryProvider | null
  readonly #storage: BrandKitStorage | null
  readonly #now: () => Date
  readonly #lockManager: BrowserLockManagerLike | null
  readonly #lockName: string
  #queue: Promise<void> = Promise.resolve()

  constructor(options: BrowserBrandKitRepositoryOptions = {}) {
    this.#fileName = assertSafeKey(
      options.fileName ?? 'brand-kits.pixelweave.json',
      'Brand kit file name',
    )
    this.#storageKey = assertSafeKey(
      options.storageKey ?? 'pixelweave:brand-kits:v1',
      'Brand kit storage key',
    )
    this.#getOpfsDirectory =
      options.getOpfsDirectory === undefined
        ? defaultOpfsProvider()
        : options.getOpfsDirectory
    this.#storage =
      options.storage === undefined ? defaultStorage() : options.storage
    this.#now = options.now ?? (() => new Date())
    this.#lockManager =
      options.lockManager === undefined
        ? detectBrowserLockManager()
        : options.lockManager
    this.#lockName = `pixelweave:brand-kits:${this.#fileName}:write`
  }

  save(kit: BrandKit): Promise<BrandKitPersistenceBackend> {
    const normalized = parseBrandKit(kit)
    return this.#enqueue(() =>
      this.#withMutationLock(async () => {
        const state = await this.#readMutationState()
        const existing = state.collection ?? this.#emptyCollection()
        const kits = existing.kits.map(cloneKit)
        const index = kits.findIndex(({ id }) => id === normalized.id)
        if (index === -1) {
          if (kits.length >= MAX_STORED_BRAND_KITS) {
            throw new BrandKitRepositoryError(
              'kit-limit',
              `At most ${MAX_STORED_BRAND_KITS} brand kits may be stored.`,
            )
          }
          kits.push(normalized)
        } else {
          kits[index] = normalized
        }
        return this.#persist(
          {
            schemaVersion: BRAND_KIT_REPOSITORY_SCHEMA_VERSION,
            updatedAt: this.#timestamp(),
            kits,
          },
          state.canWriteOpfs,
        )
      }),
    )
  }

  get(id: string): Promise<BrandKit | null> {
    return this.#enqueue(async () => {
      const collection = await this.#readNewest()
      const kit = collection?.kits.find((candidate) => candidate.id === id)
      return kit ? cloneKit(kit) : null
    })
  }

  list(): Promise<BrandKit[]> {
    return this.#enqueue(async () => {
      const collection = await this.#readNewest()
      return collection?.kits.map(cloneKit) ?? []
    })
  }

  remove(id: string): Promise<boolean> {
    return this.#enqueue(() =>
      this.#withMutationLock(async () => {
        const state = await this.#readMutationState()
        const existing = state.collection
        if (!existing || !existing.kits.some((kit) => kit.id === id)) {
          return false
        }
        await this.#persist(
          {
            schemaVersion: BRAND_KIT_REPOSITORY_SCHEMA_VERSION,
            updatedAt: this.#timestamp(),
            kits: existing.kits.filter((kit) => kit.id !== id),
          },
          state.canWriteOpfs,
        )
        return true
      }),
    )
  }

  clear(): Promise<void> {
    return this.#enqueue(() =>
      this.#withMutationLock(async () => {
        const errors: unknown[] = []
        if (this.#getOpfsDirectory) {
          try {
            const directory = await this.#getOpfsDirectory()
            await directory.removeEntry(this.#fileName)
          } catch (error) {
            if (!isNotFoundError(error)) errors.push(error)
          }
        }
        if (this.#storage) {
          try {
            this.#storage.removeItem(this.#storageKey)
          } catch (error) {
            errors.push(error)
          }
        }
        if (errors.length > 0) {
          throw new BrandKitRepositoryError(
            'clear-failed',
            'One or more brand kit stores could not be cleared.',
            { cause: errors[0] },
          )
        }
      }),
    )
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  #withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return runWithOptionalBrowserLock(
      this.#lockManager,
      this.#lockName,
      operation,
    )
  }

  #timestamp(): string {
    const value = this.#now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError(
        'Brand kit repository clock returned an invalid date.',
      )
    }
    return value.toISOString()
  }

  #emptyCollection(): StoredBrandKitCollection {
    return {
      schemaVersion: BRAND_KIT_REPOSITORY_SCHEMA_VERSION,
      updatedAt: new Date(0).toISOString(),
      kits: [],
    }
  }

  async #readOpfs(): Promise<ReadCandidate> {
    if (!this.#getOpfsDirectory) return missingCandidate(false)
    let source: string
    try {
      const directory = await this.#getOpfsDirectory()
      const handle = await directory.getFileHandle(this.#fileName)
      source = await (await handle.getFile()).text()
    } catch (error) {
      return isNotFoundError(error)
        ? missingCandidate(true)
        : { ...missingCandidate(false), error }
    }
    try {
      return {
        collection: parseStoredBrandKitCollection(source),
        available: true,
        invalid: false,
      }
    } catch (error) {
      return { collection: null, available: true, invalid: true, error }
    }
  }

  #readStorage(): ReadCandidate {
    if (!this.#storage) return missingCandidate(false)
    let source: string | null
    try {
      source = this.#storage.getItem(this.#storageKey)
    } catch (error) {
      return { ...missingCandidate(false), error }
    }
    if (source === null) return missingCandidate(true)
    try {
      return {
        collection: parseStoredBrandKitCollection(source),
        available: true,
        invalid: false,
      }
    } catch (error) {
      return { collection: null, available: true, invalid: true, error }
    }
  }

  async #readNewest(
    allowUnavailable = false,
  ): Promise<StoredBrandKitCollection | null> {
    const [opfs, storage] = await Promise.all([
      this.#readOpfs(),
      Promise.resolve(this.#readStorage()),
    ])
    if (opfs.collection && storage.collection) {
      return Date.parse(storage.collection.updatedAt) >
        Date.parse(opfs.collection.updatedAt)
        ? storage.collection
        : opfs.collection
    }
    if (opfs.collection) return opfs.collection
    if (storage.collection) return storage.collection
    if (opfs.invalid || storage.invalid) {
      throw new BrandKitRepositoryError(
        'load-failed',
        'Stored brand kits are invalid in every available backend.',
        { cause: opfs.error ?? storage.error },
      )
    }
    if (opfs.available || storage.available) return null
    if (allowUnavailable) return null
    if (opfs.error || storage.error) {
      throw new BrandKitRepositoryError(
        'load-failed',
        'Brand kit storage could not be read.',
        { cause: opfs.error ?? storage.error },
      )
    }
    return null
  }

  async #readMutationState(): Promise<{
    collection: StoredBrandKitCollection | null
    canWriteOpfs: boolean
  }> {
    const [opfs, storage] = await Promise.all([
      this.#readOpfs(),
      Promise.resolve(this.#readStorage()),
    ])
    const collection =
      opfs.collection && storage.collection
        ? Date.parse(storage.collection.updatedAt) >
          Date.parse(opfs.collection.updatedAt)
          ? storage.collection
          : opfs.collection
        : (opfs.collection ?? storage.collection)
    if (!collection && (opfs.invalid || storage.invalid)) {
      throw new BrandKitRepositoryError(
        'load-failed',
        'Stored brand kits are invalid in every available backend.',
        { cause: opfs.error ?? storage.error },
      )
    }
    if (
      !collection &&
      this.#getOpfsDirectory !== null &&
      opfs.error !== undefined
    ) {
      throw new BrandKitRepositoryError(
        'load-failed',
        'Existing brand kits could not be read safely before saving.',
        { cause: opfs.error },
      )
    }
    return {
      collection,
      canWriteOpfs: opfs.available && !opfs.invalid && opfs.error === undefined,
    }
  }

  async #persist(
    collection: StoredBrandKitCollection,
    allowOpfs = true,
  ): Promise<BrandKitPersistenceBackend> {
    const source = serializeStoredBrandKitCollection(collection)
    let opfsError: unknown
    if (this.#getOpfsDirectory && allowOpfs) {
      try {
        const directory = await this.#getOpfsDirectory()
        const handle = await directory.getFileHandle(this.#fileName, {
          create: true,
        })
        const writable = await handle.createWritable()
        try {
          await writable.write(source)
          await writable.close()
        } catch (error) {
          await writable.abort?.().catch(() => undefined)
          throw error
        }
        try {
          this.#storage?.removeItem(this.#storageKey)
        } catch {
          // The committed OPFS collection is authoritative.
        }
        return 'opfs'
      } catch (error) {
        opfsError = error
      }
    }
    if (this.#storage) {
      try {
        this.#storage.setItem(this.#storageKey, source)
        return 'localStorage'
      } catch (error) {
        throw new BrandKitRepositoryError(
          'save-failed',
          'Brand kits could not be saved to OPFS or localStorage.',
          { cause: error },
        )
      }
    }
    throw new BrandKitRepositoryError(
      'save-failed',
      'Brand kit persistence is unavailable.',
      { cause: opfsError },
    )
  }
}

export const createBrandKitRepository = (
  options: BrowserBrandKitRepositoryOptions = {},
): BrandKitRepository => new BrowserBrandKitRepository(options)
