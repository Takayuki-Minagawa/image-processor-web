import { describe, expect, it } from 'vitest'
import {
  crc32,
  createStoredZip,
  createStoredZipAsync,
  normalizeZipEntryName,
} from './zip'

const decoder = new TextDecoder()

describe('stored ZIP writer', () => {
  it('writes valid local/central headers, CRC32, UTF-8 names, and EOCD', () => {
    const contents = new TextEncoder().encode('pixelweave')
    const archive = createStoredZip([
      { name: 'icons/ロゴ.png', data: contents.buffer },
    ])
    const bytes = new Uint8Array(archive)
    const view = new DataView(archive)
    const nameLength = view.getUint16(26, true)
    const name = decoder.decode(bytes.slice(30, 30 + nameLength))
    const stored = bytes.slice(
      30 + nameLength,
      30 + nameLength + contents.length,
    )
    const eocdOffset = bytes.length - 22

    expect(view.getUint32(0, true)).toBe(0x0403_4b50)
    expect(view.getUint16(8, true)).toBe(0)
    expect(view.getUint32(14, true)).toBe(crc32(contents))
    expect(name).toBe('icons/ロゴ.png')
    expect([...stored]).toEqual([...contents])
    expect(view.getUint32(eocdOffset, true)).toBe(0x0605_4b50)
    expect(view.getUint16(eocdOffset + 10, true)).toBe(1)
    const centralOffset = view.getUint32(eocdOffset + 16, true)
    expect(view.getUint32(centralOffset, true)).toBe(0x0201_4b50)
  })

  it('normalizes traversal/control characters and rejects empty or duplicate names', () => {
    expect(normalizeZipEntryName('../safe/../logo?.png')).toBe('safe/logo-.png')
    expect(() => normalizeZipEntryName('../..')).toThrow(/safe file name/)
    expect(() =>
      createStoredZip([
        { name: 'same.png', data: new ArrayBuffer(1) },
        { name: './same.png', data: new ArrayBuffer(1) },
      ]),
    ).toThrow(/Duplicate/)
  })

  it('rejects empty archives', () => {
    expect(() => createStoredZip([])).toThrow(/require/)
  })

  it('creates the same archive asynchronously and observes cancellation between chunks', async () => {
    const entries = [
      {
        name: 'large.png',
        data: new Uint8Array(70_000).fill(7).buffer,
      },
    ]
    const synchronous = createStoredZip(entries)
    const progress: number[] = []
    const asynchronous = await createStoredZipAsync(entries, {
      chunkBytes: 64 * 1_024,
      onProgress: (value) => progress.push(value),
    })
    expect([...new Uint8Array(asynchronous)]).toEqual([
      ...new Uint8Array(synchronous),
    ])
    expect(progress.at(-1)).toBe(1)

    let checks = 0
    await expect(
      createStoredZipAsync(entries, {
        chunkBytes: 64 * 1_024,
        isCancelled: () => {
          checks += 1
          return checks >= 2
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
