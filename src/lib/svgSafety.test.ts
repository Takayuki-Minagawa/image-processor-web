import { describe, expect, it } from 'vitest'
import { sanitizeSvg, sanitizeSvgString } from './svgSafety'

const parse = (source: string): XMLDocument =>
  new DOMParser().parseFromString(source, 'image/svg+xml')

const pngDataUrl = (
  width: number,
  height: number,
  mimeType = 'image/png',
): string => {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return `data:${mimeType};base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('sanitizeSvg', () => {
  it('preserves normal SVG geometry, local paint references, and dimensions', () => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="2in" height="96px" viewBox="0 0 200 100">
        <defs>
          <linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient>
          <path id="curve" d="M0 50 C50 0 150 0 200 50"/>
        </defs>
        <rect width="200" height="100" fill="url(#paint)"/>
        <text><textPath href="#curve">Pixelweave</textPath></text>
      </svg>
    `)
    const document = parse(result.source)

    expect(result.width).toBe(192)
    expect(result.height).toBe(96)
    expect(result.elementCount).toBe(8)
    expect(result.removedElements).toBe(0)
    expect(document.querySelector('rect')?.getAttribute('fill')).toBe(
      'url(#paint)',
    )
    expect(document.querySelector('textPath')?.getAttribute('href')).toBe(
      '#curve',
    )
  })

  it('removes executable and HTML-capable elements plus event handlers', () => {
    const document = parse(
      sanitizeSvgString(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="globalThis.pwned=1">
          <script>globalThis.pwned = 2</script>
          <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>
          <iframe href="https://example.test"/>
          <animate attributeName="href" values="#safe;javascript:alert(1)"/>
          <rect width="100" height="100" onclick="globalThis.pwned=3"/>
        </svg>
      `),
    )

    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('foreignObject')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('animate')).toBeNull()
    expect(document.documentElement.hasAttribute('onload')).toBe(false)
    expect(document.querySelector('rect')?.hasAttribute('onclick')).toBe(false)
  })

  it('strips external hrefs, unsafe data URLs, CSS imports, and remote URLs', () => {
    const embeddedRaster = pngDataUrl(1, 1)
    const document = parse(
      sanitizeSvgString(`
        <svg xmlns="http://www.w3.org/2000/svg"
             xmlns:xlink="http://www.w3.org/1999/xlink"
             viewBox="0 0 100 100">
          <defs><path id="local" d="M0 0L10 10"/></defs>
          <style>@import "https://example.test/font.css"; .bad { fill: red; }</style>
          <use id="remote-use" href="sprite.svg#mark"/>
          <use id="local-use" href="#local"/>
          <image id="remote-image" href="https://example.test/image.png"/>
          <image id="nested-svg" href="data:image/svg+xml;base64,PHN2Zz4="/>
          <image id="embedded-raster" xlink:href="${embeddedRaster}"/>
          <rect id="styled" width="10" height="10"
                style="fill: url(#local); stroke: url(https://example.test/a.svg); color: red"/>
          <rect id="external-filter" width="10" height="10"
                filter="url(https://example.test/filter.svg#f)"/>
        </svg>
      `),
    )

    expect(document.querySelector('style')).toBeNull()
    expect(document.querySelector('#remote-use')?.hasAttribute('href')).toBe(
      false,
    )
    expect(document.querySelector('#local-use')?.getAttribute('href')).toBe(
      '#local',
    )
    expect(document.querySelector('#remote-image')?.hasAttribute('href')).toBe(
      false,
    )
    expect(document.querySelector('#nested-svg')?.hasAttribute('href')).toBe(
      false,
    )
    expect(
      document
        .querySelector('#embedded-raster')
        ?.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
    ).toBe(embeddedRaster)
    expect(document.querySelector('#styled')?.getAttribute('style')).toBe(
      'fill: url(#local); color: red',
    )
    expect(
      document.querySelector('#external-filter')?.hasAttribute('filter'),
    ).toBe(false)
  })

  it('removes embedded rasters with mismatched, malformed, or oversized headers', () => {
    const oversized = pngDataUrl(8_193, 1)
    const mismatched = pngDataUrl(1, 1, 'image/jpeg')
    const document = parse(
      sanitizeSvgString(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
          <image id="oversized" href="${oversized}"/>
          <image id="mismatched" href="${mismatched}"/>
          <image id="truncated" href="data:image/png;base64,iVBORw0KGgo="/>
          <image id="invalid-base64" href="data:image/png;base64,AAAAA"/>
        </svg>
      `),
    )

    for (const id of [
      'oversized',
      'mismatched',
      'truncated',
      'invalid-base64',
    ]) {
      expect(document.querySelector(`#${id}`)?.hasAttribute('href')).toBe(false)
    }
  })

  it('enforces decoded-byte and pixel limits for embedded rasters', () => {
    const embeddedRaster = pngDataUrl(10, 10)

    const byteLimited = parse(
      sanitizeSvgString(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="${embeddedRaster}"/></svg>`,
        { maxEmbeddedImageBytes: 23 },
      ),
    )
    const pixelLimited = parse(
      sanitizeSvgString(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="${embeddedRaster}"/></svg>`,
        { maxPixels: 99 },
      ),
    )

    expect(byteLimited.querySelector('image')?.hasAttribute('href')).toBe(false)
    expect(pixelLimited.querySelector('image')?.hasAttribute('href')).toBe(
      false,
    )
  })

  it('bounds cumulative embedded-raster decode work across one SVG', () => {
    const fullBudgetRaster = pngDataUrl(8_192, 8_192)
    const pixelLimited = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
        <image id="first" href="${fullBudgetRaster}"/>
        <image id="second" href="${fullBudgetRaster}"/>
      </svg>`,
    )
    const pixelDocument = parse(pixelLimited.source)

    expect(pixelDocument.querySelector('#first')?.hasAttribute('href')).toBe(
      true,
    )
    expect(pixelDocument.querySelector('#second')?.hasAttribute('href')).toBe(
      false,
    )
    expect(pixelLimited.removedAttributes).toBe(1)

    const smallRaster = pngDataUrl(1, 1)
    const byteLimited = parse(
      sanitizeSvgString(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
          <image id="first" href="${smallRaster}"/>
          <image id="second" href="${smallRaster}"/>
        </svg>`,
        { maxEmbeddedImageBytes: 47 },
      ),
    )

    expect(byteLimited.querySelector('#first')?.hasAttribute('href')).toBe(true)
    expect(byteLimited.querySelector('#second')?.hasAttribute('href')).toBe(
      false,
    )
  })

  it('rejects declarations, malformed roots, and unverifiable dimensions', () => {
    expect(() =>
      sanitizeSvg(
        '<!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid-svg' }))
    expect(() =>
      sanitizeSvg('<html xmlns="http://www.w3.org/1999/xhtml"/>'),
    ).toThrow(expect.objectContaining({ code: 'invalid-svg' }))
    expect(() =>
      sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ).toThrow(expect.objectContaining({ code: 'invalid-svg' }))
  })

  it('enforces byte, element, attribute, and rendered-dimension limits', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g/><g/></svg>'
    expect(() => sanitizeSvg(svg, { maxBytes: 20 })).toThrow(
      expect.objectContaining({ code: 'svg-byte-limit' }),
    )
    expect(() => sanitizeSvg(svg, { maxElements: 2 })).toThrow(
      expect.objectContaining({ code: 'svg-element-limit' }),
    )
    expect(() =>
      sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path data-long="123456"/></svg>',
        { maxAttributeLength: 5 },
      ),
    ).toThrow(expect.objectContaining({ code: 'svg-attribute-limit' }))
    expect(() =>
      sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 101 20"/>',
        { maxDimension: 100 },
      ),
    ).toThrow(expect.objectContaining({ code: 'svg-dimension-limit' }))
    expect(() =>
      sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"/>',
        { maxPixels: 399 },
      ),
    ).toThrow(expect.objectContaining({ code: 'svg-dimension-limit' }))
  })
})
