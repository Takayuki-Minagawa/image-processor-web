import { describe, expect, it } from 'vitest'
import { createMacro } from './macros'
import {
  DEFAULT_MACRO_STORAGE_KEY,
  LocalMacroRepository,
  type KeyValueStorage,
} from './macroRepository'

class MemoryStorage implements KeyValueStorage {
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

const macro = (id: string, updatedAt: string) =>
  createMacro({
    id,
    name: id,
    appVersion: '0.2.0',
    createdAt: updatedAt,
    updatedAt,
    commands: [{ type: 'addWatermark', text: id }],
  })

describe('LocalMacroRepository', () => {
  it('saves, replaces, orders, gets, removes, and clears named macros', () => {
    const storage = new MemoryStorage()
    const repository = new LocalMacroRepository(storage)
    repository.save(macro('older', '2026-07-30T00:00:00.000Z'))
    repository.save(macro('newer', '2026-07-31T00:00:00.000Z'))
    repository.save(macro('older', '2026-08-01T00:00:00.000Z'))

    expect(repository.list().map(({ macro: item }) => item.id)).toEqual([
      'older',
      'newer',
    ])
    expect(repository.get('newer')?.macro.name).toBe('newer')
    expect(repository.remove('missing')).toBe(false)
    expect(repository.remove('newer')).toBe(true)
    expect(repository.get('newer')).toBeNull()
    repository.clear()
    expect(storage.getItem(DEFAULT_MACRO_STORAGE_KEY)).toBeNull()
  })

  it('isolates a corrupt library or corrupt individual entry', () => {
    const storage = new MemoryStorage()
    const repository = new LocalMacroRepository(storage)
    storage.setItem(DEFAULT_MACRO_STORAGE_KEY, '{broken')
    expect(repository.list()).toEqual([])

    storage.setItem(
      DEFAULT_MACRO_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        macros: ['{broken', JSON.stringify(macro('safe', '2026-07-31'))],
      }),
    )
    expect(repository.list().map(({ macro: item }) => item.id)).toEqual([
      'safe',
    ])
  })
})
