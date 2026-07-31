import {
  MAX_SAVED_SCRIPT_DOCUMENT_LENGTH,
  type SavedEditorScript,
  type SavedEditorScriptEntry,
  parseSavedEditorScript,
  serializeSavedEditorScript,
  validateSavedEditorScript,
} from './savedScripts'

export const DEFAULT_SCRIPT_STORAGE_KEY = 'image-processor-web:scripts:v1'
export const MAX_SAVED_SCRIPTS = 50
export const MAX_SCRIPT_LIBRARY_LENGTH = 8 * 1024 * 1024

export interface ScriptStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ScriptRepositorySaveResult {
  script: SavedEditorScript
  persisted: boolean
}

export interface ScriptRepository {
  list(): SavedEditorScriptEntry[]
  get(id: string): SavedEditorScriptEntry | null
  save(script: SavedEditorScript): ScriptRepositorySaveResult
  remove(id: string): boolean
  clear(): void
  isPersistent(): boolean
}

interface StoredScriptLibrary {
  version: 1
  scripts: string[]
}

const resolveBrowserStorage = (): ScriptStorage | null => {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage
  } catch {
    return null
  }
}

const cloneEntry = (entry: SavedEditorScriptEntry): SavedEditorScriptEntry =>
  parseSavedEditorScript(serializeSavedEditorScript(entry.script))

const parseLibrary = (source: string | null): SavedEditorScriptEntry[] => {
  if (!source || source.length > MAX_SCRIPT_LIBRARY_LENGTH) {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    return []
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== 1 ||
    !Array.isArray((parsed as { scripts?: unknown }).scripts)
  ) {
    return []
  }

  const ids = new Set<string>()
  const entries: SavedEditorScriptEntry[] = []
  for (const candidate of (parsed as StoredScriptLibrary).scripts.slice(
    0,
    MAX_SAVED_SCRIPTS,
  )) {
    if (
      typeof candidate !== 'string' ||
      candidate.length > MAX_SAVED_SCRIPT_DOCUMENT_LENGTH
    ) {
      continue
    }
    try {
      const entry = parseSavedEditorScript(candidate)
      if (!ids.has(entry.script.id)) {
        ids.add(entry.script.id)
        entries.push(entry)
      }
    } catch {
      // A malformed or unsafe entry must not hide the rest of the library.
    }
  }
  return entries
}

/**
 * Keeps a validated in-memory mirror. Blocked storage, corrupt data, and quota
 * errors therefore degrade to a session-only script library without exposing
 * an unparsed source to the editor.
 */
export class LocalScriptRepository implements ScriptRepository {
  readonly #storage: ScriptStorage | null
  readonly #key: string
  #loaded = false
  #persistent: boolean
  #entries: SavedEditorScriptEntry[] = []

  constructor(
    storage: ScriptStorage | null = resolveBrowserStorage(),
    key = DEFAULT_SCRIPT_STORAGE_KEY,
  ) {
    this.#storage = storage
    this.#key = key
    this.#persistent = storage !== null
  }

  list(): SavedEditorScriptEntry[] {
    this.#ensureLoaded()
    return [...this.#entries]
      .sort(
        (left, right) =>
          Date.parse(right.script.updatedAt) -
          Date.parse(left.script.updatedAt),
      )
      .map(cloneEntry)
  }

  get(id: string): SavedEditorScriptEntry | null {
    this.#ensureLoaded()
    const entry = this.#entries.find(({ script }) => script.id === id)
    return entry ? cloneEntry(entry) : null
  }

  save(candidate: SavedEditorScript): ScriptRepositorySaveResult {
    this.#ensureLoaded()
    const entry = cloneEntry(validateSavedEditorScript(candidate))
    const retained = this.#entries.filter(
      ({ script }) => script.id !== entry.script.id,
    )
    this.#entries = [entry, ...retained].slice(0, MAX_SAVED_SCRIPTS)
    this.#persist()
    return {
      script: { ...entry.script },
      persisted: this.#persistent,
    }
  }

  remove(id: string): boolean {
    this.#ensureLoaded()
    const retained = this.#entries.filter(({ script }) => script.id !== id)
    if (retained.length === this.#entries.length) {
      return false
    }
    this.#entries = retained
    this.#persist()
    return true
  }

  clear(): void {
    this.#ensureLoaded()
    this.#entries = []
    if (!this.#storage || !this.#persistent) {
      this.#persistent = false
      return
    }
    try {
      this.#storage.removeItem(this.#key)
    } catch {
      this.#persistent = false
    }
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
      this.#entries = parseLibrary(this.#storage.getItem(this.#key))
    } catch {
      this.#persistent = false
      this.#entries = []
    }
  }

  #persist(): void {
    if (!this.#storage || !this.#persistent) {
      this.#persistent = false
      return
    }
    try {
      const library: StoredScriptLibrary = {
        version: 1,
        scripts: this.#entries.map(({ script }) =>
          serializeSavedEditorScript(script),
        ),
      }
      const serialized = JSON.stringify(library)
      if (serialized.length > MAX_SCRIPT_LIBRARY_LENGTH) {
        throw new RangeError('The script library is too large.')
      }
      this.#storage.setItem(this.#key, serialized)
    } catch {
      this.#persistent = false
    }
  }
}
