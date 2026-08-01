export const BUILTIN_ASSET_DRAG_MIME_TYPE =
  'application/x-pixelweave-builtin-asset+json'

const ASSET_DRAG_SCHEMA_VERSION = 1 as const
const MAX_ASSET_DRAG_PAYLOAD_CHARACTERS = 192
const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u

export interface BuiltinAssetDragPayload {
  version: typeof ASSET_DRAG_SCHEMA_VERSION
  kind: 'builtin-asset'
  assetId: string
}

type DragDataTransfer = Pick<DataTransfer, 'getData' | 'setData'>

const validAssetId = (assetId: string): boolean => ASSET_ID.test(assetId)

export const encodeBuiltinAssetDragPayload = (assetId: string): string => {
  if (!validAssetId(assetId)) {
    throw new TypeError('A built-in asset drag requires a valid asset id.')
  }
  return JSON.stringify({
    version: ASSET_DRAG_SCHEMA_VERSION,
    kind: 'builtin-asset',
    assetId,
  } satisfies BuiltinAssetDragPayload)
}

/** Writes only a bounded catalog reference; pack data never crosses DnD. */
export const writeBuiltinAssetDragPayload = (
  dataTransfer: DragDataTransfer,
  assetId: string,
): void => {
  dataTransfer.setData(
    BUILTIN_ASSET_DRAG_MIME_TYPE,
    encodeBuiltinAssetDragPayload(assetId),
  )
}

/** Rejects oversized, malformed, or surprising cross-document payloads. */
export const readBuiltinAssetDragPayload = (
  dataTransfer: Pick<DataTransfer, 'getData'>,
): BuiltinAssetDragPayload | undefined => {
  const source = dataTransfer.getData(BUILTIN_ASSET_DRAG_MIME_TYPE)
  if (
    source.length === 0 ||
    source.length > MAX_ASSET_DRAG_PAYLOAD_CHARACTERS
  ) {
    return undefined
  }
  try {
    const value = JSON.parse(source) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    const record = value as Record<string, unknown>
    if (
      Object.keys(record).length !== 3 ||
      record.version !== ASSET_DRAG_SCHEMA_VERSION ||
      record.kind !== 'builtin-asset' ||
      typeof record.assetId !== 'string' ||
      !validAssetId(record.assetId)
    ) {
      return undefined
    }
    return {
      version: ASSET_DRAG_SCHEMA_VERSION,
      kind: 'builtin-asset',
      assetId: record.assetId,
    }
  } catch {
    return undefined
  }
}
