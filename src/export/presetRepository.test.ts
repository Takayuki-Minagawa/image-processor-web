import { describe, expect, it, vi } from 'vitest'
import type { BrowserLockManagerLike } from '../lib/browserLock'
import {
  EXPORT_PRESET_STORAGE_KEY,
  LocalExportPresetRepository,
  getExportPresetRepository,
  type ExportPresetStorage,
} from './presetRepository'
import {
  MAX_EXPORT_PRESETS,
  MAX_EXPORT_PRESET_LIBRARY_BYTES,
  type ImagePresetSettings,
  type PdfPresetSettings,
} from './presets'

const image: ImagePresetSettings = {
  kind: 'image',
  format: 'png',
  quality: 0.9,
  multiplier: 1,
}
const pdf: PdfPresetSettings = {
  kind: 'pdf',
  dpi: 300,
  bleedMm: 3,
  cropMarks: true,
  pdfCompression: 'jpeg',
  jpegQuality: 0.85,
}

class MemoryStorage implements ExportPresetStorage {
  value: string | null = null
  writes = 0
  getItem(key: string): string | null {
    expect(key).toBe(EXPORT_PRESET_STORAGE_KEY)
    return this.value
  }
  setItem(key: string, value: string): void {
    expect(key).toBe(EXPORT_PRESET_STORAGE_KEY)
    this.value = value
    this.writes += 1
  }
}

class TestLocks implements BrowserLockManagerLike {
  names: string[] = []
  #queue: Promise<unknown> = Promise.resolve()
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> {
    this.names.push(name)
    const result = this.#queue.then(callback)
    this.#queue = result.catch(() => undefined)
    return result
  }
}

const repository = (
  storage: ExportPresetStorage | null,
  prefix = 'preset',
  lockManager: BrowserLockManagerLike | null = null,
) => {
  let count = 0
  return new LocalExportPresetRepository({
    storage,
    lockManager,
    createId: () => `${prefix}-${++count}`,
  })
}

describe('export preset repository', () => {
  it('persists, reloads, updates by id and deletes presets without output data', async () => {
    const storage = new MemoryStorage()
    const repo = repository(storage)
    const saved = await repo.save({ name: '  Print  ', settings: pdf })
    expect(saved).toMatchObject({
      persisted: true,
      preset: { id: 'preset-1', name: 'Print', settings: pdf },
    })
    expect(JSON.parse(storage.value!)).toEqual({
      version: 1,
      presets: [saved.preset],
    })
    const reopened = repository(storage)
    expect((await reopened.list()).presets).toEqual([saved.preset])
    const updated = await reopened.save({
      id: saved.preset.id,
      name: 'Press',
      settings: { ...pdf, dpi: 150 },
    })
    expect(updated.presets).toHaveLength(1)
    expect(updated.preset).toMatchObject({
      id: saved.preset.id,
      name: 'Press',
      settings: { dpi: 150 },
    })
    expect(await reopened.remove(saved.preset.id)).toEqual({
      presets: [],
      persisted: true,
    })
    expect((await repository(storage).list()).presets).toEqual([])
  })

  it('clones inputs and returned lists so callers cannot alter the saved library', async () => {
    const repo = repository(new MemoryStorage())
    const input = { name: 'Web', settings: { ...image } }
    const saved = await repo.save(input)
    input.settings.multiplier = 2
    if (saved.preset.settings.kind === 'image')
      saved.preset.settings.multiplier = 0.5
    saved.presets[0].name = 'Changed'
    const list = await repo.list()
    list.presets.splice(0)
    expect((await repo.list()).presets).toEqual([
      { id: 'preset-1', name: 'Web', settings: image },
    ])
  })

  it('rejects duplicate names only within a kind, including rename collisions', async () => {
    const repo = repository(new MemoryStorage())
    const first = await repo.save({ name: 'Web', settings: image })
    await expect(
      repo.save({ name: '  WEB ', settings: image }),
    ).rejects.toMatchObject({ code: 'duplicate-name' })
    await repo.save({ name: 'web', settings: pdf })
    const second = await repo.save({ name: 'Print', settings: image })
    await expect(
      repo.save({ id: second.preset.id, name: 'web', settings: image }),
    ).rejects.toMatchObject({ code: 'duplicate-name' })
    await expect(
      repo.save({ id: first.preset.id, name: 'WEB', settings: image }),
    ).resolves.toMatchObject({ persisted: true })
    await expect(
      repo.save({ id: first.preset.id, name: 'Other', settings: pdf }),
    ).rejects.toMatchObject({ code: 'invalid-settings' })
  })

  it('rejects a 51st entry without silently evicting older presets and permits an update', async () => {
    const storage = new MemoryStorage()
    const repo = repository(storage)
    for (let index = 0; index < MAX_EXPORT_PRESETS; index += 1) {
      await repo.save({ name: `Preset ${index}`, settings: image })
    }
    const before = storage.value
    await expect(
      repo.save({ name: 'Overflow', settings: image }),
    ).rejects.toMatchObject({ code: 'preset-limit' })
    expect(storage.value).toBe(before)
    expect((await repo.list()).presets).toHaveLength(50)
    await expect(
      repo.save({ id: 'preset-1', name: 'Updated', settings: image }),
    ).resolves.toMatchObject({ persisted: true })
  })

  it('rereads storage for mutations and synchronizes separate instances through the shared lock', async () => {
    const storage = new MemoryStorage()
    const locks = new TestLocks()
    const a = repository(storage, 'a', locks)
    const b = repository(storage, 'b', locks)
    await a.list()
    await b.list()
    await Promise.all([
      a.save({ name: 'A', settings: image }),
      b.save({ name: 'B', settings: image }),
    ])
    expect((await a.list()).presets.map(({ name }) => name)).toEqual(['A', 'B'])
    expect((await b.list()).presets.map(({ name }) => name)).toEqual(['A', 'B'])
    expect(locks.names).toEqual([
      `${EXPORT_PRESET_STORAGE_KEY}:write`,
      `${EXPORT_PRESET_STORAGE_KEY}:write`,
    ])
  })

  it('does not resurrect a preset deleted by another tab using a stale selected id', async () => {
    const storage = new MemoryStorage()
    const locks = new TestLocks()
    const a = repository(storage, 'a', locks)
    const b = repository(storage, 'b', locks)
    const saved = await a.save({ name: 'Old', settings: pdf })
    await b.list()
    await a.remove(saved.preset.id)
    const before = storage.value
    await expect(
      b.save({ id: saved.preset.id, name: 'Old', settings: pdf }),
    ).rejects.toMatchObject({ code: 'preset-not-found' })
    await expect(b.remove(saved.preset.id)).rejects.toMatchObject({
      code: 'preset-not-found',
    })
    expect(storage.value).toBe(before)
    await expect(b.save({ name: 'New', settings: pdf })).resolves.toMatchObject(
      { persisted: true },
    )
  })

  it.each([
    '{',
    JSON.stringify({ version: 2, presets: [] }),
    JSON.stringify({
      version: 1,
      presets: [{ id: 'a', name: 'Broken', settings: { kind: 'video' } }],
    }),
    ' '.repeat(MAX_EXPORT_PRESET_LIBRARY_BYTES + 1),
    JSON.stringify({
      version: 1,
      presets: Array.from({ length: 51 }, (_, id) => ({
        id: `p-${id}`,
        name: `P${id}`,
        settings: image,
      })),
    }),
    JSON.stringify({
      version: 1,
      presets: [
        { id: 'a', name: 'A', settings: image },
        { id: 'a', name: 'B', settings: image },
      ],
    }),
    JSON.stringify({
      version: 1,
      presets: [
        { id: 'a', name: 'A', settings: image },
        { id: 'b', name: 'a', settings: image },
      ],
    }),
  ])(
    'leaves invalid or unsupported stored data untouched and keeps a session library',
    async (source) => {
      const storage = new MemoryStorage()
      storage.value = source
      const repo = repository(storage)
      expect(await repo.list()).toEqual({ presets: [], persisted: false })
      const saved = await repo.save({ name: 'Temporary', settings: image })
      expect(saved.persisted).toBe(false)
      expect((await repo.list()).presets).toEqual([saved.preset])
      expect(storage.value).toBe(source)
      expect(storage.writes).toBe(0)
    },
  )

  it('retains a session mirror after quota failure without changing stored data', async () => {
    const storage = new MemoryStorage()
    const repo = repository(storage)
    const first = await repo.save({ name: 'Saved', settings: image })
    const oldValue = storage.value
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const second = await repo.save({ name: 'Temporary', settings: pdf })
    expect(second.persisted).toBe(false)
    expect(storage.value).toBe(oldValue)
    expect((await repo.list()).presets).toEqual([first.preset, second.preset])
    expect((await repo.remove(first.preset.id)).persisted).toBe(false)
    expect((await repo.list()).presets).toEqual([second.preset])
    expect((await repository(storage).list()).presets).toEqual([first.preset])
  })

  it('keeps the latest known values if later reads become blocked', async () => {
    const storage = new MemoryStorage()
    const repo = repository(storage)
    const saved = await repo.save({ name: 'Known', settings: image })
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(await repo.list()).toEqual({
      presets: [saved.preset],
      persisted: false,
    })
    await expect(
      repo.save({ name: 'Session', settings: image }),
    ).resolves.toMatchObject({ persisted: false })
  })

  it('supports missing storage and denied locks without unlocked persistent writes', async () => {
    const memoryOnly = repository(null)
    expect(
      (await memoryOnly.save({ name: 'Memory', settings: image })).persisted,
    ).toBe(false)
    const storage = new MemoryStorage()
    const lockManager: BrowserLockManagerLike = {
      request: () => Promise.reject(new Error('denied')),
    }
    const repo = repository(storage, 'denied', lockManager)
    const saved = await repo.save({ name: 'Memory', settings: image })
    expect(saved.persisted).toBe(false)
    expect(storage.writes).toBe(0)
    expect((await repo.list()).presets).toEqual([saved.preset])
  })

  it('resolves the default storage safely when its getter throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage',
    )
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    try {
      const repo = new LocalExportPresetRepository({ lockManager: null })
      expect(
        (await repo.save({ name: 'Session', settings: image })).persisted,
      ).toBe(false)
    } finally {
      if (descriptor)
        Object.defineProperty(globalThis, 'localStorage', descriptor)
    }
  })

  it('reuses one library instance across modal lifetimes', () => {
    expect(getExportPresetRepository()).toBe(getExportPresetRepository())
  })
})
