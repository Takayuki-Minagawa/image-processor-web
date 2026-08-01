import {
  BUILTIN_ASSET_CATALOG,
  BUILTIN_ASSET_PACK_MANIFESTS,
} from './builtinCatalog'
import { AssetRegistry } from './registry'

export * from './registry'
export * from './dragPayload'
export * from './search'
export * from './shapeGeometry'
export * from './types'
export * from './userAssetMetadata'
export * from './userAssetRepository'

export const createBuiltinAssetRegistry = (): AssetRegistry =>
  new AssetRegistry(BUILTIN_ASSET_CATALOG, BUILTIN_ASSET_PACK_MANIFESTS)

export { BUILTIN_ASSET_CATALOG, BUILTIN_ASSET_PACK_MANIFESTS }
