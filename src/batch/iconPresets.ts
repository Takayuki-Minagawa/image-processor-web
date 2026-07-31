import { imageDimensionsAreSafe } from '../lib/imageSafety'
import type { KeyValueStorage } from '../automation/macroRepository'
import { stripControlCharacters } from './safety'

export const ICON_PRESET_STORAGE_KEY = 'image-processor-web:icon-presets:v1'
export const MAX_USER_ICON_PRESETS = 64
export const MAX_ICON_PRESET_SOURCE_LENGTH = 64_000

export interface IconExportPreset {
  id: string
  label: string
  width: number
  height: number
  fileName: string
  fit: 'contain' | 'cover' | 'stretch'
  background: string
  builtIn?: boolean
}

const defaults = [
  ['favicon-16', 'Favicon 16', 16, 16, 'favicon-16.png', 'contain'],
  ['favicon-32', 'Favicon 32', 32, 32, 'favicon-32.png', 'contain'],
  ['favicon-48', 'Favicon 48', 48, 48, 'favicon-48.png', 'contain'],
  ['pwa-192', 'PWA 192', 192, 192, 'pwa-192.png', 'contain'],
  ['pwa-512', 'PWA 512', 512, 512, 'pwa-512.png', 'contain'],
  [
    'apple-touch-180',
    'Apple Touch 180',
    180,
    180,
    'apple-touch-icon.png',
    'contain',
  ],
  ['ogp-1200x630', 'OGP 1200 × 630', 1200, 630, 'ogp.png', 'contain'],
] as const

export const DEFAULT_ICON_PRESETS: readonly IconExportPreset[] = Object.freeze(
  defaults.map(([id, label, width, height, fileName, fit]) =>
    Object.freeze({
      id,
      label,
      width,
      height,
      fileName,
      fit,
      background: 'transparent',
      builtIn: true,
    }),
  ),
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const safeFileName = (value: unknown): value is string =>
  typeof value === 'string' &&
  stripControlCharacters(value) === value &&
  value.length > 4 &&
  value.length <= 160 &&
  /^[^<>:"/\\|?*]+\.png$/i.test(value)

const safeColor = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 64 &&
  (/^#[0-9a-f]{3,8}$/i.test(value) ||
    /^(?:transparent|black|white)$/i.test(value) ||
    /^rgba?\([\d\s.,%+-]+\)$/i.test(value))

export const validateIconPreset = (
  value: unknown,
  options: { builtIn?: boolean } = {},
): IconExportPreset => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !/^[a-z][a-z0-9_-]{0,63}$/i.test(value.id) ||
    typeof value.label !== 'string' ||
    value.label.trim().length === 0 ||
    value.label.length > 100 ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    !imageDimensionsAreSafe({
      width: value.width as number,
      height: value.height as number,
    }) ||
    !safeFileName(value.fileName) ||
    (value.fit !== 'contain' &&
      value.fit !== 'cover' &&
      value.fit !== 'stretch') ||
    !safeColor(value.background)
  ) {
    throw new TypeError('The icon export preset is invalid.')
  }
  return {
    id: value.id,
    label: value.label.trim(),
    width: value.width as number,
    height: value.height as number,
    fileName: value.fileName,
    fit: value.fit,
    background: value.background,
    ...(options.builtIn ? { builtIn: true } : {}),
  }
}

export const parseUserIconPresets = (
  source: string | null,
): IconExportPreset[] => {
  if (!source) {
    return []
  }
  if (source.length > MAX_ICON_PRESET_SOURCE_LENGTH) {
    throw new RangeError('The icon preset library is too large.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch (error) {
    throw new TypeError('The icon preset library is not valid JSON.', {
      cause: error,
    })
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.presets) ||
    parsed.presets.length > MAX_USER_ICON_PRESETS
  ) {
    throw new TypeError('The icon preset library is invalid.')
  }
  const ids = new Set(DEFAULT_ICON_PRESETS.map(({ id }) => id))
  const fileNames = new Set(
    DEFAULT_ICON_PRESETS.map(({ fileName }) => fileName.toLowerCase()),
  )
  return parsed.presets.map((candidate) => {
    const preset = validateIconPreset(candidate)
    if (ids.has(preset.id) || fileNames.has(preset.fileName.toLowerCase())) {
      throw new TypeError(
        `Icon preset "${preset.id}" conflicts with another preset.`,
      )
    }
    ids.add(preset.id)
    fileNames.add(preset.fileName.toLowerCase())
    return preset
  })
}

export const serializeUserIconPresets = (
  presets: readonly IconExportPreset[],
): string => {
  if (presets.length > MAX_USER_ICON_PRESETS) {
    throw new RangeError(
      `At most ${MAX_USER_ICON_PRESETS} presets can be saved.`,
    )
  }
  const validated = parseUserIconPresets(
    JSON.stringify({ version: 1, presets }),
  )
  return JSON.stringify({ version: 1, presets: validated }, null, 2)
}

export class LocalIconPresetRepository {
  readonly #storage: KeyValueStorage
  readonly #key: string

  constructor(storage: KeyValueStorage, key: string = ICON_PRESET_STORAGE_KEY) {
    this.#storage = storage
    this.#key = key
  }

  listUser(): IconExportPreset[] {
    try {
      return parseUserIconPresets(this.#storage.getItem(this.#key))
    } catch {
      // A corrupt local preference must not prevent the editor from opening.
      return []
    }
  }

  listAll(): IconExportPreset[] {
    return [...DEFAULT_ICON_PRESETS, ...this.listUser()]
  }

  saveUser(presets: readonly IconExportPreset[]): void {
    this.#storage.setItem(this.#key, serializeUserIconPresets(presets))
  }

  clearUser(): void {
    this.#storage.removeItem(this.#key)
  }
}
