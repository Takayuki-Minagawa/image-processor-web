import { describe, expect, it } from 'vitest'
import { sampleChartData } from '../test/fixtures/chartData'
import {
  createChartModel,
  parseChartModel,
  setChartType,
  updateChartData,
} from './model'

describe('chart model', () => {
  it('creates, validates, and changes chart data without renderer state', () => {
    const chart = createChartModel('bar', sampleChartData(), {
      title: 'Quarterly result',
    })
    expect(parseChartModel(chart)).toEqual(chart)
    expect(setChartType(chart, 'line').type).toBe('line')
    expect(chart.type).toBe('bar')
    expect(
      updateChartData(chart, {
        labels: ['One'],
        series: [{ id: 'value', name: 'Value', values: [42] }],
      }).data.labels,
    ).toEqual(['One'])
  })

  it('rejects mismatched, non-finite, duplicate, and unsafe series data', () => {
    const chart = createChartModel(
      'bar',
      sampleChartData(),
    ) as unknown as Record<string, unknown>
    const data = chart.data as Record<string, unknown>
    const series = data.series as Array<Record<string, unknown>>
    series[0].values = [1]
    expect(() => parseChartModel(chart)).toThrow(/label count/u)

    const nonFinite = sampleChartData()
    nonFinite.series[0].values[0] = Number.NaN
    expect(() => createChartModel('line', nonFinite)).toThrow(/finite/u)

    const duplicate = sampleChartData()
    duplicate.series[1].id = 'revenue'
    expect(() => createChartModel('bar', duplicate)).toThrow(/unique/u)
  })
})
