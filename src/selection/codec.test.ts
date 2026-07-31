import { describe, expect, it } from 'vitest'
import {
  SelectionMaskCodecError,
  decodeSelectionMask,
  decodeSelectionMaskFromProject,
  encodeSelectionMask,
  encodeSelectionMaskForProject,
} from './codec'
import { SelectionMask } from './mask'

describe('selection mask codec', () => {
  it('losslessly round-trips compressed and raw masks', () => {
    const compressed = SelectionMask.full(100, 1, 123)
    const alternating = SelectionMask.fromBytes(
      8,
      1,
      new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255]),
    )

    const compressedBytes = encodeSelectionMask(compressed)
    const rawBytes = encodeSelectionMask(alternating)

    expect(compressedBytes[4]).toBe(1)
    expect(rawBytes[4]).toBe(0)
    expect(decodeSelectionMask(compressedBytes).equals(compressed)).toBe(true)
    expect(decodeSelectionMask(rawBytes).equals(alternating)).toBe(true)
  })

  it('enforces encoded byte and decoded pixel limits before allocation', () => {
    const encoded = encodeSelectionMask(SelectionMask.full(10, 10))
    expect(() => decodeSelectionMask(encoded, { maximumPixels: 99 })).toThrow(
      expect.objectContaining<Partial<SelectionMaskCodecError>>({
        code: 'invalid-dimensions',
      }),
    )
    expect(() =>
      encodeSelectionMask(SelectionMask.full(10, 10), {
        maximumEncodedBytes: 12,
      }),
    ).toThrow(
      expect.objectContaining<Partial<SelectionMaskCodecError>>({
        code: 'encoded-size-limit',
      }),
    )
  })

  it('rejects bad signatures, truncated runs, zero runs, and trailing data', () => {
    const valid = encodeSelectionMask(SelectionMask.full(100, 1, 200))

    const badSignature = new Uint8Array(valid)
    badSignature[0] = 0
    expect(() => decodeSelectionMask(badSignature)).toThrow(
      expect.objectContaining<Partial<SelectionMaskCodecError>>({
        code: 'invalid-header',
      }),
    )

    expect(() => decodeSelectionMask(valid.slice(0, -1))).toThrow(
      expect.objectContaining<Partial<SelectionMaskCodecError>>({
        code: 'invalid-payload',
      }),
    )

    const zeroRun = new Uint8Array(valid)
    new DataView(zeroRun.buffer).setUint32(14, 0, true)
    expect(() => decodeSelectionMask(zeroRun)).toThrow('invalid run')

    const trailing = new Uint8Array(valid.length + 1)
    trailing.set(valid)
    expect(() => decodeSelectionMask(trailing)).toThrow('truncated')
  })

  it('round-trips the bounded Base64 project representation', () => {
    const source = SelectionMask.fromBytes(
      3,
      2,
      new Uint8Array([0, 64, 255, 255, 64, 0]),
    )
    const project = encodeSelectionMaskForProject(source)

    expect(project).toMatchObject({
      width: 3,
      height: 2,
      encoding: 'rle-base64',
    })
    expect(decodeSelectionMaskFromProject(project).equals(source)).toBe(true)
    expect(() =>
      decodeSelectionMaskFromProject({ ...project, width: 4 }),
    ).toThrow(
      expect.objectContaining<Partial<SelectionMaskCodecError>>({
        code: 'invalid-dimensions',
      }),
    )
  })
})
