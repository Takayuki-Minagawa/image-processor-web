import { describe, expect, it } from 'vitest'
import { createTableModel, updateTableCell } from './model'
import { tableModelToSvg } from './svg'

describe('tableModelToSvg', () => {
  it('renders cells as editable vector markup with escaped text', () => {
    const table = updateTableCell(createTableModel(2, 2), 0, 0, {
      text: '<Header>',
      fontWeight: 700,
    })
    const svg = tableModelToSvg(table)
    expect(svg.match(/<rect /gu)).toHaveLength(4)
    expect(svg).toContain('&lt;Header&gt;')
    expect(svg).not.toContain('<Header>')
  })
})
