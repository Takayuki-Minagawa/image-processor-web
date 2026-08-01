import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_ASSET_DRAG_MIME_TYPE,
  encodeBuiltinAssetDragPayload,
  readBuiltinAssetDragPayload,
  writeBuiltinAssetDragPayload,
} from './dragPayload'

describe('built-in asset drag payload', () => {
  it('round-trips one bounded catalog reference', () => {
    const values = new Map<string, string>()
    const transfer = {
      getData: (type: string) => values.get(type) ?? '',
      setData: (type: string, value: string) => values.set(type, value),
    }

    writeBuiltinAssetDragPayload(transfer, 'grid-two-columns')

    expect(values.get(BUILTIN_ASSET_DRAG_MIME_TYPE)).toBe(
      encodeBuiltinAssetDragPayload('grid-two-columns'),
    )
    expect(readBuiltinAssetDragPayload(transfer)).toEqual({
      version: 1,
      kind: 'builtin-asset',
      assetId: 'grid-two-columns',
    })
  })

  it('rejects invalid ids, oversized JSON, and additional fields', () => {
    expect(() => encodeBuiltinAssetDragPayload('../unsafe')).toThrow(TypeError)

    const getData = vi.fn()
    getData.mockReturnValueOnce('x'.repeat(193))
    expect(readBuiltinAssetDragPayload({ getData })).toBeUndefined()

    getData.mockReturnValueOnce(
      JSON.stringify({
        version: 1,
        kind: 'builtin-asset',
        assetId: 'shape-star',
        source: '<svg onload="alert(1)"/>',
      }),
    )
    expect(readBuiltinAssetDragPayload({ getData })).toBeUndefined()
  })
})
