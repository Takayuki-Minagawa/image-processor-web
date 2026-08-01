import { describe, expect, it } from 'vitest'
import { buildChartVectorScene } from './layout'
import { createChartModel } from './model'
import { chartVectorSceneToSvg } from './svg'

describe('chartVectorSceneToSvg', () => {
  it('serializes the renderer-neutral scene and escapes labels', () => {
    const chart = createChartModel('bar', {
      labels: ['<Jan>'],
      series: [{ id: 'sales', name: 'Sales & profit', values: [12] }],
    })
    const svg = chartVectorSceneToSvg(
      buildChartVectorScene(chart, { width: 640, height: 360 }),
    )
    expect(svg).toContain('<svg')
    expect(svg).toContain('&lt;Jan&gt;')
    expect(svg).not.toContain('<Jan>')
  })
})
