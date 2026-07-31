import { describe, expect, it } from 'vitest'
import {
  toneCurveLutToPoints,
  toneCurvePointsToLut,
  validateToneCurvePoints,
} from './curve'
import { createIdentityCurve } from './types'

describe('tone curve point conversion', () => {
  it('interpolates editable points into a complete byte LUT', () => {
    const lut = toneCurvePointsToLut([
      { x: 0, y: 12 },
      { x: 128, y: 200 },
      { x: 255, y: 244 },
    ])

    expect(lut).toHaveLength(256)
    expect(lut[0]).toBe(12)
    expect(lut[64]).toBe(106)
    expect(lut[128]).toBe(200)
    expect(lut[255]).toBe(244)
  })

  it('samples a LUT into editable points while retaining both endpoints', () => {
    const points = toneCurveLutToPoints(createIdentityCurve(), 5)

    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 64, y: 64 },
      { x: 128, y: 128 },
      { x: 191, y: 191 },
      { x: 255, y: 255 },
    ])
  })

  it('rejects unsafe or ambiguous point sequences', () => {
    expect(() =>
      validateToneCurvePoints([
        { x: 1, y: 0 },
        { x: 255, y: 255 },
      ]),
    ).toThrow(/start at x=0/u)
    expect(() =>
      validateToneCurvePoints([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 255, y: 255 },
      ]),
    ).toThrow(/increasing/u)
  })
})
