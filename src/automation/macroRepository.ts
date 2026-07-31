import {
  MAX_MACRO_SOURCE_LENGTH,
  type MacroDocument,
  type MacroParseResult,
  parseMacro,
  serializeMacro,
} from './macros'

export const DEFAULT_MACRO_STORAGE_KEY = 'image-processor-web:macros:v1'
export const MAX_SAVED_MACROS = 100

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface MacroRepositoryEntry {
  macro: MacroDocument
  diagnostics: MacroParseResult['diagnostics']
}

export interface MacroRepository {
  list(): MacroRepositoryEntry[]
  get(id: string): MacroRepositoryEntry | null
  save(macro: MacroDocument): void
  remove(id: string): boolean
  clear(): void
}

interface StoredMacroLibrary {
  version: 1
  macros: string[]
}

const parseLibrary = (source: string | null): string[] => {
  if (!source) {
    return []
  }
  if (source.length > MAX_MACRO_SOURCE_LENGTH * MAX_SAVED_MACROS) {
    return []
  }
  try {
    const parsed = JSON.parse(source) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { macros?: unknown }).macros)
    ) {
      return []
    }
    return (parsed as StoredMacroLibrary).macros
      .filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.length <= MAX_MACRO_SOURCE_LENGTH,
      )
      .slice(0, MAX_SAVED_MACROS)
  } catch {
    return []
  }
}

export class LocalMacroRepository implements MacroRepository {
  readonly #storage: KeyValueStorage
  readonly #key: string

  constructor(
    storage: KeyValueStorage,
    key: string = DEFAULT_MACRO_STORAGE_KEY,
  ) {
    this.#storage = storage
    this.#key = key
  }

  list(): MacroRepositoryEntry[] {
    const entries: MacroRepositoryEntry[] = []
    for (const source of parseLibrary(this.#storage.getItem(this.#key))) {
      try {
        entries.push(parseMacro(source))
      } catch {
        // Corrupt entries are isolated instead of making the library unusable.
      }
    }
    return entries.sort(
      (left, right) =>
        Date.parse(right.macro.updatedAt) - Date.parse(left.macro.updatedAt),
    )
  }

  get(id: string): MacroRepositoryEntry | null {
    return this.list().find(({ macro }) => macro.id === id) ?? null
  }

  save(macro: MacroDocument): void {
    const source = serializeMacro(macro)
    const entries = this.list()
      .filter(({ macro: existing }) => existing.id !== macro.id)
      .map(({ macro: existing }) => serializeMacro(existing))
    entries.unshift(source)
    const library: StoredMacroLibrary = {
      version: 1,
      macros: entries.slice(0, MAX_SAVED_MACROS),
    }
    this.#storage.setItem(this.#key, JSON.stringify(library))
  }

  remove(id: string): boolean {
    const current = this.list()
    const retained = current.filter(({ macro }) => macro.id !== id)
    if (retained.length === current.length) {
      return false
    }
    const library: StoredMacroLibrary = {
      version: 1,
      macros: retained.map(({ macro }) => serializeMacro(macro)),
    }
    this.#storage.setItem(this.#key, JSON.stringify(library))
    return true
  }

  clear(): void {
    this.#storage.removeItem(this.#key)
  }
}
