export const USER_BINARY_INDEX_SCHEMA_VERSION = 1 as const
export const USER_BINARY_FALLBACK_SCHEMA_VERSION = 1 as const

export type UserBinaryPersistenceBackend = 'opfs' | 'localStorage'
export type UserBinaryRepositoryErrorCode =
  | 'save-failed'
  | 'load-failed'
  | 'capacity-limit'
  | 'fallback-limit'
  | 'integrity-failed'
  | 'unsupported'

export interface UserBinaryMetadataBase {
  id: string
  byteLength: number
  sha256: string
}

export interface UserBinaryRecord<M> {
  metadata: M
  bytes: ArrayBuffer
  backend: UserBinaryPersistenceBackend
}

export interface UserBinaryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface UserBinaryFile {
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface UserBinaryWritable {
  write(data: string | Uint8Array<ArrayBuffer>): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}

export interface UserBinaryFileHandle {
  getFile(): Promise<UserBinaryFile>
  createWritable(): Promise<UserBinaryWritable>
}

export interface UserBinaryDirectoryHandle {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<UserBinaryFileHandle>
  removeEntry(name: string): Promise<void>
}

interface UserBinaryRootDirectoryHandle extends UserBinaryDirectoryHandle {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<UserBinaryRootDirectoryHandle>
}

export type UserBinaryDirectoryProvider =
  () => Promise<UserBinaryDirectoryHandle>

export interface UserBinaryRepositoryOptions<M extends UserBinaryMetadataBase> {
  namespace: string
  storageKey: string
  maxEntries: number
  maxTotalBytes: number
  maxFallbackEntryBytes: number
  maxFallbackTotalBytes: number
  parseMetadata(value: unknown): M
  extension(metadata: M): string
  makeError(
    code: UserBinaryRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ): Error
  getOpfsDirectory: UserBinaryDirectoryProvider | null
  storage: UserBinaryStorage | null
}

interface OpfsState<M> {
  entries: Map<string, M>
  available: boolean
  error?: unknown
}

interface FallbackEntry<M> {
  metadata: M
  bytes: Uint8Array<ArrayBuffer>
}

interface FallbackState<M> {
  entries: Map<string, FallbackEntry<M>>
  deletedIds: Set<string>
  available: boolean
  error?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNotFoundError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'NotFoundError'

const stableBytes = (
  value: ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  return new Uint8Array(
    value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer,
  )
}

export const sha256Bytes = async (
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable.')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const bytesToBase64 = (bytes: Uint8Array<ArrayBuffer>): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

const base64ToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) {
    throw new TypeError('Fallback bytes are not valid Base64.')
  }
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export const defaultUserBinaryStorage = (): UserBinaryStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export const createUserBinaryOpfsProvider = (
  directoryName: string,
): UserBinaryDirectoryProvider | null => {
  if (
    !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(directoryName) ||
    typeof navigator === 'undefined' ||
    navigator.storage === undefined
  ) {
    return null
  }
  const storageManager = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>
  }
  if (typeof storageManager.getDirectory !== 'function') return null
  return async () => {
    const root = (await storageManager.getDirectory.call(
      storageManager,
    )) as unknown as UserBinaryRootDirectoryHandle
    const application = await root.getDirectoryHandle('pixelweave', {
      create: true,
    })
    return application.getDirectoryHandle(directoryName, { create: true })
  }
}

/**
 * Internal binary store shared by user assets and fonts. OPFS remains the
 * primary store; a bounded localStorage overlay keeps both metadata and bytes
 * when OPFS is unavailable. Tombstones prevent failed OPFS deletes from
 * resurrecting entries later.
 */
export class BrowserUserBinaryRepository<M extends UserBinaryMetadataBase> {
  readonly #options: UserBinaryRepositoryOptions<M>
  readonly #indexFileName: string
  #queue: Promise<void> = Promise.resolve()

  constructor(options: UserBinaryRepositoryOptions<M>) {
    this.#options = options
    this.#indexFileName = `${options.namespace}-index-v1.json`
  }

  put(
    metadata: M,
    input: ArrayBuffer | ArrayBufferView,
  ): Promise<UserBinaryPersistenceBackend> {
    const parsed = this.#options.parseMetadata(metadata)
    const bytes = stableBytes(input)
    return this.#enqueue(async () => {
      await this.#verify(parsed, bytes)
      const state = await this.#readState()
      const logical = this.#logicalMetadata(state.opfs, state.fallback)
      const previous = logical.get(parsed.id)
      const total =
        [...logical.values()].reduce(
          (sum, entry) => sum + entry.byteLength,
          0,
        ) -
        (previous?.byteLength ?? 0) +
        parsed.byteLength
      if (
        (previous === undefined && logical.size >= this.#options.maxEntries) ||
        total > this.#options.maxTotalBytes
      ) {
        this.#fail(
          'capacity-limit',
          `Repository capacity is limited to ${this.#options.maxEntries} entries and ${this.#options.maxTotalBytes} bytes.`,
        )
      }

      let opfsError: unknown
      if (this.#options.getOpfsDirectory) {
        try {
          await this.#putOpfs(parsed, bytes, state)
          this.#cleanupFallbackAfterOpfsPut(parsed.id, state.fallback)
          return 'opfs'
        } catch (error) {
          opfsError = error
        }
      }
      try {
        this.#putFallback(parsed, bytes, state.fallback)
        return 'localStorage'
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error.code === 'fallback-limit' || error.code === 'unsupported')
        ) {
          throw error
        }
        this.#fail(
          'save-failed',
          'Binary data could not be saved to OPFS or bounded fallback storage.',
          error ?? opfsError,
        )
      }
    })
  }

  list(): Promise<M[]> {
    return this.#enqueue(async () => {
      const state = await this.#readState()
      return [
        ...this.#logicalMetadata(state.opfs, state.fallback).values(),
      ].map((metadata) => this.#options.parseMetadata(metadata))
    })
  }

  get(id: string): Promise<UserBinaryRecord<M> | null> {
    return this.#enqueue(async () => {
      const state = await this.#readState()
      if (state.fallback.deletedIds.has(id)) return null
      const fallback = state.fallback.entries.get(id)
      if (fallback) {
        await this.#verify(fallback.metadata, fallback.bytes)
        return {
          metadata: this.#options.parseMetadata(fallback.metadata),
          bytes: fallback.bytes.buffer.slice(0),
          backend: 'localStorage',
        }
      }
      const metadata = state.opfs.entries.get(id)
      if (!metadata) return null
      if (!this.#options.getOpfsDirectory) {
        this.#fail('unsupported', 'OPFS is unavailable for this stored entry.')
      }
      let bytes: Uint8Array<ArrayBuffer>
      try {
        const directory = await this.#options.getOpfsDirectory()
        const handle = await directory.getFileHandle(
          this.#binaryFileName(metadata),
        )
        bytes = stableBytes(await (await handle.getFile()).arrayBuffer())
      } catch (error) {
        this.#fail(
          'load-failed',
          `Stored bytes for ${id} could not be read.`,
          error,
        )
      }
      await this.#verify(metadata, bytes)
      return {
        metadata: this.#options.parseMetadata(metadata),
        bytes: bytes.buffer.slice(0),
        backend: 'opfs',
      }
    })
  }

  remove(id: string): Promise<boolean> {
    return this.#enqueue(async () => {
      const state = await this.#readState()
      const logical = this.#logicalMetadata(state.opfs, state.fallback)
      if (!logical.has(id)) return false
      let opfsError: unknown
      if (this.#options.getOpfsDirectory) {
        try {
          await this.#removeOpfs(id, state)
          state.fallback.entries.delete(id)
          state.fallback.deletedIds.delete(id)
          if (this.#options.storage) this.#persistFallback(state.fallback)
          return true
        } catch (error) {
          opfsError = error
        }
      }
      state.fallback.entries.delete(id)
      state.fallback.deletedIds.add(id)
      try {
        this.#persistFallback(state.fallback)
        return true
      } catch (error) {
        this.#fail(
          'save-failed',
          `Deletion of ${id} could not be persisted.`,
          error ?? opfsError,
        )
      }
    })
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  #fail(
    code: UserBinaryRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ): never {
    throw this.#options.makeError(code, message, cause)
  }

  async #verify(metadata: M, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (bytes.byteLength !== metadata.byteLength) {
      this.#fail(
        'integrity-failed',
        `${metadata.id} bytes do not match their declared size.`,
      )
    }
    let digest: string
    try {
      digest = await sha256Bytes(bytes)
    } catch (error) {
      this.#fail('unsupported', 'Web Crypto SHA-256 is unavailable.', error)
    }
    if (digest !== metadata.sha256) {
      this.#fail(
        'integrity-failed',
        `${metadata.id} bytes failed SHA-256 verification.`,
      )
    }
  }

  #logicalMetadata(
    opfs: OpfsState<M>,
    fallback: FallbackState<M>,
  ): Map<string, M> {
    const result = new Map(opfs.entries)
    for (const id of fallback.deletedIds) result.delete(id)
    for (const [id, entry] of fallback.entries) result.set(id, entry.metadata)
    return result
  }

  #binaryFileName(metadata: M): string {
    const extension = this.#options.extension(metadata)
    if (!/^[a-z0-9]{1,10}$/u.test(extension)) {
      this.#fail('save-failed', 'Binary file extension is invalid.')
    }
    return `${metadata.id}-${metadata.sha256}.${extension}`
  }

  async #readState(): Promise<{
    opfs: OpfsState<M>
    fallback: FallbackState<M>
  }> {
    const [opfs, fallback] = await Promise.all([
      this.#readOpfsIndex(),
      Promise.resolve(this.#readFallback()),
    ])
    if (opfs.error && fallback.error) {
      this.#fail(
        'load-failed',
        'Both OPFS and fallback repository indexes are unreadable.',
        opfs.error,
      )
    }
    return { opfs, fallback }
  }

  async #readOpfsIndex(): Promise<OpfsState<M>> {
    const entries = new Map<string, M>()
    if (!this.#options.getOpfsDirectory) return { entries, available: false }
    let source: string
    try {
      const directory = await this.#options.getOpfsDirectory()
      const handle = await directory.getFileHandle(this.#indexFileName)
      source = await (await handle.getFile()).text()
    } catch (error) {
      return isNotFoundError(error)
        ? { entries, available: true }
        : { entries, available: false, error }
    }
    try {
      const value: unknown = JSON.parse(source)
      if (
        !isRecord(value) ||
        value.schemaVersion !== USER_BINARY_INDEX_SCHEMA_VERSION ||
        !Array.isArray(value.entries) ||
        value.entries.length > this.#options.maxEntries
      ) {
        throw new TypeError('OPFS index schema is invalid.')
      }
      let totalBytes = 0
      for (const candidate of value.entries) {
        const metadata = this.#options.parseMetadata(candidate)
        if (entries.has(metadata.id))
          throw new TypeError('Duplicate binary id.')
        totalBytes += metadata.byteLength
        entries.set(metadata.id, metadata)
      }
      if (totalBytes > this.#options.maxTotalBytes) {
        throw new RangeError('OPFS binary index exceeds repository capacity.')
      }
      return { entries, available: true }
    } catch (error) {
      return { entries: new Map(), available: true, error }
    }
  }

  #readFallback(): FallbackState<M> {
    const empty = (): FallbackState<M> => ({
      entries: new Map(),
      deletedIds: new Set(),
      available: this.#options.storage !== null,
    })
    if (!this.#options.storage) return empty()
    let source: string | null
    try {
      source = this.#options.storage.getItem(this.#options.storageKey)
    } catch (error) {
      return { ...empty(), available: false, error }
    }
    if (source === null) return empty()
    try {
      const value: unknown = JSON.parse(source)
      if (
        !isRecord(value) ||
        value.schemaVersion !== USER_BINARY_FALLBACK_SCHEMA_VERSION ||
        !Array.isArray(value.entries) ||
        !Array.isArray(value.deletedIds) ||
        value.entries.length > this.#options.maxEntries ||
        value.deletedIds.length > this.#options.maxEntries
      ) {
        throw new TypeError('Fallback binary schema is invalid.')
      }
      const result = empty()
      let totalBytes = 0
      for (const candidate of value.entries) {
        if (!isRecord(candidate) || typeof candidate.bytes !== 'string') {
          throw new TypeError('Fallback binary entry is invalid.')
        }
        const metadata = this.#options.parseMetadata(candidate.metadata)
        if (result.entries.has(metadata.id)) {
          throw new TypeError('Fallback binary id is duplicated.')
        }
        const bytes = base64ToBytes(candidate.bytes)
        if (
          bytes.byteLength !== metadata.byteLength ||
          bytes.byteLength > this.#options.maxFallbackEntryBytes
        ) {
          throw new RangeError('Fallback binary entry exceeds its safe limit.')
        }
        totalBytes += bytes.byteLength
        result.entries.set(metadata.id, { metadata, bytes })
      }
      if (totalBytes > this.#options.maxFallbackTotalBytes) {
        throw new RangeError(
          'Fallback binary collection exceeds its safe limit.',
        )
      }
      for (const id of value.deletedIds) {
        if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(id)) {
          throw new TypeError('Fallback tombstone id is invalid.')
        }
        result.deletedIds.add(id)
        result.entries.delete(id)
      }
      return result
    } catch (error) {
      return { ...empty(), error }
    }
  }

  async #putOpfs(
    metadata: M,
    bytes: Uint8Array<ArrayBuffer>,
    state: { opfs: OpfsState<M>; fallback: FallbackState<M> },
  ): Promise<void> {
    const directory = await this.#options.getOpfsDirectory!()
    const previous = state.opfs.entries.get(metadata.id)
    const binaryName = this.#binaryFileName(metadata)
    await this.#writeFile(directory, binaryName, bytes)

    const entries = new Map(state.opfs.entries)
    for (const id of state.fallback.deletedIds) entries.delete(id)
    entries.set(metadata.id, metadata)
    await this.#writeIndex(directory, entries)

    const staleFiles = [
      ...(previous && this.#binaryFileName(previous) !== binaryName
        ? [this.#binaryFileName(previous)]
        : []),
      ...[...state.fallback.deletedIds]
        .map((id) => state.opfs.entries.get(id))
        .filter((entry): entry is M => entry !== undefined)
        .map((entry) => this.#binaryFileName(entry)),
    ]
    await Promise.all(
      staleFiles.map(async (fileName) => {
        try {
          await directory.removeEntry(fileName)
        } catch (error) {
          if (!isNotFoundError(error)) {
            // Orphan cleanup may be retried by a later write.
          }
        }
      }),
    )
  }

  #cleanupFallbackAfterOpfsPut(id: string, fallback: FallbackState<M>): void {
    fallback.entries.delete(id)
    fallback.deletedIds.delete(id)
    // Tombstones were applied to the committed OPFS index.
    fallback.deletedIds.clear()
    try {
      this.#persistFallback(fallback)
    } catch {
      // OPFS is already committed; stale fallback cleanup is best effort.
    }
  }

  #putFallback(
    metadata: M,
    bytes: Uint8Array<ArrayBuffer>,
    fallback: FallbackState<M>,
  ): void {
    if (!this.#options.storage) {
      this.#fail(
        'unsupported',
        'OPFS failed and byte-capable fallback storage is unavailable.',
      )
    }
    if (bytes.byteLength > this.#options.maxFallbackEntryBytes) {
      this.#fail(
        'fallback-limit',
        `Fallback entries are limited to ${this.#options.maxFallbackEntryBytes} bytes.`,
      )
    }
    const previous = fallback.entries.get(metadata.id)
    const total =
      [...fallback.entries.values()].reduce(
        (sum, entry) => sum + entry.bytes.byteLength,
        0,
      ) -
      (previous?.bytes.byteLength ?? 0) +
      bytes.byteLength
    if (total > this.#options.maxFallbackTotalBytes) {
      this.#fail(
        'fallback-limit',
        `Fallback storage is limited to ${this.#options.maxFallbackTotalBytes} raw bytes.`,
      )
    }
    fallback.entries.set(metadata.id, {
      metadata,
      bytes: stableBytes(bytes),
    })
    fallback.deletedIds.delete(metadata.id)
    this.#persistFallback(fallback)
  }

  #persistFallback(fallback: FallbackState<M>): void {
    if (!this.#options.storage) {
      this.#fail('unsupported', 'Fallback storage is unavailable.')
    }
    if (fallback.entries.size === 0 && fallback.deletedIds.size === 0) {
      this.#options.storage.removeItem(this.#options.storageKey)
      return
    }
    this.#options.storage.setItem(
      this.#options.storageKey,
      JSON.stringify({
        schemaVersion: USER_BINARY_FALLBACK_SCHEMA_VERSION,
        entries: [...fallback.entries.values()].map((entry) => ({
          metadata: entry.metadata,
          bytes: bytesToBase64(entry.bytes),
        })),
        deletedIds: [...fallback.deletedIds],
      }),
    )
  }

  async #removeOpfs(
    id: string,
    state: { opfs: OpfsState<M>; fallback: FallbackState<M> },
  ): Promise<void> {
    const directory = await this.#options.getOpfsDirectory!()
    const metadata = state.opfs.entries.get(id)
    const entries = new Map(state.opfs.entries)
    entries.delete(id)
    for (const deletedId of state.fallback.deletedIds) entries.delete(deletedId)
    await this.#writeIndex(directory, entries)
    if (metadata) {
      try {
        await directory.removeEntry(this.#binaryFileName(metadata))
      } catch (error) {
        if (!isNotFoundError(error)) {
          // The index is authoritative; an orphan is harmless.
        }
      }
    }
  }

  async #writeIndex(
    directory: UserBinaryDirectoryHandle,
    entries: Map<string, M>,
  ): Promise<void> {
    await this.#writeFile(
      directory,
      this.#indexFileName,
      JSON.stringify({
        schemaVersion: USER_BINARY_INDEX_SCHEMA_VERSION,
        entries: [...entries.values()],
      }),
    )
  }

  async #writeFile(
    directory: UserBinaryDirectoryHandle,
    fileName: string,
    data: string | Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    const handle = await directory.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(data)
      await writable.close()
    } catch (error) {
      await writable.abort?.().catch(() => undefined)
      throw error
    }
  }
}
