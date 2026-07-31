import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_LOCALE,
  DEFAULT_APP_THEME,
  loadLocale,
  loadTheme,
  loadUiPreferences,
  saveLocale,
  saveTheme,
  saveUiPreferences,
  UI_PREFERENCE_STORAGE_KEYS,
  type UiPreferenceStorage,
} from './uiPreferences'

class MemoryStorage implements UiPreferenceStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

class ThrowingStorage implements UiPreferenceStorage {
  getItem(): string | null {
    throw new DOMException('Storage is unavailable', 'SecurityError')
  }

  setItem(): void {
    throw new DOMException('Storage is unavailable', 'SecurityError')
  }
}

describe('UI preferences', () => {
  it('uses Japanese and dark mode as defaults', () => {
    const storage = new MemoryStorage()

    expect(loadUiPreferences(storage)).toEqual({
      locale: DEFAULT_APP_LOCALE,
      theme: DEFAULT_APP_THEME,
    })
  })

  it('loads only supported saved values', () => {
    const storage = new MemoryStorage()
    storage.setItem(UI_PREFERENCE_STORAGE_KEYS.locale, 'en')
    storage.setItem(UI_PREFERENCE_STORAGE_KEYS.theme, 'light')

    expect(loadLocale(storage)).toBe('en')
    expect(loadTheme(storage)).toBe('light')

    storage.setItem(UI_PREFERENCE_STORAGE_KEYS.locale, 'fr')
    storage.setItem(UI_PREFERENCE_STORAGE_KEYS.theme, 'midnight')

    expect(loadLocale(storage)).toBe(DEFAULT_APP_LOCALE)
    expect(loadTheme(storage)).toBe(DEFAULT_APP_THEME)
  })

  it('writes the documented localStorage keys', () => {
    const storage = new MemoryStorage()

    expect(saveLocale('en', storage)).toBe(true)
    expect(saveTheme('light', storage)).toBe(true)
    expect(storage.values).toEqual(
      new Map([
        [UI_PREFERENCE_STORAGE_KEYS.locale, 'en'],
        [UI_PREFERENCE_STORAGE_KEYS.theme, 'light'],
      ]),
    )
  })

  it('does not throw when storage is unavailable or corrupt', () => {
    const storage = new ThrowingStorage()

    expect(loadLocale(storage)).toBe(DEFAULT_APP_LOCALE)
    expect(loadTheme(storage)).toBe(DEFAULT_APP_THEME)
    expect(saveLocale('en', storage)).toBe(false)
    expect(saveTheme('light', storage)).toBe(false)
    expect(saveUiPreferences({ locale: 'en', theme: 'light' }, storage)).toBe(
      false,
    )
  })
})
