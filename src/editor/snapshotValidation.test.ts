import { describe, expect, it } from 'vitest'
import {
  MAX_PROJECT_OBJECTS,
  assertRestorableEditorSnapshot,
  imageDimensionsMatchHeader,
} from './snapshotValidation'

const pngHeaderDataUrl = (width: number, height: number): string => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('assertRestorableEditorSnapshot', () => {
  it('accepts a normal renderer snapshot', () => {
    expect(() =>
      assertRestorableEditorSnapshot({
        width: 1280,
        height: 720,
        json: {
          version: '7.4.0',
          objects: [{ type: 'Rect', width: 100, height: 50 }],
        },
      }),
    ).not.toThrow()
  })

  it('rejects a snapshot with more objects than restore can accept', () => {
    expect(() =>
      assertRestorableEditorSnapshot({
        width: 1280,
        height: 720,
        json: {
          objects: Array.from({ length: MAX_PROJECT_OBJECTS + 1 }, () => ({
            type: 'Rect',
          })),
        },
      }),
    ).toThrow(`at most ${MAX_PROJECT_OBJECTS}`)
  })

  it('rejects aggregate embedded-image decode work above 128 MP', () => {
    const src = pngHeaderDataUrl(8192, 8192)
    expect(() =>
      assertRestorableEditorSnapshot({
        width: 1280,
        height: 720,
        json: {
          objects: Array.from({ length: 3 }, () => ({
            type: 'Image',
            src,
          })),
        },
      }),
    ).toThrow('128 MP')
  })

  it('rejects non-embedded renderer image sources before persistence', () => {
    expect(() =>
      assertRestorableEditorSnapshot({
        width: 1280,
        height: 720,
        json: {
          objects: [{ type: 'Image', src: 'https://example.com/image.png' }],
        },
      }),
    ).toThrow('embedded PNG, JPEG, or WebP')
  })
})

describe('imageDimensionsMatchHeader', () => {
  it('accepts exact and EXIF-oriented width/height pairs', () => {
    expect(
      imageDimensionsMatchHeader(
        { width: 40, height: 20 },
        { width: 40, height: 20 },
      ),
    ).toBe(true)
    expect(
      imageDimensionsMatchHeader(
        { width: 20, height: 40 },
        { width: 40, height: 20 },
      ),
    ).toBe(true)
    expect(
      imageDimensionsMatchHeader(
        { width: 30, height: 40 },
        { width: 40, height: 20 },
      ),
    ).toBe(false)
  })
})
