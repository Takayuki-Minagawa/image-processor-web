import type { TableModel } from './model'

const escapeText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function tableModelToSvg(table: TableModel): string {
  const width = table.columns.reduce((total, column) => total + column.width, 0)
  const height = table.rows.reduce((total, row) => total + row.height, 0)
  const dash =
    table.border.style === 'dashed'
      ? ' stroke-dasharray="8 5"'
      : table.border.style === 'dotted'
        ? ' stroke-dasharray="2 4"'
        : ''
  const stroke = table.border.style === 'none' ? 'none' : table.border.color
  const cells: string[] = []
  let y = 0
  table.rows.forEach((row) => {
    let x = 0
    row.cells.forEach((cell, columnIndex) => {
      const column = table.columns[columnIndex]
      const textX =
        cell.horizontalAlign === 'center'
          ? x + column.width / 2
          : cell.horizontalAlign === 'right'
            ? x + column.width - 10
            : x + 10
      const anchor =
        cell.horizontalAlign === 'center'
          ? 'middle'
          : cell.horizontalAlign === 'right'
            ? 'end'
            : 'start'
      const textY =
        cell.verticalAlign === 'top'
          ? y + 18
          : cell.verticalAlign === 'bottom'
            ? y + row.height - 8
            : y + row.height / 2 + 5
      cells.push(
        `<rect x="${x}" y="${y}" width="${column.width}" height="${row.height}" fill="${cell.background}" stroke="${stroke}" stroke-width="${table.border.width}"${dash}/>` +
          `<text x="${textX}" y="${textY}" fill="${cell.color}" font-family="system-ui,sans-serif" font-size="14" font-weight="${cell.fontWeight}" text-anchor="${anchor}">${escapeText(cell.text)}</text>`,
      )
      x += column.width
    })
    y += row.height
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="table">${cells.join('')}</svg>`
}
