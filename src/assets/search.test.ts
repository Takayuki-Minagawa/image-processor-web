import { describe, expect, it } from 'vitest'
import { BUILTIN_ASSET_CATALOG } from './builtinCatalog'
import { normalizeAssetSearchText, searchAssetCatalog } from './search'

describe('asset search', () => {
  it('normalizes full-width text and matches both Japanese names and tags', () => {
    expect(normalizeAssetSearchText(' ＣＡＲＤ！ ')).toBe('card')
    expect(searchAssetCatalog(BUILTIN_ASSET_CATALOG, '吹き出し')[0]?.id).toBe(
      'shape-speech-bubble',
    )
    expect(searchAssetCatalog(BUILTIN_ASSET_CATALOG, '写真 比較')[0]?.id).toBe(
      'grid-two-columns',
    )
  })

  it('requires every query token and supports kind/category filters', () => {
    expect(
      searchAssetCatalog(BUILTIN_ASSET_CATALOG, 'photo nonexistent'),
    ).toEqual([])
    const frames = searchAssetCatalog(BUILTIN_ASSET_CATALOG, '', {
      kinds: ['frame'],
    })
    expect(frames.map(({ kind }) => kind)).toEqual(['frame', 'frame'])
    expect(
      searchAssetCatalog(BUILTIN_ASSET_CATALOG, '', {
        category: 'photo-grids',
        limit: 2,
      }),
    ).toHaveLength(2)
  })
})
