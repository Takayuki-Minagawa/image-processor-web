import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  imageDimensionsAreSafe,
  imageDimensionsMatchHeader,
  matchEmbeddedImageDataUrl,
} from './imageSafety'

describe('image safety limits', () => {
  it('accepts the shared edge and pixel limits', () => {
    expect(
      imageDimensionsAreSafe({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
      }),
    ).toBe(true)
    expect(MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION).toBe(MAX_IMAGE_PIXELS)
  })

  it('rejects invalid, fractional, and over-limit dimensions', () => {
    expect(imageDimensionsAreSafe({ width: 0, height: 10 })).toBe(false)
    expect(imageDimensionsAreSafe({ width: 10.5, height: 10 })).toBe(false)
    expect(
      imageDimensionsAreSafe({
        width: MAX_IMAGE_DIMENSION + 1,
        height: 1,
      }),
    ).toBe(false)
  })
})

describe('embedded image metadata', () => {
  it('recognizes only supported embedded image Data URLs', () => {
    expect(
      matchEmbeddedImageDataUrl('data:image/png;base64,iVBORw0KGgo='),
    ).toEqual({
      mimeType: 'image/png',
      prefixLength: 'data:image/png;base64,'.length,
    })
    expect(
      matchEmbeddedImageDataUrl(
        'data:image/jpeg;charset=utf-8;base64,/9j/4AAQ',
      ),
    ).toEqual({
      mimeType: 'image/jpeg',
      prefixLength: 'data:image/jpeg;charset=utf-8;base64,'.length,
    })
    expect(
      matchEmbeddedImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='),
    ).toBeNull()
    expect(
      matchEmbeddedImageDataUrl('https://example.com/image.png'),
    ).toBeNull()
  })

  it('accepts exact and EXIF-oriented dimension pairs', () => {
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
  })
})
