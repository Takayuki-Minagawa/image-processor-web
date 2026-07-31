import { stripControlCharacters } from './safety'

export const MAX_ZIP_ENTRIES = 65_535
export const MAX_ZIP_BYTES = 0xffff_ffff

export interface StoredZipEntry {
  name: string
  data: ArrayBuffer
}

const encoder = new TextEncoder()

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let value = 0; value < table.length; value += 1) {
    let crc = value
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1
    }
    table[value] = crc >>> 0
  }
  return table
})()

export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffff_ffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

const updateCrc32 = (
  crc: number,
  bytes: Uint8Array,
  start: number,
  end: number,
): number => {
  let next = crc
  for (let index = start; index < end; index += 1) {
    next = crcTable[(next ^ bytes[index]) & 0xff] ^ (next >>> 8)
  }
  return next
}

export const normalizeZipEntryName = (name: string): string => {
  // Control characters are stripped BEFORE the "." / ".." traversal check so
  // a segment like "..\x00" (which is not literally ".." until the stripped
  // byte is removed) cannot smuggle a path-traversal segment through.
  const segments = name
    .normalize('NFKC')
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) =>
      stripControlCharacters(segment)
        .replace(/[<>:"|?*]/g, '-')
        .slice(0, 120),
    )
    .filter((segment) => segment && segment !== '.' && segment !== '..')
  const normalized = segments.join('/').slice(0, 512)
  if (!normalized) {
    throw new TypeError('ZIP entry names must contain a safe file name.')
  }
  return normalized
}

interface PreparedZipEntry {
  name: Uint8Array
  data: Uint8Array
  crc: number
  offset: number
}

const setUint16 = (view: DataView, offset: number, value: number): void =>
  view.setUint16(offset, value, true)

const setUint32 = (view: DataView, offset: number, value: number): void =>
  view.setUint32(offset, value, true)

/**
 * Creates a deterministic ZIP archive using method 0 (stored/no compression).
 * This is intentionally dependency-free and intended to run inside the batch
 * worker so copying large output buffers never blocks React.
 */
export const createStoredZip = (
  entries: readonly StoredZipEntry[],
): ArrayBuffer => {
  if (entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) {
    throw new RangeError('ZIP archives require 1 to 65,535 entries.')
  }
  const names = new Set<string>()
  let localSize = 0
  const prepared: PreparedZipEntry[] = entries.map((entry) => {
    const normalized = normalizeZipEntryName(entry.name)
    if (names.has(normalized)) {
      throw new TypeError(`Duplicate ZIP entry "${normalized}".`)
    }
    names.add(normalized)
    const name = encoder.encode(normalized)
    if (name.byteLength > 0xffff) {
      throw new RangeError('A ZIP entry name is too long.')
    }
    const data = new Uint8Array(entry.data)
    if (data.byteLength > MAX_ZIP_BYTES) {
      throw new RangeError('A ZIP entry exceeds the 4 GiB ZIP32 limit.')
    }
    const offset = localSize
    localSize += 30 + name.byteLength + data.byteLength
    if (localSize > MAX_ZIP_BYTES) {
      throw new RangeError('The ZIP archive exceeds the 4 GiB ZIP32 limit.')
    }
    return { name, data, crc: crc32(data), offset }
  })
  const centralSize = prepared.reduce(
    (total, entry) => total + 46 + entry.name.byteLength,
    0,
  )
  const totalSize = localSize + centralSize + 22
  if (totalSize > MAX_ZIP_BYTES) {
    throw new RangeError('The ZIP archive exceeds the 4 GiB ZIP32 limit.')
  }

  const archive = new ArrayBuffer(totalSize)
  const bytes = new Uint8Array(archive)
  const view = new DataView(archive)
  let offset = 0
  for (const entry of prepared) {
    setUint32(view, offset, 0x0403_4b50)
    setUint16(view, offset + 4, 20)
    setUint16(view, offset + 6, 0x0800)
    setUint16(view, offset + 8, 0)
    setUint16(view, offset + 10, 0)
    setUint16(view, offset + 12, 0)
    setUint32(view, offset + 14, entry.crc)
    setUint32(view, offset + 18, entry.data.byteLength)
    setUint32(view, offset + 22, entry.data.byteLength)
    setUint16(view, offset + 26, entry.name.byteLength)
    setUint16(view, offset + 28, 0)
    bytes.set(entry.name, offset + 30)
    bytes.set(entry.data, offset + 30 + entry.name.byteLength)
    offset += 30 + entry.name.byteLength + entry.data.byteLength
  }

  const centralOffset = offset
  for (const entry of prepared) {
    setUint32(view, offset, 0x0201_4b50)
    setUint16(view, offset + 4, 20)
    setUint16(view, offset + 6, 20)
    setUint16(view, offset + 8, 0x0800)
    setUint16(view, offset + 10, 0)
    setUint16(view, offset + 12, 0)
    setUint16(view, offset + 14, 0)
    setUint32(view, offset + 16, entry.crc)
    setUint32(view, offset + 20, entry.data.byteLength)
    setUint32(view, offset + 24, entry.data.byteLength)
    setUint16(view, offset + 28, entry.name.byteLength)
    setUint16(view, offset + 30, 0)
    setUint16(view, offset + 32, 0)
    setUint16(view, offset + 34, 0)
    setUint16(view, offset + 36, 0)
    setUint32(view, offset + 38, 0)
    setUint32(view, offset + 42, entry.offset)
    bytes.set(entry.name, offset + 46)
    offset += 46 + entry.name.byteLength
  }

  setUint32(view, offset, 0x0605_4b50)
  setUint16(view, offset + 4, 0)
  setUint16(view, offset + 6, 0)
  setUint16(view, offset + 8, prepared.length)
  setUint16(view, offset + 10, prepared.length)
  setUint32(view, offset + 12, centralSize)
  setUint32(view, offset + 16, centralOffset)
  setUint16(view, offset + 20, 0)
  return archive
}

const zipAbortError = (): DOMException =>
  new DOMException('ZIP creation was cancelled.', 'AbortError')

const yieldZipControl = (): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, 0))

/**
 * Cancellable worker-oriented variant of createStoredZip. CRC calculation and
 * byte copies yield between 1 MiB chunks so cancellation messages can be
 * observed even for large archives.
 */
export const createStoredZipAsync = async (
  entries: readonly StoredZipEntry[],
  options: {
    isCancelled?: () => boolean
    onProgress?: (progress: number) => void
    chunkBytes?: number
  } = {},
): Promise<ArrayBuffer> => {
  if (entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) {
    throw new RangeError('ZIP archives require 1 to 65,535 entries.')
  }
  const chunkBytes = Math.max(
    64 * 1_024,
    Math.min(
      8 * 1_024 * 1_024,
      Math.floor(options.chunkBytes ?? 1_024 * 1_024),
    ),
  )
  const checkCancelled = (): void => {
    if (options.isCancelled?.()) {
      throw zipAbortError()
    }
  }
  const inputBytes = entries.reduce(
    (total, entry) => total + entry.data.byteLength,
    0,
  )
  const totalWork = Math.max(1, inputBytes * 2)
  let completedWork = 0
  const report = (): void =>
    options.onProgress?.(Math.min(1, completedWork / totalWork))

  const names = new Set<string>()
  const prepared: PreparedZipEntry[] = []
  let localSize = 0
  for (const entry of entries) {
    checkCancelled()
    const normalized = normalizeZipEntryName(entry.name)
    if (names.has(normalized)) {
      throw new TypeError(`Duplicate ZIP entry "${normalized}".`)
    }
    names.add(normalized)
    const name = encoder.encode(normalized)
    if (name.byteLength > 0xffff) {
      throw new RangeError('A ZIP entry name is too long.')
    }
    const data = new Uint8Array(entry.data)
    if (data.byteLength > MAX_ZIP_BYTES) {
      throw new RangeError('A ZIP entry exceeds the 4 GiB ZIP32 limit.')
    }
    let crc = 0xffff_ffff
    for (let start = 0; start < data.byteLength; start += chunkBytes) {
      const end = Math.min(data.byteLength, start + chunkBytes)
      crc = updateCrc32(crc, data, start, end)
      completedWork += end - start
      report()
      await yieldZipControl()
      checkCancelled()
    }
    const offset = localSize
    localSize += 30 + name.byteLength + data.byteLength
    if (localSize > MAX_ZIP_BYTES) {
      throw new RangeError('The ZIP archive exceeds the 4 GiB ZIP32 limit.')
    }
    prepared.push({ name, data, crc: (crc ^ 0xffff_ffff) >>> 0, offset })
    await yieldZipControl()
  }

  const centralSize = prepared.reduce(
    (total, entry) => total + 46 + entry.name.byteLength,
    0,
  )
  const totalSize = localSize + centralSize + 22
  if (totalSize > MAX_ZIP_BYTES) {
    throw new RangeError('The ZIP archive exceeds the 4 GiB ZIP32 limit.')
  }
  checkCancelled()
  const archive = new ArrayBuffer(totalSize)
  const bytes = new Uint8Array(archive)
  const view = new DataView(archive)
  let offset = 0
  for (const entry of prepared) {
    setUint32(view, offset, 0x0403_4b50)
    setUint16(view, offset + 4, 20)
    setUint16(view, offset + 6, 0x0800)
    setUint16(view, offset + 8, 0)
    setUint16(view, offset + 10, 0)
    setUint16(view, offset + 12, 0)
    setUint32(view, offset + 14, entry.crc)
    setUint32(view, offset + 18, entry.data.byteLength)
    setUint32(view, offset + 22, entry.data.byteLength)
    setUint16(view, offset + 26, entry.name.byteLength)
    setUint16(view, offset + 28, 0)
    bytes.set(entry.name, offset + 30)
    const dataOffset = offset + 30 + entry.name.byteLength
    for (let start = 0; start < entry.data.byteLength; start += chunkBytes) {
      const end = Math.min(entry.data.byteLength, start + chunkBytes)
      bytes.set(entry.data.subarray(start, end), dataOffset + start)
      completedWork += end - start
      report()
      await yieldZipControl()
      checkCancelled()
    }
    offset = dataOffset + entry.data.byteLength
  }

  const centralOffset = offset
  for (const entry of prepared) {
    checkCancelled()
    setUint32(view, offset, 0x0201_4b50)
    setUint16(view, offset + 4, 20)
    setUint16(view, offset + 6, 20)
    setUint16(view, offset + 8, 0x0800)
    setUint16(view, offset + 10, 0)
    setUint16(view, offset + 12, 0)
    setUint16(view, offset + 14, 0)
    setUint32(view, offset + 16, entry.crc)
    setUint32(view, offset + 20, entry.data.byteLength)
    setUint32(view, offset + 24, entry.data.byteLength)
    setUint16(view, offset + 28, entry.name.byteLength)
    setUint16(view, offset + 30, 0)
    setUint16(view, offset + 32, 0)
    setUint16(view, offset + 34, 0)
    setUint16(view, offset + 36, 0)
    setUint32(view, offset + 38, 0)
    setUint32(view, offset + 42, entry.offset)
    bytes.set(entry.name, offset + 46)
    offset += 46 + entry.name.byteLength
    await yieldZipControl()
  }

  setUint32(view, offset, 0x0605_4b50)
  setUint16(view, offset + 4, 0)
  setUint16(view, offset + 6, 0)
  setUint16(view, offset + 8, prepared.length)
  setUint16(view, offset + 10, prepared.length)
  setUint32(view, offset + 12, centralSize)
  setUint32(view, offset + 16, centralOffset)
  setUint16(view, offset + 20, 0)
  completedWork = totalWork
  report()
  return archive
}
