export const ASSET_PACK_SCHEMA_VERSION = 1 as const

export type AssetKind = 'shape' | 'icon' | 'illustration' | 'frame' | 'grid'

export interface AssetLicenseMetadata {
  /** SPDX identifier when one exists, otherwise a short human-readable name. */
  id: string
  name: string
  sourceUrl?: string
  attribution?: string
}

export interface AssetSafetyMetadata {
  origin: 'bundled' | 'user'
  mediaType:
    | 'application/x-pixelweave-shape+json'
    | 'application/x-pixelweave-grid+json'
    | 'image/svg+xml'
    | 'image/raster'
  sanitizer: 'none-required' | 'svg-sanitizer-v1' | 'image-decoder-v1'
  externalReferences: 'forbidden'
  maxBytes?: number
}

export interface AssetSearchText {
  en: string
  ja: string
}

/** Lightweight metadata that is safe to keep in the entry chunk. */
export interface AssetCatalogEntry {
  id: string
  packId: string
  kind: AssetKind
  category: string
  name: AssetSearchText
  tags: AssetSearchText
  license: AssetLicenseMetadata
  safety: AssetSafetyMetadata
  order?: number
}

export type ShapeDefinition =
  | {
      type: 'rounded-rectangle'
      cornerRadiusRatio: number
    }
  | {
      type: 'polygon'
      sides: number
      rotationDegrees?: number
    }
  | {
      type: 'star'
      points: number
      innerRadiusRatio: number
      rotationDegrees?: number
    }
  | {
      type: 'arrow'
      direction: 'right' | 'down' | 'left' | 'up'
      shaftRatio: number
      headLengthRatio: number
    }
  | {
      type: 'speech-bubble'
      cornerRadiusRatio: number
      tailPositionRatio: number
      tailWidthRatio: number
      tailHeightRatio: number
    }
  | {
      type: 'line'
      routing: 'straight' | 'elbow'
      startMarker: 'none' | 'arrow'
      endMarker: 'none' | 'arrow'
    }

export interface ProceduralShapePayload {
  type: 'procedural-shape'
  definition: ShapeDefinition
}

export interface SvgAssetPayload {
  type: 'svg'
  source: string
}

export interface FrameAssetPayload {
  type: 'frame'
  clipShape: ShapeDefinition
}

export interface GridCell {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface GridAssetPayload {
  type: 'grid'
  /** Normalized cell bounds in the inclusive 0..1 design coordinate space. */
  cells: GridCell[]
  gapRatio: number
}

export type AssetPayload =
  | ProceduralShapePayload
  | SvgAssetPayload
  | FrameAssetPayload
  | GridAssetPayload

export interface AssetPackItem {
  id: string
  payload: AssetPayload
}

export interface AssetPack {
  schemaVersion: typeof ASSET_PACK_SCHEMA_VERSION
  id: string
  items: AssetPackItem[]
}

export interface AssetPackManifest {
  id: string
  assetCount: number
  load: () => Promise<AssetPack>
}

export interface LoadedAsset extends AssetCatalogEntry {
  payload: AssetPayload
}

export interface AssetSearchOptions {
  kinds?: readonly AssetKind[]
  category?: string
  limit?: number
}
