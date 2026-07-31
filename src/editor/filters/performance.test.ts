import { expect, it } from 'vitest'
import { applyFilterChainCpu } from './cpu'

it('applies one levels filter to 4096×4096 pixels within the 2 second budget', () => {
  const width = 4096
  const height = 4096
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(128)
  for (let index = 3; index < data.length; index += 4) data[index] = 255
  const started = performance.now()
  const output = applyFilterChainCpu({ width, height, data }, [
    {
      id: 'levels',
      params: {
        inputBlack: 8,
        inputWhite: 244,
        gamma: 0.9,
        outputBlack: 0,
        outputWhite: 255,
      },
    },
  ])
  const elapsed = performance.now() - started
  expect(output.data[3]).toBe(255)
  expect(elapsed).toBeLessThan(2_000)
}, 5_000)
