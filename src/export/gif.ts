export interface GifSlideshowFrame {
  /** One palette index per pixel, in row-major order. */
  pixels: Uint8Array
  durationMs: number
}

export interface GifSlideshowInput {
  width: number
  height: number
  /** RGB triplets. Between 2 and 256 colors are accepted. */
  palette: Uint8Array
  frames: readonly GifSlideshowFrame[]
  /** Zero means repeat forever. Defaults to zero. */
  loopCount?: number
  transparentColorIndex?: number
}

export interface GifExportProgress {
  phase: 'prepare' | 'frames' | 'finalize'
  completedFrames: number
  totalFrames: number
  progress: number
}

export interface EncodeGifOptions {
  signal?: AbortSignal
  onProgress?(progress: GifExportProgress): void
  /** Lets a Worker process a queued cancel message during long frames. */
  yieldControl?(): Promise<void>
}

const assertPositiveInteger = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`)
  }
}

const abortError = (): DOMException =>
  new DOMException('GIF export was cancelled.', 'AbortError')

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError()
}

const defaultYieldControl = (): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, 0))

const littleEndian16 = (value: number): Uint8Array =>
  new Uint8Array([value & 0xff, (value >>> 8) & 0xff])

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value)

const byteLength = (parts: readonly Uint8Array[]): number =>
  parts.reduce((total, part) => total + part.byteLength, 0)

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(byteLength(parts))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const nextPowerOfTwo = (value: number): number => {
  let result = 2
  while (result < value) result *= 2
  return result
}

interface ValidatedGifInput {
  colorCount: number
  colorTableSize: number
  minimumCodeSize: number
  loopCount: number
}

const validateGifInput = (input: GifSlideshowInput): ValidatedGifInput => {
  assertPositiveInteger(input.width, 'GIF width')
  assertPositiveInteger(input.height, 'GIF height')
  if (input.width > 65_535 || input.height > 65_535) {
    throw new RangeError('GIF dimensions cannot exceed 65535 pixels.')
  }
  if (input.palette.byteLength % 3 !== 0) {
    throw new RangeError('The GIF palette must contain complete RGB triplets.')
  }
  const colorCount = input.palette.byteLength / 3
  if (colorCount < 2 || colorCount > 256) {
    throw new RangeError('The GIF palette must contain 2 to 256 colors.')
  }
  if (input.frames.length === 0) {
    throw new RangeError('A GIF slideshow must contain at least one frame.')
  }
  if (input.frames.length > 65_535) {
    throw new RangeError('A GIF slideshow cannot exceed 65535 frames.')
  }
  const pixelCount = input.width * input.height
  input.frames.forEach((frame, index) => {
    if (frame.pixels.byteLength !== pixelCount) {
      throw new RangeError(
        `GIF frame ${index + 1} must contain ${pixelCount} palette indices.`,
      )
    }
    if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0) {
      throw new RangeError(
        `GIF frame ${index + 1} duration must be a positive finite number.`,
      )
    }
  })

  const loopCount = input.loopCount ?? 0
  if (!Number.isInteger(loopCount) || loopCount < 0 || loopCount > 65_535) {
    throw new RangeError('GIF loop count must be an integer from 0 to 65535.')
  }
  if (
    input.transparentColorIndex !== undefined &&
    (!Number.isInteger(input.transparentColorIndex) ||
      input.transparentColorIndex < 0 ||
      input.transparentColorIndex >= colorCount)
  ) {
    throw new RangeError('GIF transparent color index is outside the palette.')
  }

  const colorTableSize = nextPowerOfTwo(colorCount)
  return {
    colorCount,
    colorTableSize,
    minimumCodeSize: Math.max(2, Math.ceil(Math.log2(colorTableSize))),
    loopCount,
  }
}

const padPalette = (
  palette: Uint8Array,
  colorTableSize: number,
): Uint8Array => {
  const padded = new Uint8Array(colorTableSize * 3)
  padded.set(palette)
  return padded
}

const splitIntoDataSubBlocks = (data: Uint8Array): Uint8Array[] => {
  const parts: Uint8Array[] = []
  for (let offset = 0; offset < data.byteLength; offset += 255) {
    const length = Math.min(255, data.byteLength - offset)
    parts.push(new Uint8Array([length]), data.subarray(offset, offset + length))
  }
  parts.push(new Uint8Array([0]))
  return parts
}

/** Standard GIF LZW with a bounded 4096-entry numeric dictionary. */
const encodePaletteIndices = async (
  pixels: Uint8Array,
  minimumCodeSize: number,
  colorCount: number,
  frameIndex: number,
  signal: AbortSignal | undefined,
  yieldControl: () => Promise<void>,
  onChunk: (processedPixels: number) => void,
): Promise<Uint8Array> => {
  const clearCode = 1 << minimumCodeSize
  const endCode = clearCode + 1
  let codeSize = minimumCodeSize + 1
  let nextCode = endCode + 1
  const dictionary = new Map<number, number>()
  let bytes = new Uint8Array(Math.max(256, Math.ceil(pixels.byteLength / 2)))
  let byteLength = 0
  let bitBuffer = 0
  let bitCount = 0

  const pushByte = (byte: number): void => {
    if (byteLength === bytes.byteLength) {
      const grown = new Uint8Array(bytes.byteLength * 2)
      grown.set(bytes)
      bytes = grown
    }
    bytes[byteLength] = byte
    byteLength += 1
  }

  const writeCode = (code: number): void => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      pushByte(bitBuffer & 0xff)
      bitBuffer >>>= 8
      bitCount -= 8
    }
  }

  writeCode(clearCode)
  let prefix = pixels[0]
  if (prefix >= colorCount) {
    throw new RangeError(
      `GIF frame ${frameIndex + 1} uses palette index ${prefix}, but only ${colorCount} colors exist.`,
    )
  }
  for (let index = 1; index < pixels.byteLength; index += 1) {
    const paletteIndex = pixels[index]
    if (paletteIndex >= colorCount) {
      throw new RangeError(
        `GIF frame ${frameIndex + 1} uses palette index ${paletteIndex}, but only ${colorCount} colors exist.`,
      )
    }
    const key = prefix * 256 + paletteIndex
    const existing = dictionary.get(key)
    if (existing !== undefined) {
      prefix = existing
    } else {
      writeCode(prefix)
      if (nextCode < 4_096) {
        dictionary.set(key, nextCode)
        nextCode += 1
        if (nextCode > 1 << codeSize && codeSize < 12) codeSize += 1
      } else {
        writeCode(clearCode)
        dictionary.clear()
        codeSize = minimumCodeSize + 1
        nextCode = endCode + 1
      }
      prefix = paletteIndex
    }
    if ((index + 1) % 16_384 === 0) {
      throwIfAborted(signal)
      onChunk(index + 1)
      await yieldControl()
    }
  }
  writeCode(prefix)
  writeCode(endCode)
  if (bitCount > 0) pushByte(bitBuffer & 0xff)
  throwIfAborted(signal)
  onChunk(pixels.byteLength)
  return bytes.slice(0, byteLength)
}

const graphicsControlExtension = (
  frame: GifSlideshowFrame,
  transparentColorIndex: number | undefined,
): Uint8Array => {
  const delay = Math.min(65_535, Math.max(1, Math.round(frame.durationMs / 10)))
  const transparencyFlag = transparentColorIndex === undefined ? 0 : 1
  const packed = (1 << 2) | transparencyFlag
  return concatBytes([
    new Uint8Array([0x21, 0xf9, 0x04, packed]),
    littleEndian16(delay),
    new Uint8Array([transparentColorIndex ?? 0, 0]),
  ])
}

/** Encodes an indexed-color, full-canvas GIF89a slideshow. */
export const encodeGifSlideshow = async (
  input: GifSlideshowInput,
  options: EncodeGifOptions = {},
): Promise<Uint8Array> => {
  const validated = validateGifInput(input)
  throwIfAborted(options.signal)
  const totalFrames = input.frames.length
  const report = (
    phase: GifExportProgress['phase'],
    completedFrames: number,
    progress: number,
  ): void =>
    options.onProgress?.({
      phase,
      completedFrames,
      totalFrames,
      progress: Math.min(1, Math.max(0, progress)),
    })

  report('prepare', 0, 0)
  const colorTableSizeCode = Math.log2(validated.colorTableSize) - 1
  const colorResolution = 7
  const logicalScreenPacked =
    0x80 | ((colorResolution & 0x07) << 4) | colorTableSizeCode
  const parts: Uint8Array[] = [
    ascii('GIF89a'),
    littleEndian16(input.width),
    littleEndian16(input.height),
    new Uint8Array([logicalScreenPacked, 0, 0]),
    padPalette(input.palette, validated.colorTableSize),
    new Uint8Array([0x21, 0xff, 0x0b]),
    ascii('NETSCAPE2.0'),
    new Uint8Array([
      0x03,
      0x01,
      validated.loopCount & 0xff,
      (validated.loopCount >>> 8) & 0xff,
      0,
    ]),
  ]

  const yieldControl = options.yieldControl ?? defaultYieldControl
  for (let index = 0; index < input.frames.length; index += 1) {
    throwIfAborted(options.signal)
    const frame = input.frames[index]
    parts.push(
      graphicsControlExtension(frame, input.transparentColorIndex),
      new Uint8Array([0x2c]),
      littleEndian16(0),
      littleEndian16(0),
      littleEndian16(input.width),
      littleEndian16(input.height),
      new Uint8Array([0]),
      new Uint8Array([validated.minimumCodeSize]),
    )
    const compressed = await encodePaletteIndices(
      frame.pixels,
      validated.minimumCodeSize,
      validated.colorCount,
      index,
      options.signal,
      yieldControl,
      (processedPixels) =>
        report(
          'frames',
          index,
          (index + processedPixels / frame.pixels.byteLength) / totalFrames,
        ),
    )
    parts.push(...splitIntoDataSubBlocks(compressed))
    report('frames', index + 1, (index + 1) / totalFrames)
    await yieldControl()
  }

  throwIfAborted(options.signal)
  parts.push(new Uint8Array([0x3b]))
  report('finalize', totalFrames, 1)
  return concatBytes(parts)
}
