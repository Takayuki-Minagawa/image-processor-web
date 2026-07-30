import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  assertSafeImageDimensions,
  imageDimensionsAreSafe,
  matchEmbeddedImageDataUrl,
} from '../lib/imageSafety'
import {
  IMAGE_HEADER_READ_BYTES,
  parseImageDimensions,
  type ImageDimensions,
} from '../lib/imageMetadata'

export interface RestorableEditorSnapshot {
  json: Record<string, unknown>
  width: number
  height: number
}

export const MAX_PROJECT_DECODE_PIXELS = 2 * MAX_IMAGE_PIXELS
export const MAX_PROJECT_OBJECTS = 500
export const MAX_PROJECT_JSON_NODES = 50_000

const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export { imageDimensionsMatchHeader } from '../lib/imageSafety'

export const inspectEmbeddedImageDataUrl = (
  dataUrl: string,
): { dimensions: ImageDimensions; decodedBytes: number } => {
  const metadata = matchEmbeddedImageDataUrl(dataUrl)
  if (!metadata) {
    throw new TypeError(
      'Projects may contain only embedded PNG, JPEG, or WebP images.',
    )
  }

  const encoded = dataUrl.slice(metadata.prefixLength)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new TypeError('The embedded image contains invalid Base64 data.')
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const decodedBytes = Math.max(
    0,
    Math.floor((encoded.length * 3) / 4) - padding,
  )
  if (decodedBytes <= 0 || decodedBytes > MAX_IMAGE_BYTES) {
    throw new RangeError(
      'Embedded images must be non-empty and no larger than 50 MB.',
    )
  }

  let prefixLength = Math.min(
    encoded.length,
    Math.ceil((IMAGE_HEADER_READ_BYTES * 4) / 3),
  )
  prefixLength -= prefixLength % 4
  if (prefixLength === 0) {
    throw new TypeError('The embedded image header is incomplete.')
  }

  let decodedPrefix: string
  try {
    decodedPrefix = globalThis.atob(encoded.slice(0, prefixLength))
  } catch (error) {
    throw new TypeError('The embedded image could not be decoded.', {
      cause: error,
    })
  }
  const bytes = Uint8Array.from(decodedPrefix, (character) =>
    character.charCodeAt(0),
  )
  const dimensions = parseImageDimensions(bytes, metadata.mimeType)
  if (!dimensions) {
    throw new TypeError(
      'The embedded image dimensions could not be verified safely.',
    )
  }
  return {
    dimensions: assertSafeImageDimensions(dimensions),
    decodedBytes,
  }
}

const assertSafeRendererImageSources = (value: unknown): void => {
  const pending: unknown[] = [value]
  const visited = new WeakSet<object>()
  let nodeCount = 0
  let totalDecodePixels = 0

  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current !== 'object' || current === null) {
      continue
    }
    if (visited.has(current)) {
      continue
    }
    visited.add(current)
    nodeCount += 1
    if (nodeCount > MAX_PROJECT_JSON_NODES) {
      throw new RangeError('The project structure is too large to open safely.')
    }

    if (Array.isArray(current)) {
      pending.push(...current)
      continue
    }

    Object.entries(current).forEach(([key, child]) => {
      if (UNSAFE_JSON_KEYS.has(key)) {
        throw new TypeError(`Unsafe project key: ${key}`)
      }
      if (key === 'src') {
        if (typeof child !== 'string') {
          throw new TypeError('Embedded image sources must be strings.')
        }
        const { dimensions } = inspectEmbeddedImageDataUrl(child)
        totalDecodePixels += dimensions.width * dimensions.height
        if (totalDecodePixels > MAX_PROJECT_DECODE_PIXELS) {
          throw new RangeError(
            'The project exceeds the 128 MP embedded-image decode limit.',
          )
        }
      }
      pending.push(child)
    })
  }
}

/**
 * Enforces the exact structural and decode limits used when restoring.
 *
 * The same function is called before persistence so the editor cannot create
 * a project that it would later refuse to reopen.
 */
export const assertRestorableEditorSnapshot = (
  snapshot: RestorableEditorSnapshot,
): void => {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !snapshot.json ||
    typeof snapshot.json !== 'object' ||
    Array.isArray(snapshot.json) ||
    !Number.isInteger(snapshot.width) ||
    !Number.isInteger(snapshot.height)
  ) {
    throw new TypeError('Invalid editor snapshot.')
  }

  const serializedObjects = snapshot.json.objects
  if (
    serializedObjects !== undefined &&
    (!Array.isArray(serializedObjects) ||
      serializedObjects.length > MAX_PROJECT_OBJECTS)
  ) {
    throw new RangeError(
      `Projects may contain at most ${MAX_PROJECT_OBJECTS} top-level objects.`,
    )
  }

  if (
    !imageDimensionsAreSafe({
      width: snapshot.width,
      height: snapshot.height,
    })
  ) {
    throw new RangeError(
      'Project dimensions exceed the 8,192 px / 64 MP safety limit.',
    )
  }

  assertSafeRendererImageSources(snapshot.json)
}
