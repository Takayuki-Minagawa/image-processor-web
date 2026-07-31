import { describe, expect, it } from 'vitest'
import {
  generateColorHarmony,
  hslToHex,
  hslToRgb,
  parseHexColor,
  readableTextColor,
  rgbToHex,
  rgbToHsl,
} from './colors'

describe('color conversion', () => {
  it('normalizes short and long hexadecimal colors', () => {
    expect(parseHexColor('#f0a')).toEqual({ r: 255, g: 0, b: 170 })
    expect(parseHexColor('6757E8')).toEqual({ r: 103, g: 87, b: 232 })
    expect(rgbToHex({ r: 103, g: 87, b: 232 })).toBe('#6757e8')
    expect(() => parseHexColor('#12')).toThrow(/invalid hexadecimal/i)
  })

  it('round-trips representative RGB and HSL colors', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({
      h: 0,
      s: 100,
      l: 50,
    })
    expect(hslToRgb({ h: 120, s: 100, l: 50 })).toEqual({
      r: 0,
      g: 255,
      b: 0,
    })
    expect(hslToHex({ h: 240, s: 100, l: 50 })).toBe('#0000ff')

    const source = { r: 103, g: 87, b: 232 }
    const roundTrip = hslToRgb(rgbToHsl(source))
    expect(roundTrip.r).toBeCloseTo(source.r, 8)
    expect(roundTrip.g).toBeCloseTo(source.g, 8)
    expect(roundTrip.b).toBeCloseTo(source.b, 8)
  })
})

describe('color harmonies', () => {
  it('creates canonical complementary and triadic hues', () => {
    expect(
      generateColorHarmony('#ff0000', 'complementary').slice(0, 2),
    ).toEqual(['#ff0000', '#00ffff'])
    expect(generateColorHarmony('#ff0000', 'triadic').slice(0, 3)).toEqual([
      '#ff0000',
      '#00ff00',
      '#0000ff',
    ])
  })

  it.each(['complementary', 'analogous', 'triadic', 'monochromatic'] as const)(
    'returns five deterministic %s swatches with the base first',
    (rule) => {
      const first = generateColorHarmony('#6757e8', rule)
      const second = generateColorHarmony('#6757e8', rule)
      expect(first).toHaveLength(5)
      expect(first[0]).toBe('#6757e8')
      expect(second).toEqual(first)
      expect(new Set(first).size).toBeGreaterThanOrEqual(3)
    },
  )

  it('selects readable black or white text', () => {
    expect(readableTextColor('#ffffff')).toBe('#000000')
    expect(readableTextColor('#000000')).toBe('#ffffff')
  })
})
