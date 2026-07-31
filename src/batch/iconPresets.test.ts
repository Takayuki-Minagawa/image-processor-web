import { describe, expect, it } from 'vitest'
import type { KeyValueStorage } from '../automation/macroRepository'
import {
  DEFAULT_ICON_PRESETS,
  ICON_PRESET_STORAGE_KEY,
  LocalIconPresetRepository,
  parseUserIconPresets,
  serializeUserIconPresets,
  validateIconPreset,
} from './iconPresets'

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

const custom = {
  id: 'custom-96',
  label: 'Custom 96',
  width: 96,
  height: 96,
  fileName: 'custom-96.png',
  fit: 'cover' as const,
  background: '#112233',
}

describe('icon export presets', () => {
  it('provides the required favicon, PWA, Apple Touch, and OGP dimensions', () => {
    expect(
      DEFAULT_ICON_PRESETS.map(({ width, height }) => `${width}x${height}`),
    ).toEqual([
      '16x16',
      '32x32',
      '48x48',
      '192x192',
      '512x512',
      '180x180',
      '1200x630',
    ])
    DEFAULT_ICON_PRESETS.forEach((preset) =>
      expect(validateIconPreset(preset, { builtIn: true })).toEqual(preset),
    )
  })

  it('round-trips valid user presets and persists them separately from defaults', () => {
    const source = serializeUserIconPresets([custom])
    expect(parseUserIconPresets(source)).toEqual([custom])

    const storage = new MemoryStorage()
    const repository = new LocalIconPresetRepository(storage)
    repository.saveUser([custom])
    expect(repository.listUser()).toEqual([custom])
    expect(repository.listAll()).toHaveLength(DEFAULT_ICON_PRESETS.length + 1)
    repository.clearUser()
    expect(storage.getItem(ICON_PRESET_STORAGE_KEY)).toBeNull()
  })

  it('rejects unsafe dimensions, filenames, duplicate ids/files, and built-in conflicts', () => {
    expect(() => validateIconPreset({ ...custom, width: 9_000 })).toThrow(
      /invalid/,
    )
    expect(() =>
      validateIconPreset({ ...custom, fileName: '../escape.png' }),
    ).toThrow(/invalid/)
    expect(() =>
      parseUserIconPresets(
        JSON.stringify({
          version: 1,
          presets: [custom, { ...custom, label: 'Duplicate' }],
        }),
      ),
    ).toThrow(/conflicts/)
    expect(() =>
      parseUserIconPresets(
        JSON.stringify({
          version: 1,
          presets: [{ ...custom, id: 'favicon-16' }],
        }),
      ),
    ).toThrow(/conflicts/)
  })

  it('does not silently accept corrupt JSON', () => {
    expect(() => parseUserIconPresets('{broken')).toThrow(/not valid JSON/)

    const storage = new MemoryStorage()
    storage.setItem(ICON_PRESET_STORAGE_KEY, '{broken')
    expect(new LocalIconPresetRepository(storage).listUser()).toEqual([])
  })
})
