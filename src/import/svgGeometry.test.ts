import { describe, expect, it } from 'vitest'
import { prepareSvgNativeImport } from './svgGeometry'

const svg = (attributes: string, content = '<rect width="10" height="10"/>') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${content}</svg>`

const rootOf = (source: string) =>
  new DOMParser().parseFromString(source, 'image/svg+xml').documentElement

describe('prepareSvgNativeImport', () => {
  it.each([
    ['25.4mm', 25.4],
    ['2.54cm', 25.4],
    ['1in', 25.4],
    ['72pt', 25.4],
    ['6pc', 25.4],
    ['101.6Q', 25.4],
    ['2.54e1MM', 25.4],
  ])(
    'converts physical length %s using 96 CSS pixels per inch',
    (length, mm) => {
      const result = prepareSvgNativeImport(
        svg(`width="${length}" height="${length}"`),
      )
      expect(result.width).toBe(96)
      expect(result.height).toBe(96)
      expect(result.viewportWidth).toBeCloseTo(96)
      expect(result.physicalSize).toMatchObject({
        unit: 'mm',
        sourceDpi: 96,
      })
      expect(result.physicalSize?.widthMm).toBeCloseTo(mm)
      expect(result.physicalSize?.heightMm).toBeCloseTo(mm)
      expect(result.inferred).toBe(false)
      expect(rootOf(result.source).getAttribute('width')).toMatch(/px$/u)
    },
  )

  it('retains fractional physical viewport separately from its integer editing canvas', () => {
    const result = prepareSvgNativeImport(svg('width="210mm" height="297mm"'))
    expect([result.width, result.height]).toEqual([794, 1123])
    expect(result.viewportWidth).toBeCloseTo((210 * 96) / 25.4)
    expect(result.viewportHeight).toBeCloseTo((297 * 96) / 25.4)
    expect(result.physicalSize?.widthMm).toBeCloseTo(210)
    expect(result.physicalSize?.heightMm).toBeCloseTo(297)
  })

  it('keeps a subpixel physical page valid and rejects sizes below the project schema minimum', () => {
    const result = prepareSvgNativeImport(svg('width="0.01mm" height="0.01mm"'))
    expect([result.width, result.height]).toEqual([1, 1])
    expect(result.viewportWidth).toBeLessThan(1)
    expect(result.physicalSize?.widthMm).toBeCloseTo(0.01)
    expect(() =>
      prepareSvgNativeImport(svg('width="0.001mm" height="1mm"')),
    ).toThrow(expect.objectContaining({ code: 'svg-viewport' }))
  })

  it.each(['96px', '96'])('keeps %s dimensions in pixel mode', (length) => {
    const result = prepareSvgNativeImport(svg(`width="${length}" height="48"`))
    expect(result.physicalSize).toBeUndefined()
    expect(result.inferred).toBe(false)
    expect([result.width, result.height]).toEqual([96, 48])
  })

  it('derives a missing axis from viewBox aspect ratio and requires confirmation', () => {
    const result = prepareSvgNativeImport(
      svg('width="100mm" viewBox="10 20 200 100"'),
    )
    expect(result.physicalSize?.widthMm).toBeCloseTo(100)
    expect(result.physicalSize?.heightMm).toBeCloseTo(50)
    expect(result.inferred).toBe(true)
    expect(result.inferenceReason).toBe('missing-dimension')
    expect(result.viewportHeight).toBeCloseTo((50 * 96) / 25.4)
  })

  it('derives a missing width from a fixed height', () => {
    const result = prepareSvgNativeImport(
      svg('height="50px" viewBox="0 0 200 100"'),
    )
    expect([result.width, result.height]).toEqual([100, 50])
    expect(result.physicalSize).toBeUndefined()
    expect(result.inferenceReason).toBe('missing-dimension')
  })

  it('marks viewBox-only and relative dimensions as inferred pixel geometry', () => {
    const onlyViewBox = prepareSvgNativeImport(svg('viewBox="-50 -30 200 100"'))
    expect([onlyViewBox.width, onlyViewBox.height]).toEqual([200, 100])
    expect(onlyViewBox.inferenceReason).toBe('viewbox-only')
    expect(onlyViewBox.physicalSize).toBeUndefined()
    const percentage = prepareSvgNativeImport(
      svg('width="100%" height="auto" viewBox="0 0 200 100"'),
    )
    expect(percentage.inferenceReason).toBe('relative-dimensions')
    expect([percentage.width, percentage.height]).toEqual([200, 100])
  })

  it('applies root inline absolute CSS sizing before attributes', () => {
    const result = prepareSvgNativeImport(
      svg(
        'width="10" height="10" style="width: 1in; height: 2in !important; fill: red"',
      ),
    )
    expect([result.width, result.height]).toEqual([96, 192])
    const root = rootOf(result.source)
    expect(root.getAttribute('style')).toContain('fill: red')
    expect(root.getAttribute('style')).not.toMatch(/width|height/u)
    expect(result.physicalSize?.heightMm).toBeCloseTo(50.8)
  })

  it('accepts inline CSS-only dimensions without bypassing the sanitizer', () => {
    const result = prepareSvgNativeImport(
      svg(
        'style="width: 100px; height: 50px" onload="evil()"',
        '<script>evil()</script><rect width="10" height="10"/>',
      ),
    )
    expect([result.width, result.height]).toEqual([100, 50])
    expect(result.source).not.toContain('evil')
    expect(result.removedElements).toBe(1)
    expect(result.removedAttributes).toBe(1)
  })

  it.each([
    ['viewBox="0 0 100 100"', 'matrix(1 0 0 1 50 0)'],
    ['viewBox="50 20 100 100"', 'matrix(1 0 0 1 0 -20)'],
    [
      'viewBox="0 0 100 100" preserveAspectRatio="xMaxYMax meet"',
      'matrix(1 0 0 1 100 0)',
    ],
    ['viewBox="0 0 100 100" preserveAspectRatio="none"', 'matrix(2 0 0 1 0 0)'],
    [
      'viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"',
      'matrix(2 0 0 2 0 -50)',
    ],
    [
      'viewBox="0 0 100 100" preserveAspectRatio="xMinYMin   slice"',
      'matrix(2 0 0 2 0 0)',
    ],
  ])('bakes viewport mapping for %s', (attributes, matrix) => {
    const result = prepareSvgNativeImport(
      svg(`width="200" height="100" ${attributes}`),
    )
    const root = rootOf(result.source)
    expect(root.hasAttribute('viewBox')).toBe(false)
    expect(root.hasAttribute('preserveAspectRatio')).toBe(false)
    expect(root.getAttribute('transform')).toBe(matrix)
    expect(root.querySelector('g')).toBeNull()
    expect(root.querySelector('rect')?.getAttribute('width')).toBe('10')
  })

  it.each([
    ['translate(10 20) scale(2)', 'matrix(4 0 0 4 10 -80)'],
    ['matrix(1,0,0,1,10,20)', 'matrix(2 0 0 2 10 -30)'],
    ['none', 'matrix(2 0 0 2 0 -50)'],
  ])(
    'composes root transform %s before the viewport mapping',
    (transform, expected) => {
      const result = prepareSvgNativeImport(
        svg(
          `width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" transform="${transform}"`,
        ),
      )
      expect(rootOf(result.source).getAttribute('transform')).toBe(expected)
    },
  )

  it('keeps pivot rotation and skew operations numerically correct', () => {
    const result = prepareSvgNativeImport(
      svg(
        'width="100" height="100" transform="rotate(90 10 20) skewX(45) skewY(45)"',
      ),
    )
    const values = rootOf(result.source)
      .getAttribute('transform')!
      .slice(7, -1)
      .split(' ')
      .map(Number)
    const expected = [-1, 2, -1, 1, 30, 10]
    values.forEach((value, index) => expect(value).toBeCloseTo(expected[index]))
  })

  it('preserves inline transform precedence and writes a CSS-valid composed matrix', () => {
    const result = prepareSvgNativeImport(
      svg(
        'width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none" transform="scale(9)" style="transform: matrix(1,0,0,1,10,20) !important; fill: blue"',
      ),
    )
    const root = rootOf(result.source) as unknown as SVGSVGElement
    expect(root.getAttribute('transform')).toBe('matrix(2 0 0 1 10 20)')
    expect(root.style.transform).toBe('matrix(2, 0, 0, 1, 10, 20)')
    expect(root.style.fill).toBe('blue')
    const none = prepareSvgNativeImport(
      svg(
        'width="200" height="100" viewBox="0 0 100 100" transform="scale(9)" style="transform: none"',
      ),
    )
    expect(rootOf(none.source).getAttribute('transform')).toBe(
      'matrix(1 0 0 1 50 0)',
    )
  })

  it.each([
    ['transform: scale(2) !important; transform: scale(3)', 2],
    ['transform: scale(2); transform: scale(3) !important', 3],
    ['transform: scale(2) !important; transform: scale(3) !important', 3],
  ])('honors inline declaration importance: %s', (style, scale) => {
    const result = prepareSvgNativeImport(
      svg(`width="200" height="100" viewBox="0 0 100 100" style="${style}"`),
    )
    expect(rootOf(result.source).getAttribute('transform')).toBe(
      `matrix(${scale} 0 0 ${scale} ${50 * scale} 0)`,
    )
  })

  it.each([
    '#drawing { transform: scale(2) }',
    '.drawing { transform: scale(2) }',
    'svg { transform: scale(2) }',
    '#drawing { trans\\66 orm: scale(2) }',
    '@media screen { g { transform: scale(2) } }',
    'unknown|svg { transform: scale(2) }',
  ])(
    'rejects stylesheet transforms that target the root or cannot be resolved: %s',
    (css) => {
      expect(() =>
        prepareSvgNativeImport(
          svg(
            'id="drawing" class="drawing" width="200" height="100" viewBox="0 0 100 100"',
            `<style>${css}</style><rect width="10" height="10"/>`,
          ),
        ),
      ).toThrow(expect.objectContaining({ code: 'svg-transform' }))
    },
  )

  it.each([
    'translate(10px, 20px)',
    'rotate(45deg)',
    'scale(2) bad',
    'matrix(1 2 3)',
    'scale(1e999)',
    'rotate(20 1)',
    'var(--transform)',
  ])(
    'rejects an unsupported root transform instead of dropping the viewport mapping: %s',
    (transform) => {
      expect(() =>
        prepareSvgNativeImport(
          svg(
            `width="200" height="100" viewBox="0 0 100 100" transform="${transform}"`,
          ),
        ),
      ).toThrow(expect.objectContaining({ code: 'svg-transform' }))
    },
  )

  it.each([
    'svg { width: 20mm }',
    'svg { height: 20mm !important }',
    'svg { min-width: 10000px }',
    'svg { inline-size: 20mm }',
    'svg { w/**/idth: 20mm }',
    'svg { w\\69 dth: 20mm }',
  ])(
    'rejects stylesheet sizing instead of certifying conflicting dimensions: %s',
    (css) => {
      expect(() =>
        prepareSvgNativeImport(
          svg('width="100" height="100"', `<style>${css}</style>`),
        ),
      ).toThrow(expect.objectContaining({ code: 'svg-css-size' }))
    },
  )

  it('rejects inline viewport constraints that could override the fixed dimensions', () => {
    expect(() =>
      prepareSvgNativeImport(
        svg(
          'width="100" height="100" style="width: 100px; min-width: 10000px"',
        ),
      ),
    ).toThrow(expect.objectContaining({ code: 'svg-css-size' }))
  })

  it.each([
    'width="0" height="100"',
    'width="-1mm" height="100"',
    'width="1e999px" height="100"',
    'width="100"',
    'viewBox="0 0 0 100"',
    'viewBox="0 0 -10 100"',
    'viewBox="0 0 100 Infinity"',
    'viewBox="0 0 100 100" preserveAspectRatio="bad"',
  ])('rejects invalid or unresolved viewports: %s', (attributes) => {
    expect(() => prepareSvgNativeImport(svg(attributes))).toThrow(
      expect.objectContaining({ code: 'svg-viewport' }),
    )
  })

  it('checks limits after inferred viewport resolution', () => {
    expect(() =>
      prepareSvgNativeImport(svg('width="8000" viewBox="0 0 1 2"')),
    ).toThrow(expect.objectContaining({ code: 'svg-dimension-limit' }))
    expect(() =>
      prepareSvgNativeImport(svg('style="width: 9000px; height: 1px"')),
    ).toThrow(expect.objectContaining({ code: 'svg-dimension-limit' }))
  })

  it('retains local paint references while removing external resources', () => {
    const result = prepareSvgNativeImport(
      svg(
        'viewBox="0 0 100 100"',
        `
      <defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs>
      <rect width="100" height="100" fill="url(#paint)"/>
      <image href="https://example.test/secret.png"/>
    `,
      ),
    )
    const root = rootOf(result.source)
    expect(root.querySelector('rect')?.getAttribute('fill')).toBe('url(#paint)')
    expect(root.querySelector('image')?.hasAttribute('href')).toBe(false)
  })
})
