export const MAX_SELECTION_MASK_PIXELS = 64 * 1024 * 1024

export interface SelectionMaskBounds {
  left: number
  top: number
  width: number
  height: number
}

const assertDimensions = (
  width: number,
  height: number,
  maximumPixels = MAX_SELECTION_MASK_PIXELS,
): number => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new RangeError('Selection mask dimensions must be positive integers.')
  }
  const pixelCount = width * height
  if (!Number.isSafeInteger(pixelCount) || pixelCount > maximumPixels) {
    throw new RangeError(
      `Selection mask exceeds the ${maximumPixels} pixel limit.`,
    )
  }
  return pixelCount
}

/**
 * Immutable document-space 8-bit selection mask.
 *
 * Input and output byte arrays are copied so history snapshots cannot be
 * silently changed through a retained Uint8Array reference.
 */
export class SelectionMask {
  readonly width: number
  readonly height: number
  readonly pixelCount: number

  readonly #bytes: Uint8Array

  private constructor(width: number, height: number, bytes: Uint8Array) {
    this.width = width
    this.height = height
    this.pixelCount = bytes.length
    this.#bytes = bytes
  }

  static empty(width: number, height: number): SelectionMask {
    const pixelCount = assertDimensions(width, height)
    return new SelectionMask(width, height, new Uint8Array(pixelCount))
  }

  static full(width: number, height: number, alpha = 255): SelectionMask {
    const pixelCount = assertDimensions(width, height)
    if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) {
      throw new RangeError('Selection alpha must be an integer from 0 to 255.')
    }
    const bytes = new Uint8Array(pixelCount)
    bytes.fill(alpha)
    return new SelectionMask(width, height, bytes)
  }

  static fromBytes(
    width: number,
    height: number,
    bytes: Uint8Array | Uint8ClampedArray,
    maximumPixels = MAX_SELECTION_MASK_PIXELS,
  ): SelectionMask {
    const pixelCount = assertDimensions(width, height, maximumPixels)
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== pixelCount) {
      throw new RangeError(
        'Selection mask byte length does not match its dimensions.',
      )
    }
    return new SelectionMask(width, height, new Uint8Array(bytes))
  }

  get(x: number, y: number): number {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= this.width ||
      y >= this.height
    ) {
      throw new RangeError('Selection mask coordinate is out of bounds.')
    }
    return this.#bytes[y * this.width + x]
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.#bytes)
  }

  /**
   * Returns the smallest document-space rectangle containing non-zero mask
   * pixels. Scanning the immutable backing store avoids allocating a
   * full-document copy for callers that only need a cropped edit clip.
   */
  getNonEmptyBounds(): SelectionMaskBounds | null {
    let left = this.width
    let top = this.height
    let right = -1
    let bottom = -1

    for (let y = 0; y < this.height; y += 1) {
      const rowOffset = y * this.width
      for (let x = 0; x < this.width; x += 1) {
        if (this.#bytes[rowOffset + x] === 0) {
          continue
        }
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }

    return right < left || bottom < top
      ? null
      : {
          left,
          top,
          width: right - left + 1,
          height: bottom - top + 1,
        }
  }

  /**
   * Copies only a bounded mask region. The returned mask remains immutable,
   * and no intermediate full-document Uint8Array is created.
   */
  crop(bounds: SelectionMaskBounds): SelectionMask {
    const { left, top, width, height } = bounds
    const pixelCount = assertDimensions(width, height)
    if (
      !Number.isSafeInteger(left) ||
      !Number.isSafeInteger(top) ||
      left < 0 ||
      top < 0 ||
      left + width > this.width ||
      top + height > this.height
    ) {
      throw new RangeError('Selection mask crop is out of bounds.')
    }

    const bytes = new Uint8Array(pixelCount)
    for (let y = 0; y < height; y += 1) {
      const sourceStart = (top + y) * this.width + left
      bytes.set(
        this.#bytes.subarray(sourceStart, sourceStart + width),
        y * width,
      )
    }
    return new SelectionMask(width, height, bytes)
  }

  equals(other: SelectionMask): boolean {
    if (
      this === other ||
      (this.width === other.width &&
        this.height === other.height &&
        this.#bytes.every((value, index) => value === other.#bytes[index]))
    ) {
      return true
    }
    return false
  }
}

export const assertMatchingMaskDimensions = (
  first: SelectionMask,
  second: SelectionMask,
): void => {
  if (first.width !== second.width || first.height !== second.height) {
    throw new RangeError('Selection mask dimensions must match.')
  }
}
