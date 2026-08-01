export const CHART_SCHEMA_VERSION = 1 as const
export const MAX_CHART_LABELS = 1_000
export const MAX_CHART_SERIES = 20
export const MAX_CHART_POINTS = 10_000

export type ChartType = 'bar' | 'horizontal-bar' | 'line' | 'pie' | 'doughnut'

export interface ChartSeries {
  id: string
  name: string
  values: Array<number | null>
  color?: string
}

export interface ChartData {
  labels: string[]
  series: ChartSeries[]
}

export interface ChartStyle {
  background: string
  foreground: string
  gridColor: string
  showGrid: boolean
  showLegend: boolean
  showValues: boolean
  doughnutRatio: number
}

export interface ChartModel {
  schemaVersion: typeof CHART_SCHEMA_VERSION
  type: ChartType
  title: string
  data: ChartData
  style: ChartStyle
}

const HEX_COLOR = /^#[0-9a-f]{6}$/iu
const CHART_TYPES: readonly ChartType[] = [
  'bar',
  'horizontal-bar',
  'line',
  'pie',
  'doughnut',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`)
}

const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 0x1f || code === 0x7f
  })

const text = (
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = false,
): string => {
  if (typeof value !== 'string') return fail(path, 'must be a string')
  const normalized = value.trim()
  if (
    (!allowEmpty && normalized.length === 0) ||
    normalized.length > maximum ||
    hasControlCharacters(normalized)
  ) {
    return fail(path, `must contain at most ${maximum} safe characters`)
  }
  return normalized
}

const color = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    return fail(path, 'must be a six-digit hex color')
  }
  return value.toLowerCase()
}

const parseData = (value: unknown): ChartData => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.labels) ||
    !Array.isArray(value.series)
  ) {
    return fail('$.data', 'must contain labels and series arrays')
  }
  if (value.labels.length === 0 || value.labels.length > MAX_CHART_LABELS) {
    return fail('$.data.labels', `must contain 1 to ${MAX_CHART_LABELS} labels`)
  }
  if (value.series.length === 0 || value.series.length > MAX_CHART_SERIES) {
    return fail('$.data.series', `must contain 1 to ${MAX_CHART_SERIES} series`)
  }
  if (value.labels.length * value.series.length > MAX_CHART_POINTS) {
    return fail('$.data', `must contain at most ${MAX_CHART_POINTS} points`)
  }
  const labels = value.labels.map((label, index) =>
    text(label, `$.data.labels[${index}]`, 200, true),
  )
  const ids = new Set<string>()
  const series = value.series.map((source, seriesIndex): ChartSeries => {
    const path = `$.data.series[${seriesIndex}]`
    if (!isRecord(source) || !Array.isArray(source.values)) {
      return fail(path, 'must contain a values array')
    }
    const id = text(source.id, `${path}.id`, 80)
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(id) || ids.has(id)) {
      return fail(`${path}.id`, 'must be a unique lowercase slug')
    }
    ids.add(id)
    if (source.values.length !== labels.length) {
      return fail(`${path}.values`, 'must match the label count')
    }
    const values = source.values.map((point, pointIndex) => {
      if (point === null) return null
      if (
        typeof point !== 'number' ||
        !Number.isFinite(point) ||
        Math.abs(point) > 1e15
      ) {
        return fail(
          `${path}.values[${pointIndex}]`,
          'must be null or a bounded finite number',
        )
      }
      return point
    })
    return {
      id,
      name: text(source.name, `${path}.name`, 120),
      values,
      ...(source.color === undefined
        ? {}
        : { color: color(source.color, `${path}.color`) }),
    }
  })
  return { labels, series }
}

export function parseChartModel(value: unknown): ChartModel {
  if (!isRecord(value)) return fail('$', 'must be an object')
  if (value.schemaVersion !== CHART_SCHEMA_VERSION) {
    return fail('$.schemaVersion', 'is unsupported')
  }
  if (!CHART_TYPES.includes(value.type as ChartType)) {
    return fail('$.type', `must be one of: ${CHART_TYPES.join(', ')}`)
  }
  if (!isRecord(value.style)) return fail('$.style', 'must be an object')
  for (const field of ['showGrid', 'showLegend', 'showValues'] as const) {
    if (typeof value.style[field] !== 'boolean') {
      return fail(`$.style.${field}`, 'must be a boolean')
    }
  }
  if (
    typeof value.style.doughnutRatio !== 'number' ||
    !Number.isFinite(value.style.doughnutRatio) ||
    value.style.doughnutRatio < 0.1 ||
    value.style.doughnutRatio > 0.9
  ) {
    return fail('$.style.doughnutRatio', 'must be between 0.1 and 0.9')
  }
  const showGrid = value.style.showGrid as boolean
  const showLegend = value.style.showLegend as boolean
  const showValues = value.style.showValues as boolean
  return {
    schemaVersion: CHART_SCHEMA_VERSION,
    type: value.type as ChartType,
    title: text(value.title ?? '', '$.title', 200, true),
    data: parseData(value.data),
    style: {
      background: color(value.style.background, '$.style.background'),
      foreground: color(value.style.foreground, '$.style.foreground'),
      gridColor: color(value.style.gridColor, '$.style.gridColor'),
      showGrid,
      showLegend,
      showValues,
      doughnutRatio: value.style.doughnutRatio,
    },
  }
}

export function createChartModel(
  type: ChartType,
  data: ChartData,
  options: {
    title?: string
    style?: Partial<ChartStyle>
  } = {},
): ChartModel {
  return parseChartModel({
    schemaVersion: CHART_SCHEMA_VERSION,
    type,
    title: options.title ?? '',
    data,
    style: {
      background: '#ffffff',
      foreground: '#111827',
      gridColor: '#d1d5db',
      showGrid: true,
      showLegend: data.series.length > 1,
      showValues: false,
      doughnutRatio: 0.58,
      ...options.style,
    },
  })
}

export const setChartType = (chart: ChartModel, type: ChartType): ChartModel =>
  parseChartModel({ ...chart, type })

export const updateChartData = (
  chart: ChartModel,
  data: ChartData,
): ChartModel => parseChartModel({ ...chart, data })
