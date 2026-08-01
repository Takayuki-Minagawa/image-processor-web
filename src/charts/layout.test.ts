import { describe, expect, it } from 'vitest'
import { sampleChartData } from '../test/fixtures/chartData'
import { buildChartVectorScene } from './layout'
import { createChartModel } from './model'

const assertFiniteScene = (
  scene: ReturnType<typeof buildChartVectorScene>,
): void => {
  expect(JSON.stringify(scene)).not.toMatch(/NaN|Infinity/u)
  expect(scene.primitives.every(({ id }) => id.length > 0)).toBe(true)
}

describe('buildChartVectorScene', () => {
  it('lays out positive and negative grouped bars around a zero baseline', () => {
    const chart = createChartModel('bar', sampleChartData(), {
      style: { showValues: true },
    })
    const scene = buildChartVectorScene(chart, { width: 640, height: 400 })
    const bars = scene.primitives.filter(
      (primitive) => primitive.type === 'rect' && primitive.role === 'data',
    )

    expect(scene.domain).toEqual({ minimum: -4, maximum: 12 })
    expect(bars).toHaveLength(5)
    expect(bars.every(({ type }) => type === 'rect')).toBe(true)
    assertFiniteScene(scene)
  })

  it('lays out horizontal bars and applies a supplied brand palette', () => {
    const chart = createChartModel('horizontal-bar', sampleChartData())
    const scene = buildChartVectorScene(chart, {
      width: 640,
      height: 400,
      palette: ['#112233', '#aabbcc'],
    })
    const bars = scene.primitives.filter(
      (primitive) => primitive.type === 'rect' && primitive.role === 'data',
    )
    expect(bars[0]).toMatchObject({ fill: '#112233' })
    expect(bars[3]).toMatchObject({ fill: '#aabbcc' })
    assertFiniteScene(scene)
  })

  it('splits line segments at null values while retaining point markers', () => {
    const chart = createChartModel('line', {
      labels: ['A', 'B', 'C', 'D', 'E'],
      series: [{ id: 'value', name: 'Value', values: [1, 2, null, 3, 4] }],
    })
    const scene = buildChartVectorScene(chart, { width: 500, height: 320 })
    expect(
      scene.primitives.filter(({ type }) => type === 'polyline'),
    ).toHaveLength(2)
    expect(
      scene.primitives.filter(({ type }) => type === 'circle'),
    ).toHaveLength(4)
    assertFiniteScene(scene)
  })

  it('generates valid pie and doughnut paths, including a single full circle', () => {
    for (const type of ['pie', 'doughnut'] as const) {
      const chart = createChartModel(type, {
        labels: ['Only'],
        series: [{ id: 'value', name: 'Value', values: [100] }],
      })
      const scene = buildChartVectorScene(chart, { width: 400, height: 320 })
      const paths = scene.primitives.filter(
        (primitive) => primitive.type === 'path',
      )
      expect(paths).toHaveLength(1)
      expect(paths[0]).toMatchObject({ type: 'path' })
      if (paths[0]?.type === 'path') {
        expect((paths[0].d.match(/ A /gu) ?? []).length).toBe(
          type === 'pie' ? 2 : 4,
        )
      }
      assertFiniteScene(scene)
    }
  })

  it('rejects unsafe palettes and impractical scene dimensions', () => {
    const chart = createChartModel('bar', sampleChartData())
    expect(() =>
      buildChartVectorScene(chart, {
        width: 640,
        height: 400,
        palette: ['red'],
      }),
    ).toThrow(/hex colors/u)
    expect(() =>
      buildChartVectorScene(chart, { width: 20, height: 20 }),
    ).toThrow(/dimensions/u)
  })
})
