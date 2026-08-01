import { describe, expect, it, vi } from 'vitest'
import {
  AutosaveError,
  BrowserAutosaveRepository,
  type AutosaveDirectoryHandle,
  type AutosaveFileHandle,
  type AutosaveStorage,
  type AutosaveWritable,
} from './autosave'
import { createProjectDocument, serializeProject } from './project'
import type { ProjectDocument } from './types'

const timestamp = '2026-07-30T03:00:00.000Z'
const defaultAutosaveFileName = 'autosave.image-processor-web.json'

const project = (): ProjectDocument =>
  createProjectDocument({
    canvasSize: { width: 800, height: 600 },
    fabricCanvas: { objects: [{ type: 'Circle', radius: 20 }] },
    metadata: { name: 'Autosave test', createdAt: timestamp },
    updatedAt: timestamp,
  })

const projectAt = (updatedAt: string, name: string): ProjectDocument =>
  createProjectDocument({
    canvasSize: { width: 800, height: 600 },
    fabricCanvas: { objects: [{ type: 'Circle', radius: 20 }] },
    metadata: { name, createdAt: timestamp },
    updatedAt,
  })

const page = (id: string, radius: number) =>
  createProjectDocument({
    pageId: id,
    pageName: `Page ${id}`,
    canvasSize: { width: 800, height: 600 },
    fabricCanvas: { objects: [{ type: 'Circle', radius }] },
    metadata: { name: 'Autosave test', createdAt: timestamp },
    updatedAt: timestamp,
  }).pages[0]

const multiPageProject = (
  radii: readonly [number, number],
  updatedAt = timestamp,
): ProjectDocument =>
  createProjectDocument({
    pages: [page('page-1', radii[0]), page('page-2', radii[1])],
    activePageId: 'page-2',
    metadata: { name: 'Autosave pages', createdAt: timestamp },
    updatedAt,
  })

class MemoryStorage implements AutosaveStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const makeOpfs = (initial?: string) => {
  const files = new Map<string, string>()
  if (initial !== undefined) files.set(defaultAutosaveFileName, initial)
  const write = vi.fn(async (fileName: string, data: string) => {
    files.set(fileName, data)
  })
  const close = vi.fn(async (fileName: string) => fileName)
  const root: AutosaveDirectoryHandle = {
    getFileHandle: vi.fn(async (name, options) => {
      if (!files.has(name) && options?.create !== true) {
        throw new DOMException('Missing', 'NotFoundError')
      }
      const writable: AutosaveWritable = {
        write: async (data) => write(name, data),
        close: async () => {
          await close(name)
        },
      }
      const handle: AutosaveFileHandle = {
        getFile: vi.fn(async () => ({
          text: async () => {
            const content = files.get(name)
            if (content === undefined) {
              throw new DOMException('Missing', 'NotFoundError')
            }
            return content
          },
        })),
        createWritable: vi.fn(async () => writable),
      }
      return handle
    }),
    removeEntry: vi.fn(async (name) => {
      if (!files.has(name)) {
        throw new DOMException('Missing', 'NotFoundError')
      }
      files.delete(name)
    }),
    keys: async function* () {
      yield* files.keys()
    },
  }

  return {
    root,
    write,
    close,
    content: (fileName = defaultAutosaveFileName) => files.get(fileName),
    fileNames: () => [...files.keys()],
  }
}

describe('BrowserAutosaveRepository', () => {
  it('prefers OPFS for save and load', async () => {
    const opfs = makeOpfs()
    const storage = new MemoryStorage()
    storage.setItem('fallback', 'stale')
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage,
      storageKey: 'fallback',
    })

    await expect(repository.save(project())).resolves.toBe('opfs')
    expect(opfs.write).toHaveBeenCalledTimes(2)
    expect(opfs.close).toHaveBeenCalledTimes(2)
    expect(storage.getItem('fallback')).toBeNull()
    await expect(repository.load()).resolves.toEqual(project())
  })

  it('rewrites only the changed page and the manifest', async () => {
    const opfs = makeOpfs()
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage: new MemoryStorage(),
    })
    const original = multiPageProject([20, 30])

    await repository.save(original)
    const firstManifest = JSON.parse(opfs.content()!) as {
      pages: { id: string; fileName: string }[]
    }
    const firstPageFiles = new Map(
      firstManifest.pages.map(({ id, fileName }) => [id, fileName]),
    )
    opfs.write.mockClear()

    const changed = multiPageProject([20, 45], '2026-07-30T03:01:00.000Z')
    await repository.save(changed)

    const writtenFileNames = opfs.write.mock.calls.map(([fileName]) => fileName)
    const secondManifest = JSON.parse(opfs.content()!) as {
      pages: { id: string; fileName: string }[]
    }
    const secondPageFiles = new Map(
      secondManifest.pages.map(({ id, fileName }) => [id, fileName]),
    )
    expect(writtenFileNames).toHaveLength(2)
    expect(writtenFileNames).toContain(defaultAutosaveFileName)
    expect(secondPageFiles.get('page-1')).toBe(firstPageFiles.get('page-1'))
    expect(secondPageFiles.get('page-2')).not.toBe(firstPageFiles.get('page-2'))
    expect(writtenFileNames).toContain(secondPageFiles.get('page-2'))
    expect(opfs.fileNames()).not.toContain(firstPageFiles.get('page-2'))
    await expect(repository.load()).resolves.toEqual(changed)
  })

  it('falls back to localStorage when OPFS is unavailable', async () => {
    const storage = new MemoryStorage()
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: null,
      storage,
      storageKey: 'fallback',
    })

    await expect(repository.save(project())).resolves.toBe('localStorage')
    expect(storage.getItem('fallback')).toContain(
      'image-processor-web/fallback',
    )
    await expect(repository.load()).resolves.toEqual(project())
  })

  it('falls back when an OPFS operation fails', async () => {
    const storage = new MemoryStorage()
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
      storage,
    })

    await expect(repository.save(project())).resolves.toBe('localStorage')
    await expect(repository.load()).resolves.toEqual(project())
  })

  it('uses a local copy when the OPFS copy is corrupt', async () => {
    const opfs = makeOpfs('{"broken":true}')
    const storage = new MemoryStorage()
    storage.setItem('fallback', serializeProject(project()))
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage,
      storageKey: 'fallback',
    })

    await expect(repository.load()).resolves.toEqual(project())
  })

  it('loads a newer fallback copy after a failed OPFS save', async () => {
    const older = projectAt('2026-07-30T03:00:00.000Z', 'Older OPFS')
    const newer = projectAt('2026-07-30T03:01:00.000Z', 'Newer fallback')
    const opfs = makeOpfs(serializeProject(older))
    const storage = new MemoryStorage()
    storage.setItem('fallback', serializeProject(newer))
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage,
      storageKey: 'fallback',
    })

    await expect(repository.load()).resolves.toEqual(newer)
  })

  it('prefers a failed-save fallback even when its project clock is unchanged', async () => {
    const opfsProject = projectAt(timestamp, 'OPFS before failed save')
    const fallbackProject = projectAt(timestamp, 'Fallback after failed save')
    const opfs = makeOpfs(serializeProject(opfsProject))
    const storage = new MemoryStorage()
    const getFileHandle = opfs.root.getFileHandle.bind(opfs.root)
    opfs.root.getFileHandle = vi.fn(async (name, options) => {
      if (options?.create) {
        throw new DOMException('Disk full', 'QuotaExceededError')
      }
      return getFileHandle(name, options)
    })
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage,
      storageKey: 'fallback',
    })

    await expect(repository.save(fallbackProject)).resolves.toBe('localStorage')
    opfs.root.getFileHandle = getFileHandle

    await expect(repository.load()).resolves.toEqual(fallbackProject)
  })

  it('records when a later OPFS commit supersedes a retained fallback', async () => {
    const opfs = makeOpfs(serializeProject(projectAt(timestamp, 'Old OPFS')))
    const storage = new MemoryStorage()
    const getFileHandle = opfs.root.getFileHandle.bind(opfs.root)
    opfs.root.getFileHandle = vi.fn(async (name, options) => {
      if (options?.create) {
        throw new DOMException('Disk full', 'QuotaExceededError')
      }
      return getFileHandle(name, options)
    })
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage,
      storageKey: 'fallback',
    })
    await repository.save(projectAt(timestamp, 'Retained fallback'))
    opfs.root.getFileHandle = getFileHandle
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new DOMException('Busy', 'InvalidStateError')
    })
    const latest = projectAt(timestamp, 'Latest OPFS')

    await expect(repository.save(latest)).resolves.toBe('opfs')
    await expect(repository.load()).resolves.toEqual(latest)
  })

  it('keeps a newer OPFS copy when the fallback is stale', async () => {
    const older = projectAt('2026-07-30T03:00:00.000Z', 'Older fallback')
    const newer = projectAt('2026-07-30T03:01:00.000Z', 'Newer OPFS')
    const opfs = makeOpfs(serializeProject(newer))
    const storage = new MemoryStorage()
    storage.setItem('fallback', serializeProject(older))
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage,
      storageKey: 'fallback',
    })

    await expect(repository.load()).resolves.toEqual(newer)
  })

  it('returns null when neither backend contains an autosave', async () => {
    const opfs = makeOpfs()
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage: new MemoryStorage(),
    })

    await expect(repository.load()).resolves.toBeNull()
  })

  it('clears the manifest, every page file, and the fallback copy together', async () => {
    const opfs = makeOpfs()
    const storage = new MemoryStorage()
    storage.setItem('fallback', serializeProject(project()))
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage,
      storageKey: 'fallback',
    })
    await repository.save(multiPageProject([20, 30]))
    storage.setItem('fallback', serializeProject(project()))

    await repository.clear()

    expect(opfs.content()).toBeUndefined()
    expect(opfs.fileNames()).toEqual([])
    expect(storage.getItem('fallback')).toBeNull()
  })

  it('keeps the prior autosave intact when its manifest cannot be removed', async () => {
    const opfs = makeOpfs()
    const saved = multiPageProject([20, 30])
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage: new MemoryStorage(),
    })
    await repository.save(saved)
    const pageFilesBeforeClear = opfs.fileNames().sort()
    const removeEntry = opfs.root.removeEntry.bind(opfs.root)
    opfs.root.removeEntry = vi.fn(async (name) => {
      if (name === defaultAutosaveFileName) {
        throw new DOMException('Manifest is busy', 'InvalidStateError')
      }
      await removeEntry(name)
    })

    await expect(repository.clear()).rejects.toMatchObject({
      code: 'clear-failed',
    })

    expect(opfs.fileNames().sort()).toEqual(pageFilesBeforeClear)
    await expect(repository.load()).resolves.toEqual(saved)
  })

  it('rediscovers and removes an orphaned page chunk on the next clear', async () => {
    const opfs = makeOpfs()
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage: new MemoryStorage(),
    })
    await repository.save(multiPageProject([20, 30]))
    const pageFile = opfs
      .fileNames()
      .find((name) => name.startsWith(`${defaultAutosaveFileName}.page.`))!
    const removeEntry = opfs.root.removeEntry.bind(opfs.root)
    let failedOnce = false
    opfs.root.removeEntry = vi.fn(async (name) => {
      if (name === pageFile && !failedOnce) {
        failedOnce = true
        throw new DOMException('Busy', 'InvalidStateError')
      }
      await removeEntry(name)
    })

    await expect(repository.clear()).rejects.toMatchObject({
      code: 'clear-failed',
    })
    expect(opfs.content()).toBeUndefined()
    expect(opfs.fileNames()).toContain(pageFile)

    await expect(repository.clear()).resolves.toBeUndefined()
    expect(opfs.fileNames()).toEqual([])
  })

  it('loads a legacy monolithic autosave and migrates it on the next save', async () => {
    const legacySource = JSON.stringify({
      appId: 'image-processor-web',
      schemaVersion: 1,
      canvasSize: { width: 800, height: 600 },
      fabricCanvas: { objects: [{ type: 'Circle', radius: 20 }] },
      metadata: { name: 'Legacy autosave', createdAt: timestamp },
      updatedAt: timestamp,
    })
    const opfs = makeOpfs(legacySource)
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage: new MemoryStorage(),
    })

    const migrated = await repository.load()
    expect(migrated).toEqual(
      expect.objectContaining({ schemaVersion: 4, activePageId: 'page-1' }),
    )

    await repository.save(migrated!)

    expect(JSON.parse(opfs.content()!)).toEqual(
      expect.objectContaining({
        autosaveFormat: 'image-processor-web/page-delta',
        autosaveVersion: 1,
      }),
    )
    await expect(repository.load()).resolves.toEqual(migrated)
  })

  it('reports a clear error when no persistence backend can save', async () => {
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: null,
      storage: null,
    })

    await expect(repository.save(project())).rejects.toEqual(
      expect.objectContaining<AutosaveError>({
        name: 'AutosaveError',
        code: 'save-failed',
        message: expect.any(String) as string,
      }),
    )
  })

  it('supports injected codec functions', async () => {
    const storage = new MemoryStorage()
    const serialize = vi.fn(() => 'encoded')
    const parse = vi.fn(() => project())
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: null,
      storage,
      serialize,
      parse,
    })

    await repository.save(project())
    await repository.load()

    expect(serialize).toHaveBeenCalledOnce()
    expect(parse).toHaveBeenCalledWith('encoded')
  })
})
