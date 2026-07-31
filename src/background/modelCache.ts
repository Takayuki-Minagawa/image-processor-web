export interface BackgroundModelDescriptor {
  id: string
  version: string
  sizeBytes: number
  sha256: string
  downloadUrl?: string
}

export interface BackgroundModelConsent {
  modelId: string
  version: string
  sizeBytes: number
  sha256: string
  grantedAt: string
}

export interface BinaryModelRepository {
  get(descriptor: BackgroundModelDescriptor): Promise<Uint8Array | null>
  put(descriptor: BackgroundModelDescriptor, bytes: Uint8Array): Promise<void>
  remove(descriptor: BackgroundModelDescriptor): Promise<void>
}

export interface ModelConsentRepository {
  get(modelId: string): Promise<BackgroundModelConsent | null>
  put(consent: BackgroundModelConsent): Promise<void>
  remove(modelId: string): Promise<void>
}

export type BackgroundModelCacheErrorCode =
  | 'invalid-descriptor'
  | 'consent-required'
  | 'model-size-mismatch'
  | 'model-checksum-mismatch'
  | 'model-download-failed'

export class BackgroundModelCacheError extends Error {
  readonly code: BackgroundModelCacheErrorCode

  constructor(
    code: BackgroundModelCacheErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BackgroundModelCacheError'
    this.code = code
  }
}

const descriptorKey = (descriptor: BackgroundModelDescriptor): string =>
  `${descriptor.id}@${descriptor.version}`

export const validateBackgroundModelDescriptor = (
  descriptor: BackgroundModelDescriptor,
): BackgroundModelDescriptor => {
  if (
    !descriptor ||
    typeof descriptor !== 'object' ||
    typeof descriptor.id !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(descriptor.id) ||
    typeof descriptor.version !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(descriptor.version) ||
    !Number.isSafeInteger(descriptor.sizeBytes) ||
    descriptor.sizeBytes <= 0 ||
    descriptor.sizeBytes > 512 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/i.test(descriptor.sha256) ||
    (descriptor.downloadUrl !== undefined &&
      typeof descriptor.downloadUrl !== 'string')
  ) {
    throw new BackgroundModelCacheError(
      'invalid-descriptor',
      'Background model descriptor is invalid.',
    )
  }
  return {
    ...descriptor,
    sha256: descriptor.sha256.toLowerCase(),
  }
}

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    throw new BackgroundModelCacheError(
      'model-checksum-mismatch',
      'Web Crypto SHA-256 is unavailable.',
    )
  }
  const stableBytes = new Uint8Array(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', stableBytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const verifyBackgroundModelBytes = async (
  candidate: BackgroundModelDescriptor,
  bytes: Uint8Array,
): Promise<void> => {
  const descriptor = validateBackgroundModelDescriptor(candidate)
  if (!ArrayBuffer.isView(bytes) || bytes.byteLength !== descriptor.sizeBytes) {
    throw new BackgroundModelCacheError(
      'model-size-mismatch',
      `Model ${descriptorKey(descriptor)} does not match its declared size.`,
    )
  }
  if ((await sha256Hex(bytes)) !== descriptor.sha256) {
    throw new BackgroundModelCacheError(
      'model-checksum-mismatch',
      `Model ${descriptorKey(descriptor)} failed SHA-256 verification.`,
    )
  }
}

export class MemoryBinaryModelRepository implements BinaryModelRepository {
  readonly #models = new Map<string, Uint8Array>()

  async get(candidate: BackgroundModelDescriptor): Promise<Uint8Array | null> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    const value = this.#models.get(descriptorKey(descriptor))
    return value ? new Uint8Array(value) : null
  }

  async put(
    candidate: BackgroundModelDescriptor,
    bytes: Uint8Array,
  ): Promise<void> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    this.#models.set(descriptorKey(descriptor), new Uint8Array(bytes))
  }

  async remove(candidate: BackgroundModelDescriptor): Promise<void> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    this.#models.delete(descriptorKey(descriptor))
  }
}

export class MemoryModelConsentRepository implements ModelConsentRepository {
  readonly #consents = new Map<string, BackgroundModelConsent>()

  async get(modelId: string): Promise<BackgroundModelConsent | null> {
    const consent = this.#consents.get(modelId)
    return consent ? { ...consent } : null
  }

  async put(consent: BackgroundModelConsent): Promise<void> {
    this.#consents.set(consent.modelId, { ...consent })
  }

  async remove(modelId: string): Promise<void> {
    this.#consents.delete(modelId)
  }
}

export interface ModelCacheFile {
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface ModelCacheWritable {
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface ModelCacheFileHandle {
  getFile(): Promise<ModelCacheFile>
  createWritable(): Promise<ModelCacheWritable>
}

export interface ModelCacheDirectory {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ModelCacheFileHandle>
  removeEntry(name: string): Promise<void>
}

export type ModelCacheDirectoryProvider = () => Promise<ModelCacheDirectory>

const modelFileName = (descriptor: BackgroundModelDescriptor): string =>
  `pixelweave-model-${encodeURIComponent(descriptor.id)}-${encodeURIComponent(descriptor.version)}.onnx`

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'NotFoundError'

export class OpfsModelRepository implements BinaryModelRepository {
  readonly #getRoot: ModelCacheDirectoryProvider
  readonly #fallback: BinaryModelRepository

  constructor(
    getRoot: ModelCacheDirectoryProvider,
    fallback: BinaryModelRepository = new MemoryBinaryModelRepository(),
  ) {
    this.#getRoot = getRoot
    this.#fallback = fallback
  }

  async get(candidate: BackgroundModelDescriptor): Promise<Uint8Array | null> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    try {
      const root = await this.#getRoot()
      const handle = await root.getFileHandle(modelFileName(descriptor))
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch (error) {
      if (!isNotFound(error)) {
        const fallback = await this.#fallback.get(descriptor)
        if (fallback) return fallback
      }
      return this.#fallback.get(descriptor)
    }
  }

  async put(
    candidate: BackgroundModelDescriptor,
    bytes: Uint8Array,
  ): Promise<void> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    try {
      const root = await this.#getRoot()
      const handle = await root.getFileHandle(modelFileName(descriptor), {
        create: true,
      })
      const writable = await handle.createWritable()
      await writable.write(new Uint8Array(bytes))
      await writable.close()
      await this.#fallback.remove(descriptor)
    } catch {
      await this.#fallback.put(descriptor, bytes)
    }
  }

  async remove(candidate: BackgroundModelDescriptor): Promise<void> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    try {
      const root = await this.#getRoot()
      await root.removeEntry(modelFileName(descriptor))
    } catch (error) {
      if (!isNotFound(error)) {
        // The fallback is still cleared even when OPFS is temporarily blocked.
      }
    }
    await this.#fallback.remove(descriptor)
  }
}

export interface ModelDownloadContext {
  signal?: AbortSignal
  reportProgress?(loadedBytes: number, totalBytes: number): void
}

export type BackgroundModelDownloader = (
  descriptor: BackgroundModelDescriptor,
  context: ModelDownloadContext,
) => Promise<Uint8Array>

export class ConsentAwareBackgroundModelCache {
  readonly #models: BinaryModelRepository
  readonly #consents: ModelConsentRepository
  readonly #now: () => string

  constructor(
    options: {
      models?: BinaryModelRepository
      consents?: ModelConsentRepository
      now?: () => string
    } = {},
  ) {
    this.#models = options.models ?? new MemoryBinaryModelRepository()
    this.#consents = options.consents ?? new MemoryModelConsentRepository()
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  async grantConsent(
    candidate: BackgroundModelDescriptor,
  ): Promise<BackgroundModelConsent> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    const consent: BackgroundModelConsent = {
      modelId: descriptor.id,
      version: descriptor.version,
      sizeBytes: descriptor.sizeBytes,
      sha256: descriptor.sha256,
      grantedAt: this.#now(),
    }
    await this.#consents.put(consent)
    return consent
  }

  async hasConsent(candidate: BackgroundModelDescriptor): Promise<boolean> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    const consent = await this.#consents.get(descriptor.id)
    return Boolean(
      consent &&
      consent.version === descriptor.version &&
      consent.sizeBytes === descriptor.sizeBytes &&
      consent.sha256.toLowerCase() === descriptor.sha256,
    )
  }

  async loadCached(
    candidate: BackgroundModelDescriptor,
  ): Promise<Uint8Array | null> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    const bytes = await this.#models.get(descriptor)
    if (!bytes) return null
    try {
      await verifyBackgroundModelBytes(descriptor, bytes)
      return new Uint8Array(bytes)
    } catch {
      await this.#models.remove(descriptor)
      return null
    }
  }

  async getOrDownload(
    candidate: BackgroundModelDescriptor,
    download: BackgroundModelDownloader,
    context: ModelDownloadContext = {},
  ): Promise<Uint8Array> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    const cached = await this.loadCached(descriptor)
    if (cached) return cached
    if (!(await this.hasConsent(descriptor))) {
      throw new BackgroundModelCacheError(
        'consent-required',
        `Downloading ${descriptor.sizeBytes} bytes for model ${descriptor.id} requires consent.`,
      )
    }

    let bytes: Uint8Array
    try {
      bytes = await download(descriptor, context)
    } catch (error) {
      throw new BackgroundModelCacheError(
        'model-download-failed',
        `Could not download model ${descriptorKey(descriptor)}.`,
        { cause: error },
      )
    }
    await verifyBackgroundModelBytes(descriptor, bytes)
    await this.#models.put(descriptor, bytes)
    return new Uint8Array(bytes)
  }

  async revoke(
    candidate: BackgroundModelDescriptor,
    removeCachedModel = false,
  ): Promise<void> {
    const descriptor = validateBackgroundModelDescriptor(candidate)
    await this.#consents.remove(descriptor.id)
    if (removeCachedModel) {
      await this.#models.remove(descriptor)
    }
  }
}
