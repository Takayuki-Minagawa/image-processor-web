import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from './imageSafety'

export const MAX_SVG_BYTES = 5 * 1024 * 1024
export const MAX_SVG_ELEMENTS = 10_000
export const MAX_SVG_ATTRIBUTE_LENGTH = 128 * 1024
const MAX_SVG_EMBEDDED_IMAGE_BYTES = Math.floor((MAX_SVG_BYTES * 3) / 4)
const EMBEDDED_IMAGE_HEADER_BYTES = 1024 * 1024

export type SvgSafetyErrorCode =
  | 'invalid-svg'
  | 'svg-byte-limit'
  | 'svg-element-limit'
  | 'svg-attribute-limit'
  | 'svg-dimension-limit'

export class SvgSafetyError extends Error {
  readonly code: SvgSafetyErrorCode

  constructor(code: SvgSafetyErrorCode, message: string) {
    super(message)
    this.name = 'SvgSafetyError'
    this.code = code
  }
}

export interface SvgSanitizerOptions {
  maxBytes?: number
  maxElements?: number
  maxAttributeLength?: number
  /** Maximum edge length for the SVG root and every embedded raster. */
  maxDimension?: number
  /** Maximum pixels for the root, each embedded raster, and all embedded rasters combined. */
  maxPixels?: number
  /** Maximum decoded bytes for each embedded raster and all embedded rasters combined. */
  maxEmbeddedImageBytes?: number
}

export interface SanitizedSvg {
  source: string
  width: number
  height: number
  elementCount: number
  removedElements: number
  removedAttributes: number
}

const FORBIDDEN_ELEMENTS = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'applet',
  'audio',
  'canvas',
  'discard',
  'embed',
  'foreignobject',
  'iframe',
  'object',
  'script',
  'set',
  'video',
])

const REFERENCE_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'xlink:href',
  'xml:base',
])

/**
 * Matched against Attr.localName (the prefix-independent part) so a
 * rebound namespace prefix, e.g. `xmlns:x="...xlink" x:href="http://..."`,
 * is still treated as a reference attribute instead of falling through to
 * the generic value checks below.
 */
const REFERENCE_ATTRIBUTE_LOCAL_NAMES = new Set([
  'href',
  'src',
  'srcset',
  'base',
])

const UNSAFE_CSS = /(?:@import|expression\s*\(|-moz-binding|behavior\s*:)/i
const URL_REFERENCE = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/giu
const RASTER_DATA_URL =
  /^data:(image\/(?:png|jpeg|webp))(?:;charset=[^;,]+)?;base64,([a-z0-9+/]*={0,2})$/i
const LENGTH_VALUE =
  /^\s*([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|q|pt|pc)?\s*$/i

const positiveLimit = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback

const localName = (value: string): string => value.toLowerCase()

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

const readUint16BigEndian = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] * 0x100 + bytes[offset + 1]

const readUint16LittleEndian = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] + bytes[offset + 1] * 0x100

const readUint24LittleEndian = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000

const readUint32BigEndian = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] * 0x1000000 +
  bytes[offset + 1] * 0x10000 +
  bytes[offset + 2] * 0x100 +
  bytes[offset + 3]

const readUint32LittleEndian = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] +
  bytes[offset + 1] * 0x100 +
  bytes[offset + 2] * 0x10000 +
  bytes[offset + 3] * 0x1000000

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

const embeddedRasterDimensions = (
  bytes: Uint8Array,
  mimeType: string,
  decodedBytes: number,
): { width: number; height: number } | null => {
  if (mimeType === 'image/png') {
    if (
      bytes.length < 24 ||
      ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      ) ||
      readUint32BigEndian(bytes, 8) !== 13 ||
      ascii(bytes, 12, 4) !== 'IHDR'
    ) {
      return null
    }
    return {
      width: readUint32BigEndian(bytes, 16),
      height: readUint32BigEndian(bytes, 20),
    }
  }

  if (mimeType === 'image/jpeg') {
    if (
      bytes.length < 4 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[2] !== 0xff
    ) {
      return null
    }
    let offset = 2
    while (offset + 3 < bytes.length) {
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
      if (offset >= bytes.length) return null
      const marker = bytes[offset]
      offset += 1
      if (marker === 0xd8 || marker === 0x01) continue
      if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) {
        return null
      }
      const segmentLength = readUint16BigEndian(bytes, offset)
      if (segmentLength < 2 || offset + segmentLength > bytes.length) {
        return null
      }
      if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
        return segmentLength >= 7
          ? {
              height: readUint16BigEndian(bytes, offset + 3),
              width: readUint16BigEndian(bytes, offset + 5),
            }
          : null
      }
      offset += segmentLength
    }
    return null
  }

  if (
    mimeType !== 'image/webp' ||
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP' ||
    readUint32LittleEndian(bytes, 4) + 8 > decodedBytes
  ) {
    return null
  }

  const chunk = ascii(bytes, 12, 4)
  const chunkBytes = readUint32LittleEndian(bytes, 16)
  if (chunkBytes + 20 > decodedBytes) return null
  if (chunk === 'VP8X' && chunkBytes >= 10) {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    }
  }
  if (chunk === 'VP8L' && chunkBytes >= 5 && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height:
        1 +
        ((bytes[22] & 0xc0) >> 6) +
        (bytes[23] << 2) +
        ((bytes[24] & 0x0f) << 10),
    }
  }
  if (
    chunk === 'VP8 ' &&
    chunkBytes >= 10 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: readUint16LittleEndian(bytes, 26) & 0x3fff,
      height: readUint16LittleEndian(bytes, 28) & 0x3fff,
    }
  }
  return null
}

const urlReferencesAreLocal = (value: string): boolean => {
  URL_REFERENCE.lastIndex = 0
  let found = false
  let match: RegExpExecArray | null
  while ((match = URL_REFERENCE.exec(value)) !== null) {
    found = true
    if (!match[2].trim().startsWith('#')) {
      return false
    }
  }
  return !/\burl\s*\(/iu.test(value) || found
}

interface EmbeddedRasterCost {
  decodedBytes: number
  pixels: number
}

const inspectEmbeddedRaster = (
  value: string,
  maxDecodedBytes: number,
  maxDimension: number,
  maxPixels: number,
): EmbeddedRasterCost | null => {
  const match = RASTER_DATA_URL.exec(value)
  if (!match) {
    return null
  }

  const mimeType = match[1].toLowerCase()
  const encoded = match[2]
  const remainder = encoded.length % 4
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  if (
    encoded.length === 0 ||
    remainder === 1 ||
    (padding > 0 && remainder !== 0)
  ) {
    return null
  }

  const decodedBytes = Math.floor((encoded.length * 3) / 4) - padding
  if (decodedBytes <= 0 || decodedBytes > maxDecodedBytes) {
    return null
  }

  // Header inspection is deliberately bounded: a JPEG may place its SOF marker
  // after metadata, but untrusted SVG must never make the synchronous sanitizer
  // allocate the complete embedded image merely to discover its dimensions.
  const maxEncodedHeaderLength = Math.floor(
    (EMBEDDED_IMAGE_HEADER_BYTES / 3) * 4,
  )
  let encodedHeader = encoded.slice(0, maxEncodedHeaderLength)
  if (encodedHeader.length < encoded.length) {
    encodedHeader = encodedHeader.slice(
      0,
      encodedHeader.length % 4 === 0 ? undefined : -(encodedHeader.length % 4),
    )
  }

  let decodedHeader: string
  try {
    decodedHeader = globalThis.atob(encodedHeader)
  } catch {
    return null
  }

  const bytes = Uint8Array.from(decodedHeader, (character) =>
    character.charCodeAt(0),
  )
  const dimensions = embeddedRasterDimensions(bytes, mimeType, decodedBytes)
  if (
    dimensions === null ||
    !Number.isSafeInteger(dimensions.width) ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > maxDimension ||
    dimensions.height > maxDimension
  ) {
    return null
  }

  const pixels = dimensions.width * dimensions.height
  return pixels <= maxPixels ? { decodedBytes, pixels } : null
}

const referenceIsLocal = (
  value: string,
  maxEmbeddedImageBytes: number,
  maxDimension: number,
  maxPixels: number,
  consumed: EmbeddedRasterCost,
): boolean => {
  const normalized = value.trim()
  if (normalized.startsWith('#')) {
    return true
  }

  const raster = inspectEmbeddedRaster(
    normalized,
    maxEmbeddedImageBytes,
    maxDimension,
    maxPixels,
  )
  if (
    raster === null ||
    raster.decodedBytes > maxEmbeddedImageBytes - consumed.decodedBytes ||
    raster.pixels > maxPixels - consumed.pixels
  ) {
    return false
  }

  consumed.decodedBytes += raster.decodedBytes
  consumed.pixels += raster.pixels
  return true
}

const sanitizeStyleAttribute = (value: string): string | null => {
  if (UNSAFE_CSS.test(value)) {
    return null
  }

  const safeDeclarations = value
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => urlReferencesAreLocal(declaration))

  return safeDeclarations.length > 0 ? safeDeclarations.join('; ') : null
}

const MAX_USE_REFERENCE_DEPTH = 256

/**
 * `<use href="#id">` clones the referenced subtree. Because a clone can
 * itself contain `<use>` elements pointing at earlier siblings, a document
 * with only a few thousand literal elements can resolve to an exponential
 * number of nodes (a "billion laughs" style bomb) even though it passes the
 * flat element-count check. This walks the reference graph with memoized,
 * cycle-safe weights and rejects documents whose *resolved* element count
 * would exceed `limit`, without ever materializing the expansion.
 */
const assertBoundedUseExpansion = (root: Element, limit: number): void => {
  const byId = new Map<string, Element>()
  for (const element of [root, ...root.querySelectorAll('*')]) {
    const id = element.getAttribute('id')
    if (id !== null && !byId.has(id)) {
      byId.set(id, element)
    }
  }

  const memo = new Map<Element, number>()
  const visiting = new Set<Element>()

  const weightOf = (element: Element, depth: number): number => {
    const cached = memo.get(element)
    if (cached !== undefined) {
      return cached
    }
    if (depth > MAX_USE_REFERENCE_DEPTH || visiting.has(element)) {
      throw new SvgSafetyError(
        'svg-element-limit',
        'SVG <use> references are too deeply nested or cyclic.',
      )
    }
    visiting.add(element)

    let total = 1
    if (localName(element.localName) === 'use') {
      const href =
        element.getAttribute('href') ?? element.getAttribute('xlink:href')
      const targetId =
        href !== null && href.trim().startsWith('#')
          ? href.trim().slice(1)
          : null
      const target = targetId !== null ? byId.get(targetId) : undefined
      if (target !== undefined) {
        total += weightOf(target, depth + 1)
      }
    } else {
      for (const child of Array.from(element.children)) {
        total += weightOf(child, depth + 1)
      }
    }

    visiting.delete(element)
    if (total > limit) {
      throw new SvgSafetyError(
        'svg-element-limit',
        `SVG <use> references may not resolve to more than ${limit} elements.`,
      )
    }
    memo.set(element, total)
    return total
  }

  weightOf(root, 0)
}

const parseLength = (value: string | null): number | null => {
  if (value === null || value.trim() === '') {
    return null
  }
  const match = LENGTH_VALUE.exec(value)
  if (!match) {
    return null
  }
  const amount = Number(match[1])
  const unit = (match[2] ?? 'px').toLowerCase()
  const scale =
    unit === 'in'
      ? 96
      : unit === 'cm'
        ? 96 / 2.54
        : unit === 'mm'
          ? 96 / 25.4
          : unit === 'q'
            ? 96 / 101.6
            : unit === 'pt'
              ? 96 / 72
              : unit === 'pc'
                ? 16
                : 1
  const pixels = amount * scale
  return Number.isFinite(pixels) && pixels > 0 ? pixels : null
}

const parseViewBox = (
  value: string | null,
): { width: number; height: number } | null => {
  if (!value) {
    return null
  }
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .filter(Boolean)
    .map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isFinite(part)) ||
    parts[2] <= 0 ||
    parts[3] <= 0
  ) {
    return null
  }
  return { width: parts[2], height: parts[3] }
}

const readDimensions = (
  root: SVGSVGElement,
): { width: number; height: number } => {
  const width = parseLength(root.getAttribute('width'))
  const height = parseLength(root.getAttribute('height'))
  const viewBox = parseViewBox(root.getAttribute('viewBox'))

  if (width !== null && height !== null) {
    return { width, height }
  }
  if (viewBox) {
    return {
      width: width ?? viewBox.width,
      height: height ?? viewBox.height,
    }
  }
  throw new SvgSafetyError(
    'invalid-svg',
    'SVG dimensions must be positive fixed lengths or a valid viewBox.',
  )
}

const assertSafeDimensions = (
  dimensions: { width: number; height: number },
  maxDimension: number,
  maxPixels: number,
): void => {
  if (
    dimensions.width > maxDimension ||
    dimensions.height > maxDimension ||
    dimensions.width * dimensions.height > maxPixels
  ) {
    throw new SvgSafetyError(
      'svg-dimension-limit',
      `SVG dimensions exceed the ${maxDimension.toLocaleString('en-US')} px / ${maxPixels.toLocaleString('en-US')} pixel safety limit.`,
    )
  }
}

/**
 * Sanitizes untrusted SVG before it reaches Fabric.js or a browser DOM.
 *
 * Only local fragment references and embedded PNG/JPEG/WebP data URLs survive.
 * Elements or attributes capable of executing script, embedding HTML, or
 * fetching an external resource are removed.
 */
export function sanitizeSvg(
  source: string,
  options: SvgSanitizerOptions = {},
): SanitizedSvg {
  const maxBytes = positiveLimit(options.maxBytes, MAX_SVG_BYTES)
  const maxElements = Math.floor(
    positiveLimit(options.maxElements, MAX_SVG_ELEMENTS),
  )
  const maxAttributeLength = Math.floor(
    positiveLimit(options.maxAttributeLength, MAX_SVG_ATTRIBUTE_LENGTH),
  )
  const maxDimension = positiveLimit(options.maxDimension, MAX_IMAGE_DIMENSION)
  const maxPixels = positiveLimit(options.maxPixels, MAX_IMAGE_PIXELS)
  const maxEmbeddedImageBytes = Math.floor(
    positiveLimit(options.maxEmbeddedImageBytes, MAX_SVG_EMBEDDED_IMAGE_BYTES),
  )

  if (typeof source !== 'string' || source.trim() === '') {
    throw new SvgSafetyError('invalid-svg', 'SVG source must be non-empty.')
  }
  if (new TextEncoder().encode(source).byteLength > maxBytes) {
    throw new SvgSafetyError(
      'svg-byte-limit',
      `SVG files must be no larger than ${maxBytes} bytes.`,
    )
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) {
    throw new SvgSafetyError(
      'invalid-svg',
      'SVG document type and entity declarations are not allowed.',
    )
  }

  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (
    document.querySelector('parsererror') ||
    localName(document.documentElement.localName) !== 'svg' ||
    document.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg'
  ) {
    throw new SvgSafetyError('invalid-svg', 'The SVG document is malformed.')
  }

  const root = document.documentElement as unknown as SVGSVGElement
  const allElements = [...root.querySelectorAll('*')]
  const originalElementCount = allElements.length + 1
  if (originalElementCount > maxElements) {
    throw new SvgSafetyError(
      'svg-element-limit',
      `SVG files may contain at most ${maxElements} elements.`,
    )
  }

  let removedElements = 0
  let removedAttributes = 0
  const consumedEmbeddedRasterBudget: EmbeddedRasterCost = {
    decodedBytes: 0,
    pixels: 0,
  }

  for (const element of allElements) {
    if (FORBIDDEN_ELEMENTS.has(localName(element.localName))) {
      element.remove()
      removedElements += 1
    }
  }

  const retainedElements = [root, ...root.querySelectorAll('*')]
  for (const element of retainedElements) {
    const elementName = localName(element.localName)
    if (elementName === 'style') {
      const css = element.textContent ?? ''
      if (UNSAFE_CSS.test(css) || !urlReferencesAreLocal(css)) {
        element.remove()
        removedElements += 1
        continue
      }
    }

    for (const attribute of [...element.attributes]) {
      const attributeName = localName(attribute.name)
      const attributeLocalName = localName(attribute.localName)
      const value = attribute.value
      if (value.length > maxAttributeLength) {
        throw new SvgSafetyError(
          'svg-attribute-limit',
          `SVG attributes may contain at most ${maxAttributeLength} characters.`,
        )
      }

      let sanitizedValue: string | null = value
      if (
        attributeName.startsWith('on') ||
        REFERENCE_ATTRIBUTES.has(attributeName) ||
        REFERENCE_ATTRIBUTE_LOCAL_NAMES.has(attributeLocalName)
      ) {
        sanitizedValue =
          !attributeName.startsWith('on') &&
          referenceIsLocal(
            value,
            maxEmbeddedImageBytes,
            maxDimension,
            maxPixels,
            consumedEmbeddedRasterBudget,
          )
            ? value
            : null
      } else if (attributeName === 'style') {
        sanitizedValue = sanitizeStyleAttribute(value)
      } else if (
        UNSAFE_CSS.test(value) ||
        !urlReferencesAreLocal(value) ||
        /^\s*javascript:/iu.test(value)
      ) {
        sanitizedValue = null
      }

      if (sanitizedValue === null) {
        element.removeAttributeNode(attribute)
        removedAttributes += 1
      } else if (sanitizedValue !== value) {
        element.setAttribute(attribute.name, sanitizedValue)
      }
    }
  }

  assertBoundedUseExpansion(root, maxElements)

  const dimensions = readDimensions(root)
  assertSafeDimensions(dimensions, maxDimension, maxPixels)

  return {
    source: new XMLSerializer().serializeToString(root),
    width: dimensions.width,
    height: dimensions.height,
    elementCount: root.querySelectorAll('*').length + 1,
    removedElements,
    removedAttributes,
  }
}

export const sanitizeSvgString = (
  source: string,
  options?: SvgSanitizerOptions,
): string => sanitizeSvg(source, options).source
