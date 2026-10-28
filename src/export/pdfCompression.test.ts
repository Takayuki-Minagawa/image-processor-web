// @vitest-environment node
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { compressPdfRgb, rgbaToWhiteRgb } from './pdfCompression'

describe('lossless PDF compression', () => {
  it('flattens transparent and half-transparent pixels over white', () => {
    expect([
      ...rgbaToWhiteRgb(
        new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 128, 12, 34, 56, 255]),
      ),
    ]).toEqual([255, 255, 255, 255, 127, 127, 12, 34, 56])
    expect(() => rgbaToWhiteRgb(new Uint8ClampedArray(3))).toThrow(
      /complete pixels/,
    )
  })

  it('preserves every RGB sample in a zlib stream across strip boundaries', async () => {
    const first = new Uint8Array([0, 255, 12, 34, 56, 78])
    const second = new Uint8Array([255, 255, 255, 0, 0, 0])
    const bytes = await compressPdfRgb(
      new ReadableStream({
        start(controller) {
          controller.enqueue(first)
          controller.enqueue(second)
          controller.close()
        },
      }),
    )
    expect([...inflateSync(bytes)]).toEqual([...first, ...second])
  })

  it('cancels before reading and during compression without returning partial data', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      compressPdfRgb(new ReadableStream(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    const during = new AbortController()
    const source = new ReadableStream<BufferSource>({
      pull(stream) {
        stream.enqueue(new Uint8Array(1024))
        during.abort()
      },
    })
    await expect(compressPdfRgb(source, during.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
