import type { ChartVectorPrimitive, ChartVectorScene } from './layout'

const escapeText = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const points = (value: readonly { x: number; y: number }[]): string =>
  value.map(({ x, y }) => `${x},${y}`).join(' ')

const primitiveSvg = (primitive: ChartVectorPrimitive): string => {
  const data = `data-vector-id="${escapeText(primitive.id)}"`
  if (primitive.type === 'rect') {
    return `<rect ${data} x="${primitive.x}" y="${primitive.y}" width="${primitive.width}" height="${primitive.height}" fill="${primitive.fill}"${primitive.stroke ? ` stroke="${primitive.stroke}"` : ''}/>`
  }
  if (primitive.type === 'line') {
    return `<line ${data} x1="${primitive.x1}" y1="${primitive.y1}" x2="${primitive.x2}" y2="${primitive.y2}" stroke="${primitive.stroke}" stroke-width="${primitive.strokeWidth}"/>`
  }
  if (primitive.type === 'polyline') {
    return `<polyline ${data} points="${points(primitive.points)}" fill="none" stroke="${primitive.stroke}" stroke-width="${primitive.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (primitive.type === 'path') {
    return `<path ${data} d="${escapeText(primitive.d)}" fill="${primitive.fill}"${primitive.stroke ? ` stroke="${primitive.stroke}"` : ''}/>`
  }
  if (primitive.type === 'circle') {
    return `<circle ${data} cx="${primitive.cx}" cy="${primitive.cy}" r="${primitive.radius}" fill="${primitive.fill}"/>`
  }
  const anchor =
    primitive.align === 'center'
      ? 'middle'
      : primitive.align === 'right'
        ? 'end'
        : 'start'
  return `<text ${data} x="${primitive.x}" y="${primitive.y}" fill="${primitive.fill}" font-family="system-ui,sans-serif" font-size="${primitive.fontSize}" text-anchor="${anchor}">${escapeText(primitive.text)}</text>`
}

export const chartVectorSceneToSvg = (scene: ChartVectorScene): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img">${scene.primitives.map(primitiveSvg).join('')}</svg>`
