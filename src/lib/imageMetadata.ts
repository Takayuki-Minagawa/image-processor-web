export interface ImageDimensions {
  width: number
  height: number
}

export const IMAGE_HEADER_READ_BYTES = 1024 * 1024

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

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

const pngDimensions = (bytes: Uint8Array): ImageDimensions | null => {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    ascii(bytes, 1, 3) !== 'PNG' ||
    ascii(bytes, 12, 4) !== 'IHDR'
  ) {
    return null
  }
  return {
    width: readUint32BigEndian(bytes, 16),
    height: readUint32BigEndian(bytes, 20),
  }
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

const jpegDimensions = (bytes: Uint8Array): ImageDimensions | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1
    }
    if (offset >= bytes.length) return null

    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0x01) continue
    if (marker === 0xd9 || marker === 0xda) return null
    if (offset + 1 >= bytes.length) return null

    const segmentLength = readUint16BigEndian(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null
      return {
        height: readUint16BigEndian(bytes, offset + 3),
        width: readUint16BigEndian(bytes, offset + 5),
      }
    }
    offset += segmentLength
  }
  return null
}

const webpDimensions = (bytes: Uint8Array): ImageDimensions | null => {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP'
  ) {
    return null
  }

  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X') {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    }
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
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

/**
 * Reads dimensions without asking the browser image decoder to allocate the
 * complete bitmap. Only PNG, JPEG, and WebP are intentionally supported.
 */
export function parseImageDimensions(
  bytes: Uint8Array,
  mimeType: string,
): ImageDimensions | null {
  if (mimeType === 'image/png') return pngDimensions(bytes)
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes)
  if (mimeType === 'image/webp') return webpDimensions(bytes)
  return null
}
