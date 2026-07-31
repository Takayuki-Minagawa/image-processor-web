import { FilterValidationError, validateFilterOperation } from './registry'
import { cloneFilterOperation, type FilterOperation } from './types'

export const FILTER_PRESET_SCHEMA_VERSION = 1 as const
export const MAX_FILTERS_PER_PRESET = 64

export interface FilterPreset {
  schemaVersion: typeof FILTER_PRESET_SCHEMA_VERSION
  id: string
  name: string
  description?: string
  filters: FilterOperation[]
}

export interface FilterPresetWarning {
  index: number
  message: string
}

export interface FilterPresetValidationResult {
  preset: FilterPreset
  warnings: FilterPresetWarning[]
}

export class FilterPresetError extends Error {
  readonly code:
    'invalid-json' | 'invalid-preset' | 'unsupported-version' | 'preset-limit'

  constructor(
    code: FilterPresetError['code'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'FilterPresetError'
    this.code = code
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireText = (
  value: unknown,
  field: string,
  maximumLength: number,
): string => {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maximumLength
  ) {
    throw new FilterPresetError(
      'invalid-preset',
      `${field} must be a non-empty string no longer than ${maximumLength} characters.`,
    )
  }
  return value.trim()
}

export const validateFilterPreset = (
  value: unknown,
): FilterPresetValidationResult => {
  if (!isRecord(value)) {
    throw new FilterPresetError(
      'invalid-preset',
      'A filter preset must be an object.',
    )
  }
  if (value.schemaVersion !== FILTER_PRESET_SCHEMA_VERSION) {
    throw new FilterPresetError(
      'unsupported-version',
      `Filter preset schema version ${String(value.schemaVersion)} is not supported.`,
    )
  }
  if (!Array.isArray(value.filters)) {
    throw new FilterPresetError('invalid-preset', 'filters must be an array.')
  }
  if (value.filters.length > MAX_FILTERS_PER_PRESET) {
    throw new FilterPresetError(
      'preset-limit',
      `A preset may contain at most ${MAX_FILTERS_PER_PRESET} filters.`,
    )
  }

  const warnings: FilterPresetWarning[] = []
  const filters = value.filters.flatMap((filter, index) => {
    try {
      return [validateFilterOperation(filter, `filters[${index}]`)]
    } catch (error) {
      if (
        error instanceof FilterValidationError &&
        error.code === 'unknown-filter'
      ) {
        warnings.push({ index, message: error.message })
        return []
      }
      throw new FilterPresetError(
        'invalid-preset',
        error instanceof Error
          ? error.message
          : `filters[${index}] is invalid.`,
        { cause: error },
      )
    }
  })

  let description: string | undefined
  if (value.description !== undefined) {
    description = requireText(value.description, 'description', 500)
  }

  return {
    preset: {
      schemaVersion: FILTER_PRESET_SCHEMA_VERSION,
      id: requireText(value.id, 'id', 100),
      name: requireText(value.name, 'name', 200),
      ...(description === undefined ? {} : { description }),
      filters,
    },
    warnings,
  }
}

export const createFilterPreset = (
  input: Omit<FilterPreset, 'schemaVersion'>,
): FilterPreset =>
  validateFilterPreset({
    ...input,
    schemaVersion: FILTER_PRESET_SCHEMA_VERSION,
    filters: input.filters.map(cloneFilterOperation),
  }).preset

export const serializeFilterPreset = (
  preset: FilterPreset,
  space: number | string = 2,
): string => JSON.stringify(validateFilterPreset(preset).preset, null, space)

export const parseFilterPreset = (
  source: string,
): FilterPresetValidationResult => {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch (error) {
    throw new FilterPresetError(
      'invalid-json',
      'The filter preset is not valid JSON.',
      { cause: error },
    )
  }
  return validateFilterPreset(value)
}

export const BUILT_IN_FILTER_PRESETS: readonly FilterPreset[] = [
  createFilterPreset({
    id: 'warm-film',
    name: 'Warm Film',
    filters: [
      {
        id: 'white-balance',
        params: { temperature: 0.25, tint: 0.03 },
      },
      { id: 'sepia', params: { amount: 0.18 } },
      {
        id: 'vignette',
        params: {
          amount: 0.3,
          midpoint: 0.5,
          softness: 0.65,
          color: { r: 8, g: 4, b: 2 },
        },
      },
    ],
  }),
  createFilterPreset({
    id: 'ink-duotone',
    name: 'Ink Duotone',
    filters: [
      {
        id: 'duotone',
        params: {
          shadows: { r: 16, g: 20, b: 48 },
          highlights: { r: 250, g: 194, b: 98 },
        },
      },
    ],
  }),
]
