import { describe, expect, it } from 'vitest'
import {
  MAX_TABLE_CELLS,
  createTableModel,
  insertTableColumn,
  insertTableRow,
  parseTableModel,
  removeTableColumn,
  removeTableRow,
  resizeTableColumn,
  resizeTableRow,
  updateTableCell,
} from './model'

describe('table model', () => {
  it('creates, edits, and resizes a renderer-neutral table immutably', () => {
    const original = createTableModel(2, 2)
    const edited = updateTableCell(original, 0, 1, {
      text: 'Revenue',
      background: '#112233',
      horizontalAlign: 'right',
      fontWeight: 700,
    })
    const resized = resizeTableColumn(resizeTableRow(edited, 0, 64), 1, 240)

    expect(original.rows[0].cells[1].text).toBe('')
    expect(resized.rows[0]).toMatchObject({ height: 64 })
    expect(resized.rows[0].cells[1]).toMatchObject({
      text: 'Revenue',
      background: '#112233',
      horizontalAlign: 'right',
      fontWeight: 700,
    })
    expect(resized.columns[1].width).toBe(240)
    expect(parseTableModel(resized)).toEqual(resized)
  })

  it('inserts and removes rows and columns while preserving rectangular data', () => {
    const original = updateTableCell(createTableModel(2, 2), 1, 1, {
      text: 'kept',
    })
    const expanded = insertTableColumn(insertTableRow(original, 1), 1)

    expect(expanded.rows).toHaveLength(3)
    expect(expanded.columns).toHaveLength(3)
    expect(expanded.rows.every(({ cells }) => cells.length === 3)).toBe(true)
    expect(expanded.rows[2].cells[2].text).toBe('kept')
    expect(new Set(expanded.rows.map(({ id }) => id)).size).toBe(3)
    expect(new Set(expanded.columns.map(({ id }) => id)).size).toBe(3)

    const restored = removeTableColumn(removeTableRow(expanded, 1), 1)
    expect(restored.rows[1].cells[1].text).toBe('kept')
  })

  it('rejects malformed rectangular data and operations beyond hard limits', () => {
    const malformed = createTableModel(2, 2) as unknown as Record<
      string,
      unknown
    >
    const rows = malformed.rows as Array<Record<string, unknown>>
    rows[0].cells = []
    expect(() => parseTableModel(malformed)).toThrow(/column count/u)

    expect(() => createTableModel(500, 100)).toThrow(
      new RegExp(String(MAX_TABLE_CELLS), 'u'),
    )
    expect(() => removeTableRow(createTableModel(1, 2), 0)).toThrow(
      /at least one row/u,
    )
    expect(() => removeTableColumn(createTableModel(2, 1), 0)).toThrow(
      /at least one column/u,
    )
  })
})
