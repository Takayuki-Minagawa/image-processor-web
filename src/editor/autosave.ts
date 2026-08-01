import {
  parseProject,
  serializeProject,
  type ProjectFormatError,
  validateProjectDocument,
} from './project'
import type { ProjectDocument } from './types'
import {
  detectBrowserLockManager,
  runWithOptionalBrowserLock,
  type BrowserLockManagerLike,
} from '../lib/browserLock'

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
  keys?(): AsyncIterableIterator<string>
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
  /** `undefined` detects Web Locks; `null` disables cross-tab locking. */
  lockManager?: BrowserLockManagerLike | null
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

const DELTA_AUTOSAVE_FORMAT = 'image-processor-web/page-delta' as const
const DELTA_AUTOSAVE_VERSION = 1 as const
const FALLBACK_AUTOSAVE_FORMAT = 'image-processor-web/fallback' as const
const FALLBACK_AUTOSAVE_VERSION = 1 as const
const MAX_DELTA_AUTOSAVE_PAGES = 100
const MAX_DELTA_AUTOSAVE_FILES = 10_000

interface DeltaAutosavePageReference {
  id: string
  fileName: string
}

interface DeltaAutosaveManifest {
  autosaveFormat: typeof DELTA_AUTOSAVE_FORMAT
  autosaveVersion: typeof DELTA_AUTOSAVE_VERSION
  project: Record<string, unknown>
  pages: DeltaAutosavePageReference[]
  garbage?: string[]
  supersedesFallback?: string
}

interface FallbackAutosaveEnvelope {
  autosaveFormat: typeof FALLBACK_AUTOSAVE_FORMAT
  autosaveVersion: typeof FALLBACK_AUTOSAVE_VERSION
  commitToken: string
  projectSource: string
}

interface FallbackAutosaveCandidate {
  commitToken: string
  projectSource: string
  versioned: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const safePageFileReference = (
  value: unknown,
  prefix: string,
): value is string =>
  typeof value === 'string' &&
  value.length > prefix.length &&
  value.length <= 512 &&
  value.startsWith(prefix) &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !value.includes('\0')

const safeCommitToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256

const legacyFallbackToken = (source: string): string => {
  let hash = 2_166_136_261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `legacy-${source.length.toString(36)}-${(hash >>> 0).toString(36)}`
}

const parseFallbackCandidate = (source: string): FallbackAutosaveCandidate => {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    return {
      commitToken: legacyFallbackToken(source),
      projectSource: source,
      versioned: false,
    }
  }
  if (!isRecord(value) || value.autosaveFormat !== FALLBACK_AUTOSAVE_FORMAT) {
    return {
      commitToken: legacyFallbackToken(source),
      projectSource: source,
      versioned: false,
    }
  }
  if (
    value.autosaveVersion !== FALLBACK_AUTOSAVE_VERSION ||
    !safeCommitToken(value.commitToken) ||
    typeof value.projectSource !== 'string'
  ) {
    throw new Error('The fallback autosave envelope is invalid.')
  }
  return {
    commitToken: value.commitToken,
    projectSource: value.projectSource,
    versioned: true,
  }
}

/**
 * Distinguishes the page-delta envelope from the historical monolithic file.
 * A file without our marker is deliberately left to the project parser so
 * schema-v1 through schema-v4 autosaves keep using the normal migration path.
 */
const parseDeltaManifest = (
  source: string,
  pageFilePrefix: string,
): DeltaAutosaveManifest | null => {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    return null
  }
  if (!isRecord(value) || value.autosaveFormat !== DELTA_AUTOSAVE_FORMAT) {
    return null
  }
  if (
    value.autosaveVersion !== DELTA_AUTOSAVE_VERSION ||
    !isRecord(value.project) ||
    !Array.isArray(value.pages) ||
    value.pages.length === 0 ||
    value.pages.length > MAX_DELTA_AUTOSAVE_PAGES
  ) {
    throw new Error('The page-delta autosave manifest is invalid.')
  }

  const pageIds = new Set<string>()
  const pageFiles = new Set<string>()
  const pages = value.pages.map((page): DeltaAutosavePageReference => {
    if (
      !isRecord(page) ||
      typeof page.id !== 'string' ||
      page.id.length === 0 ||
      !safePageFileReference(page.fileName, pageFilePrefix) ||
      pageIds.has(page.id) ||
      pageFiles.has(page.fileName)
    ) {
      throw new Error('The page-delta autosave manifest has an invalid page.')
    }
    pageIds.add(page.id)
    pageFiles.add(page.fileName)
    return { id: page.id, fileName: page.fileName }
  })

  let garbage: string[] | undefined
  if (value.garbage !== undefined) {
    if (!Array.isArray(value.garbage)) {
      throw new Error('The page-delta autosave cleanup list is invalid.')
    }
    const uniqueGarbage = new Set<string>()
    for (const fileName of value.garbage) {
      if (
        !safePageFileReference(fileName, pageFilePrefix) ||
        pageFiles.has(fileName)
      ) {
        throw new Error('The page-delta autosave cleanup list is invalid.')
      }
      uniqueGarbage.add(fileName)
    }
    garbage = [...uniqueGarbage]
  }

  const supersedesFallback = value.supersedesFallback
  if (
    supersedesFallback !== undefined &&
    !safeCommitToken(supersedesFallback)
  ) {
    throw new Error('The page-delta autosave provenance is invalid.')
  }

  return {
    autosaveFormat: DELTA_AUTOSAVE_FORMAT,
    autosaveVersion: DELTA_AUTOSAVE_VERSION,
    project: value.project,
    pages,
    ...(garbage === undefined ? {} : { garbage }),
    ...(supersedesFallback === undefined ? {} : { supersedesFallback }),
  }
}

const readFile = async (
  root: AutosaveDirectoryHandle,
  fileName: string,
): Promise<string> => {
  const handle = await root.getFileHandle(fileName)
  return (await handle.getFile()).text()
}

const readFileIfPresent = async (
  root: AutosaveDirectoryHandle,
  fileName: string,
): Promise<string | null> => {
  try {
    return await readFile(root, fileName)
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

const writeFile = async (
  root: AutosaveDirectoryHandle,
  fileName: string,
  source: string,
): Promise<void> => {
  const handle = await root.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(source)
  await writable.close()
}

const removeFileIfPresent = async (
  root: AutosaveDirectoryHandle,
  fileName: string,
): Promise<void> => {
  try {
    await root.removeEntry(fileName)
  } catch (error) {
    if (!isNotFoundError(error)) throw error
  }
}

const yieldToMainThread = async (): Promise<void> => {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: { yield?: () => Promise<void> }
    }
  ).scheduler
  if (typeof scheduler?.yield === 'function') {
    await scheduler.yield()
    return
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

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
  readonly #pageFilePrefix: string
  readonly #storageKey: string
  readonly #getOpfsRoot: OpfsRootProvider | null
  readonly #storage: AutosaveStorage | null
  readonly #serialize: (project: ProjectDocument) => string
  readonly #parse: (source: string) => ProjectDocument
  readonly #usesDefaultCodec: boolean
  readonly #lockManager: BrowserLockManagerLike | null
  readonly #lockName: string
  #pageFileSequence = 0
  #commitSequence = 0

  constructor(options: BrowserAutosaveRepositoryOptions = {}) {
    this.#fileName = options.fileName ?? 'autosave.image-processor-web.json'
    this.#pageFilePrefix = `${this.#fileName}.page.`
    this.#storageKey = options.storageKey ?? 'image-processor-web:autosave:v1'
    this.#getOpfsRoot =
      options.getOpfsRoot === undefined
        ? defaultOpfsProvider()
        : options.getOpfsRoot
    this.#storage =
      options.storage === undefined ? defaultStorage() : options.storage
    this.#serialize = options.serialize ?? serializeProject
    this.#parse = options.parse ?? parseProject
    this.#usesDefaultCodec =
      options.serialize === undefined && options.parse === undefined
    this.#lockManager =
      options.lockManager === undefined
        ? detectBrowserLockManager()
        : options.lockManager
    this.#lockName = `pixelweave:autosave:${this.#fileName}:write`
  }

  save(project: ProjectDocument): Promise<AutosaveBackend> {
    return this.#withMutationLock(() => this.#saveUnlocked(project))
  }

  async #saveUnlocked(project: ProjectDocument): Promise<AutosaveBackend> {
    let opfsError: unknown
    let priorFallbackToken: string | undefined
    if (this.#storage !== null) {
      try {
        const source = this.#storage.getItem(this.#storageKey)
        if (source !== null) {
          priorFallbackToken = parseFallbackCandidate(source).commitToken
        }
      } catch {
        // OPFS can still commit even when fallback metadata is unavailable.
      }
    }

    if (this.#getOpfsRoot !== null) {
      try {
        const root = await this.#getOpfsRoot()
        if (this.#usesDefaultCodec) {
          await this.#savePageDelta(root, project, priorFallbackToken)
        } else {
          // A custom codec is opaque to this repository, so retain the
          // historical single-file contract rather than splitting it unsafely.
          await writeFile(root, this.#fileName, this.#serialize(project))
        }

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
        const envelope: FallbackAutosaveEnvelope = {
          autosaveFormat: FALLBACK_AUTOSAVE_FORMAT,
          autosaveVersion: FALLBACK_AUTOSAVE_VERSION,
          commitToken: this.#nextCommitToken(),
          projectSource: this.#serialize(project),
        }
        this.#storage.setItem(this.#storageKey, JSON.stringify(envelope))
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
    let opfsSupersedesFallback: string | undefined
    let storageError: unknown
    let storageProject: ProjectDocument | null = null
    let storageCandidate: FallbackAutosaveCandidate | null = null

    if (this.#getOpfsRoot !== null) {
      try {
        const root = await this.#getOpfsRoot()
        const source = await readFile(root, this.#fileName)
        const manifest = parseDeltaManifest(source, this.#pageFilePrefix)
        if (manifest === null) {
          opfsProject = this.#parse(source)
        } else {
          opfsSupersedesFallback = manifest.supersedesFallback
          const pages = await Promise.all(
            manifest.pages.map(async ({ id, fileName }) => {
              let page: unknown
              try {
                page = JSON.parse(await readFile(root, fileName)) as unknown
              } catch (error) {
                throw new Error(`Autosave page "${id}" could not be read.`, {
                  cause: error,
                })
              }
              if (!isRecord(page) || page.id !== id) {
                throw new Error(
                  `Autosave page "${id}" does not match its manifest entry.`,
                )
              }
              return page
            }),
          )
          opfsProject = this.#parse(
            JSON.stringify({ ...manifest.project, pages }),
          )
        }
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
          storageCandidate = parseFallbackCandidate(source)
          storageProject = this.#parse(storageCandidate.projectSource)
        } catch (error) {
          storageError = error
        }
      }
    }

    if (opfsProject && storageProject) {
      if (
        storageCandidate !== null &&
        opfsSupersedesFallback === storageCandidate.commitToken
      ) {
        return opfsProject
      }
      if (storageCandidate?.versioned) return storageProject
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

  clear(): Promise<void> {
    return this.#withMutationLock(() => this.#clearUnlocked())
  }

  async #clearUnlocked(): Promise<void> {
    const errors: unknown[] = []

    if (this.#getOpfsRoot !== null) {
      try {
        const root = await this.#getOpfsRoot()
        const source = await readFileIfPresent(root, this.#fileName)
        const pageFiles = new Set<string>()
        if (source !== null) {
          let manifest: DeltaAutosaveManifest | null = null
          try {
            manifest = parseDeltaManifest(source, this.#pageFilePrefix)
          } catch {
            // A corrupt manifest must never be able to block its own removal.
          }
          if (manifest !== null) {
            for (const { fileName } of manifest.pages) pageFiles.add(fileName)
            for (const fileName of manifest.garbage ?? [])
              pageFiles.add(fileName)
          }
        }

        // A prior failed cleanup may have removed the manifest already. OPFS
        // directory iteration lets a later clear safely rediscover every
        // bounded page chunk without touching unrelated application files.
        if (root.keys) {
          for await (const fileName of root.keys()) {
            if (safePageFileReference(fileName, this.#pageFilePrefix)) {
              pageFiles.add(fileName)
              if (pageFiles.size > MAX_DELTA_AUTOSAVE_FILES) {
                throw new Error(
                  'Too many autosave page chunks to clear safely.',
                )
              }
            }
          }
        }

        if (source !== null) {
          // Remove the commit point first. If this fails, every referenced
          // page remains intact and the previous autosave is still loadable.
          await removeFileIfPresent(root, this.#fileName)
        }

        for (const fileName of pageFiles) {
          try {
            await removeFileIfPresent(root, fileName)
          } catch (error) {
            errors.push(error)
          }
        }
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

  #nextPageFileName(pageId: string): string {
    const randomId = globalThis.crypto?.randomUUID?.()
    const token =
      randomId ??
      `${Date.now().toString(36)}-${(++this.#pageFileSequence).toString(36)}-${Math.random().toString(36).slice(2)}`
    return `${this.#pageFilePrefix}${encodeURIComponent(pageId)}.${token}.json`
  }

  #withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return runWithOptionalBrowserLock(
      this.#lockManager,
      this.#lockName,
      operation,
    )
  }

  #nextCommitToken(): string {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${(++this.#commitSequence).toString(36)}-${Math.random().toString(36).slice(2)}`
    )
  }

  async #savePageDelta(
    root: AutosaveDirectoryHandle,
    project: ProjectDocument,
    supersedesFallback?: string,
  ): Promise<void> {
    // Validation remains synchronous, but yielding first prevents a debounced
    // autosave from extending the input event that scheduled it.
    await yieldToMainThread()
    const validated = validateProjectDocument(project)
    const priorSource = await readFileIfPresent(root, this.#fileName)
    let priorManifest: DeltaAutosaveManifest | null = null
    if (priorSource !== null) {
      try {
        priorManifest = parseDeltaManifest(priorSource, this.#pageFilePrefix)
      } catch {
        // A valid save replaces a corrupt internal manifest. Any unreferenced
        // files remain isolated under our prefix and cannot shadow the result.
      }
    }

    const priorPages = new Map(
      (priorManifest?.pages ?? []).map((page) => [page.id, page]),
    )
    const pendingGarbage = new Set<string>()
    for (const fileName of priorManifest?.garbage ?? []) {
      try {
        await removeFileIfPresent(root, fileName)
      } catch {
        pendingGarbage.add(fileName)
      }
    }
    const pages: DeltaAutosavePageReference[] = []
    const createdFiles: string[] = []

    try {
      for (const page of validated.pages) {
        // Large pages are serialized independently, yielding between chunks so
        // a ten-page 4K document does not monopolize one browser task.
        await yieldToMainThread()
        const source = JSON.stringify(page)
        const prior = priorPages.get(page.id)
        const priorPageSource =
          prior === undefined
            ? null
            : await readFileIfPresent(root, prior.fileName)

        if (prior !== undefined && priorPageSource === source) {
          pages.push(prior)
          continue
        }

        const fileName = this.#nextPageFileName(page.id)
        await writeFile(root, fileName, source)
        createdFiles.push(fileName)
        pages.push({ id: page.id, fileName })
      }

      const retainedFiles = new Set(pages.map(({ fileName }) => fileName))
      const garbage = pendingGarbage
      for (const { fileName } of priorManifest?.pages ?? []) {
        if (!retainedFiles.has(fileName)) garbage.add(fileName)
      }

      const manifest: DeltaAutosaveManifest = {
        autosaveFormat: DELTA_AUTOSAVE_FORMAT,
        autosaveVersion: DELTA_AUTOSAVE_VERSION,
        project: {
          appId: validated.appId,
          schemaVersion: validated.schemaVersion,
          activePageId: validated.activePageId,
          metadata: validated.metadata,
          updatedAt: validated.updatedAt,
        },
        pages,
        ...(garbage.size === 0 ? {} : { garbage: [...garbage] }),
        ...(supersedesFallback === undefined ? {} : { supersedesFallback }),
      }
      await writeFile(root, this.#fileName, JSON.stringify(manifest))

      // Cleanup happens only after the manifest commit. The names stay in the
      // manifest's cleanup list so a later save/clear safely retries failures.
      for (const fileName of garbage) {
        try {
          await removeFileIfPresent(root, fileName)
        } catch {
          // The committed autosave is usable; stale chunks cannot shadow it.
        }
      }
    } catch (error) {
      // Page files created before a failed manifest commit are unreachable.
      // Best-effort cleanup keeps common failures from leaving those orphans.
      await Promise.allSettled(
        createdFiles.map((fileName) => removeFileIfPresent(root, fileName)),
      )
      throw error
    }
  }
}

export const createAutosaveRepository = (
  options?: BrowserAutosaveRepositoryOptions,
): AutosaveRepository => new BrowserAutosaveRepository(options)
