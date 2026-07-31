import { describe, expect, it } from 'vitest'
import { SelectionMask } from './mask'

describe('SelectionMask', () => {
  it('copies input and output arrays to remain immutable', () => {
    const source = new Uint8Array([0, 64, 128, 255])
    const mask = SelectionMask.fromBytes(2, 2, source)
    source[0] = 255
    const exported = mask.toBytes()
    exported[1] = 0

    expect([...mask.toBytes()]).toEqual([0, 64, 128, 255])
    expect(mask.get(1, 1)).toBe(255)
  })

  it('creates empty and full masks and compares their contents', () => {
    const empty = SelectionMask.empty(2, 2)
    const full = SelectionMask.full(2, 2, 120)

    expect([...empty.toBytes()]).toEqual([0, 0, 0, 0])
    expect([...full.toBytes()]).toEqual([120, 120, 120, 120])
    expect(full.equals(SelectionMask.full(2, 2, 120))).toBe(true)
    expect(full.equals(empty)).toBe(false)
  })

  it('rejects mismatched lengths, invalid alpha, and out-of-range reads', () => {
    expect(() => SelectionMask.fromBytes(2, 2, new Uint8Array(3))).toThrow(
      'does not match',
    )
    expect(() => SelectionMask.full(1, 1, 256)).toThrow('0 to 255')
    expect(() => SelectionMask.empty(2, 2).get(2, 0)).toThrow('out of bounds')
  })

  it('finds and crops the non-empty region without exposing mutable bytes', () => {
    const source = SelectionMask.fromBytes(
      5,
      4,
      new Uint8Array([
        0, 0, 0, 0, 0, 0, 0, 64, 255, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0,
      ]),
    )

    const bounds = source.getNonEmptyBounds()
    expect(bounds).toEqual({ left: 2, top: 1, width: 2, height: 2 })
    const cropped = source.crop(bounds!)
    expect([...cropped.toBytes()]).toEqual([64, 255, 128, 0])

    const mutableCopy = cropped.toBytes()
    mutableCopy.fill(0)
    expect([...cropped.toBytes()]).toEqual([64, 255, 128, 0])
    expect(SelectionMask.empty(2, 2).getNonEmptyBounds()).toBeNull()
  })

  it('rejects invalid crop rectangles', () => {
    const mask = SelectionMask.full(4, 3)
    expect(() => mask.crop({ left: -1, top: 0, width: 1, height: 1 })).toThrow(
      'out of bounds',
    )
    expect(() => mask.crop({ left: 3, top: 2, width: 2, height: 1 })).toThrow(
      'out of bounds',
    )
    expect(() => mask.crop({ left: 0, top: 0, width: 0, height: 1 })).toThrow(
      'positive integers',
    )
  })
})
