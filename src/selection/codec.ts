import { MAX_SELECTION_MASK_PIXELS, SelectionMask } from './mask'
import type { EncodedSelectionMask } from '../editor/types'

const MAGIC = [0x50, 0x57, 0x4d, 0x31] as const
const HEADER_BYTES = 13
const RAW_ENCODING = 0
const RLE_ENCODING = 1

export const MAX_ENCODED_SELECTION_MASK_BYTES = 128 * 1024 * 1024

export interface SelectionMaskCodecLimits {
  maximumPixels?: number
  maximumEncodedBytes?: number
}

export class SelectionMaskCodecError extends Error {
  readonly code:
    | 'encoded-size-limit'
    | 'invalid-header'
    | 'invalid-dimensions'
    | 'invalid-payload'

  constructor(code: SelectionMaskCodecError['code'], message: string) {
    super(message)
    this.name = 'SelectionMaskCodecError'
    this.code = code
  }
}

const resolvedLimits = (
  limits: SelectionMaskCodecLimits = {},
): Required<SelectionMaskCodecLimits> => ({
  maximumPixels: limits.maximumPixels ?? MAX_SELECTION_MASK_PIXELS,
  maximumEncodedBytes:
    limits.maximumEncodedBytes ?? MAX_ENCODED_SELECTION_MASK_BYTES,
})

const assertEncodedSize = (size: number, maximumEncodedBytes: number): void => {
  if (
    !Number.isSafeInteger(maximumEncodedBytes) ||
    maximumEncodedBytes < HEADER_BYTES ||
    size > maximumEncodedBytes
  ) {
    throw new SelectionMaskCodecError(
      'encoded-size-limit',
      `Encoded selection mask exceeds the ${maximumEncodedBytes} byte limit.`,
    )
  }
}

const writeHeader = (
  output: Uint8Array,
  encoding: number,
  width: number,
  height: number,
): void => {
  output.set(MAGIC, 0)
  output[4] = encoding
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength)
  view.setUint32(5, width, true)
  view.setUint32(9, height, true)
}

export const encodeSelectionMask = (
  mask: SelectionMask,
  limits: SelectionMaskCodecLimits = {},
): Uint8Array => {
  const { maximumPixels, maximumEncodedBytes } = resolvedLimits(limits)
  if (mask.pixelCount > maximumPixels) {
    throw new SelectionMaskCodecError(
      'invalid-dimensions',
      `Selection mask exceeds the ${maximumPixels} pixel limit.`,
    )
  }

  const source = mask.toBytes()
  const runs: Array<{ value: number; length: number }> = []
  let start = 0
  while (start < source.length) {
    const value = source[start]
    let end = start + 1
    while (end < source.length && source[end] === value) {
      end += 1
    }
    runs.push({ value, length: end - start })
    start = end
  }

  const rawLength = HEADER_BYTES + source.length
  const rleLength = HEADER_BYTES + runs.length * 5
  const useRle = rleLength < rawLength
  const outputLength = useRle ? rleLength : rawLength
  assertEncodedSize(outputLength, maximumEncodedBytes)

  const output = new Uint8Array(outputLength)
  writeHeader(
    output,
    useRle ? RLE_ENCODING : RAW_ENCODING,
    mask.width,
    mask.height,
  )
  if (!useRle) {
    output.set(source, HEADER_BYTES)
    return output
  }

  const view = new DataView(output.buffer)
  runs.forEach((run, index) => {
    const offset = HEADER_BYTES + index * 5
    output[offset] = run.value
    view.setUint32(offset + 1, run.length, true)
  })
  return output
}

export const decodeSelectionMask = (
  encoded: Uint8Array,
  limits: SelectionMaskCodecLimits = {},
): SelectionMask => {
  const { maximumPixels, maximumEncodedBytes } = resolvedLimits(limits)
  if (!(encoded instanceof Uint8Array) || encoded.length < HEADER_BYTES) {
    throw new SelectionMaskCodecError(
      'invalid-header',
      'Encoded selection mask header is incomplete.',
    )
  }
  assertEncodedSize(encoded.length, maximumEncodedBytes)
  if (MAGIC.some((byte, index) => encoded[index] !== byte)) {
    throw new SelectionMaskCodecError(
      'invalid-header',
      'Encoded selection mask has an invalid signature.',
    )
  }

  const view = new DataView(
    encoded.buffer,
    encoded.byteOffset,
    encoded.byteLength,
  )
  const encoding = encoded[4]
  const width = view.getUint32(5, true)
  const height = view.getUint32(9, true)
  const pixelCount = width * height
  if (
    width === 0 ||
    height === 0 ||
    !Number.isSafeInteger(pixelCount) ||
    pixelCount > maximumPixels
  ) {
    throw new SelectionMaskCodecError(
      'invalid-dimensions',
      'Encoded selection mask dimensions are invalid or too large.',
    )
  }

  if (encoding === RAW_ENCODING) {
    if (encoded.length !== HEADER_BYTES + pixelCount) {
      throw new SelectionMaskCodecError(
        'invalid-payload',
        'Raw selection mask payload length is invalid.',
      )
    }
    return SelectionMask.fromBytes(
      width,
      height,
      encoded.subarray(HEADER_BYTES),
      maximumPixels,
    )
  }
  if (encoding !== RLE_ENCODING) {
    throw new SelectionMaskCodecError(
      'invalid-header',
      `Unknown selection mask encoding ${encoding}.`,
    )
  }

  const output = new Uint8Array(pixelCount)
  let inputOffset = HEADER_BYTES
  let outputOffset = 0
  while (inputOffset < encoded.length) {
    if (inputOffset + 5 > encoded.length) {
      throw new SelectionMaskCodecError(
        'invalid-payload',
        'Run-length selection mask payload is truncated.',
      )
    }
    const value = encoded[inputOffset]
    const runLength = view.getUint32(inputOffset + 1, true)
    if (runLength === 0 || outputOffset + runLength > output.length) {
      throw new SelectionMaskCodecError(
        'invalid-payload',
        'Run-length selection mask payload contains an invalid run.',
      )
    }
    output.fill(value, outputOffset, outputOffset + runLength)
    outputOffset += runLength
    inputOffset += 5
  }
  if (outputOffset !== output.length) {
    throw new SelectionMaskCodecError(
      'invalid-payload',
      'Run-length selection mask payload does not fill its dimensions.',
    )
  }
  return SelectionMask.fromBytes(width, height, output, maximumPixels)
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

const base64ToBytes = (value: string): Uint8Array => {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new SelectionMaskCodecError(
      'invalid-payload',
      'Project selection mask is not valid Base64.',
    )
  }
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new SelectionMaskCodecError(
      'invalid-payload',
      'Project selection mask is not valid Base64.',
    )
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

/** Bridges the binary history-safe codec to the JSON project representation. */
export const encodeSelectionMaskForProject = (
  mask: SelectionMask,
  limits: SelectionMaskCodecLimits = {},
): EncodedSelectionMask => ({
  width: mask.width,
  height: mask.height,
  encoding: 'rle-base64',
  data: bytesToBase64(encodeSelectionMask(mask, limits)),
})

/** Decodes and cross-checks the dimensions stored in a project document. */
export const decodeSelectionMaskFromProject = (
  encoded: EncodedSelectionMask,
  limits: SelectionMaskCodecLimits = {},
): SelectionMask => {
  if (encoded.encoding !== 'rle-base64') {
    throw new SelectionMaskCodecError(
      'invalid-header',
      'Project selection mask uses an unsupported encoding.',
    )
  }
  const mask = decodeSelectionMask(base64ToBytes(encoded.data), limits)
  if (mask.width !== encoded.width || mask.height !== encoded.height) {
    throw new SelectionMaskCodecError(
      'invalid-dimensions',
      'Project selection mask dimensions do not match its payload.',
    )
  }
  return mask
}
