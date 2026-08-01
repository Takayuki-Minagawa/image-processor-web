import { describe, expect, it } from 'vitest'
import {
  chartDataToDelimitedText,
  delimitedTextToChartData,
  delimitedTextToTable,
  parseDelimitedText,
  serializeDelimitedRows,
  tableModelToDelimitedText,
} from './csv'

describe('parseDelimitedText', () => {
  it('serializes quoted values and semantic models for inline editing', () => {
    expect(
      serializeDelimitedRows([
        ['a,b', 'say "yes"'],
        ['line\nbreak', '2'],
      ]),
    ).toBe('"a,b","say ""yes"""\n"line\nbreak",2')
    const chart = delimitedTextToChartData('Month,Sales\nJan,10').data
    expect(chartDataToDelimitedText(chart)).toBe(',Sales\nJan,10')
    const table = delimitedTextToTable('Name,Value\nA,1').table
    expect(tableModelToDelimitedText(table)).toBe('Name,Value\nA,1')
    expect(
      serializeDelimitedRows([['=SUM(A1:A2)', '+cmd', '-2', '@link']]),
    ).toBe("'=SUM(A1:A2),'+cmd,'-2,'@link")
  })

  it('detects CSV/TSV and handles escaped quotes, CRLF, and quoted newlines', () => {
    const csv = parseDelimitedText(
      '\uFEFFName,Note,Value\r\n"A, Inc.","line 1\nline 2",12\r\nB,"He said ""hello""",9\r\n',
    )
    expect(csv.delimiter).toBe(',')
    expect(csv.rows).toEqual([
      ['Name', 'Note', 'Value'],
      ['A, Inc.', 'line 1\nline 2', '12'],
      ['B', 'He said "hello"', '9'],
    ])

    const tsv = parseDelimitedText('Label\tValue\nEast\t4')
    expect(tsv.delimiter).toBe('\t')
    expect(tsv.rows[1]).toEqual(['East', '4'])
  })

  it('pads ragged rows and treats formula-looking cells as inert text', () => {
    const result = parseDelimitedText('Name,Value\nA,1\n=HYPERLINK("x")')
    expect(result.rows[2]).toEqual(['=HYPERLINK("x")', ''])
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'ragged-row', row: 2 }),
    ])
  })

  it('rejects unterminated fields and configured resource limits', () => {
    expect(() => parseDelimitedText('A,"open')).toThrow(/unterminated/u)
    expect(() => parseDelimitedText('A,B\n1,2', { maxRows: 1 })).toThrow(
      /row or cell limit/u,
    )
    expect(() => parseDelimitedText('abcdef', { maxFieldLength: 3 })).toThrow(
      /field/u,
    )
  })
})

describe('CSV data conversion', () => {
  it('creates a styled table without evaluating cell contents', () => {
    const result = delimitedTextToTable('Name,Value\nNorth,12', {
      firstRowIsHeader: true,
    })
    expect(result.table.rows[0].cells[0]).toMatchObject({
      text: 'Name',
      fontWeight: 700,
      background: '#f3f4f6',
    })
    expect(result.table.rows[1].cells[1].text).toBe('12')
  })

  it('applies table and chart string limits before model construction', () => {
    expect(() => delimitedTextToTable(`A\n${'x'.repeat(10_001)}`)).toThrow(
      /10000/u,
    )
    expect(() =>
      delimitedTextToChartData(`Label,${'S'.repeat(121)}\nA,1`),
    ).toThrow(/120/u)
    const chart = delimitedTextToChartData(
      `Label,${'abcdefghij'.repeat(10)}\nA,1`,
    )
    expect(chart.data.series[0].id.length).toBeLessThanOrEqual(80)
  })

  it('maps the first column to labels and reports non-numeric chart values', () => {
    const result = delimitedTextToChartData(
      'Region,Revenue,Cost\nNorth,12,7\nSouth,no data,3',
    )
    expect(result.data).toEqual({
      labels: ['North', 'South'],
      series: [
        { id: 'revenue-1', name: 'Revenue', values: [12, null] },
        { id: 'cost-2', name: 'Cost', values: [7, 3] },
      ],
    })
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'non-numeric-value',
        row: 2,
        column: 1,
        value: 'no data',
      }),
    ])
  })
})
