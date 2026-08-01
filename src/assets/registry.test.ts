import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_ASSET_CATALOG,
  BUILTIN_ASSET_PACK_MANIFESTS,
  createBuiltinAssetRegistry,
} from './index'
import { AssetRegistry, AssetRegistryError } from './registry'
import type { AssetCatalogEntry, AssetPackManifest } from './types'

const entry = (
  overrides: Partial<AssetCatalogEntry> = {},
): AssetCatalogEntry => ({
  id: 'test-svg',
  packId: 'test-pack',
  kind: 'icon',
  category: 'test',
  name: { en: 'Test icon', ja: 'テストアイコン' },
  tags: { en: 'sample', ja: 'サンプル' },
  license: { id: 'CC0-1.0', name: 'CC0 1.0' },
  safety: {
    origin: 'bundled',
    mediaType: 'image/svg+xml',
    sanitizer: 'svg-sanitizer-v1',
    externalReferences: 'forbidden',
    maxBytes: 4_096,
  },
  ...overrides,
})

describe('AssetRegistry', () => {
  it('keeps pack payloads lazy until an asset is requested', async () => {
    const load = vi.fn<AssetPackManifest['load']>().mockResolvedValue({
      schemaVersion: 1,
      id: 'test-pack',
      items: [
        {
          id: 'test-svg',
          payload: {
            type: 'svg',
            source:
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>',
          },
        },
      ],
    })
    const registry = new AssetRegistry(
      [entry()],
      [{ id: 'test-pack', assetCount: 1, load }],
    )

    expect(registry.search('test')).toHaveLength(1)
    expect(load).not.toHaveBeenCalled()
    await registry.loadAsset('test-svg')
    await registry.loadAsset('test-svg')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries a pack after a transient chunk-load rejection', async () => {
    const pack = {
      schemaVersion: 1 as const,
      id: 'test-pack',
      items: [
        {
          id: 'test-svg',
          payload: {
            type: 'svg' as const,
            source:
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
          },
        },
      ],
    }
    const load = vi
      .fn<AssetPackManifest['load']>()
      .mockRejectedValueOnce(new Error('stale chunk'))
      .mockResolvedValue(pack)
    const registry = new AssetRegistry(
      [entry()],
      [{ id: 'test-pack', assetCount: 1, load }],
    )

    await expect(registry.loadAsset('test-svg')).rejects.toThrow('stale chunk')
    await expect(registry.loadAsset('test-svg')).resolves.toMatchObject({
      id: 'test-svg',
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('sanitizes every SVG payload even when a bundled pack is malformed', async () => {
    const registry = new AssetRegistry(
      [entry()],
      [
        {
          id: 'test-pack',
          assetCount: 1,
          load: async () => ({
            schemaVersion: 1,
            id: 'test-pack',
            items: [
              {
                id: 'test-svg',
                payload: {
                  type: 'svg',
                  source:
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><path d="M0 0h10v10z"/></svg>',
                },
              },
            ],
          }),
        },
      ],
    )

    const loaded = await registry.loadAsset('test-svg')
    expect(loaded.payload.type).toBe('svg')
    if (loaded.payload.type === 'svg') {
      expect(loaded.payload.source).not.toMatch(/script|onload/u)
      expect(loaded.payload.source).toContain('<path')
    }
  })

  it('rejects catalog counts and payload kinds that do not match manifests', async () => {
    expect(
      () =>
        new AssetRegistry(
          [entry()],
          [{ id: 'test-pack', assetCount: 2, load: vi.fn() }],
        ),
    ).toThrow(expect.objectContaining({ code: 'invalid-catalog' }))

    const registry = new AssetRegistry(
      [entry({ kind: 'shape' })],
      [
        {
          id: 'test-pack',
          assetCount: 1,
          load: async () => ({
            schemaVersion: 1,
            id: 'test-pack',
            items: [
              {
                id: 'test-svg',
                payload: {
                  type: 'svg',
                  source:
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
                },
              },
            ],
          }),
        },
      ],
    )
    await expect(registry.loadAsset('test-svg')).rejects.toBeInstanceOf(
      AssetRegistryError,
    )
  })
})

describe('built-in asset catalog', () => {
  it('provides licensed and bounded safety metadata for every indexed asset', () => {
    expect(BUILTIN_ASSET_CATALOG.length).toBeGreaterThanOrEqual(15)
    expect(BUILTIN_ASSET_PACK_MANIFESTS.length).toBeGreaterThanOrEqual(3)
    expect(new Set(BUILTIN_ASSET_CATALOG.map(({ id }) => id)).size).toBe(
      BUILTIN_ASSET_CATALOG.length,
    )
    for (const item of BUILTIN_ASSET_CATALOG) {
      expect(item.license.id).toBeTruthy()
      expect(item.safety.externalReferences).toBe('forbidden')
      if (item.safety.mediaType === 'image/svg+xml') {
        expect(item.safety).toMatchObject({
          sanitizer: 'svg-sanitizer-v1',
          maxBytes: expect.any(Number),
        })
      }
    }
  })

  it('loads procedural, grid, and sanitized SVG packs through one API', async () => {
    const registry = createBuiltinAssetRegistry()
    await expect(registry.loadAsset('shape-star')).resolves.toMatchObject({
      kind: 'shape',
      payload: { type: 'procedural-shape' },
    })
    await expect(registry.loadAsset('grid-two-columns')).resolves.toMatchObject(
      {
        kind: 'grid',
        payload: { type: 'grid' },
      },
    )
    await expect(registry.loadAsset('icon-camera')).resolves.toMatchObject({
      kind: 'icon',
      payload: { type: 'svg' },
    })
  })
})
