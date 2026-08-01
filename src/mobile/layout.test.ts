import { describe, expect, it } from 'vitest'
import {
  classifyResponsiveEditorMode,
  interactiveTargetIsLargeEnough,
  resolveResponsiveEditorLayout,
} from './layout'

describe('responsive editor layout', () => {
  it('keeps portrait and landscape phones in handset mode', () => {
    expect(
      classifyResponsiveEditorMode({
        width: 390,
        height: 844,
        pointer: 'coarse',
      }),
    ).toBe('handset')
    expect(
      classifyResponsiveEditorMode({
        width: 844,
        height: 390,
        pointer: 'coarse',
      }),
    ).toBe('handset')
  })

  it('maps an iPad-class viewport to bottom-sheet tablet controls', () => {
    expect(
      resolveResponsiveEditorLayout({
        width: 1_024,
        height: 1_366,
        pointer: 'coarse',
      }),
    ).toEqual({
      mode: 'tablet',
      toolRailPlacement: 'bottom',
      inspectorPresentation: 'bottom-sheet',
      assetPanelPresentation: 'bottom-sheet',
      dialogPresentation: 'centered',
      minimumInteractiveSizePx: 44,
    })
    expect(
      classifyResponsiveEditorMode({
        width: 1_366,
        height: 1_024,
        pointer: 'coarse',
      }),
    ).toBe('tablet')
  })

  it('preserves the docked desktop composition', () => {
    expect(
      resolveResponsiveEditorLayout({
        width: 1_440,
        height: 900,
        pointer: 'fine',
      }),
    ).toMatchObject({
      mode: 'desktop',
      toolRailPlacement: 'left',
      inspectorPresentation: 'docked',
      dialogPresentation: 'centered',
      minimumInteractiveSizePx: 32,
    })
  })

  it('enforces larger targets for coarse pointers', () => {
    expect(interactiveTargetIsLargeEnough(44, 44, 'coarse')).toBe(true)
    expect(interactiveTargetIsLargeEnough(43, 44, 'coarse')).toBe(false)
    expect(interactiveTargetIsLargeEnough(32, 32, 'fine')).toBe(true)
    expect(interactiveTargetIsLargeEnough(Number.NaN, 44, 'coarse')).toBe(false)
  })

  it('rejects non-positive viewport dimensions', () => {
    expect(() =>
      classifyResponsiveEditorMode({
        width: 0,
        height: 800,
        pointer: 'fine',
      }),
    ).toThrow(RangeError)
  })
})
