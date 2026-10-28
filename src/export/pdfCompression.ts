import { assertPdfEncodedByteBudget } from './pdfPreflight'

export const rgbaToWhiteRgb = (
  rgba: Uint8ClampedArray,
): Uint8Array<ArrayBuffer> => {
  if (rgba.length % 4 !== 0) {
    throw new RangeError('RGBA data must contain complete pixels.')
  }
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let source = 0, target = 0; source < rgba.length; source += 4) {
    const alpha = rgba[source + 3] / 255
    for (let channel = 0; channel < 3; channel += 1) {
      rgb[target++] = Math.round(
        rgba[source + channel] * alpha + 255 * (1 - alpha),
      )
    }
  }
  return rgb
}

/** Compress strips, never a whole document's raw RGB, into a PDF Flate stream. */
export const compressPdfRgb = async (
  source: ReadableStream<BufferSource>,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  const cancelled = () =>
    new DOMException('PDF export was cancelled.', 'AbortError')
  if (signal?.aborted) {
    await source.cancel()
    throw cancelled()
  }
  if (typeof CompressionStream === 'undefined') {
    await source.cancel()
    throw Object.assign(
      new Error(
        'Lossless PDF compression requires CompressionStream. Use a current browser or select JPEG.',
      ),
      { code: 'pdf-compression-unavailable' },
    )
  }
  const reader = source
    .pipeThrough(new CompressionStream('deflate'))
    .getReader()
  const onAbort = () => {
    void reader.cancel(cancelled()).catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const parts: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (signal?.aborted) throw cancelled()
      if (done) break
      length += value.byteLength
      assertPdfEncodedByteBudget(length)
      parts.push(value)
    }
    const compressed = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
      compressed.set(part, offset)
      offset += part.byteLength
    }
    return compressed
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
