import { describe, expect, it } from 'vitest'
import {
  DESIGN_SIZE_PRESETS,
  designSizeToPixels,
  millimetersToPixels,
  presetPixelDimensions,
} from './designPresets'

describe('design size presets', () => {
  it('converts physical sizes at a selected DPI', () => {
    expect(millimetersToPixels(25.4, 300)).toBe(300)
    const a4 = DESIGN_SIZE_PRESETS.find(({ id }) => id === 'a4-portrait')!
    expect(presetPixelDimensions(a4)).toEqual({ width: 2480, height: 3508 })
  })

  it('keeps pixel presets exact', () => {
    const story = DESIGN_SIZE_PRESETS.find(
      ({ id }) => id === 'instagram-story',
    )!
    expect(presetPixelDimensions(story)).toEqual({ width: 1080, height: 1920 })
  })

  it('converts custom px and mm sizes through one new-document path', () => {
    expect(designSizeToPixels(640.4, 360.4, 'px')).toEqual({
      width: 640,
      height: 360,
    })
    expect(designSizeToPixels(25.4, 50.8, 'mm', 300)).toEqual({
      width: 300,
      height: 600,
    })
  })

  it('provides each required workflow category', () => {
    expect(
      new Set(DESIGN_SIZE_PRESETS.map(({ category }) => category)),
    ).toEqual(new Set(['social', 'presentation', 'print', 'banner']))
  })
})
