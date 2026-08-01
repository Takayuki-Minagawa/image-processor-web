export const TABLE_SCHEMA_VERSION = 1 as const
export const MAX_TABLE_ROWS = 500
export const MAX_TABLE_COLUMNS = 100
export const MAX_TABLE_CELLS = 20_000

export interface TableBorderStyle {
  color: string
  width: number
  style: 'solid' | 'dashed' | 'dotted' | 'none'
}

export interface TableCell {
  text: string
  background: string
  color: string
  horizontalAlign: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  fontWeight: number
}

export interface TableColumn {
  id: string
  width: number
}

export interface TableRow {
  id: string
  height: number
  cells: TableCell[]
}

export interface TableModel {
  schemaVersion: typeof TABLE_SCHEMA_VERSION
  columns: TableColumn[]
  rows: TableRow[]
  border: TableBorderStyle
}

const HEX_COLOR = /^#[0-9a-f]{6}$/iu

const defaultCell = (): TableCell => ({
  text: '',
  background: '#ffffff',
  color: '#111111',
  horizontalAlign: 'left',
  verticalAlign: 'middle',
  fontWeight: 400,
})

const assertCount = (rows: number, columns: number): void => {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(columns) ||
    rows < 1 ||
    columns < 1 ||
    rows > MAX_TABLE_ROWS ||
    columns > MAX_TABLE_COLUMNS ||
    rows * columns > MAX_TABLE_CELLS
  ) {
    throw new RangeError(
      `Table dimensions must fit ${MAX_TABLE_ROWS} rows, ${MAX_TABLE_COLUMNS} columns, and ${MAX_TABLE_CELLS} cells.`,
    )
  }
}

export function createTableModel(rows: number, columns: number): TableModel {
  assertCount(rows, columns)
  return {
    schemaVersion: TABLE_SCHEMA_VERSION,
    columns: Array.from({ length: columns }, (_, index) => ({
      id: `column-${index + 1}`,
      width: 160,
    })),
    rows: Array.from({ length: rows }, (_, rowIndex) => ({
      id: `row-${rowIndex + 1}`,
      height: 48,
      cells: Array.from({ length: columns }, defaultCell),
    })),
    border: { color: '#d1d5db', width: 1, style: 'solid' },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`)
}

const slug = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(value)) {
    return fail(path, 'must be a lowercase slug')
  }
  return value
}

const color = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    return fail(path, 'must be a six-digit hex color')
  }
  return value.toLowerCase()
}

const finite = (
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
    return fail(path, `must be between ${minimum} and ${maximum}`)
  }
  return value
}

const parseCell = (value: unknown, path: string): TableCell => {
  if (!isRecord(value)) return fail(path, 'must be an object')
  if (typeof value.text !== 'string' || value.text.length > 10_000) {
    return fail(`${path}.text`, 'must contain at most 10000 characters')
  }
  if (!['left', 'center', 'right'].includes(value.horizontalAlign as string)) {
    return fail(`${path}.horizontalAlign`, 'is invalid')
  }
  if (!['top', 'middle', 'bottom'].includes(value.verticalAlign as string)) {
    return fail(`${path}.verticalAlign`, 'is invalid')
  }
  return {
    text: value.text,
    background: color(value.background, `${path}.background`),
    color: color(value.color, `${path}.color`),
    horizontalAlign: value.horizontalAlign as TableCell['horizontalAlign'],
    verticalAlign: value.verticalAlign as TableCell['verticalAlign'],
    fontWeight: finite(value.fontWeight, `${path}.fontWeight`, 1, 1_000),
  }
}

export function parseTableModel(value: unknown): TableModel {
  if (!isRecord(value)) return fail('$', 'must be an object')
  if (value.schemaVersion !== TABLE_SCHEMA_VERSION) {
    return fail('$.schemaVersion', 'is unsupported')
  }
  if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) {
    return fail('$', 'must contain columns and rows arrays')
  }
  assertCount(value.rows.length, value.columns.length)
  const columnIds = new Set<string>()
  const columns = value.columns.map((column, index): TableColumn => {
    const path = `$.columns[${index}]`
    if (!isRecord(column)) return fail(path, 'must be an object')
    const id = slug(column.id, `${path}.id`)
    if (columnIds.has(id)) return fail(`${path}.id`, 'must be unique')
    columnIds.add(id)
    return {
      id,
      width: finite(column.width, `${path}.width`, 16, 4_096),
    }
  })
  const rowIds = new Set<string>()
  const rows = value.rows.map((row, rowIndex): TableRow => {
    const path = `$.rows[${rowIndex}]`
    if (!isRecord(row) || !Array.isArray(row.cells)) {
      return fail(path, 'must contain a cells array')
    }
    if (row.cells.length !== columns.length) {
      return fail(`${path}.cells`, 'must match the column count')
    }
    const id = slug(row.id, `${path}.id`)
    if (rowIds.has(id)) return fail(`${path}.id`, 'must be unique')
    rowIds.add(id)
    return {
      id,
      height: finite(row.height, `${path}.height`, 12, 4_096),
      cells: row.cells.map((cell, columnIndex) =>
        parseCell(cell, `${path}.cells[${columnIndex}]`),
      ),
    }
  })
  if (!isRecord(value.border)) return fail('$.border', 'must be an object')
  if (
    !['solid', 'dashed', 'dotted', 'none'].includes(
      value.border.style as string,
    )
  ) {
    return fail('$.border.style', 'is invalid')
  }
  return {
    schemaVersion: TABLE_SCHEMA_VERSION,
    columns,
    rows,
    border: {
      color: color(value.border.color, '$.border.color'),
      width: finite(value.border.width, '$.border.width', 0, 100),
      style: value.border.style as TableBorderStyle['style'],
    },
  }
}

const nextId = (prefix: string, ids: readonly string[]): string => {
  const taken = new Set(ids)
  for (let index = 1; index <= Number.MAX_SAFE_INTEGER; index += 1) {
    const candidate = `${prefix}-${index}`
    if (!taken.has(candidate)) return candidate
  }
  throw new RangeError(`Could not allocate a ${prefix} id.`)
}

const rowAt = (table: TableModel, row: number): TableRow => {
  const result = table.rows[row]
  if (!result) throw new RangeError(`Row ${row} is outside the table.`)
  return result
}

const columnAt = (table: TableModel, column: number): TableColumn => {
  const result = table.columns[column]
  if (!result) throw new RangeError(`Column ${column} is outside the table.`)
  return result
}

export function updateTableCell(
  table: TableModel,
  row: number,
  column: number,
  update: Partial<TableCell>,
): TableModel {
  rowAt(table, row)
  columnAt(table, column)
  const cells = [...table.rows[row].cells]
  cells[column] = parseCell(
    { ...cells[column], ...update },
    `cell[${row},${column}]`,
  )
  const rows = [...table.rows]
  rows[row] = { ...rows[row], cells }
  return { ...table, rows }
}

export function insertTableRow(table: TableModel, index: number): TableModel {
  if (!Number.isInteger(index) || index < 0 || index > table.rows.length) {
    throw new RangeError('Row insertion index is outside the table.')
  }
  assertCount(table.rows.length + 1, table.columns.length)
  const rows = [...table.rows]
  rows.splice(index, 0, {
    id: nextId(
      'row',
      table.rows.map(({ id }) => id),
    ),
    height: 48,
    cells: Array.from({ length: table.columns.length }, defaultCell),
  })
  return { ...table, rows }
}

export function removeTableRow(table: TableModel, index: number): TableModel {
  rowAt(table, index)
  if (table.rows.length === 1)
    throw new RangeError('A table needs at least one row.')
  return { ...table, rows: table.rows.filter((_, row) => row !== index) }
}

export function insertTableColumn(
  table: TableModel,
  index: number,
): TableModel {
  if (!Number.isInteger(index) || index < 0 || index > table.columns.length) {
    throw new RangeError('Column insertion index is outside the table.')
  }
  assertCount(table.rows.length, table.columns.length + 1)
  const columns = [...table.columns]
  columns.splice(index, 0, {
    id: nextId(
      'column',
      table.columns.map(({ id }) => id),
    ),
    width: 160,
  })
  return {
    ...table,
    columns,
    rows: table.rows.map((row) => {
      const cells = [...row.cells]
      cells.splice(index, 0, defaultCell())
      return { ...row, cells }
    }),
  }
}

export function removeTableColumn(
  table: TableModel,
  index: number,
): TableModel {
  columnAt(table, index)
  if (table.columns.length === 1) {
    throw new RangeError('A table needs at least one column.')
  }
  return {
    ...table,
    columns: table.columns.filter((_, column) => column !== index),
    rows: table.rows.map((row) => ({
      ...row,
      cells: row.cells.filter((_, column) => column !== index),
    })),
  }
}

export function resizeTableRow(
  table: TableModel,
  index: number,
  height: number,
): TableModel {
  rowAt(table, index)
  const rows = [...table.rows]
  rows[index] = {
    ...rows[index],
    height: finite(height, 'height', 12, 4_096),
  }
  return { ...table, rows }
}

export function resizeTableColumn(
  table: TableModel,
  index: number,
  width: number,
): TableModel {
  columnAt(table, index)
  const columns = [...table.columns]
  columns[index] = {
    ...columns[index],
    width: finite(width, 'width', 16, 4_096),
  }
  return { ...table, columns }
}
