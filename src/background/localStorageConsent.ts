import type {
  BackgroundModelConsent,
  ModelConsentRepository,
} from './modelCache'

export const DEFAULT_MODEL_CONSENT_STORAGE_PREFIX =
  'pixelweave.background-model-consent.v1.'

export interface ModelConsentKeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const checkedModelId = (modelId: string): string => {
  if (
    typeof modelId !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(modelId)
  ) {
    throw new TypeError('The background model id is invalid.')
  }
  return modelId
}

const checkedConsent = (candidate: unknown): BackgroundModelConsent => {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new TypeError('The background model consent is invalid.')
  }
  const value = candidate as Partial<BackgroundModelConsent>
  const modelId = checkedModelId(value.modelId as string)
  if (
    typeof value.version !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(value.version) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) <= 0 ||
    (value.sizeBytes as number) > 512 * 1024 * 1024 ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(value.sha256) ||
    typeof value.grantedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.grantedAt))
  ) {
    throw new TypeError('The background model consent is invalid.')
  }
  return {
    modelId,
    version: value.version,
    sizeBytes: value.sizeBytes as number,
    sha256: value.sha256.toLowerCase(),
    grantedAt: value.grantedAt,
  }
}

const defaultStorage = (): ModelConsentKeyValueStorage => {
  const storage = globalThis.localStorage
  if (!storage) {
    throw new DOMException(
      'Local storage is unavailable for model consent.',
      'NotSupportedError',
    )
  }
  return storage
}

/**
 * Stores each consent independently so concurrent grants for separate models
 * cannot overwrite one another. Malformed or stale foreign data is ignored.
 */
export class LocalStorageModelConsentRepository implements ModelConsentRepository {
  readonly #storage: () => ModelConsentKeyValueStorage
  readonly #prefix: string

  constructor(options?: {
    storage?: ModelConsentKeyValueStorage
    prefix?: string
  }) {
    this.#storage = options?.storage
      ? () => options.storage as ModelConsentKeyValueStorage
      : defaultStorage
    this.#prefix = options?.prefix ?? DEFAULT_MODEL_CONSENT_STORAGE_PREFIX
    if (
      typeof this.#prefix !== 'string' ||
      this.#prefix.length === 0 ||
      this.#prefix.length > 200
    ) {
      throw new TypeError('The model consent storage prefix is invalid.')
    }
  }

  #key(modelId: string): string {
    return `${this.#prefix}${encodeURIComponent(checkedModelId(modelId))}`
  }

  async get(modelId: string): Promise<BackgroundModelConsent | null> {
    const key = this.#key(modelId)
    const serialized = this.#storage().getItem(key)
    if (serialized === null) return null
    try {
      const consent = checkedConsent(JSON.parse(serialized))
      return consent.modelId === modelId ? { ...consent } : null
    } catch {
      return null
    }
  }

  async put(candidate: BackgroundModelConsent): Promise<void> {
    const consent = checkedConsent(candidate)
    this.#storage().setItem(this.#key(consent.modelId), JSON.stringify(consent))
  }

  async remove(modelId: string): Promise<void> {
    this.#storage().removeItem(this.#key(modelId))
  }
}
