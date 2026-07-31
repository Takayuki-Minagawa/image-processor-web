import {
  BUILT_IN_FILTER_PRESETS,
  createFilterPreset,
  validateFilterPreset,
  type FilterPreset,
} from './presets'

export const FILTER_PRESET_LIBRARY_STORAGE_KEY =
  'image-processor-web:filter-presets:v1'
export const MAX_USER_FILTER_PRESETS = 100
export const MAX_FILTER_PRESET_LIBRARY_LENGTH = 2_000_000

export interface FilterPresetStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface FilterPresetSaveResult {
  preset: FilterPreset
  persisted: boolean
}

export interface FilterPresetRepository {
  listUser(): FilterPreset[]
  listAll(): FilterPreset[]
  save(preset: FilterPreset): FilterPresetSaveResult
  remove(id: string): boolean
  isPersistent(): boolean
}

interface StoredFilterPresetLibrary {
  version: 1
  presets: unknown[]
}

const clonePreset = (preset: FilterPreset): FilterPreset =>
  createFilterPreset({
    id: preset.id,
    name: preset.name,
    ...(preset.description ? { description: preset.description } : {}),
    filters: preset.filters,
  })

const parseLibrary = (source: string | null): FilterPreset[] => {
  if (!source) {
    return []
  }
  if (source.length > MAX_FILTER_PRESET_LIBRARY_LENGTH) {
    throw new RangeError('The filter preset library is too large.')
  }

  const parsed = JSON.parse(source) as unknown
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { presets?: unknown }).presets)
  ) {
    throw new TypeError('The filter preset library is invalid.')
  }

  const entries = (parsed as StoredFilterPresetLibrary).presets
  if (entries.length > MAX_USER_FILTER_PRESETS) {
    throw new RangeError('The filter preset library contains too many items.')
  }

  const ids = new Set<string>()
  const result: FilterPreset[] = []
  entries.forEach((entry) => {
    try {
      const { preset } = validateFilterPreset(entry)
      if (
        !ids.has(preset.id) &&
        !BUILT_IN_FILTER_PRESETS.some(({ id }) => id === preset.id)
      ) {
        ids.add(preset.id)
        result.push(preset)
      }
    } catch {
      // One corrupt entry must not make the rest of the local library unusable.
    }
  })
  return result
}

const resolveBrowserStorage = (): FilterPresetStorage | null => {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage
  } catch {
    return null
  }
}

/**
 * Keeps a validated in-memory mirror so a blocked, corrupt, or quota-limited
 * localStorage implementation degrades to session-only presets.
 */
export class LocalFilterPresetRepository implements FilterPresetRepository {
  readonly #storage: FilterPresetStorage | null
  readonly #key: string
  #loaded = false
  #persistent: boolean
  #userPresets: FilterPreset[] = []

  constructor(
    storage: FilterPresetStorage | null = resolveBrowserStorage(),
    key = FILTER_PRESET_LIBRARY_STORAGE_KEY,
  ) {
    this.#storage = storage
    this.#key = key
    this.#persistent = storage !== null
  }

  listUser(): FilterPreset[] {
    this.#ensureLoaded()
    return this.#userPresets.map(clonePreset)
  }

  listAll(): FilterPreset[] {
    return [...BUILT_IN_FILTER_PRESETS.map(clonePreset), ...this.listUser()]
  }

  save(candidate: FilterPreset): FilterPresetSaveResult {
    this.#ensureLoaded()
    const preset = clonePreset(validateFilterPreset(candidate).preset)
    if (BUILT_IN_FILTER_PRESETS.some(({ id }) => id === preset.id)) {
      throw new TypeError('A user preset cannot replace a built-in preset.')
    }
    const retained = this.#userPresets.filter(({ id }) => id !== preset.id)
    this.#userPresets = [preset, ...retained].slice(0, MAX_USER_FILTER_PRESETS)
    this.#persist()
    return {
      preset: clonePreset(preset),
      persisted: this.#persistent,
    }
  }

  remove(id: string): boolean {
    this.#ensureLoaded()
    const retained = this.#userPresets.filter((preset) => preset.id !== id)
    if (retained.length === this.#userPresets.length) {
      return false
    }
    this.#userPresets = retained
    this.#persist()
    return true
  }

  isPersistent(): boolean {
    this.#ensureLoaded()
    return this.#persistent
  }

  #ensureLoaded(): void {
    if (this.#loaded) {
      return
    }
    this.#loaded = true
    if (!this.#storage) {
      this.#persistent = false
      return
    }
    try {
      this.#userPresets = parseLibrary(this.#storage.getItem(this.#key))
    } catch {
      this.#persistent = false
      this.#userPresets = []
    }
  }

  #persist(): void {
    if (!this.#storage || !this.#persistent) {
      this.#persistent = false
      return
    }
    try {
      const library: StoredFilterPresetLibrary = {
        version: 1,
        presets: this.#userPresets,
      }
      this.#storage.setItem(this.#key, JSON.stringify(library))
    } catch {
      this.#persistent = false
    }
  }
}
