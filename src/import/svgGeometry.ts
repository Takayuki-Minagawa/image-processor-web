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
  readonly code: 'svg-css-size' | 'svg-viewport'

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
): string => {
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
  return `matrix(${sx} 0 0 ${sy} ${tx} ${ty})`
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

  if (viewBox) {
    const group = document.createElementNS(SVG_NS, 'g')
    group.setAttribute(
      'transform',
      viewportMatrix(
        viewBox,
        viewportWidth,
        viewportHeight,
        root.getAttribute('preserveAspectRatio'),
      ),
    )
    while (root.firstChild) group.appendChild(root.firstChild)
    root.appendChild(group)
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
