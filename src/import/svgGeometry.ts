import type { ProjectPagePhysicalSize } from '../editor/types'
import { MAX_SVG_BYTES, SvgSafetyError, sanitizeSvg } from '../lib/svgSafety'

export const SVG_CSS_DPI = 96

export type SvgNativeInferenceReason =
  'viewbox-only' | 'missing-dimension' | 'relative-dimensions'

export interface SvgNativeGeometry {
  /** Sanitized SVG with a fixed CSS-pixel viewport and baked viewBox mapping. */
  source: string
  /** Integer editing canvas; the fractional source viewport is retained below. */
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  physicalSize?: ProjectPagePhysicalSize
  inferred: boolean
  inferenceReason?: SvgNativeInferenceReason
  removedElements: number
  removedAttributes: number
}

export class SvgNativeImportError extends Error {
  readonly code: 'svg-css-size' | 'svg-viewport' | 'svg-transform'

  constructor(code: SvgNativeImportError['code'], message: string) {
    super(message)
    this.name = 'SvgNativeImportError'
    this.code = code
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?'
const LENGTH = new RegExp(`^(${NUMBER})(px|in|cm|mm|q|pt|pc)?$`, 'i')
const SEPARATOR = '(?:\\s*,\\s*|\\s+)'
const VIEW_BOX = new RegExp(
  `^\\s*(${NUMBER})${SEPARATOR}(${NUMBER})${SEPARATOR}(${NUMBER})${SEPARATOR}(${NUMBER})\\s*$`,
  'i',
)

type FixedLength = { kind: 'fixed'; pixels: number; physical: boolean }
type Length = FixedLength | { kind: 'missing' | 'relative' }
type ViewBox = { minX: number; minY: number; width: number; height: number }

const invalidViewport = (message: string): never => {
  throw new SvgNativeImportError('svg-viewport', message)
}

const parseLength = (raw: string | null): Length => {
  if (raw === null || raw.trim() === '') return { kind: 'missing' }
  const value = raw.trim()
  const match = LENGTH.exec(value)
  if (!match) return { kind: 'relative' }
  const amount = Number(match[1])
  const unit = (match[2] ?? 'px').toLowerCase()
  const factors: Record<string, number> = {
    px: 1,
    in: SVG_CSS_DPI,
    cm: SVG_CSS_DPI / 2.54,
    mm: SVG_CSS_DPI / 25.4,
    q: SVG_CSS_DPI / 101.6,
    pt: SVG_CSS_DPI / 72,
    pc: SVG_CSS_DPI / 6,
  }
  const pixels = amount * factors[unit]
  if (!Number.isFinite(pixels) || pixels <= 0) {
    return invalidViewport(
      'SVG viewport dimensions must be positive and finite.',
    )
  }
  return { kind: 'fixed', pixels, physical: unit !== 'px' }
}

const parseViewBox = (raw: string | null): ViewBox | undefined => {
  if (raw === null) return undefined
  const match = VIEW_BOX.exec(raw)
  if (!match) return invalidViewport('The SVG viewBox is invalid.')
  const [minX, minY, width, height] = match.slice(1).map(Number)
  if (
    ![minX, minY, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    return invalidViewport(
      'The SVG viewBox must have positive finite dimensions.',
    )
  }
  return { minX, minY, width, height }
}

/** Decode CSS identifier escapes before checking declarations, including comments. */
const normalizedCss = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\\([\da-f]{1,6})\s?|\\(.)/giu, (_, hex: string, char: string) =>
      hex
        ? String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff))
        : char,
    )

const CSS_SIZE_PROPERTY =
  /(?:^|[;{])\s*(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|aspect-ratio)\s*:/iu

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]
const invalidTransform = (): never => {
  throw new SvgNativeImportError(
    'svg-transform',
    'Use numeric SVG transforms on the root. Stylesheet transforms targeting the root are unsupported.',
  )
}

const parseTransform = (source: string): Matrix => {
  if (!source.trim() || source.trim() === 'none') return [...IDENTITY]
  const operations = /([a-zA-Z]+)\s*\(([^()]*)\)/gu
  const numbers = new RegExp(
    `^\\s*${NUMBER}(?:${SEPARATOR}${NUMBER})*\\s*$`,
    'iu',
  )
  let matrix: Matrix = [...IDENTITY]
  let end = 0
  for (const match of source.matchAll(operations)) {
    if (!/^\s*,?\s*$/u.test(source.slice(end, match.index))) invalidTransform()
    if (!numbers.test(match[2])) invalidTransform()
    const args = match[2]
      .trim()
      .split(/[\s,]+/u)
      .map(Number)
    if (!args.every(Number.isFinite)) invalidTransform()
    const [a, b, c] = args
    let next: Matrix
    if (match[1] === 'matrix' && args.length === 6) next = args as Matrix
    else if (match[1] === 'translate' && [1, 2].includes(args.length))
      next = [1, 0, 0, 1, a, b ?? 0]
    else if (match[1] === 'scale' && [1, 2].includes(args.length))
      next = [a, 0, 0, b ?? a, 0, 0]
    else if (match[1] === 'rotate' && [1, 3].includes(args.length)) {
      const angle = (a * Math.PI) / 180
      const cosine = Math.cos(angle)
      const sine = Math.sin(angle)
      const x = b ?? 0
      const y = c ?? 0
      next = [
        cosine,
        sine,
        -sine,
        cosine,
        x - cosine * x + sine * y,
        y - sine * x - cosine * y,
      ]
    } else if (['skewX', 'skewY'].includes(match[1]) && args.length === 1) {
      const tangent = Math.tan((a * Math.PI) / 180)
      next =
        match[1] === 'skewX'
          ? [1, 0, tangent, 1, 0, 0]
          : [1, tangent, 0, 1, 0, 0]
    } else return invalidTransform()
    matrix = multiply(matrix, next)
    if (!matrix.every(Number.isFinite)) invalidTransform()
    end = match.index + match[0].length
  }
  if (end === 0 || source.slice(end).trim()) invalidTransform()
  return matrix
}

const readRootTransform = (root: SVGSVGElement): Matrix => {
  const transformDeclaration = /(?:^|;)\s*transform\s*:/iu
  for (const style of root.querySelectorAll('style')) {
    const css = normalizedCss(style.textContent ?? '')
    if (!/(?:^|[;{])\s*transform\s*:/iu.test(css)) continue
    // Nested cascades and conditional rules require a CSS engine. Basic
    // selectors remain supported, but uncertain root transforms fail explicitly.
    if (/@[a-z-]+/iu.test(css)) invalidTransform()
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      if (!transformDeclaration.test(rule[2])) continue
      try {
        if (root.matches(rule[1].trim())) invalidTransform()
      } catch {
        invalidTransform()
      }
    }
  }
  const declarations = normalizedCss(root.getAttribute('style') ?? '').split(
    ';',
  )
  const transforms = declarations.filter((value) =>
    /^\s*transform\s*:/iu.test(value),
  )
  const important = transforms.filter((value) => /!important\s*$/iu.test(value))
  const inline = (important.at(-1) ?? transforms.at(-1))
    ?.replace(/^\s*transform\s*:/iu, '')
    .replace(/\s*!important\s*$/iu, '')
  return parseTransform(inline ?? root.getAttribute('transform') ?? '')
}

const readRootSizes = (root: SVGSVGElement): [Length, Length] => {
  // Selector-based sizing requires a full CSS cascade/environment. Do not label
  // attribute dimensions as original physical size when a stylesheet can win.
  for (const style of root.querySelectorAll('style')) {
    if (CSS_SIZE_PROPERTY.test(normalizedCss(style.textContent ?? ''))) {
      throw new SvgNativeImportError(
        'svg-css-size',
        'SVG original-size import does not support stylesheet width or height. Use fixed root attributes or inline styles.',
      )
    }
  }

  const style = root.style
  const nonFixedSizing = normalizedCss(
    root.getAttribute('style') ?? '',
  ).replace(/(?:^|;)\s*(?:width|height)\s*:[^;]*/giu, '')
  if (CSS_SIZE_PROPERTY.test(nonFixedSizing)) {
    throw new SvgNativeImportError(
      'svg-css-size',
      'SVG original-size import only supports fixed root width and height styles.',
    )
  }
  return ['width', 'height'].map((property) =>
    parseLength(
      style.getPropertyValue(property) || root.getAttribute(property),
    ),
  ) as [Length, Length]
}

const viewportMatrix = (
  viewBox: ViewBox,
  width: number,
  height: number,
  preserveAspectRatio: string | null,
): Matrix => {
  const parts = (preserveAspectRatio?.trim() || 'xMidYMid meet').split(/\s+/u)
  const [align, fit = 'meet'] = parts
  if (
    parts.length > 2 ||
    !/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))$/u.test(align) ||
    !['meet', 'slice'].includes(fit)
  ) {
    return invalidViewport('The SVG preserveAspectRatio value is unsupported.')
  }
  let sx = width / viewBox.width
  let sy = height / viewBox.height
  if (align !== 'none') {
    sx = sy = fit === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy)
  }
  const xFactor = align.includes('xMid') ? 0.5 : align.includes('xMax') ? 1 : 0
  const yFactor = align.includes('YMid') ? 0.5 : align.includes('YMax') ? 1 : 0
  const tx = -viewBox.minX * sx + (width - viewBox.width * sx) * xFactor
  const ty = -viewBox.minY * sy + (height - viewBox.height * sy) * yFactor
  if (![sx, sy, tx, ty].every(Number.isFinite)) {
    return invalidViewport('The SVG viewport transform is not finite.')
  }
  return [sx, 0, 0, sy, tx, ty]
}

/**
 * Resolve original page dimensions independently from the existing fit-to-page
 * asset importer. Absolute units use CSS's fixed 96 px/in ratio, never screen DPR.
 * https://www.w3.org/TR/css-values-4/#absolute-lengths
 * https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform
 * https://www.w3.org/TR/SVG2/coords.html#IntrinsicSizing
 *
 * Fabric 7.4.0 skips an alignment-only viewBox translation at scale 1. Baking
 * that matrix also avoids its missing-dimension and Q-unit parsing differences:
 * https://github.com/fabricjs/fabric.js/blob/v740/src/parser/applyViewboxTransform.ts
 */
export function prepareSvgNativeImport(source: string): SvgNativeGeometry {
  // Parse a detached XML document only after applying the same pre-parse gates
  // as svgSafety. No input is rendered or handed to Fabric before sanitization.
  if (new TextEncoder().encode(source).byteLength > MAX_SVG_BYTES) {
    throw new SvgSafetyError(
      'svg-byte-limit',
      'SVG file exceeds the size limit.',
    )
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) {
    throw new SvgSafetyError(
      'invalid-svg',
      'SVG document declarations are unsupported.',
    )
  }
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = document.documentElement as unknown as SVGSVGElement
  if (
    document.querySelector('parsererror') ||
    root.localName !== 'svg' ||
    root.namespaceURI !== SVG_NS
  ) {
    throw new SvgSafetyError('invalid-svg', 'The SVG document is malformed.')
  }

  const [widthLength, heightLength] = readRootSizes(root)
  const viewBox = parseViewBox(root.getAttribute('viewBox'))
  const rootTransform = readRootTransform(root)
  const fixedWidth =
    widthLength.kind === 'fixed' ? widthLength.pixels : undefined
  const fixedHeight =
    heightLength.kind === 'fixed' ? heightLength.pixels : undefined
  if ((fixedWidth === undefined || fixedHeight === undefined) && !viewBox) {
    return invalidViewport(
      'SVG original-size import needs fixed dimensions or a valid viewBox.',
    )
  }
  const viewportWidth =
    fixedWidth ??
    (fixedHeight === undefined
      ? viewBox!.width
      : (fixedHeight * viewBox!.width) / viewBox!.height)
  const viewportHeight =
    fixedHeight ??
    (fixedWidth === undefined
      ? viewBox!.height
      : (fixedWidth * viewBox!.height) / viewBox!.width)
  if (
    ![viewportWidth, viewportHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return invalidViewport('The resolved SVG viewport is invalid.')
  }

  const inferred = fixedWidth === undefined || fixedHeight === undefined
  const inferenceReason: SvgNativeInferenceReason | undefined = !inferred
    ? undefined
    : widthLength.kind === 'relative' || heightLength.kind === 'relative'
      ? 'relative-dimensions'
      : fixedWidth === undefined && fixedHeight === undefined
        ? 'viewbox-only'
        : 'missing-dimension'
  // A px-only SVG remains a pixel document. A declared physical axis supplies
  // the fixed CSS conversion for the other explicit or aspect-derived axis.
  const physical =
    (widthLength.kind === 'fixed' && widthLength.physical) ||
    (heightLength.kind === 'fixed' && heightLength.physical)
  const widthMm = (viewportWidth * 25.4) / SVG_CSS_DPI
  const heightMm = (viewportHeight * 25.4) / SVG_CSS_DPI
  if (physical && (widthMm < 0.01 || heightMm < 0.01)) {
    return invalidViewport(
      'Physical SVG page dimensions must be at least 0.01 mm.',
    )
  }

  root.setAttribute('width', `${viewportWidth}px`)
  root.setAttribute('height', `${viewportHeight}px`)
  root.style.removeProperty('width')
  root.style.removeProperty('height')
  if (!root.getAttribute('style')?.trim()) root.removeAttribute('style')

  const matrix = multiply(
    rootTransform,
    viewBox
      ? viewportMatrix(
          viewBox,
          viewportWidth,
          viewportHeight,
          root.getAttribute('preserveAspectRatio'),
        )
      : IDENTITY,
  )
  if (!matrix.every(Number.isFinite)) invalidTransform()
  // Keep the authored element tree unchanged: a synthetic <g> would match
  // existing g selectors and alter colors, opacity or even this transform.
  root.setAttribute('transform', `matrix(${matrix.join(' ')})`)
  // Always fix the inline value as well: Fabric matches id/class selectors
  // case-insensitively and can otherwise apply a rule that does not match the
  // actual SVG root. Commas make this matrix valid in CSS and SVG syntax.
  root.style.setProperty('transform', `matrix(${matrix.join(', ')})`)
  if (viewBox) {
    root.removeAttribute('viewBox')
    root.removeAttribute('preserveAspectRatio')
  }

  // Validate the resolved viewport, embedded resources, references, use expansion,
  // and added transform together. The asset import sanitizer remains unchanged.
  const sanitized = sanitizeSvg(new XMLSerializer().serializeToString(root))
  return {
    source: sanitized.source,
    width: Math.max(1, Math.round(viewportWidth)),
    height: Math.max(1, Math.round(viewportHeight)),
    viewportWidth,
    viewportHeight,
    ...(physical
      ? {
          physicalSize: {
            unit: 'mm' as const,
            widthMm,
            heightMm,
            sourceDpi: SVG_CSS_DPI,
          },
        }
      : {}),
    inferred,
    ...(inferenceReason ? { inferenceReason } : {}),
    removedElements: sanitized.removedElements,
    removedAttributes: sanitized.removedAttributes,
  }
}
