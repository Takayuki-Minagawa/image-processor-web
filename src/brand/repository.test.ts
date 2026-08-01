import { describe, expect, it, vi } from 'vitest'
import type { BrowserLockManagerLike } from '../lib/browserLock'
import { parseBrandKit, type BrandKit } from './brandKit'
import {
  BRAND_KIT_REPOSITORY_SCHEMA_VERSION,
  MAX_STORED_BRAND_KITS,
  BrandKitRepositoryError,
  BrowserBrandKitRepository,
  serializeStoredBrandKitCollection,
  type BrandKitDirectoryHandle,
  type BrandKitFileHandle,
  type BrandKitStorage,
  type BrandKitWritable,
} from './repository'

const kit = (id = 'acme', updatedAt = '2026-08-01T00:00:00.000Z'): BrandKit =>
  parseBrandKit({
    schemaVersion: 1,
    id,
    name: id
      .split('-')
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' '),
    palettes: [
      {
        id: 'default',
        name: 'Default',
        colors: {
          primary: '#112233',
          secondary: '#445566',
          accent: '#ff5500',
          background: '#ffffff',
          foreground: '#111111',
        },
      },
    ],
    fonts: {
      heading: { family: 'Bitter', fallback: 'serif', sourceId: 'bitter' },
      body: { family: 'Inter', fallback: 'sans-serif', sourceId: 'inter' },
    },
    logos: [],
    updatedAt,
  })

class MemoryStorage implements BrandKitStorage {
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

const collection = (kits: BrandKit[], updatedAt: string): string =>
  serializeStoredBrandKitCollection({
    schemaVersion: BRAND_KIT_REPOSITORY_SCHEMA_VERSION,
    updatedAt,
    kits,
  })

class MemoryLockManager implements BrowserLockManagerLike {
  readonly #queues = new Map<string, Promise<void>>()

  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> {
    const prior = this.#queues.get(name) ?? Promise.resolve()
    const result = prior.then(callback, callback)
    this.#queues.set(
      name,
      Promise.resolve(result).then(
        () => undefined,
        () => undefined,
      ),
    )
    return Promise.resolve(result)
  }
}

const makeOpfs = (
  initial?: string,
  options: { failWrite?: boolean; failRead?: boolean } = {},
) => {
  let content = initial
  let pending: string | undefined
  const write = vi.fn(async (data: string) => {
    if (options.failWrite) throw new DOMException('Blocked', 'SecurityError')
    pending = data
  })
  const close = vi.fn(async () => {
    if (options.failWrite) throw new DOMException('Blocked', 'SecurityError')
    content = pending
    pending = undefined
  })
  const abort = vi.fn(async () => {
    pending = undefined
  })
  const writable: BrandKitWritable = { write, close, abort }
  const handle: BrandKitFileHandle = {
    getFile: vi.fn(async () => {
      if (options.failRead) throw new DOMException('Blocked', 'SecurityError')
      if (content === undefined)
        throw new DOMException('Missing', 'NotFoundError')
      return { text: async () => content as string }
    }),
    createWritable: vi.fn(async () => writable),
  }
  const directory: BrandKitDirectoryHandle = {
    getFileHandle: vi.fn(async (_name, handleOptions) => {
      if (options.failRead && handleOptions?.create !== true) {
        throw new DOMException('Blocked', 'SecurityError')
      }
      if (content === undefined && handleOptions?.create !== true) {
        throw new DOMException('Missing', 'NotFoundError')
      }
      return handle
    }),
    removeEntry: vi.fn(async () => {
      if (content === undefined)
        throw new DOMException('Missing', 'NotFoundError')
      content = undefined
    }),
  }
  return { directory, write, close, abort, content: () => content }
}

describe('BrowserBrandKitRepository', () => {
  it('prefers OPFS, clears stale fallback data, and supports CRUD', async () => {
    const opfs = makeOpfs()
    const storage = new MemoryStorage()
    storage.setItem('brands', collection([], '2026-07-31T00:00:00.000Z'))
    const repository = new BrowserBrandKitRepository({
      getOpfsDirectory: async () => opfs.directory,
      storage,
      storageKey: 'brands',
      now: () => new Date('2026-08-01T01:00:00.000Z'),
    })

    await expect(repository.save(kit())).resolves.toBe('opfs')
    expect(opfs.write).toHaveBeenCalledOnce()
    expect(opfs.close).toHaveBeenCalledOnce()
    expect(storage.getItem('brands')).toBeNull()
    await expect(repository.get('acme')).resolves.toMatchObject({ id: 'acme' })
    await expect(repository.list()).resolves.toHaveLength(1)
    await expect(repository.remove('missing')).resolves.toBe(false)
    await expect(repository.remove('acme')).resolves.toBe(true)
    await expect(repository.list()).resolves.toEqual([])

    await repository.clear()
    expect(opfs.content()).toBeUndefined()
  })

  it('uses localStorage when OPFS is unavailable', async () => {
    const storage = new MemoryStorage()
    const repository = new BrowserBrandKitRepository({
      getOpfsDirectory: null,
      storage,
      storageKey: 'brands',
      now: () => new Date('2026-08-01T01:00:00.000Z'),
    })

    await expect(repository.save(kit())).resolves.toBe('localStorage')
    expect(storage.getItem('brands')).toContain('"acme"')
    await expect(repository.list()).resolves.toEqual([kit()])
  })

  it('fails closed when an advertised OPFS collection cannot be read', async () => {
    const storage = new MemoryStorage()
    const repository = new BrowserBrandKitRepository({
      getOpfsDirectory: async () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
      storage,
      storageKey: 'brands',
      now: () => new Date('2026-08-01T01:30:00.000Z'),
    })

    await expect(repository.save(kit())).rejects.toMatchObject({
      code: 'load-failed',
    })
    expect(storage.getItem('brands')).toBeNull()
  })

  it('keeps a newer fallback authoritative after an OPFS write failure', async () => {
    const older = kit('old-brand', '2026-08-01T00:00:00.000Z')
    const opfs = makeOpfs(collection([older], '2026-08-01T00:00:00.000Z'), {
      failWrite: true,
    })
    const storage = new MemoryStorage()
    const repository = new BrowserBrandKitRepository({
      getOpfsDirectory: async () => opfs.directory,
      storage,
      storageKey: 'brands',
      now: () => new Date('2026-08-01T02:00:00.000Z'),
    })

    await expect(repository.save(kit('new-brand'))).resolves.toBe(
      'localStorage',
    )
    await expect(repository.list()).resolves.toEqual([older, kit('new-brand')])
    expect(opfs.abort).toHaveBeenCalledOnce()
  })

  it('uses a valid fallback when the OPFS collection is corrupt', async () => {
    const opfs = makeOpfs('{"broken":true}')
    const storage = new MemoryStorage()
    storage.setItem('brands', collection([kit()], '2026-08-01T03:00:00.000Z'))
    const repository = new BrowserBrandKitRepository({
      getOpfsDirectory: async () => opfs.directory,
      storage,
      storageKey: 'brands',
    })

    await expect(repository.list()).resolves.toEqual([kit()])
  })

  it('serializes concurrent saves so no brand kit is lost', async () => {
    const opfs = makeOpfs()
    const repository = new BrowserBrandKitRepository({
      getOpfsDirectory: async () => opfs.directory,
      storage: new MemoryStorage(),
      now: () => new Date('2026-08-01T04:00:00.000Z'),
    })

    await Promise.all([
      repository.save(kit('brand-one')),
      repository.save(kit('brand-two')),
      repository.save(kit('brand-three')),
    ])
    expect((await repository.list()).map(({ id }) => id)).toEqual([
      'brand-one',
      'brand-two',
      'brand-three',
    ])
  })

  it('serializes saves across repository instances with a shared browser lock', async () => {
    const opfs = makeOpfs()
    const lockManager = new MemoryLockManager()
    const options = {
      getOpfsDirectory: async () => opfs.directory,
      storage: new MemoryStorage(),
      lockManager,
      now: () => new Date('2026-08-01T04:30:00.000Z'),
    }
    const first = new BrowserBrandKitRepository(options)
    const second = new BrowserBrandKitRepository(options)

    await Promise.all([first.save(kit('tab-one')), second.save(kit('tab-two'))])

    expect((await first.list()).map(({ id }) => id)).toEqual([
      'tab-one',
      'tab-two',
    ])
  })

  it('enforces collection limits and reports invalid storage', async () => {
    const storage = new MemoryStorage()
    storage.setItem(
      'brands',
      collection(
        Array.from({ length: MAX_STORED_BRAND_KITS }, (_, index) =>
          kit(`brand-${index + 1}`),
        ),
        '2026-08-01T00:00:00.000Z',
      ),
    )
    const repository = new BrowserBrandKitRepository({
      getOpfsDirectory: null,
      storage,
      storageKey: 'brands',
    })
    await expect(repository.save(kit('one-too-many'))).rejects.toMatchObject({
      code: 'kit-limit',
    })

    storage.setItem('brands', '{invalid')
    await expect(repository.list()).rejects.toBeInstanceOf(
      BrandKitRepositoryError,
    )
  })

  it('reports save failure when neither backend is available', async () => {
    const repository = new BrowserBrandKitRepository({
      getOpfsDirectory: null,
      storage: null,
    })
    await expect(repository.save(kit())).rejects.toMatchObject({
      code: 'save-failed',
    })
  })
})
