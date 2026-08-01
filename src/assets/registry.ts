import { searchAssetCatalog } from './search'
import { shapeDefinitionToPath } from './shapeGeometry'
import {
  ASSET_PACK_SCHEMA_VERSION,
  type AssetCatalogEntry,
  type AssetPack,
  type AssetPackManifest,
  type AssetPayload,
  type AssetSearchOptions,
  type GridAssetPayload,
  type LoadedAsset,
} from './types'

export type AssetRegistryErrorCode =
  'invalid-catalog' | 'invalid-pack' | 'asset-not-found' | 'unsafe-asset'

export class AssetRegistryError extends Error {
  readonly code: AssetRegistryErrorCode

  constructor(code: AssetRegistryErrorCode, message: string) {
    super(message)
    this.name = 'AssetRegistryError'
    this.code = code
  }
}

const isSlug = (value: string): boolean =>
  /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value)

const validateGrid = (payload: GridAssetPayload, assetId: string): void => {
  if (
    payload.cells.length === 0 ||
    payload.cells.length > 64 ||
    !Number.isFinite(payload.gapRatio) ||
    payload.gapRatio < 0 ||
    payload.gapRatio > 0.5
  ) {
    throw new AssetRegistryError(
      'invalid-pack',
      `${assetId} has an invalid grid.`,
    )
  }
  const ids = new Set<string>()
  for (const cell of payload.cells) {
    if (
      !isSlug(cell.id) ||
      ids.has(cell.id) ||
      ![cell.x, cell.y, cell.width, cell.height].every(Number.isFinite) ||
      cell.x < 0 ||
      cell.y < 0 ||
      cell.width <= 0 ||
      cell.height <= 0 ||
      cell.x + cell.width > 1.000_001 ||
      cell.y + cell.height > 1.000_001
    ) {
      throw new AssetRegistryError(
        'invalid-pack',
        `${assetId} has an invalid grid cell.`,
      )
    }
    ids.add(cell.id)
  }
}

const validatePayload = (
  entry: AssetCatalogEntry,
  payload: AssetPayload,
): void => {
  const compatible =
    (entry.kind === 'shape' && payload.type === 'procedural-shape') ||
    ((entry.kind === 'icon' || entry.kind === 'illustration') &&
      payload.type === 'svg') ||
    (entry.kind === 'frame' && payload.type === 'frame') ||
    (entry.kind === 'grid' && payload.type === 'grid')
  if (!compatible) {
    throw new AssetRegistryError(
      'invalid-pack',
      `${entry.id} payload is incompatible with catalog kind ${entry.kind}.`,
    )
  }

  if (payload.type === 'procedural-shape') {
    shapeDefinitionToPath(payload.definition, 100, 100)
  } else if (payload.type === 'frame') {
    shapeDefinitionToPath(payload.clipShape, 100, 100)
  } else if (payload.type === 'grid') {
    validateGrid(payload, entry.id)
  } else {
    const bytes = new TextEncoder().encode(payload.source).byteLength
    if (
      entry.safety.sanitizer !== 'svg-sanitizer-v1' ||
      bytes > (entry.safety.maxBytes ?? 0)
    ) {
      throw new AssetRegistryError(
        'unsafe-asset',
        `${entry.id} is missing bounded SVG sanitization metadata.`,
      )
    }
  }
}

export class AssetRegistry {
  readonly #catalog: readonly AssetCatalogEntry[]
  readonly #entries = new Map<string, AssetCatalogEntry>()
  readonly #manifests = new Map<string, AssetPackManifest>()
  readonly #packPromises = new Map<string, Promise<Map<string, AssetPayload>>>()

  constructor(
    catalog: readonly AssetCatalogEntry[],
    manifests: readonly AssetPackManifest[],
  ) {
    this.#catalog = [...catalog]
    for (const manifest of manifests) {
      if (!isSlug(manifest.id) || this.#manifests.has(manifest.id)) {
        throw new AssetRegistryError(
          'invalid-catalog',
          `Duplicate or invalid asset pack id: ${manifest.id}`,
        )
      }
      if (
        !Number.isSafeInteger(manifest.assetCount) ||
        manifest.assetCount < 1
      ) {
        throw new AssetRegistryError(
          'invalid-catalog',
          `${manifest.id} has an invalid asset count.`,
        )
      }
      this.#manifests.set(manifest.id, manifest)
    }

    const countByPack = new Map<string, number>()
    for (const entry of catalog) {
      if (!isSlug(entry.id) || this.#entries.has(entry.id)) {
        throw new AssetRegistryError(
          'invalid-catalog',
          `Duplicate or invalid asset id: ${entry.id}`,
        )
      }
      if (!this.#manifests.has(entry.packId)) {
        throw new AssetRegistryError(
          'invalid-catalog',
          `${entry.id} references unknown pack ${entry.packId}.`,
        )
      }
      this.#entries.set(entry.id, entry)
      countByPack.set(entry.packId, (countByPack.get(entry.packId) ?? 0) + 1)
    }
    for (const manifest of manifests) {
      if (countByPack.get(manifest.id) !== manifest.assetCount) {
        throw new AssetRegistryError(
          'invalid-catalog',
          `${manifest.id} catalog count does not match its manifest.`,
        )
      }
    }
  }

  list(): readonly AssetCatalogEntry[] {
    return this.#catalog
  }

  getEntry(id: string): AssetCatalogEntry | undefined {
    return this.#entries.get(id)
  }

  search(query: string, options?: AssetSearchOptions): AssetCatalogEntry[] {
    return searchAssetCatalog(this.#catalog, query, options)
  }

  async preloadPack(packId: string): Promise<void> {
    await this.#loadPack(packId)
  }

  async loadAsset(id: string): Promise<LoadedAsset> {
    const entry = this.#entries.get(id)
    if (!entry) {
      throw new AssetRegistryError('asset-not-found', `Unknown asset: ${id}`)
    }
    const payload = (await this.#loadPack(entry.packId)).get(id)
    if (!payload) {
      throw new AssetRegistryError(
        'invalid-pack',
        `${entry.packId} does not contain ${id}.`,
      )
    }

    if (payload.type !== 'svg') {
      return { ...entry, payload }
    }

    // The sanitizer is itself deferred so searching procedural assets does not
    // pull the SVG parser into the entry bundle.
    const { sanitizeSvg } = await import('../lib/svgSafety')
    const sanitized = sanitizeSvg(payload.source, {
      maxBytes: entry.safety.maxBytes,
    })
    return {
      ...entry,
      payload: { type: 'svg', source: sanitized.source },
    }
  }

  #loadPack(packId: string): Promise<Map<string, AssetPayload>> {
    const cached = this.#packPromises.get(packId)
    if (cached) return cached
    const manifest = this.#manifests.get(packId)
    if (!manifest) {
      return Promise.reject(
        new AssetRegistryError(
          'asset-not-found',
          `Unknown asset pack: ${packId}`,
        ),
      )
    }
    const promise = manifest
      .load()
      .then((pack) => this.#validatePack(pack, manifest))
    this.#packPromises.set(packId, promise)
    return promise
  }

  #validatePack(
    pack: AssetPack,
    manifest: AssetPackManifest,
  ): Map<string, AssetPayload> {
    if (
      pack.schemaVersion !== ASSET_PACK_SCHEMA_VERSION ||
      pack.id !== manifest.id ||
      pack.items.length !== manifest.assetCount
    ) {
      throw new AssetRegistryError(
        'invalid-pack',
        `${manifest.id} does not match its manifest.`,
      )
    }
    const result = new Map<string, AssetPayload>()
    for (const item of pack.items) {
      const entry = this.#entries.get(item.id)
      if (!entry || entry.packId !== pack.id || result.has(item.id)) {
        throw new AssetRegistryError(
          'invalid-pack',
          `${pack.id} contains an unknown or duplicate asset id.`,
        )
      }
      validatePayload(entry, item.payload)
      result.set(item.id, item.payload)
    }
    return result
  }
}
