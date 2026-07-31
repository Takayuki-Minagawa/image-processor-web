/** Supported interface languages. */
export type AppLocale = 'ja' | 'en'

/** Supported color themes. */
export type AppTheme = 'dark' | 'light'

export const DEFAULT_APP_LOCALE: AppLocale = 'ja'
export const DEFAULT_APP_THEME: AppTheme = 'dark'

/** The only browser-storage keys used for user interface preferences. */
export const UI_PREFERENCE_STORAGE_KEYS = {
  locale: 'pixelweave:locale',
  theme: 'pixelweave:theme',
} as const

/**
 * A minimal structural Storage interface, so callers can inject a safe test
 * double and the module can operate when browser storage is unavailable.
 */
export interface UiPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface UiPreferences {
  locale: AppLocale
  theme: AppTheme
}

const isAppLocale = (value: string | null): value is AppLocale =>
  value === 'ja' || value === 'en'

const isAppTheme = (value: string | null): value is AppTheme =>
  value === 'dark' || value === 'light'

/**
 * Resolves browser storage lazily. Access can itself throw in private or
 * restricted browsing contexts, so every access remains behind this guard.
 */
const defaultStorage = (): UiPreferenceStorage | null => {
  try {
    if (typeof globalThis === 'undefined') {
      return null
    }

    const storage = globalThis.localStorage
    return storage === undefined || storage === null ? null : storage
  } catch {
    return null
  }
}

const resolveStorage = (
  storage: UiPreferenceStorage | null | undefined,
): UiPreferenceStorage | null =>
  storage === undefined ? defaultStorage() : storage

const loadValue = <Value extends string>(
  key: string,
  fallback: Value,
  isValid: (value: string | null) => value is Value,
  storage?: UiPreferenceStorage | null,
): Value => {
  try {
    const value = resolveStorage(storage)?.getItem(key) ?? null
    return isValid(value) ? value : fallback
  } catch {
    return fallback
  }
}

const saveValue = (
  key: string,
  value: string,
  storage?: UiPreferenceStorage | null,
): boolean => {
  try {
    const target = resolveStorage(storage)
    if (target === null) {
      return false
    }

    target.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Loads the saved language, defaulting safely to Japanese. */
export const loadLocale = (storage?: UiPreferenceStorage | null): AppLocale =>
  loadValue(
    UI_PREFERENCE_STORAGE_KEYS.locale,
    DEFAULT_APP_LOCALE,
    isAppLocale,
    storage,
  )

/** Loads the saved theme, defaulting safely to dark mode. */
export const loadTheme = (storage?: UiPreferenceStorage | null): AppTheme =>
  loadValue(
    UI_PREFERENCE_STORAGE_KEYS.theme,
    DEFAULT_APP_THEME,
    isAppTheme,
    storage,
  )

/** Saves the language without allowing storage failures to interrupt the UI. */
export const saveLocale = (
  locale: AppLocale,
  storage?: UiPreferenceStorage | null,
): boolean => saveValue(UI_PREFERENCE_STORAGE_KEYS.locale, locale, storage)

/** Saves the theme without allowing storage failures to interrupt the UI. */
export const saveTheme = (
  theme: AppTheme,
  storage?: UiPreferenceStorage | null,
): boolean => saveValue(UI_PREFERENCE_STORAGE_KEYS.theme, theme, storage)

/** Loads both persisted UI preferences in one convenient object. */
export const loadUiPreferences = (
  storage?: UiPreferenceStorage | null,
): UiPreferences => ({
  locale: loadLocale(storage),
  theme: loadTheme(storage),
})

/**
 * Saves both UI preferences. The return value reports whether both writes
 * succeeded, while each write remains isolated and non-throwing.
 */
export const saveUiPreferences = (
  preferences: UiPreferences,
  storage?: UiPreferenceStorage | null,
): boolean => {
  const localeSaved = saveLocale(preferences.locale, storage)
  const themeSaved = saveTheme(preferences.theme, storage)
  return localeSaved && themeSaved
}
