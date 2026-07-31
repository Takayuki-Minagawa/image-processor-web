import { describe, expect, it } from 'vitest'
import { createFilterPreset } from './presets'
import {
  FILTER_PRESET_LIBRARY_STORAGE_KEY,
  LocalFilterPresetRepository,
  type FilterPresetStorage,
} from './presetRepository'

class MemoryStorage implements FilterPresetStorage {
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

const samplePreset = createFilterPreset({
  id: 'user-cinema',
  name: 'Cinema',
  filters: [
    {
      id: 'levels',
      params: {
        inputBlack: 12,
        inputWhite: 240,
        gamma: 0.9,
        outputBlack: 0,
        outputWhite: 255,
      },
    },
  ],
})

describe('LocalFilterPresetRepository', () => {
  it('persists validated presets and reloads them with built-ins', () => {
    const storage = new MemoryStorage()
    const repository = new LocalFilterPresetRepository(storage)

    expect(repository.save(samplePreset)).toMatchObject({ persisted: true })
    const reloaded = new LocalFilterPresetRepository(storage)

    expect(reloaded.listUser()).toEqual([samplePreset])
    expect(reloaded.listAll().map(({ id }) => id)).toEqual(
      expect.arrayContaining(['warm-film', 'ink-duotone', 'user-cinema']),
    )
  })

  it('isolates corrupt entries while preserving valid presets', () => {
    const storage = new MemoryStorage()
    storage.values.set(
      FILTER_PRESET_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        presets: [
          { nope: true },
          samplePreset,
          { ...samplePreset, id: 'warm-film' },
        ],
      }),
    )

    expect(new LocalFilterPresetRepository(storage).listUser()).toEqual([
      samplePreset,
    ])
  })

  it('falls back to a session mirror when storage writes fail', () => {
    const storage: FilterPresetStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      },
      removeItem: () => undefined,
    }
    const repository = new LocalFilterPresetRepository(storage)

    expect(repository.save(samplePreset)).toMatchObject({ persisted: false })
    expect(repository.isPersistent()).toBe(false)
    expect(repository.listUser()).toEqual([samplePreset])
  })

  it('falls back safely when localStorage access is blocked or corrupt', () => {
    const blocked: FilterPresetStorage = {
      getItem: () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    }
    const repository = new LocalFilterPresetRepository(blocked)

    expect(repository.listUser()).toEqual([])
    expect(repository.isPersistent()).toBe(false)
    expect(repository.save(samplePreset).persisted).toBe(false)
    expect(repository.listUser()).toEqual([samplePreset])
  })
})
