import {
  MAX_CHART_LABEL_LENGTH,
  MAX_CHART_LABELS,
  MAX_CHART_POINTS,
  MAX_CHART_SERIES,
  MAX_CHART_SERIES_ID_LENGTH,
  MAX_CHART_SERIES_NAME_LENGTH,
  type ChartData,
  type ChartSeries,
} from '../charts/model'
import {
  MAX_TABLE_CELL_TEXT_LENGTH,
  MAX_TABLE_CELLS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  createTableModel,
  type TableModel,
} from '../tables/model'

export type Delimiter = ',' | '\t' | ';'

export interface DelimitedTextWarning {
  code: 'ragged-row'
  row: number
  message: string
}

export interface DelimitedTextResult {
  delimiter: Delimiter
  rows: string[][]
  warnings: DelimitedTextWarning[]
}

export interface DelimitedTextOptions {
  delimiter?: Delimiter
  maxBytes?: number
  maxRows?: number
  maxColumns?: number
  maxCells?: number
  maxFieldLength?: number
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_ROWS = 2_000
const DEFAULT_MAX_COLUMNS = 200
const DEFAULT_MAX_CELLS = 100_000
const DEFAULT_MAX_FIELD_LENGTH = 100_000

const positiveInteger = (
  value: number | undefined,
  fallback: number,
): number =>
  Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : fallback

const detectDelimiter = (input: string): Delimiter => {
  const counts = new Map<Delimiter, number>([
    [',', 0],
    ['\t', 0],
    [';', 0],
  ])
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (!quoted && (character === '\n' || character === '\r')) break
    if (!quoted && counts.has(character as Delimiter)) {
      const delimiter = character as Delimiter
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1)
    }
  }
  return (
    [...counts.entries()].sort(
      (a, b) =>
        b[1] - a[1] ||
        [',', '\t', ';'].indexOf(a[0]) - [',', '\t', ';'].indexOf(b[0]),
    )[0]?.[0] ?? ','
  )
}

/**
 * Bounded RFC 4180-style parser for clipboard CSV/TSV. Values remain inert
 * strings; spreadsheet formulas are never evaluated.
 */
export function parseDelimitedText(
  source: string,
  options: DelimitedTextOptions = {},
): DelimitedTextResult {
  const input = source.startsWith('\uFEFF') ? source.slice(1) : source
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES)
  if (new TextEncoder().encode(input).byteLength > maxBytes) {
    throw new RangeError(`Delimited text exceeds the ${maxBytes} byte limit.`)
  }
  const delimiter = options.delimiter ?? detectDelimiter(input)
  const maxRows = positiveInteger(options.maxRows, DEFAULT_MAX_ROWS)
  const maxColumns = positiveInteger(options.maxColumns, DEFAULT_MAX_COLUMNS)
  const maxCells = positiveInteger(options.maxCells, DEFAULT_MAX_CELLS)
  const maxFieldLength = positiveInteger(
    options.maxFieldLength,
    DEFAULT_MAX_FIELD_LENGTH,
  )
  if (input.length === 0) return { delimiter, rows: [], warnings: [] }

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let afterQuote = false
  let endedWithNewline = false
  let cellCount = 0

  const append = (character: string): void => {
    field += character
    if (field.length > maxFieldLength) {
      throw new RangeError(`A field exceeds ${maxFieldLength} characters.`)
    }
  }
  const commitField = (): void => {
    row.push(field)
    field = ''
    afterQuote = false
    if (row.length > maxColumns) {
      throw new RangeError(`A row exceeds ${maxColumns} columns.`)
    }
  }
  const commitRow = (): void => {
    commitField()
    cellCount += row.length
    rows.push(row)
    row = []
    if (rows.length > maxRows || cellCount > maxCells) {
      throw new RangeError('Delimited text exceeds its row or cell limit.')
    }
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          append('"')
          index += 1
        } else {
          inQuotes = false
          afterQuote = true
        }
      } else {
        append(character)
      }
      endedWithNewline = false
      continue
    }

    if (afterQuote) {
      if (character === delimiter) {
        commitField()
        endedWithNewline = false
        continue
      }
      if (character === '\n' || character === '\r') {
        commitRow()
        if (character === '\r' && input[index + 1] === '\n') index += 1
        endedWithNewline = true
        continue
      }
      if (/^[ \t]$/u.test(character) && character !== delimiter) continue
      throw new TypeError(
        `Unexpected character after a quoted field at offset ${index}.`,
      )
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true
      endedWithNewline = false
    } else if (character === delimiter) {
      commitField()
      endedWithNewline = false
    } else if (character === '\n' || character === '\r') {
      commitRow()
      if (character === '\r' && input[index + 1] === '\n') index += 1
      endedWithNewline = true
    } else {
      append(character)
      endedWithNewline = false
    }
  }
  if (inQuotes)
    throw new TypeError('Delimited text contains an unterminated quote.')
  if (!endedWithNewline || row.length > 0 || field.length > 0 || afterQuote) {
    commitRow()
  }

  const maximumColumns = Math.max(...rows.map((record) => record.length))
  if (rows.length * maximumColumns > maxCells) {
    throw new RangeError(`Delimited text exceeds the ${maxCells} cell limit.`)
  }
  const warnings: DelimitedTextWarning[] = []
  rows.forEach((record, index) => {
    if (record.length === maximumColumns) return
    warnings.push({
      code: 'ragged-row',
      row: index,
      message: `Row ${index + 1} was padded from ${record.length} to ${maximumColumns} columns.`,
    })
    while (record.length < maximumColumns) record.push('')
  })
  return { delimiter, rows, warnings }
}

export const parseCsv = parseDelimitedText

const formulaLikeField = (value: string): boolean => {
  const first = value.trimStart()[0]
  return first === '=' || first === '+' || first === '-' || first === '@'
}

const escapeDelimitedField = (
  value: string,
  delimiter: Delimiter,
  protectFormulas: boolean,
): string => {
  const inert = protectFormulas && formulaLikeField(value) ? `'${value}` : value
  return inert.includes(delimiter) || /["\r\n]/u.test(inert)
    ? `"${inert.replaceAll('"', '""')}"`
    : inert
}

/** Serializes inert values for round-tripping through the CSV mini editor. */
export function serializeDelimitedRows(
  rows: readonly (readonly string[])[],
  delimiter: Delimiter = ',',
  options: { protectFormulas?: boolean } = {},
): string {
  const protectFormulas = options.protectFormulas ?? true
  return rows
    .map((row) =>
      row
        .map((value) => escapeDelimitedField(value, delimiter, protectFormulas))
        .join(delimiter),
    )
    .join('\n')
}

export const chartDataToDelimitedText = (data: ChartData): string =>
  serializeDelimitedRows(
    [
      ['', ...data.series.map(({ name }) => name)],
      ...data.labels.map((label, index) => [
        label,
        ...data.series.map(({ values }) => {
          const value = values[index]
          return value === null || value === undefined ? '' : String(value)
        }),
      ]),
    ],
    ',',
    { protectFormulas: false },
  )

export const tableModelToDelimitedText = (table: TableModel): string =>
  serializeDelimitedRows(
    table.rows.map((row) => row.cells.map(({ text }) => text)),
    ',',
    { protectFormulas: false },
  )

export interface TableImportResult {
  table: TableModel
  warnings: DelimitedTextWarning[]
}

export function delimitedTextToTable(
  source: string,
  options: DelimitedTextOptions & { firstRowIsHeader?: boolean } = {},
): TableImportResult {
  const parsed = parseDelimitedText(source, {
    ...options,
    maxRows: Math.min(options.maxRows ?? MAX_TABLE_ROWS, MAX_TABLE_ROWS),
    maxColumns: Math.min(
      options.maxColumns ?? MAX_TABLE_COLUMNS,
      MAX_TABLE_COLUMNS,
    ),
    maxCells: Math.min(options.maxCells ?? MAX_TABLE_CELLS, MAX_TABLE_CELLS),
    maxFieldLength: Math.min(
      options.maxFieldLength ?? MAX_TABLE_CELL_TEXT_LENGTH,
      MAX_TABLE_CELL_TEXT_LENGTH,
    ),
  })
  if (parsed.rows.length === 0 || parsed.rows[0].length === 0) {
    throw new TypeError('Delimited text does not contain table data.')
  }
  const table = createTableModel(parsed.rows.length, parsed.rows[0].length)
  return {
    warnings: parsed.warnings,
    table: {
      ...table,
      rows: table.rows.map((row, rowIndex) => ({
        ...row,
        cells: row.cells.map((cell, columnIndex) => ({
          ...cell,
          text: parsed.rows[rowIndex][columnIndex],
          fontWeight: options.firstRowIsHeader && rowIndex === 0 ? 700 : 400,
          background:
            options.firstRowIsHeader && rowIndex === 0 ? '#f3f4f6' : '#ffffff',
        })),
      })),
    },
  }
}

export interface ChartImportWarning {
  code: 'non-numeric-value'
  row: number
  column: number
  value: string
}

export interface ChartDataImportResult {
  data: ChartData
  warnings: Array<DelimitedTextWarning | ChartImportWarning>
}

const seriesId = (name: string, index: number): string => {
  const normalized = name
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  const suffix = `-${index + 1}`
  const bounded = normalized.slice(
    0,
    MAX_CHART_SERIES_ID_LENGTH - suffix.length,
  )
  return bounded ? `${bounded}${suffix}` : `series-${index + 1}`
}

export function delimitedTextToChartData(
  source: string,
  options: DelimitedTextOptions & { firstRowIsHeader?: boolean } = {},
): ChartDataImportResult {
  const firstRowIsHeader = options.firstRowIsHeader ?? true
  const parsed = parseDelimitedText(source, {
    ...options,
    maxRows: Math.min(
      options.maxRows ?? MAX_CHART_LABELS + (firstRowIsHeader ? 1 : 0),
      MAX_CHART_LABELS + (firstRowIsHeader ? 1 : 0),
    ),
    maxColumns: Math.min(
      options.maxColumns ?? MAX_CHART_SERIES + 1,
      MAX_CHART_SERIES + 1,
    ),
    maxCells: Math.min(
      options.maxCells ??
        MAX_CHART_POINTS + MAX_CHART_LABELS + MAX_CHART_SERIES + 1,
      MAX_CHART_POINTS + MAX_CHART_LABELS + MAX_CHART_SERIES + 1,
    ),
    maxFieldLength: Math.min(
      options.maxFieldLength ?? MAX_CHART_LABEL_LENGTH,
      MAX_CHART_LABEL_LENGTH,
    ),
  })
  const firstDataRow = firstRowIsHeader ? 1 : 0
  if (parsed.rows.length <= firstDataRow || parsed.rows[0].length < 2) {
    throw new TypeError(
      'Chart data needs a label column and at least one numeric series.',
    )
  }
  const labels = parsed.rows.slice(firstDataRow).map((row) => row[0])
  const warnings: Array<DelimitedTextWarning | ChartImportWarning> = [
    ...parsed.warnings,
  ]
  const usedIds = new Set<string>()
  const series: ChartSeries[] = []
  for (let column = 1; column < parsed.rows[0].length; column += 1) {
    const name = firstRowIsHeader
      ? parsed.rows[0][column].trim() || `Series ${column}`
      : `Series ${column}`
    if (name.length > MAX_CHART_SERIES_NAME_LENGTH) {
      throw new RangeError(
        `A chart series name exceeds ${MAX_CHART_SERIES_NAME_LENGTH} characters.`,
      )
    }
    let id = seriesId(name, column - 1)
    while (usedIds.has(id)) id = `${id}-copy`
    usedIds.add(id)
    const values = parsed.rows.slice(firstDataRow).map((row, rowIndex) => {
      const raw = row[column].trim()
      if (raw === '') return null
      const numeric = Number(raw)
      if (!Number.isFinite(numeric) || Math.abs(numeric) > 1e15) {
        warnings.push({
          code: 'non-numeric-value',
          row: rowIndex + firstDataRow,
          column,
          value: raw,
        })
        return null
      }
      return numeric
    })
    series.push({ id, name, values })
  }
  return { data: { labels, series }, warnings }
}
