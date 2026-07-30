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
  let content = initial
  const write = vi.fn(async (data: string) => {
    content = data
  })
  const close = vi.fn(async () => undefined)
  const writable: AutosaveWritable = { write, close }
  const handle: AutosaveFileHandle = {
    getFile: vi.fn(async () => ({
      text: async () => {
        if (content === undefined) {
          throw new DOMException('Missing', 'NotFoundError')
        }
        return content
      },
    })),
    createWritable: vi.fn(async () => writable),
  }
  const root: AutosaveDirectoryHandle = {
    getFileHandle: vi.fn(async (_name, options) => {
      if (content === undefined && options?.create !== true) {
        throw new DOMException('Missing', 'NotFoundError')
      }
      return handle
    }),
    removeEntry: vi.fn(async () => {
      if (content === undefined) {
        throw new DOMException('Missing', 'NotFoundError')
      }
      content = undefined
    }),
  }

  return {
    root,
    write,
    close,
    content: () => content,
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
    expect(opfs.write).toHaveBeenCalledOnce()
    expect(opfs.close).toHaveBeenCalledOnce()
    expect(storage.getItem('fallback')).toBeNull()
    await expect(repository.load()).resolves.toEqual(project())
  })

  it('falls back to localStorage when OPFS is unavailable', async () => {
    const storage = new MemoryStorage()
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: null,
      storage,
      storageKey: 'fallback',
    })

    await expect(repository.save(project())).resolves.toBe('localStorage')
    expect(storage.getItem('fallback')).toBe(serializeProject(project()))
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

  it('clears OPFS and fallback copies together', async () => {
    const opfs = makeOpfs(serializeProject(project()))
    const storage = new MemoryStorage()
    storage.setItem('fallback', serializeProject(project()))
    const repository = new BrowserAutosaveRepository({
      getOpfsRoot: async () => opfs.root,
      storage,
      storageKey: 'fallback',
    })

    await repository.clear()

    expect(opfs.content()).toBeUndefined()
    expect(storage.getItem('fallback')).toBeNull()
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
