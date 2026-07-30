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
    const validate = () =>
      assertRestorableEditorSnapshot({
        width: 1280,
        height: 720,
        json: {
          objects: Array.from({ length: MAX_PROJECT_OBJECTS + 1 }, () => ({
            type: 'Rect',
          })),
        },
      })

    expect(validate).toThrow(`at most ${MAX_PROJECT_OBJECTS}`)
    expect(validate).toThrow(
      expect.objectContaining({ code: 'project-object-limit' }),
    )
  })

  it('rejects aggregate embedded-image decode work above 128 MP', () => {
    const src = pngHeaderDataUrl(8192, 8192)
    const validate = () =>
      assertRestorableEditorSnapshot({
        width: 1280,
        height: 720,
        json: {
          objects: Array.from({ length: 3 }, () => ({
            type: 'Image',
            src,
          })),
        },
      })

    expect(validate).toThrow('128 MP')
    expect(validate).toThrow(
      expect.objectContaining({ code: 'project-decode-limit' }),
    )
  })

  it('rejects non-embedded renderer image sources before persistence', () => {
    const validate = () =>
      assertRestorableEditorSnapshot({
        width: 1280,
        height: 720,
        json: {
          objects: [{ type: 'Image', src: 'https://example.com/image.png' }],
        },
      })

    expect(validate).toThrow('embedded PNG, JPEG, or WebP')
    expect(validate).toThrow(
      expect.objectContaining({ code: 'invalid-image-data' }),
    )
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
