import { describe, expect, it, vi } from 'vitest'
import { encodeGifSlideshow, type GifSlideshowInput } from './gif'

const twoColorSlideshow = (): GifSlideshowInput => ({
  width: 2,
  height: 1,
  palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
  frames: [
    { pixels: new Uint8Array([0, 1]), durationMs: 120 },
    { pixels: new Uint8Array([1, 0]), durationMs: 340 },
  ],
  loopCount: 0,
})

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] | (bytes[offset + 1] << 8)

const decodeImageData = (
  compressed: Uint8Array,
  minimumCodeSize: number,
): number[] => {
  const clearCode = 1 << minimumCodeSize
  const endCode = clearCode + 1
  let codeSize = minimumCodeSize + 1
  let nextCode = endCode + 1
  let bitOffset = 0
  let previous: number[] | undefined
  let dictionary: Array<number[] | undefined> = []
  const reset = (): void => {
    dictionary = Array.from({ length: clearCode }, (_, index) => [index])
    codeSize = minimumCodeSize + 1
    nextCode = endCode + 1
    previous = undefined
  }
  const readCode = (): number | undefined => {
    if (bitOffset + codeSize > compressed.byteLength * 8) return undefined
    let code = 0
    for (let bit = 0; bit < codeSize; bit += 1) {
      const absolute = bitOffset + bit
      code |= ((compressed[absolute >>> 3] >>> (absolute & 7)) & 1) << bit
    }
    bitOffset += codeSize
    return code
  }
  reset()
  const pixels: number[] = []
  while (true) {
    const code = readCode()
    if (code === undefined) break
    if (code === clearCode) {
      reset()
      continue
    }
    if (code === endCode) break
    const entry =
      dictionary[code] ??
      (code === nextCode && previous ? [...previous, previous[0]] : undefined)
    if (!entry) throw new Error(`Invalid GIF LZW code ${code}.`)
    pixels.push(...entry)
    if (previous && nextCode < 4_096) {
      dictionary[nextCode] = [...previous, entry[0]]
      nextCode += 1
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1
    }
    previous = entry
  }
  return pixels
}

interface ParsedGifFrame {
  delayHundredths: number
  pixels: number[]
}

const parseBaselineFrames = (bytes: Uint8Array): ParsedGifFrame[] => {
  const globalTableSize = 1 << ((bytes[10] & 0x07) + 1)
  let offset = 13 + globalTableSize * 3
  const frames: ParsedGifFrame[] = []
  let delayHundredths = 0

  while (offset < bytes.byteLength) {
    const marker = bytes[offset]
    if (marker === 0x3b) break
    if (marker === 0x21 && bytes[offset + 1] === 0xf9) {
      delayHundredths = readUint16(bytes, offset + 4)
      offset += 8
      continue
    }
    if (marker === 0x21) {
      offset += 2
      while (bytes[offset] !== 0) offset += bytes[offset] + 1
      offset += 1
      continue
    }
    if (marker !== 0x2c) throw new Error(`Unexpected GIF marker ${marker}.`)

    const minimumCodeSize = bytes[offset + 10]
    offset += 11
    const blocks: number[] = []
    while (bytes[offset] !== 0) {
      const length = bytes[offset]
      blocks.push(...bytes.subarray(offset + 1, offset + 1 + length))
      offset += length + 1
    }
    offset += 1
    frames.push({
      delayHundredths,
      pixels: decodeImageData(Uint8Array.from(blocks), minimumCodeSize),
    })
  }
  return frames
}

describe('GIF slideshow encoder', () => {
  it('writes a looping GIF89a with decodable indexed frames and delays', async () => {
    const progress = vi.fn()
    const bytes = await encodeGifSlideshow(twoColorSlideshow(), {
      onProgress: progress,
      yieldControl: () => Promise.resolve(),
    })

    expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a')
    expect(readUint16(bytes, 6)).toBe(2)
    expect(readUint16(bytes, 8)).toBe(1)
    expect(bytes.at(-1)).toBe(0x3b)
    expect(new TextDecoder().decode(bytes)).toContain('NETSCAPE2.0')
    expect(parseBaselineFrames(bytes)).toEqual([
      { delayHundredths: 12, pixels: [0, 1] },
      { delayHundredths: 34, pixels: [1, 0] },
    ])
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'finalize',
      completedFrames: 2,
      totalFrames: 2,
      progress: 1,
    })
  })

  it('writes transparency metadata when a palette index is selected', async () => {
    const bytes = await encodeGifSlideshow(
      { ...twoColorSlideshow(), transparentColorIndex: 0 },
      { yieldControl: () => Promise.resolve() },
    )
    const extensionOffset = bytes.findIndex(
      (byte, index) => byte === 0x21 && bytes[index + 1] === 0xf9,
    )

    expect(extensionOffset).toBeGreaterThan(0)
    expect(bytes[extensionOffset + 3] & 1).toBe(1)
    expect(bytes[extensionOffset + 6]).toBe(0)
  })

  it('reports intra-frame progress and observes cancellation', async () => {
    const controller = new AbortController()
    const input: GifSlideshowInput = {
      width: 20_000,
      height: 1,
      palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
      frames: [{ pixels: new Uint8Array(20_000), durationMs: 100 }],
    }

    await expect(
      encodeGifSlideshow(input, {
        signal: controller.signal,
        onProgress: (update) => {
          if (update.phase === 'frames' && update.progress > 0) {
            controller.abort()
          }
        },
        yieldControl: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('compresses repeated indexed pixels instead of clearing per pixel', async () => {
    const bytes = await encodeGifSlideshow(
      {
        width: 10_000,
        height: 1,
        palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
        frames: [{ pixels: new Uint8Array(10_000), durationMs: 100 }],
      },
      { yieldControl: () => Promise.resolve() },
    )

    expect(bytes.byteLength).toBeLessThan(1_000)
    expect(parseBaselineFrames(bytes)[0].pixels).toEqual([
      ...new Uint8Array(10_000),
    ])
  })

  it('rejects invalid palette indices and frame durations', async () => {
    await expect(
      encodeGifSlideshow({
        ...twoColorSlideshow(),
        frames: [{ pixels: new Uint8Array([0, 2]), durationMs: 100 }],
      }),
    ).rejects.toThrow('uses palette index 2')
    await expect(
      encodeGifSlideshow({
        ...twoColorSlideshow(),
        frames: [{ pixels: new Uint8Array([0, 1]), durationMs: 0 }],
      }),
    ).rejects.toThrow('duration must be a positive')
  })
})
