import {
  parseProject,
  serializeProject,
  type ProjectFormatError,
} from './project'
import type { ProjectDocument } from './types'

export type AutosaveBackend = 'opfs' | 'localStorage'

export type AutosaveErrorCode = 'save-failed' | 'load-failed' | 'clear-failed'

export class AutosaveError extends Error {
  readonly code: AutosaveErrorCode

  constructor(
    code: AutosaveErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AutosaveError'
    this.code = code
  }
}

export interface AutosaveRepository {
  save(project: ProjectDocument): Promise<AutosaveBackend>
  load(): Promise<ProjectDocument | null>
  clear(): Promise<void>
}

export interface AutosaveStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface AutosaveFile {
  text(): Promise<string>
}

export interface AutosaveWritable {
  write(data: string): Promise<void>
  close(): Promise<void>
}

export interface AutosaveFileHandle {
  getFile(): Promise<AutosaveFile>
  createWritable(): Promise<AutosaveWritable>
}

export interface AutosaveDirectoryHandle {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<AutosaveFileHandle>
  removeEntry(name: string): Promise<void>
}

export type OpfsRootProvider = () => Promise<AutosaveDirectoryHandle>

export interface BrowserAutosaveRepositoryOptions {
  fileName?: string
  storageKey?: string
  /**
   * `undefined` performs browser feature detection; `null` disables OPFS.
   */
  getOpfsRoot?: OpfsRootProvider | null
  /**
   * `undefined` performs browser feature detection; `null` disables fallback.
   */
  storage?: AutosaveStorage | null
  serialize?: (project: ProjectDocument) => string
  parse?: (source: string) => ProjectDocument
}

const defaultOpfsProvider = (): OpfsRootProvider | null => {
  if (
    typeof navigator === 'undefined' ||
    !('storage' in navigator) ||
    navigator.storage === undefined
  ) {
    return null
  }

  const storageManager = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>
  }
  if (typeof storageManager.getDirectory !== 'function') {
    return null
  }

  return async () =>
    (await storageManager.getDirectory?.call(
      storageManager,
    )) as unknown as AutosaveDirectoryHandle
}

const defaultStorage = (): AutosaveStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Some privacy modes expose the property but throw when it is accessed.
    return null
  }
}

const isNotFoundError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'NotFoundError'

const rethrowProjectFormatError = (error: unknown): never => {
  // Avoid a runtime import solely for instanceof; keeping the original error
  // preserves its stable code and detailed validation message.
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ProjectFormatError'
  ) {
    throw error as ProjectFormatError
  }
  throw new AutosaveError(
    'load-failed',
    'The autosaved project could not be loaded.',
    { cause: error },
  )
}

/**
 * Browser persistence that prefers OPFS and degrades to localStorage.
 *
 * Browser capabilities are injected structurally, allowing unit tests to run
 * without real filesystem or Storage APIs.
 */
export class BrowserAutosaveRepository implements AutosaveRepository {
  readonly #fileName: string
  readonly #storageKey: string
  readonly #getOpfsRoot: OpfsRootProvider | null
  readonly #storage: AutosaveStorage | null
  readonly #serialize: (project: ProjectDocument) => string
  readonly #parse: (source: string) => ProjectDocument

  constructor(options: BrowserAutosaveRepositoryOptions = {}) {
    this.#fileName = options.fileName ?? 'autosave.image-processor-web.json'
    this.#storageKey = options.storageKey ?? 'image-processor-web:autosave:v1'
    this.#getOpfsRoot =
      options.getOpfsRoot === undefined
        ? defaultOpfsProvider()
        : options.getOpfsRoot
    this.#storage =
      options.storage === undefined ? defaultStorage() : options.storage
    this.#serialize = options.serialize ?? serializeProject
    this.#parse = options.parse ?? parseProject
  }

  async save(project: ProjectDocument): Promise<AutosaveBackend> {
    const source = this.#serialize(project)
    let opfsError: unknown

    if (this.#getOpfsRoot !== null) {
      try {
        const root = await this.#getOpfsRoot()
        const handle = await root.getFileHandle(this.#fileName, {
          create: true,
        })
        const writable = await handle.createWritable()
        await writable.write(source)
        await writable.close()

        // A prior fallback copy can otherwise shadow a later OPFS failure.
        try {
          this.#storage?.removeItem(this.#storageKey)
        } catch {
          // OPFS is authoritative after a successful committed write.
        }
        return 'opfs'
      } catch (error) {
        opfsError = error
      }
    }

    if (this.#storage !== null) {
      try {
        this.#storage.setItem(this.#storageKey, source)
        return 'localStorage'
      } catch (error) {
        throw new AutosaveError(
          'save-failed',
          'Autosave failed in both OPFS and localStorage.',
          { cause: error },
        )
      }
    }

    throw new AutosaveError(
      'save-failed',
      'Autosave is unavailable because neither OPFS nor localStorage could be used.',
      { cause: opfsError },
    )
  }

  async load(): Promise<ProjectDocument | null> {
    let opfsError: unknown
    let opfsProject: ProjectDocument | null = null
    let storageError: unknown
    let storageProject: ProjectDocument | null = null

    if (this.#getOpfsRoot !== null) {
      try {
        const root = await this.#getOpfsRoot()
        const handle = await root.getFileHandle(this.#fileName)
        const file = await handle.getFile()
        opfsProject = this.#parse(await file.text())
      } catch (error) {
        if (!isNotFoundError(error)) {
          opfsError = error
        }
      }
    }

    if (this.#storage !== null) {
      let source: string | null
      try {
        source = this.#storage.getItem(this.#storageKey)
      } catch (error) {
        storageError = new AutosaveError(
          'load-failed',
          'The local autosave fallback could not be read.',
          { cause: error },
        )
        source = null
      }

      if (source !== null) {
        try {
          storageProject = this.#parse(source)
        } catch (error) {
          storageError = error
        }
      }
    }

    if (opfsProject && storageProject) {
      return Date.parse(storageProject.updatedAt) >
        Date.parse(opfsProject.updatedAt)
        ? storageProject
        : opfsProject
    }
    if (opfsProject) return opfsProject
    if (storageProject) return storageProject
    if (storageError !== undefined) {
      rethrowProjectFormatError(storageError)
    }
    if (opfsError !== undefined) {
      rethrowProjectFormatError(opfsError)
    }
    return null
  }

  async clear(): Promise<void> {
    const errors: unknown[] = []

    if (this.#getOpfsRoot !== null) {
      try {
        const root = await this.#getOpfsRoot()
        await root.removeEntry(this.#fileName)
      } catch (error) {
        if (!isNotFoundError(error)) {
          errors.push(error)
        }
      }
    }

    if (this.#storage !== null) {
      try {
        this.#storage.removeItem(this.#storageKey)
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      throw new AutosaveError(
        'clear-failed',
        'One or more autosave copies could not be cleared.',
        { cause: errors[0] },
      )
    }
  }
}

export const createAutosaveRepository = (
  options?: BrowserAutosaveRepositoryOptions,
): AutosaveRepository => new BrowserAutosaveRepository(options)
