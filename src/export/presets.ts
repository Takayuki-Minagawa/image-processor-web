export const EXPORT_PRESET_SCHEMA_VERSION = 1 as const
export const MAX_EXPORT_PRESETS = 50
export const MAX_EXPORT_PRESET_NAME_LENGTH = 80
export const MAX_EXPORT_PRESET_ID_LENGTH = 100
export const MAX_EXPORT_PRESET_LIBRARY_BYTES = 32 * 1024

export interface ImagePresetSettings {
  kind: 'image'
  format: 'png' | 'jpeg' | 'webp' | 'svg'
  quality: number
  multiplier: number
}

export interface PdfPresetSettings {
  kind: 'pdf'
  dpi: number
  bleedMm: number
  cropMarks: boolean
  pdfCompression: 'lossless' | 'jpeg'
  jpegQuality: number
}

export type ExportPresetSettings = ImagePresetSettings | PdfPresetSettings

export interface ExportPreset {
  id: string
  name: string
  settings: ExportPresetSettings
}

export type ExportPresetErrorCode =
  | 'invalid-settings'
  | 'invalid-name'
  | 'invalid-preset'
  | 'duplicate-name'
  | 'preset-limit'
  | 'preset-not-found'

export class ExportPresetError extends Error {
  readonly code: ExportPresetErrorCode

  constructor(code: ExportPresetErrorCode, message: string) {
    super(message)
    this.name = 'ExportPresetError'
    this.code = code
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max

const invalidSettings = (): never => {
  throw new ExportPresetError(
    'invalid-settings',
    'Invalid export preset settings.',
  )
}

/** Construct a fresh allowlisted value; document selection and output data never enter a preset. */
export const validateExportPresetSettings = (
  value: unknown,
): ExportPresetSettings => {
  if (!isRecord(value)) return invalidSettings()
  if (value.kind === 'image') {
    if (
      !['png', 'jpeg', 'webp', 'svg'].includes(String(value.format)) ||
      typeof value.format !== 'string' ||
      !inRange(value.quality, 0.1, 1) ||
      typeof value.multiplier !== 'number' ||
      ![0.5, 1, 2].includes(value.multiplier)
    )
      return invalidSettings()
    return {
      kind: 'image',
      format: value.format as ImagePresetSettings['format'],
      quality: value.quality,
      multiplier: value.multiplier,
    }
  }
  if (value.kind === 'pdf') {
    if (
      !inRange(value.dpi, 72, 600) ||
      !inRange(value.bleedMm, 0, 20) ||
      typeof value.cropMarks !== 'boolean' ||
      (value.pdfCompression !== 'lossless' &&
        value.pdfCompression !== 'jpeg') ||
      !inRange(value.jpegQuality, 0.1, 1)
    )
      return invalidSettings()
    return {
      kind: 'pdf',
      dpi: value.dpi,
      bleedMm: value.bleedMm,
      cropMarks: value.cropMarks,
      pdfCompression: value.pdfCompression,
      jpegQuality: value.jpegQuality,
    }
  }
  return invalidSettings()
}

export const validateExportPresetName = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new ExportPresetError('invalid-name', 'A preset needs a name.')
  }
  const name = value.trim()
  if (!name || name.length > MAX_EXPORT_PRESET_NAME_LENGTH) {
    throw new ExportPresetError(
      'invalid-name',
      'Preset names must contain 1–80 characters.',
    )
  }
  return name
}

export const validateExportPresetId = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > MAX_EXPORT_PRESET_ID_LENGTH ||
    !/^[a-z\d_-]+$/iu.test(value)
  ) {
    throw new ExportPresetError('invalid-preset', 'Invalid preset identifier.')
  }
  return value
}

export const validateExportPreset = (value: unknown): ExportPreset => {
  if (!isRecord(value)) {
    throw new ExportPresetError('invalid-preset', 'A preset must be an object.')
  }
  return {
    id: validateExportPresetId(value.id),
    name: validateExportPresetName(value.name),
    settings: validateExportPresetSettings(value.settings),
  }
}
