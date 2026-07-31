import { Canvas2dFilterBackend, filters, initFilterBackend } from 'fabric'
import { describe, expect, it } from 'vitest'
import { applyFilterChainCpu } from './cpu'
import type { FilterOperation, PixelBuffer } from './types'

const onePixel = (values: [number, number, number, number]): PixelBuffer => ({
  width: 1,
  height: 1,
  data: new Uint8ClampedArray(values),
})

describe('filter CPU fallback acceptance', () => {
  it('selects Canvas2D and runs built-in filters when WebGL is unavailable', () => {
    expect(document.createElement('canvas').getContext('webgl')).toBeNull()
    const backend = initFilterBackend()
    expect(backend).toBeInstanceOf(Canvas2dFilterBackend)

    const source = document.createElement('canvas')
    source.width = 1
    source.height = 1
    const sourceContext = source.getContext('2d')
    if (!sourceContext) throw new Error('Expected a Canvas2D source context.')
    sourceContext.fillStyle = 'rgb(10, 20, 30)'
    sourceContext.fillRect(0, 0, 1, 1)

    const target = document.createElement('canvas')
    target.width = 1
    target.height = 1
    backend.applyFilters([new filters.Invert()], source, 1, 1, target)

    expect([
      ...(target.getContext('2d')?.getImageData(0, 0, 1, 1).data ?? []),
    ]).toEqual([245, 235, 225, 255])
  })

  it('runs the custom-filter chain without any GPU API', () => {
    expect(globalThis.WebGLRenderingContext).toBeUndefined()
    const operations: FilterOperation[] = [
      {
        id: 'levels',
        params: {
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1,
          outputBlack: 10,
          outputWhite: 240,
        },
      },
      {
        id: 'duotone',
        params: {
          shadows: { r: 0, g: 20, b: 40 },
          highlights: { r: 240, g: 220, b: 120 },
        },
      },
    ]

    expect([
      ...applyFilterChainCpu(onePixel([64, 128, 192, 200]), operations).data,
    ]).toEqual([110, 112, 77, 200])
  })
})
