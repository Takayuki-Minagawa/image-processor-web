import { SelectionMask, assertMatchingMaskDimensions } from './mask'

export type SelectionCombineMode = 'replace' | 'add' | 'subtract' | 'intersect'

const assertRadius = (radius: number, maximum: number): number => {
  if (!Number.isInteger(radius) || radius < 0 || radius > maximum) {
    throw new RangeError(
      `Selection radius must be an integer from 0 to ${maximum}.`,
    )
  }
  return radius
}

export const combineSelectionMasks = (
  base: SelectionMask,
  incoming: SelectionMask,
  mode: SelectionCombineMode,
): SelectionMask => {
  assertMatchingMaskDimensions(base, incoming)
  if (mode === 'replace') {
    return SelectionMask.fromBytes(
      incoming.width,
      incoming.height,
      incoming.toBytes(),
    )
  }
  const first = base.toBytes()
  const second = incoming.toBytes()
  const output = new Uint8Array(first.length)
  for (let index = 0; index < output.length; index += 1) {
    switch (mode) {
      case 'add':
        output[index] = Math.max(first[index], second[index])
        break
      case 'subtract':
        output[index] = Math.max(0, first[index] - second[index])
        break
      case 'intersect':
        output[index] = Math.min(first[index], second[index])
        break
    }
  }
  return SelectionMask.fromBytes(base.width, base.height, output)
}

export const invertSelectionMask = (mask: SelectionMask): SelectionMask => {
  const output = mask.toBytes()
  for (let index = 0; index < output.length; index += 1) {
    output[index] = 255 - output[index]
  }
  return SelectionMask.fromBytes(mask.width, mask.height, output)
}

const morphology = (
  mask: SelectionMask,
  radius: number,
  mode: 'dilate' | 'erode',
): SelectionMask => {
  const safeRadius = assertRadius(radius, 128)
  if (safeRadius === 0) {
    return SelectionMask.fromBytes(mask.width, mask.height, mask.toBytes())
  }
  const source = mask.toBytes()
  const output = new Uint8Array(source.length)
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let result = mode === 'dilate' ? 0 : 255
      for (let offsetY = -safeRadius; offsetY <= safeRadius; offsetY += 1) {
        const sampleY = y + offsetY
        for (let offsetX = -safeRadius; offsetX <= safeRadius; offsetX += 1) {
          const sampleX = x + offsetX
          const value =
            sampleX < 0 ||
            sampleY < 0 ||
            sampleX >= mask.width ||
            sampleY >= mask.height
              ? 0
              : source[sampleY * mask.width + sampleX]
          result =
            mode === 'dilate'
              ? Math.max(result, value)
              : Math.min(result, value)
          if (
            (mode === 'dilate' && result === 255) ||
            (mode === 'erode' && result === 0)
          ) {
            break
          }
        }
        if (
          (mode === 'dilate' && result === 255) ||
          (mode === 'erode' && result === 0)
        ) {
          break
        }
      }
      output[y * mask.width + x] = result
    }
  }
  return SelectionMask.fromBytes(mask.width, mask.height, output)
}

export const dilateSelectionMask = (
  mask: SelectionMask,
  radius: number,
): SelectionMask => morphology(mask, radius, 'dilate')

export const erodeSelectionMask = (
  mask: SelectionMask,
  radius: number,
): SelectionMask => morphology(mask, radius, 'erode')

export const featherSelectionMask = (
  mask: SelectionMask,
  radius: number,
): SelectionMask => {
  const safeRadius = assertRadius(radius, 256)
  if (safeRadius === 0) {
    return SelectionMask.fromBytes(mask.width, mask.height, mask.toBytes())
  }

  const source = mask.toBytes()
  const horizontal = new Float64Array(source.length)
  for (let y = 0; y < mask.height; y += 1) {
    let sum = 0
    let count = 0
    for (let x = -safeRadius; x < mask.width; x += 1) {
      const entering = x + safeRadius
      if (entering >= 0 && entering < mask.width) {
        sum += source[y * mask.width + entering]
        count += 1
      }
      const leaving = x - safeRadius - 1
      if (leaving >= 0 && leaving < mask.width) {
        sum -= source[y * mask.width + leaving]
        count -= 1
      }
      if (x >= 0) {
        horizontal[y * mask.width + x] = sum / count
      }
    }
  }

  const output = new Uint8Array(source.length)
  for (let x = 0; x < mask.width; x += 1) {
    let sum = 0
    let count = 0
    for (let y = -safeRadius; y < mask.height; y += 1) {
      const entering = y + safeRadius
      if (entering >= 0 && entering < mask.height) {
        sum += horizontal[entering * mask.width + x]
        count += 1
      }
      const leaving = y - safeRadius - 1
      if (leaving >= 0 && leaving < mask.height) {
        sum -= horizontal[leaving * mask.width + x]
        count -= 1
      }
      if (y >= 0) {
        output[y * mask.width + x] = Math.round(sum / count)
      }
    }
  }
  return SelectionMask.fromBytes(mask.width, mask.height, output)
}
