import {
  createIdentityCurve,
  type CurvesParameters,
  type FilterDefinition,
  type FilterId,
  type FilterOperation,
  type FilterParametersById,
  type GradientStop,
  type RgbColor,
} from './types'

export type FilterValidationErrorCode =
  'invalid-filter' | 'unknown-filter' | 'invalid-parameter'

export class FilterValidationError extends Error {
  readonly code: FilterValidationErrorCode
  readonly path: string

  constructor(code: FilterValidationErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'FilterValidationError'
    this.code = code
    this.path = path
  }
}

const identityCurves = (): CurvesParameters => ({
  master: createIdentityCurve(),
  red: createIdentityCurve(),
  green: createIdentityCurve(),
  blue: createIdentityCurve(),
})

const DEFINITIONS = [
  {
    id: 'sharpen',
    label: 'シャープ',
    category: 'built-in',
    defaults: { amount: 1 },
  },
  {
    id: 'emboss',
    label: 'エンボス',
    category: 'built-in',
    defaults: { strength: 1 },
  },
  {
    id: 'noise',
    label: 'ノイズ',
    category: 'built-in',
    defaults: { amount: 0.15, seed: 1, monochrome: false },
  },
  {
    id: 'pixelate',
    label: 'ピクセレート',
    category: 'built-in',
    defaults: { size: 8 },
  },
  {
    id: 'sepia',
    label: 'セピア',
    category: 'built-in',
    defaults: { amount: 1 },
  },
  {
    id: 'invert',
    label: '色反転',
    category: 'built-in',
    defaults: { amount: 1 },
  },
  {
    id: 'levels',
    label: 'レベル補正',
    category: 'custom',
    defaults: {
      inputBlack: 0,
      inputWhite: 255,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 255,
    },
  },
  {
    id: 'curves',
    label: 'トーンカーブ',
    category: 'custom',
    defaults: identityCurves(),
  },
  {
    id: 'white-balance',
    label: 'ホワイトバランス',
    category: 'custom',
    defaults: { temperature: 0, tint: 0 },
  },
  {
    id: 'vignette',
    label: 'ビネット',
    category: 'custom',
    defaults: {
      amount: 0.5,
      midpoint: 0.45,
      softness: 0.5,
      color: { r: 0, g: 0, b: 0 },
    },
  },
  {
    id: 'gradient-map',
    label: 'グラデーションマップ',
    category: 'custom',
    defaults: {
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0 } },
        { offset: 1, color: { r: 255, g: 255, b: 255 } },
      ],
    },
  },
  {
    id: 'duotone',
    label: 'デュオトーン',
    category: 'custom',
    defaults: {
      shadows: { r: 24, g: 18, b: 64 },
      highlights: { r: 255, g: 202, b: 108 },
    },
  },
  {
    id: 'halftone',
    label: 'ハーフトーン',
    category: 'custom',
    defaults: {
      size: 8,
      angle: 45,
      foreground: { r: 0, g: 0, b: 0 },
      background: { r: 255, g: 255, b: 255 },
    },
  },
  {
    id: 'glitch',
    label: 'グリッチ',
    category: 'custom',
    defaults: { amount: 0.35, offset: 8, scanlines: 0.2, seed: 1 },
  },
] as const satisfies readonly FilterDefinition[]

const FILTER_IDS = new Set<string>(
  DEFINITIONS.map((definition) => definition.id),
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (path: string, message: string): never => {
  throw new FilterValidationError('invalid-parameter', path, message)
}

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void => {
  const expected = new Set(keys)
  const unexpected = Object.keys(value).find((key) => !expected.has(key))
  if (unexpected) {
    fail(`${path}.${unexpected}`, 'is not a supported parameter')
  }
  const missing = keys.find((key) => !(key in value))
  if (missing) {
    fail(`${path}.${missing}`, 'is required')
  }
}

const recordAt = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    fail(path, 'must be an object')
  }
  return value as Record<string, unknown>
}

const numberAt = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(path, `must be a finite number from ${minimum} to ${maximum}`)
  }
  return value as number
}

const integerAt = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  const number = numberAt(value, path, minimum, maximum)
  if (!Number.isInteger(number)) {
    fail(path, 'must be an integer')
  }
  return number
}

const booleanAt = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') {
    fail(path, 'must be a boolean')
  }
  return value as boolean
}

const rgbAt = (value: unknown, path: string): RgbColor => {
  const record = recordAt(value, path)
  exactKeys(record, ['r', 'g', 'b'], path)
  return {
    r: integerAt(record.r, `${path}.r`, 0, 255),
    g: integerAt(record.g, `${path}.g`, 0, 255),
    b: integerAt(record.b, `${path}.b`, 0, 255),
  }
}

const curveAt = (value: unknown, path: string): number[] => {
  if (!Array.isArray(value) || value.length !== 256) {
    fail(path, 'must be an array containing exactly 256 entries')
  }
  return (value as unknown[]).map((entry, index) =>
    integerAt(entry, `${path}[${index}]`, 0, 255),
  )
}

const gradientStopsAt = (value: unknown, path: string): GradientStop[] => {
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) {
    fail(path, 'must contain from 2 to 16 stops')
  }
  const stops = (value as unknown[]).map((entry, index) => {
    const stopPath = `${path}[${index}]`
    const record = recordAt(entry, stopPath)
    exactKeys(record, ['offset', 'color'], stopPath)
    return {
      offset: numberAt(record.offset, `${stopPath}.offset`, 0, 1),
      color: rgbAt(record.color, `${stopPath}.color`),
    }
  })
  if (stops[0].offset !== 0 || stops.at(-1)?.offset !== 1) {
    fail(path, 'must start at offset 0 and end at offset 1')
  }
  stops.forEach((stop, index) => {
    if (index > 0 && stop.offset <= stops[index - 1].offset) {
      fail(`${path}[${index}].offset`, 'must be strictly increasing')
    }
  })
  return stops
}

const validateParameters = <I extends FilterId>(
  id: I,
  value: unknown,
  path: string,
): FilterParametersById[I] => {
  const record = recordAt(value, path)
  let parameters: FilterParametersById[FilterId]

  switch (id) {
    case 'sharpen':
      exactKeys(record, ['amount'], path)
      parameters = {
        amount: numberAt(record.amount, `${path}.amount`, 0, 2),
      }
      break
    case 'emboss':
      exactKeys(record, ['strength'], path)
      parameters = {
        strength: numberAt(record.strength, `${path}.strength`, 0, 4),
      }
      break
    case 'noise':
      exactKeys(record, ['amount', 'seed', 'monochrome'], path)
      parameters = {
        amount: numberAt(record.amount, `${path}.amount`, 0, 1),
        seed: integerAt(record.seed, `${path}.seed`, 0, 0xffffffff),
        monochrome: booleanAt(record.monochrome, `${path}.monochrome`),
      }
      break
    case 'pixelate':
      exactKeys(record, ['size'], path)
      parameters = {
        size: integerAt(record.size, `${path}.size`, 1, 256),
      }
      break
    case 'sepia':
    case 'invert':
      exactKeys(record, ['amount'], path)
      parameters = {
        amount: numberAt(record.amount, `${path}.amount`, 0, 1),
      }
      break
    case 'levels': {
      exactKeys(
        record,
        ['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite'],
        path,
      )
      const inputBlack = integerAt(
        record.inputBlack,
        `${path}.inputBlack`,
        0,
        254,
      )
      const inputWhite = integerAt(
        record.inputWhite,
        `${path}.inputWhite`,
        1,
        255,
      )
      const outputBlack = integerAt(
        record.outputBlack,
        `${path}.outputBlack`,
        0,
        254,
      )
      const outputWhite = integerAt(
        record.outputWhite,
        `${path}.outputWhite`,
        1,
        255,
      )
      if (inputBlack >= inputWhite) {
        fail(`${path}.inputWhite`, 'must be greater than inputBlack')
      }
      if (outputBlack >= outputWhite) {
        fail(`${path}.outputWhite`, 'must be greater than outputBlack')
      }
      parameters = {
        inputBlack,
        inputWhite,
        gamma: numberAt(record.gamma, `${path}.gamma`, 0.1, 10),
        outputBlack,
        outputWhite,
      }
      break
    }
    case 'curves':
      exactKeys(record, ['master', 'red', 'green', 'blue'], path)
      parameters = {
        master: curveAt(record.master, `${path}.master`),
        red: curveAt(record.red, `${path}.red`),
        green: curveAt(record.green, `${path}.green`),
        blue: curveAt(record.blue, `${path}.blue`),
      }
      break
    case 'white-balance':
      exactKeys(record, ['temperature', 'tint'], path)
      parameters = {
        temperature: numberAt(record.temperature, `${path}.temperature`, -1, 1),
        tint: numberAt(record.tint, `${path}.tint`, -1, 1),
      }
      break
    case 'vignette':
      exactKeys(record, ['amount', 'midpoint', 'softness', 'color'], path)
      parameters = {
        amount: numberAt(record.amount, `${path}.amount`, 0, 1),
        midpoint: numberAt(record.midpoint, `${path}.midpoint`, 0, 1),
        softness: numberAt(record.softness, `${path}.softness`, 0.01, 1),
        color: rgbAt(record.color, `${path}.color`),
      }
      break
    case 'gradient-map':
      exactKeys(record, ['stops'], path)
      parameters = {
        stops: gradientStopsAt(record.stops, `${path}.stops`),
      }
      break
    case 'duotone':
      exactKeys(record, ['shadows', 'highlights'], path)
      parameters = {
        shadows: rgbAt(record.shadows, `${path}.shadows`),
        highlights: rgbAt(record.highlights, `${path}.highlights`),
      }
      break
    case 'halftone':
      exactKeys(record, ['size', 'angle', 'foreground', 'background'], path)
      parameters = {
        size: integerAt(record.size, `${path}.size`, 2, 64),
        angle: numberAt(record.angle, `${path}.angle`, 0, 180),
        foreground: rgbAt(record.foreground, `${path}.foreground`),
        background: rgbAt(record.background, `${path}.background`),
      }
      break
    case 'glitch':
      exactKeys(record, ['amount', 'offset', 'scanlines', 'seed'], path)
      parameters = {
        amount: numberAt(record.amount, `${path}.amount`, 0, 1),
        offset: integerAt(record.offset, `${path}.offset`, 0, 256),
        scanlines: numberAt(record.scanlines, `${path}.scanlines`, 0, 1),
        seed: integerAt(record.seed, `${path}.seed`, 0, 0xffffffff),
      }
      break
  }

  return parameters as FilterParametersById[I]
}

export const listFilterDefinitions = (): readonly FilterDefinition[] =>
  DEFINITIONS

export const isFilterId = (value: unknown): value is FilterId =>
  typeof value === 'string' && FILTER_IDS.has(value)

export const getFilterDefinition = <I extends FilterId>(
  id: I,
): FilterDefinition<I> =>
  DEFINITIONS.find((definition) => definition.id === id) as FilterDefinition<I>

export const createDefaultFilterOperation = <I extends FilterId>(
  id: I,
): FilterOperation<I> => ({
  id,
  params: JSON.parse(
    JSON.stringify(getFilterDefinition(id).defaults),
  ) as FilterParametersById[I],
})

export const validateFilterOperation = (
  value: unknown,
  path = 'filter',
): FilterOperation => {
  if (!isRecord(value)) {
    throw new FilterValidationError('invalid-filter', path, 'must be an object')
  }
  exactKeys(value, ['id', 'params'], path)
  if (!isFilterId(value.id)) {
    throw new FilterValidationError(
      'unknown-filter',
      `${path}.id`,
      `unknown filter "${String(value.id)}"`,
    )
  }
  return {
    id: value.id,
    params: validateParameters(value.id, value.params, `${path}.params`),
  } as FilterOperation
}
