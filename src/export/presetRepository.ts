import {
  detectBrowserLockManager,
  runWithOptionalBrowserLock,
  type BrowserLockManagerLike,
} from '../lib/browserLock'
import {
  EXPORT_PRESET_SCHEMA_VERSION,
  ExportPresetError,
  MAX_EXPORT_PRESETS,
  MAX_EXPORT_PRESET_LIBRARY_BYTES,
  validateExportPreset,
  validateExportPresetId,
  validateExportPresetName,
  validateExportPresetSettings,
  type ExportPreset,
  type ExportPresetSettings,
} from './presets'

export const EXPORT_PRESET_STORAGE_KEY = 'image-processor-web:export-presets:v1'

export interface ExportPresetStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ExportPresetListResult {
  presets: ExportPreset[]
  persisted: boolean
}

export interface ExportPresetSaveInput {
  id?: string
  name: string
  settings: ExportPresetSettings
}

export interface ExportPresetSaveResult extends ExportPresetListResult {
  preset: ExportPreset
}

export interface ExportPresetRepository {
  list(): Promise<ExportPresetListResult>
  save(input: ExportPresetSaveInput): Promise<ExportPresetSaveResult>
  remove(id: string): Promise<ExportPresetListResult>
}

export interface ExportPresetRepositoryOptions {
  /** Undefined detects localStorage; null selects session-only storage. */
  storage?: ExportPresetStorage | null
  /** Reuses the application's optional Web Locks boundary. */
  lockManager?: BrowserLockManagerLike | null
  createId?: () => string
}

const browserStorage = (): ExportPresetStorage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `export-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const clone = (presets: readonly ExportPreset[]): ExportPreset[] =>
  presets.map(validateExportPreset)

const nameKey = (preset: Pick<ExportPreset, 'name' | 'settings'>): string =>
  `${preset.settings.kind}:${preset.name.toLowerCase()}`

const bytes = (source: string): number =>
  new TextEncoder().encode(source).byteLength

const parseLibrary = (source: string | null): ExportPreset[] => {
  if (source === null) return []
  if (
    source.length > MAX_EXPORT_PRESET_LIBRARY_BYTES ||
    bytes(source) > MAX_EXPORT_PRESET_LIBRARY_BYTES
  ) {
    throw new Error('The saved preset library exceeds its limit.')
  }
  const value: unknown = JSON.parse(source)
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('version' in value) ||
    value.version !== EXPORT_PRESET_SCHEMA_VERSION ||
    !('presets' in value) ||
    !Array.isArray(value.presets) ||
    value.presets.length > MAX_EXPORT_PRESETS
  )
    throw new Error('The saved preset library is invalid or unsupported.')
  const presets = value.presets.map(validateExportPreset)
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const preset of presets) {
    if (ids.has(preset.id) || names.has(nameKey(preset))) {
      throw new Error('The saved preset library contains duplicates.')
    }
    ids.add(preset.id)
    names.add(nameKey(preset))
  }
  return presets
}

/**
 * A small local JSON library. Mutations reread while holding the shared browser
 * lock, instead of overwriting another tab from a stale in-memory snapshot.
 * Unavailable, invalid, newer-version or quota-limited storage is left untouched;
 * this repository then retains explicitly session-only presets until reload.
 */
export class LocalExportPresetRepository implements ExportPresetRepository {
  readonly #storage: ExportPresetStorage | null
  readonly #lockManager: BrowserLockManagerLike | null
  readonly #createId: () => string
  #persistent: boolean
  #presets: ExportPreset[] = []
  #queue: Promise<void> = Promise.resolve()

  constructor(options: ExportPresetRepositoryOptions = {}) {
    this.#storage =
      options.storage === undefined ? browserStorage() : options.storage
    this.#lockManager =
      options.lockManager === undefined
        ? detectBrowserLockManager()
        : options.lockManager
    this.#createId = options.createId ?? createId
    this.#persistent = this.#storage !== null
  }

  list(): Promise<ExportPresetListResult> {
    return this.#enqueue(() => {
      this.#readLatest()
      return this.#result()
    })
  }

  save(input: ExportPresetSaveInput): Promise<ExportPresetSaveResult> {
    return this.#enqueue(() =>
      this.#mutate(() => {
        this.#readLatest()
        const name = validateExportPresetName(input.name)
        const settings = validateExportPresetSettings(input.settings)
        const requestedId =
          input.id === undefined ? undefined : validateExportPresetId(input.id)
        const existing =
          requestedId === undefined
            ? undefined
            : this.#presets.find(({ id }) => id === requestedId)
        if (requestedId !== undefined && !existing) {
          throw new ExportPresetError(
            'preset-not-found',
            'The preset was removed. Save a new preset instead.',
          )
        }
        if (existing && existing.settings.kind !== settings.kind) {
          throw new ExportPresetError(
            'invalid-settings',
            'A preset cannot change its output kind.',
          )
        }
        if (
          this.#presets.some(
            (preset) =>
              preset.id !== requestedId &&
              nameKey(preset) === nameKey({ name, settings }),
          )
        ) {
          throw new ExportPresetError(
            'duplicate-name',
            'A preset with this name already exists.',
          )
        }
        if (!existing && this.#presets.length >= MAX_EXPORT_PRESETS) {
          throw new ExportPresetError(
            'preset-limit',
            'The preset library is full.',
          )
        }
        const id = requestedId ?? validateExportPresetId(this.#createId())
        if (!existing && this.#presets.some((preset) => preset.id === id)) {
          throw new ExportPresetError(
            'invalid-preset',
            'The generated preset identifier is already in use.',
          )
        }
        const preset = { id, name, settings }
        const next = existing
          ? this.#presets.map((item) => (item.id === id ? preset : item))
          : [...this.#presets, preset]
        this.#commit(next)
        return { ...this.#result(), preset: validateExportPreset(preset) }
      }),
    )
  }

  remove(id: string): Promise<ExportPresetListResult> {
    return this.#enqueue(() =>
      this.#mutate(() => {
        validateExportPresetId(id)
        this.#readLatest()
        if (!this.#presets.some((preset) => preset.id === id)) {
          throw new ExportPresetError(
            'preset-not-found',
            'The preset has already been removed.',
          )
        }
        this.#commit(this.#presets.filter((preset) => preset.id !== id))
        return this.#result()
      }),
    )
  }

  #enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #mutate<T>(operation: () => T): Promise<T> {
    let started = false
    try {
      return await runWithOptionalBrowserLock(
        this.#lockManager,
        `${EXPORT_PRESET_STORAGE_KEY}:write`,
        () => {
          started = true
          return operation()
        },
      )
    } catch (error) {
      if (started) throw error
      // A denied lock must not cause an unlocked write to shared browser data.
      this.#persistent = false
      return operation()
    }
  }

  #readLatest(): void {
    if (!this.#persistent || !this.#storage) return
    try {
      this.#presets = parseLibrary(
        this.#storage.getItem(EXPORT_PRESET_STORAGE_KEY),
      )
    } catch {
      this.#persistent = false
    }
  }

  #commit(presets: ExportPreset[]): void {
    const source = JSON.stringify({
      version: EXPORT_PRESET_SCHEMA_VERSION,
      presets,
    })
    if (bytes(source) > MAX_EXPORT_PRESET_LIBRARY_BYTES) {
      throw new ExportPresetError(
        'preset-limit',
        'The preset library exceeds 32 KiB.',
      )
    }
    if (this.#persistent && this.#storage) {
      try {
        this.#storage.setItem(EXPORT_PRESET_STORAGE_KEY, source)
      } catch {
        this.#persistent = false
      }
    }
    this.#presets = presets
  }

  #result(): ExportPresetListResult {
    return { presets: clone(this.#presets), persisted: this.#persistent }
  }
}

let sharedRepository: ExportPresetRepository | undefined

/** Lives outside modal components so a session-only library survives reopening. */
export const getExportPresetRepository = (): ExportPresetRepository =>
  (sharedRepository ??= new LocalExportPresetRepository())
