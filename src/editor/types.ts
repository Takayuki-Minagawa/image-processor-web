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
export const EDITOR_STATE_PROJECT_SCHEMA_VERSION = 2 as const
export const DESIGN_DOCUMENT_SCHEMA_VERSION = 3 as const
export const PROJECT_SCHEMA_VERSION = 4 as const

export type SupportedProjectSchemaVersion =
  | typeof LEGACY_PROJECT_SCHEMA_VERSION
  | typeof EDITOR_STATE_PROJECT_SCHEMA_VERSION
  | typeof DESIGN_DOCUMENT_SCHEMA_VERSION
  | typeof PROJECT_SCHEMA_VERSION

export interface ProjectCanvasSize {
  width: number
  height: number
}

export interface ProjectGuide {
  axis: 'x' | 'y'
  position: number
}

/**
 * Lossless 8-bit grayscale mask payload shared by selections and layer masks.
 * The historical encoding name is retained for v2 compatibility.
 */
export interface EncodedSelectionMask {
  width: number
  height: number
  encoding: 'rle-base64'
  data: string
}

export type EncodedLayerMask = EncodedSelectionMask

/**
 * Renderer-independent per-canvas editing state introduced in schema v2.
 *
 * Large selection masks are stored with a bounded lossless codec instead of
 * being expanded into renderer JSON. Additional JSON-compatible keys remain
 * available for forward-compatible editor features.
 */
export interface ProjectEditorState {
  guides: ProjectGuide[]
  snapTolerance: number
  selectionMask?: EncodedSelectionMask
  [key: string]: JsonValue | ProjectGuide[] | EncodedSelectionMask | undefined
}

export interface ProjectLayerMask {
  enabled: boolean
  inverted: boolean
  opacity: number
  offsetX: number
  offsetY: number
  payload: EncodedLayerMask
}

/**
 * A content layer can use another leaf layer as its clipping frame. Position
 * is normalized within the frame, keeping the persisted relation independent
 * of Fabric's object coordinate conventions.
 */
export interface ProjectClipReference {
  frameLayerId: string
  fit: 'cover' | 'contain' | 'fill'
  position: {
    x: number
    y: number
  }
  scale: number
  rotation: number
}

export interface ProjectLayerNodeBase {
  /** Matches the renderer object's stable editorId. */
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
}

export interface ProjectLayerNode extends ProjectLayerNodeBase {
  kind: 'layer'
  layerType: string
  clip?: ProjectClipReference
  mask?: ProjectLayerMask
}

export interface ProjectLayerGroup extends ProjectLayerNodeBase {
  kind: 'group'
  children: ProjectLayerTreeNode[]
}

export type ProjectLayerTreeNode = ProjectLayerNode | ProjectLayerGroup
export type ProjectLayerTree = ProjectLayerTreeNode[]

export interface ProjectGradientStop {
  offset: number
  color: string
}

export type ProjectPageBackground =
  | { kind: 'transparent' }
  | { kind: 'color'; color: string }
  | {
      kind: 'gradient'
      gradientType: 'linear' | 'radial'
      angle: number
      stops: ProjectGradientStop[]
    }
  | {
      kind: 'image'
      source: string
      fit: 'cover' | 'contain' | 'fill'
      position: { x: number; y: number }
      opacity: number
    }

export type ProjectAnimationEffect =
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom'
  | 'wipe-left'
  | 'wipe-right'
  | 'pulse'

/** @deprecated Use ProjectAnimationEffect. */
export type ProjectAnimationPreset = ProjectAnimationEffect

export type ProjectAnimationEasing =
  'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

export type ProjectAnimationStart =
  | { mode: 'with-page'; delayMs?: number }
  | { mode: 'after-previous'; delayMs?: number }

export interface ProjectElementAnimation {
  id: string
  phase: 'enter' | 'emphasis' | 'exit'
  effect: ProjectAnimationEffect
  start: ProjectAnimationStart
  durationMs: number
  easing?: ProjectAnimationEasing
  distancePx?: number
}

export interface ProjectPageTransition {
  type: 'none' | 'fade' | 'slide-left' | 'slide-right'
  durationMs: number
  easing?: ProjectAnimationEasing
}

/** Schema-v4 timeline. Its absence is semantically identical to no motion. */
export interface ProjectPageTimeline {
  durationMs: number
  transition?: ProjectPageTransition
  elements: Record<string, ProjectElementAnimation[]>
}

/** Optional physical trim size retained for print-oriented millimetre pages. */
export interface ProjectPagePhysicalSize {
  unit: 'mm'
  widthMm: number
  heightMm: number
  sourceDpi: number
}

/**
 * A page owns its renderer payload. Only the active page needs to be enlivened
 * by Fabric; inactive pages can remain as these serializable records.
 */
export interface ProjectPage {
  id: string
  name: string
  canvasSize: ProjectCanvasSize
  fabricCanvas: JsonObject
  editorState: ProjectEditorState
  layerTree: ProjectLayerTree
  background: ProjectPageBackground
  physicalSize?: ProjectPagePhysicalSize
  timeline?: ProjectPageTimeline
  thumbnail?: string
}

/**
 * Metadata fields required by every schema version.
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
 * Persisted design document.
 *
 * `pages` is the schema-v3+ source of truth. `canvasSize`, `fabricCanvas`, and
 * `editorState` are runtime compatibility aliases for the active page so the
 * existing single-canvas application API keeps working during migration. The
 * official serializer omits those aliases and therefore never duplicates the
 * active renderer payload on disk.
 */
export interface ProjectDocument {
  appId: typeof PROJECT_APP_ID
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  pages: ProjectPage[]
  activePageId: string
  metadata: ProjectMetadata
  updatedAt: string

  /** @deprecated Read the active ProjectPage in new code. */
  canvasSize: ProjectCanvasSize
  /** @deprecated Read the active ProjectPage in new code. */
  fabricCanvas: JsonObject
  /** @deprecated Read the active ProjectPage in new code. */
  editorState: ProjectEditorState
}
