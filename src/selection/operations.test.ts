import { describe, expect, it } from 'vitest'
import { SelectionMask } from './mask'
import {
  combineSelectionMasks,
  dilateSelectionMask,
  erodeSelectionMask,
  featherSelectionMask,
  invertSelectionMask,
} from './operations'

describe('selection mask operations', () => {
  const base = SelectionMask.fromBytes(4, 1, new Uint8Array([0, 64, 128, 255]))
  const incoming = SelectionMask.fromBytes(
    4,
    1,
    new Uint8Array([255, 128, 64, 0]),
  )

  it('combines masks with replace, add, subtract, and intersect modes', () => {
    expect([
      ...combineSelectionMasks(base, incoming, 'replace').toBytes(),
    ]).toEqual([255, 128, 64, 0])
    expect([...combineSelectionMasks(base, incoming, 'add').toBytes()]).toEqual(
      [255, 128, 128, 255],
    )
    expect([
      ...combineSelectionMasks(base, incoming, 'subtract').toBytes(),
    ]).toEqual([0, 0, 64, 255])
    expect([
      ...combineSelectionMasks(base, incoming, 'intersect').toBytes(),
    ]).toEqual([0, 64, 64, 0])
  })

  it('inverts all 8-bit alpha values', () => {
    expect([...invertSelectionMask(base).toBytes()]).toEqual([255, 191, 127, 0])
  })

  it('dilates, erodes, and feathers without mutating the source', () => {
    const center = SelectionMask.fromBytes(
      3,
      3,
      new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 0]),
    )
    expect([...dilateSelectionMask(center, 1).toBytes()]).toEqual(
      Array(9).fill(255),
    )
    expect([
      ...erodeSelectionMask(SelectionMask.full(3, 3), 1).toBytes(),
    ]).toEqual([0, 0, 0, 0, 255, 0, 0, 0, 0])

    const featherSource = SelectionMask.fromBytes(
      3,
      1,
      new Uint8Array([0, 255, 0]),
    )
    expect([...featherSelectionMask(featherSource, 1).toBytes()]).toEqual([
      128, 85, 128,
    ])
    expect([...featherSource.toBytes()]).toEqual([0, 255, 0])
  })

  it('rejects mismatched dimensions and unbounded radii', () => {
    expect(() =>
      combineSelectionMasks(base, SelectionMask.empty(2, 2), 'add'),
    ).toThrow('dimensions must match')
    expect(() => dilateSelectionMask(base, 129)).toThrow('0 to 128')
    expect(() => featherSelectionMask(base, 257)).toThrow('0 to 256')
  })
})
