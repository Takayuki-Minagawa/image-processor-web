/**
 * JSON-compatible values used by the renderer-neutral project format.
 *
 * Keeping this type independent from Fabric.js prevents renderer types from
 * leaking into persistence, history, or autosave code.
 */
export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject

export interface JsonObject {
  [key: string]: JsonValue
}

export const PROJECT_APP_ID = 'image-processor-web' as const
export const LEGACY_PROJECT_SCHEMA_VERSION = 1 as const
export const PROJECT_SCHEMA_VERSION = 2 as const

export interface ProjectCanvasSize {
  width: number
  height: number
}

export interface ProjectGuide {
  axis: 'x' | 'y'
  position: number
}

export interface EncodedSelectionMask {
  width: number
  height: number
  encoding: 'rle-base64'
  data: string
}

/**
 * Renderer-independent editing state introduced with schema version 2.
 *
 * Large selection masks are stored with a bounded lossless codec instead of
 * being expanded into Fabric.js JSON. Additional JSON-compatible keys remain
 * available for forward-compatible editor features.
 */
export interface ProjectEditorState {
  guides: ProjectGuide[]
  snapTolerance: number
  selectionMask?: EncodedSelectionMask
  [key: string]: JsonValue | ProjectGuide[] | EncodedSelectionMask | undefined
}

/**
 * Metadata fields required by schema version 1.
 *
 * Additional JSON-compatible keys are allowed so that non-breaking metadata
 * can be added without changing the document schema.
 */
export interface ProjectMetadata {
  name: string
  createdAt: string
  sourceFileName?: string
  [key: string]: JsonValue | undefined
}

/**
 * Persisted project document.
 *
 * `fabricCanvas` is treated as opaque JSON by the domain layer. Its contents
 * are owned by the renderer adapter, while the surrounding envelope remains
 * stable and versioned by this application.
 */
export interface ProjectDocument {
  appId: typeof PROJECT_APP_ID
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  canvasSize: ProjectCanvasSize
  fabricCanvas: JsonObject
  editorState: ProjectEditorState
  metadata: ProjectMetadata
  updatedAt: string
}
