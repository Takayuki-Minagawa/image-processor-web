import {
  ActiveSelection,
  Canvas,
  classRegistry,
  Ellipse,
  FabricImage,
  FabricObject,
  Gradient,
  Group,
  IText,
  Path,
  PencilBrush,
  Point,
  Rect,
  Shadow,
  Textbox,
  filters,
  iMatrix,
  loadSVGFromString,
  util,
  type T2DPipelineState,
  type TWebGLUniformLocationMap,
} from 'fabric'
import {
  ImageSafetyError,
  MAX_IMAGE_DIMENSION,
  assertSafeImageDimensions,
} from '../lib/imageSafety'
import {
  assertRestorableEditorSnapshot,
  imageDimensionsMatchHeader,
  inspectEmbeddedImageDataUrl,
} from './snapshotValidation'
import type { LogoVariation } from '../logo/generator'
import type { EvaluatedElementState } from '../animation/timeline'
import type { ChartModel } from '../charts'
import type { TableModel } from '../tables'
import { SelectionMask, type SelectionMaskBounds } from '../selection/mask'
import { createSelectionMaskClip } from '../selection/fabricMaskClip'
import {
  decodeSelectionMaskFromProject,
  encodeSelectionMaskForProject,
} from '../selection/codec'
import { type FilterOperation, type PixelBuffer } from './filters/types'
import {
  gridBoundaries,
  moveGridBoundary,
  type GridBoundary,
  type GridCellLayout,
} from './gridLayout'
import { MAX_LAYER_NAME_LENGTH, repairRendererLayerName } from './layerTree'
import type {
  EncodedSelectionMask,
  ProjectClipReference,
  ProjectEditorState,
  ProjectGuide,
  ProjectLayerMask,
} from './types'

export type EditorTool = 'select' | 'brush' | 'eraser' | 'pan'

export type EditorStatusKind = 'info' | 'success' | 'warning' | 'error'

export type EditorChangeReason =
  | 'object-added'
  | 'object-removed'
  | 'object-modified'
  | 'text-changed'
  | 'layer'
  | 'layer-opacity'
  | 'canvas-size'
  | 'clear'
  | 'crop'
  | 'filter'
  | 'duplicate'
  | 'cut'
  | 'paste'
  | 'guide'
  | 'selection-mask'
  | 'pixel-delete'
  | 'alignment'
  | 'text-style'
  | 'svg-import'
  | 'adjustment-layer'
  | 'logo'
  | 'macro'
  | 'script'
  | 'background-removal'
  | 'group'
  | 'clip'
  | 'layer-mask'
  | 'magic-resize'
  | 'background'
  | 'asset'
  | 'template'
  | 'chart'
  | 'table'

export type ExportImageFormat = 'png' | 'jpeg' | 'webp'

export interface ExportDataUrlOptions {
  exactSafeMultiplier?: boolean
}

export interface EditorStatus {
  message: string
  kind: EditorStatusKind
}

export interface LayerInfo {
  id: string
  name: string
  type: string
  visible: boolean
  locked: boolean
  opacity: number
  blend: GlobalCompositeOperation
  selected: boolean
}

export interface LayerTreeInfo extends LayerInfo {
  parentId?: string
  depth: number
  hasChildren: boolean
  clipped: boolean
  masked: boolean
}

export interface ChartLayerData {
  layerId: string
  model: ChartModel
  palette: string[]
}

export interface TableLayerData {
  layerId: string
  model: TableModel
}

export interface UpdateChartLayerOptions {
  id?: string
  palette?: readonly string[]
}

export interface UpdateTableLayerOptions {
  id?: string
}

export interface EditorSnapshot {
  json: Record<string, unknown>
  width: number
  height: number
  editorState?: ProjectEditorState
}

export interface ImageFilterSettings {
  brightness?: number
  contrast?: number
  saturation?: number
  hue?: number
  blur?: number
  grayscale?: boolean
  sharpen?: number
  emboss?: number
  noise?: number
  pixelate?: number
  sepia?: number
  invert?: number
  gamma?: number
  temperature?: number
  tint?: number
  vignette?: number
  duotone?: number
  halftone?: number
  glitch?: number
}

export const DEFAULT_IMAGE_FILTER_SETTINGS: Required<ImageFilterSettings> = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  blur: 0,
  grayscale: false,
  sharpen: 0,
  emboss: 0,
  noise: 0,
  pixelate: 1,
  sepia: 0,
  invert: 0,
  gamma: 1,
  temperature: 0,
  tint: 0,
  vignette: 0,
  duotone: 0,
  halftone: 0,
  glitch: 0,
}

export type AlignmentMode =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-y'

export interface TextGradientSettings {
  start: string
  end: string
  angle?: number
}

export interface TextShadowSettings {
  color: string
  blur: number
  offsetX: number
  offsetY: number
}

export interface TextStyleSettings {
  fill?: string
  stroke?: string
  strokeWidth?: number
  gradient?: TextGradientSettings | null
  shadow?: TextShadowSettings | null
  charSpacing?: number
  lineHeight?: number
}

export interface BrushOptions {
  color?: string
  size?: number
  opacity?: number
}

export interface SelectionTransform {
  id: string
  left: number
  top: number
  width: number
  height: number
  angle: number
  flipX: boolean
  flipY: boolean
}

export interface SelectionTransformUpdate {
  left?: number
  top?: number
  width?: number
  height?: number
  angle?: number
  flipX?: boolean
  flipY?: boolean
}

export interface AddShapeOptions {
  left?: number
  top?: number
  width?: number
  height?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  name?: string
}

export interface AddTextOptions {
  left?: number
  top?: number
  fill?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: string | number
  name?: string
  width?: number
  layoutMode?: TextLayoutMode
  vertical?: boolean
}

export type TextLayoutMode = 'auto' | 'wrap' | 'fixed'
export type TextEffectPreset =
  'none' | 'neon' | 'splice' | 'background' | 'echo'

export type ResizeAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

export type MagicResizeMode = 'fit' | 'fill' | 'stretch'

export type DesignShapeKind =
  | 'rounded-rectangle'
  | 'triangle'
  | 'pentagon'
  | 'star'
  | 'arrow'
  | 'line'
  | 'speech-bubble'
  | 'arch'

export interface FabricEditorCallbacks {
  /**
   * Fired only for document mutations. Viewport changes and restore operations
   * intentionally do not fire this callback, so history managers do not create
   * entries for zooming, panning, undo, or redo.
   */
  onChanged?: (reason: EditorChangeReason) => void
  onSelectionChanged?: (selectedIds: string[]) => void
  onLayersChanged?: (layers: LayerInfo[]) => void
  onStatus?: (status: EditorStatus) => void
  onZoomChanged?: (zoom: number) => void
}

export interface FabricEditorOptions {
  width?: number
  height?: number
  backgroundColor?: string
  brushColor?: string
  brushWidth?: number
  brushOpacity?: number
  callbacks?: FabricEditorCallbacks
}

export interface ImportImageOptions {
  /**
   * When importing into an empty document, resize its logical pixel dimensions
   * to the decoded image in the same mutation as adding the image.
   */
  resizeCanvasIfEmpty?: boolean
}

export interface CanvasDropTarget {
  point: { x: number; y: number }
  gridCellId?: string
  frameLayerId?: string
}

export interface GridBoundaryInfo extends GridBoundary {
  groupId: string
}

type EditorObject = FabricObject & {
  editorId?: string
  editorName?: string
  editorLocked?: boolean
  editorKind?:
    | 'svg'
    | 'adjustment'
    | 'logo'
    | 'pixel-delete'
    | 'group'
    | 'frame'
    | 'grid-cell'
    | 'grid-cell-image'
    | 'chart'
    | 'table'
  editorFilterSettings?: Record<string, unknown>
  editorFilterOperations?: FilterOperation[]
  editorTemplateId?: string
  editorLayerType?: string
  editorGridCellId?: string
  editorClipFrameId?: string
  editorClipSettings?: Omit<ProjectClipReference, 'frameLayerId'>
  editorLayerMask?: EncodedSelectionMask
  editorLayerMaskEnabled?: boolean
  editorLayerMaskSettings?: Pick<
    ProjectLayerMask,
    'inverted' | 'opacity' | 'offsetX' | 'offsetY'
  >
  editorTextLayoutMode?: TextLayoutMode
  editorVerticalText?: boolean
  editorChartModel?: ChartModel
  editorChartPalette?: string[]
  editorTableModel?: TableModel
}

type ClipboardObject = EditorObject

type RestoredCanvasEnlivables = Pick<
  Canvas,
  'backgroundColor' | 'backgroundImage' | 'overlayColor' | 'overlayImage'
>

interface PreparedEditorRestore {
  objects: FabricObject[]
  enlivables: RestoredCanvasEnlivables
  width: number
  height: number
  editorState: ProjectEditorState
}

interface PreparedRestoreApplicationOptions {
  onApplicationStart?: VoidFunction
  selectedEditorIds?: ReadonlySet<string>
  viewportTransform?: Canvas['viewportTransform']
}

interface ResolvedGridGroupLayout {
  group: EditorObject & Group
  cells: Map<string, EditorObject & Rect>
  layout: GridCellLayout[]
  left: number
  top: number
  width: number
  height: number
}

const SERIALIZED_EDITOR_PROPERTIES = [
  'editorId',
  'editorName',
  'editorLocked',
  'editorKind',
  'editorFilterSettings',
  'editorFilterOperations',
  'editorTemplateId',
  'editorLayerType',
  'editorGridCellId',
  'editorClipFrameId',
  'editorClipSettings',
  'editorLayerMask',
  'editorLayerMaskEnabled',
  'editorLayerMaskSettings',
  'editorTextLayoutMode',
  'editorVerticalText',
  'editorChartModel',
  'editorChartPalette',
  'editorTableModel',
] as const

const MIN_DOCUMENT_SIZE = 1
const MAX_DOCUMENT_SIZE = MAX_IMAGE_DIMENSION
const MIN_ZOOM = 0.05
const MIN_FIT_ZOOM = 0.005
const MAX_ZOOM = 32
const DEFAULT_WIDTH = 1_280
const DEFAULT_HEIGHT = 720
const DEFAULT_BRUSH_COLOR = '#111827'
const DEFAULT_BRUSH_SIZE = 12
const DEFAULT_BACKGROUND = 'transparent'
const EPSILON = 0.000_001
const MIN_VISIBLE_PASTE_PIXELS = 24
const DEFAULT_SNAP_TOLERANCE = 8
const MAX_ADVANCED_FILTER_OPERATIONS = 64
const TOP_LEFT_ORIGIN = {
  originX: 'left',
  originY: 'top',
} as const
const createEmptyAbsoluteClip = (): Rect => new Rect({ width: 0, height: 0 })

const validateAdvancedFilterOperations = async (
  operations: unknown,
  path = 'filters',
): Promise<FilterOperation[]> => {
  if (
    !Array.isArray(operations) ||
    operations.length === 0 ||
    operations.length > MAX_ADVANCED_FILTER_OPERATIONS
  ) {
    throw new RangeError(
      `Advanced filtering requires from 1 to ${MAX_ADVANCED_FILTER_OPERATIONS} operations.`,
    )
  }
  const { validateFilterOperation } = await import('./filters/registry')
  return operations.map((operation, index) =>
    validateFilterOperation(operation, `${path}[${index}]`),
  )
}

const cloneAdvancedFilterOperations = (
  operations: readonly FilterOperation[],
): FilterOperation[] => structuredClone(operations) as FilterOperation[]

const copySelectionMask = (
  mask: EncodedSelectionMask | undefined,
): EncodedSelectionMask | undefined =>
  mask
    ? {
        width: mask.width,
        height: mask.height,
        encoding: mask.encoding,
        data: mask.data,
      }
    : undefined

const normalizeEditorState = (
  state: ProjectEditorState | undefined,
  width: number,
  height: number,
): ProjectEditorState => {
  const guides = (state?.guides ?? [])
    .filter(
      (guide): guide is ProjectGuide =>
        (guide.axis === 'x' || guide.axis === 'y') &&
        Number.isFinite(guide.position) &&
        guide.position >= 0 &&
        guide.position <= (guide.axis === 'x' ? width : height),
    )
    .map((guide) => ({ ...guide }))
  const snapTolerance =
    typeof state?.snapTolerance === 'number' &&
    Number.isFinite(state.snapTolerance)
      ? clamp(state.snapTolerance, 1, 100)
      : DEFAULT_SNAP_TOLERANCE
  const selectionMask =
    state?.selectionMask?.width === width &&
    state.selectionMask.height === height
      ? copySelectionMask(state.selectionMask)
      : undefined

  return {
    guides,
    snapTolerance,
    ...(selectionMask ? { selectionMask } : {}),
  }
}

let fallbackIdCounter = 0

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const escapeXmlAttribute = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const MAX_CHART_PALETTE_COLORS = 64
const HEX_COLOR = /^#[0-9a-f]{6}$/iu

const normalizeChartPalette = (palette: readonly string[]): string[] => {
  if (palette.length > MAX_CHART_PALETTE_COLORS) {
    throw new RangeError(
      `Chart palettes may contain at most ${MAX_CHART_PALETTE_COLORS} colors.`,
    )
  }
  return palette.map((entry, index) => {
    if (!HEX_COLOR.test(entry)) {
      throw new TypeError(
        `Chart palette color ${index + 1} must be a six-digit hex color.`,
      )
    }
    return entry.toLowerCase()
  })
}

const parseChartPalette = (value: unknown, path: string): string[] => {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new TypeError(`${path} must be an array of hex colors.`)
  }
  return normalizeChartPalette(value as string[])
}

const normalizeFilterSettings = (
  settings: ImageFilterSettings,
): Required<ImageFilterSettings> => ({
  brightness: clamp(finiteOr(settings.brightness, 0), -1, 1),
  contrast: clamp(finiteOr(settings.contrast, 0), -1, 1),
  saturation: clamp(finiteOr(settings.saturation, 0), -1, 1),
  hue: clamp(finiteOr(settings.hue, 0), -1, 1),
  blur: clamp(finiteOr(settings.blur, 0), 0, 1),
  grayscale: Boolean(settings.grayscale),
  sharpen: clamp(finiteOr(settings.sharpen, 0), 0, 2),
  emboss: clamp(finiteOr(settings.emboss, 0), 0, 2),
  noise: clamp(finiteOr(settings.noise, 0), 0, 1),
  pixelate: clamp(Math.round(finiteOr(settings.pixelate, 1)), 1, 128),
  sepia: clamp(finiteOr(settings.sepia, 0), 0, 1),
  invert: clamp(finiteOr(settings.invert, 0), 0, 1),
  gamma: clamp(finiteOr(settings.gamma, 1), 0.1, 2.2),
  temperature: clamp(finiteOr(settings.temperature, 0), -1, 1),
  tint: clamp(finiteOr(settings.tint, 0), -1, 1),
  vignette: clamp(finiteOr(settings.vignette, 0), 0, 1),
  duotone: clamp(finiteOr(settings.duotone, 0), 0, 1),
  halftone: clamp(finiteOr(settings.halftone, 0), 0, 1),
  glitch: clamp(finiteOr(settings.glitch, 0), 0, 1),
})

type DeterministicNoiseProps = {
  noise: number
  seed: number
}

const DETERMINISTIC_NOISE_SEED = 0.618_033_988_75
const DETERMINISTIC_NOISE_FRAGMENT_SOURCE = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uStepW;
  uniform float uStepH;
  uniform float uNoise;
  uniform float uSeed;
  varying vec2 vTexCoord;

  float pixelweaveRandom(vec2 pixel, float seed) {
    return fract(sin(dot(pixel, vec2(12.9898, 78.233)) + seed * 19.19) * 43758.5453);
  }

  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec2 pixel = floor(vTexCoord / vec2(uStepW, uStepH));
    color.rgb += (0.5 - pixelweaveRandom(pixel, uSeed)) * uNoise;
    gl_FragColor = color;
  }
`

/**
 * Fabric's built-in Noise filter samples Math.random() on every CPU/WebGL
 * application. Adjustment caches are intentionally rebuilt, so that behavior
 * would make an unchanged project render differently after refresh/restore.
 * This filter uses a persisted fixed seed and a pixel-index hash instead.
 */
class DeterministicNoiseFilter extends filters.BaseFilter<
  'PixelweaveDeterministicNoise',
  DeterministicNoiseProps
> {
  declare public noise: number
  declare public seed: number

  public static type = 'PixelweaveDeterministicNoise'
  public static defaults: DeterministicNoiseProps = {
    noise: 0,
    seed: DETERMINISTIC_NOISE_SEED,
  }
  public static uniformLocations = ['uNoise', 'uSeed']

  public getFragmentSource(): string {
    return DETERMINISTIC_NOISE_FRAGMENT_SOURCE
  }

  public applyTo2d({ imageData: { data } }: T2DPipelineState): void {
    const seed = Math.round(this.seed * 0xffff_ffff) >>> 0
    for (let offset = 0; offset < data.length; offset += 4) {
      let hash = ((offset / 4) ^ seed) >>> 0
      hash = Math.imul(hash ^ (hash >>> 16), 0x7feb_352d)
      hash = Math.imul(hash ^ (hash >>> 15), 0x846c_a68b)
      hash = (hash ^ (hash >>> 16)) >>> 0
      const random = hash / 0x1_0000_0000
      const delta = (0.5 - random) * this.noise
      data[offset] += delta
      data[offset + 1] += delta
      data[offset + 2] += delta
    }
  }

  public sendUniformData(
    gl: WebGLRenderingContext,
    uniformLocations: TWebGLUniformLocationMap,
  ): void {
    gl.uniform1f(uniformLocations.uNoise, this.noise / 255)
    gl.uniform1f(uniformLocations.uSeed, this.seed)
  }

  public isNeutralState(): boolean {
    return this.noise === 0
  }
}

classRegistry.setClass(DeterministicNoiseFilter)

const createImageFilters = (
  normalized: Required<ImageFilterSettings>,
): FabricImage['filters'] => {
  const nextFilters: FabricImage['filters'] = []

  if (Math.abs(normalized.brightness) > EPSILON) {
    nextFilters.push(
      new filters.Brightness({ brightness: normalized.brightness }),
    )
  }
  if (Math.abs(normalized.contrast) > EPSILON) {
    nextFilters.push(new filters.Contrast({ contrast: normalized.contrast }))
  }
  if (Math.abs(normalized.saturation) > EPSILON) {
    nextFilters.push(
      new filters.Saturation({ saturation: normalized.saturation }),
    )
  }
  if (Math.abs(normalized.hue) > EPSILON) {
    nextFilters.push(new filters.HueRotation({ rotation: normalized.hue }))
  }
  if (normalized.blur > EPSILON) {
    nextFilters.push(new filters.Blur({ blur: normalized.blur }))
  }
  if (normalized.grayscale) {
    nextFilters.push(new filters.Grayscale({ mode: 'luminosity' }))
  }
  if (normalized.sharpen > EPSILON) {
    const amount = normalized.sharpen
    nextFilters.push(
      new filters.Convolute({
        matrix: [
          0,
          -amount,
          0,
          -amount,
          1 + amount * 4,
          -amount,
          0,
          -amount,
          0,
        ],
      }),
    )
  }
  if (normalized.emboss > EPSILON) {
    const amount = normalized.emboss
    nextFilters.push(
      new filters.Convolute({
        matrix: [
          -2 * amount,
          -amount,
          0,
          -amount,
          1,
          amount,
          0,
          amount,
          2 * amount,
        ],
        opaque: true,
      }),
    )
  }
  if (normalized.noise > EPSILON) {
    nextFilters.push(
      new DeterministicNoiseFilter({
        noise: Math.round(normalized.noise * 500),
        seed: DETERMINISTIC_NOISE_SEED,
      }),
    )
  }
  if (normalized.pixelate > 1) {
    nextFilters.push(new filters.Pixelate({ blocksize: normalized.pixelate }))
  }
  if (normalized.sepia > EPSILON) {
    nextFilters.push(new filters.Sepia())
  }
  if (normalized.invert > EPSILON) {
    nextFilters.push(new filters.Invert())
  }
  if (Math.abs(normalized.gamma - 1) > EPSILON) {
    nextFilters.push(
      new filters.Gamma({
        gamma: [normalized.gamma, normalized.gamma, normalized.gamma],
      }),
    )
  }
  if (
    Math.abs(normalized.temperature) > EPSILON ||
    Math.abs(normalized.tint) > EPSILON
  ) {
    const temperature = normalized.temperature * 0.2
    const tint = normalized.tint * 0.16
    nextFilters.push(
      new filters.ColorMatrix({
        matrix: [
          1 + temperature,
          0,
          0,
          0,
          0,
          0,
          1 + tint,
          0,
          0,
          0,
          0,
          0,
          1 - temperature,
          0,
          0,
          0,
          0,
          0,
          1,
          0,
        ],
      }),
    )
  }
  if (normalized.vignette > EPSILON) {
    nextFilters.push(
      new filters.BlendColor({
        color: '#111827',
        mode: 'multiply',
        alpha: normalized.vignette * 0.25,
      }),
    )
  }
  if (normalized.duotone > EPSILON) {
    nextFilters.push(
      new filters.BlendColor({
        color: '#6d28d9',
        mode: 'tint',
        alpha: normalized.duotone * 0.35,
      }),
    )
  }
  if (normalized.halftone > EPSILON) {
    nextFilters.push(
      new filters.Pixelate({
        blocksize: Math.max(2, Math.round(normalized.halftone * 18)),
      }),
    )
  }
  if (normalized.glitch > EPSILON) {
    nextFilters.push(
      new filters.BlendColor({
        color: '#00d9ff',
        mode: 'difference',
        alpha: normalized.glitch * 0.18,
      }),
    )
  }

  return nextFilters
}

const documentDimension = (value: number): number =>
  clamp(Math.round(value), MIN_DOCUMENT_SIZE, MAX_DOCUMENT_SIZE)

const createEditorId = (): string => {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID()
  }

  fallbackIdCounter += 1
  return `layer-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`
}

const isAbortLikeError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

interface DocumentSpaceTransform {
  scaleX: number
  scaleY: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

const transformDocumentMask = (
  mask: SelectionMask,
  transform: DocumentSpaceTransform,
): SelectionMask => {
  const source = mask.toBytes()
  const output = new Uint8Array(transform.width * transform.height)
  for (let y = 0; y < transform.height; y += 1) {
    const sourceY = Math.floor((y - transform.offsetY) / transform.scaleY)
    if (sourceY < 0 || sourceY >= mask.height) continue
    for (let x = 0; x < transform.width; x += 1) {
      const sourceX = Math.floor((x - transform.offsetX) / transform.scaleX)
      if (sourceX < 0 || sourceX >= mask.width) continue
      output[y * transform.width + x] = source[sourceY * mask.width + sourceX]
    }
  }
  return SelectionMask.fromBytes(transform.width, transform.height, output)
}

/**
 * A React-independent adapter around Fabric.js.
 *
 * Logical document pixels are tracked independently from the Fabric display
 * surface. `fitToViewport` sizes that surface while `setCanvasSize` changes
 * only the document. Zoom and pan are viewport-only operations and are
 * excluded from snapshots and change events.
 */
export class FabricEditorEngine {
  private readonly canvas: Canvas
  private documentWidth: number
  private documentHeight: number
  private callbacks: FabricEditorCallbacks
  private currentTool: EditorTool = 'select'
  private brushColor: string
  private brushSize: number
  private brushOpacity: number
  private eventSuppressionDepth = 0
  private transactionDepth = 0
  private transactionChanged = false
  private atomicQueue: Promise<void> = Promise.resolve()
  private disposed = false
  private isPanning = false
  private lastPanPoint: Point | null = null
  private clipboard: ClipboardObject[] = []
  private clipboardPrimaryCount = 0
  private pasteGeneration = 0
  private editorState: ProjectEditorState
  private selectionMask: SelectionMask | undefined
  private selectionBounds: SelectionMaskBounds | null = null
  private selectionOverlay: HTMLCanvasElement | undefined
  private selectionOverlayPhase = 0
  private selectionOverlayTimer:
    ReturnType<typeof globalThis.setInterval> | undefined
  private restoreQueue: Promise<void> = Promise.resolve()
  private isExporting = false
  private isRefreshingAdjustments = false
  private adjustmentRefreshGeneration = 0
  private adjustmentRefreshPromise: Promise<void> = Promise.resolve()
  private readonly eventDisposers: VoidFunction[] = []
  private readonly disposedResources = new WeakSet<object>()

  public constructor(
    element: HTMLCanvasElement,
    options: FabricEditorOptions = {},
  ) {
    const width = documentDimension(finiteOr(options.width, DEFAULT_WIDTH))
    const height = documentDimension(finiteOr(options.height, DEFAULT_HEIGHT))

    this.callbacks = options.callbacks ?? {}
    this.documentWidth = width
    this.documentHeight = height
    this.brushColor = options.brushColor ?? DEFAULT_BRUSH_COLOR
    this.brushSize = clamp(
      finiteOr(options.brushWidth, DEFAULT_BRUSH_SIZE),
      1,
      512,
    )
    this.brushOpacity = clamp(finiteOr(options.brushOpacity, 1), 0.01, 1)
    this.editorState = normalizeEditorState(undefined, width, height)

    this.canvas = new Canvas(element, {
      width,
      height,
      backgroundColor: options.backgroundColor ?? DEFAULT_BACKGROUND,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      controlsAboveOverlay: true,
    })
    this.setDocumentClip()
    this.canvas.freeDrawingBrush = new PencilBrush(this.canvas)
    this.applyBrushOptions()
    this.bindEvents()
    this.configureObjectInteractivity()
    this.emitLayers()
    this.emitSelection()
    this.emitZoom()
  }

  public getCanvas(): Canvas {
    return this.canvas
  }

  public setCallbacks(callbacks: FabricEditorCallbacks): void {
    this.callbacks = callbacks
    this.emitLayers()
    this.emitSelection()
    this.emitZoom()
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.adjustmentRefreshGeneration += 1
    this.stopSelectionOverlayAnimation()
    await this.restoreQueue.catch(() => undefined)
    await this.adjustmentRefreshPromise.catch(() => undefined)
    this.eventDisposers.splice(0).forEach((dispose) => dispose())
    this.replaceClipboard([])
    await this.canvas.dispose()
  }

  /**
   * Groups any number of existing engine operations into one observable
   * mutation. A failed transaction restores the exact pre-operation snapshot.
   */
  public async runAtomic<T>(
    reason: EditorChangeReason,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const execute = async (): Promise<T> => {
      this.assertUsable()
      const before = this.snapshot()
      this.transactionDepth = 1
      this.transactionChanged = false
      try {
        const result = await operation()
        const changed = this.transactionChanged
        this.transactionDepth = 0
        this.transactionChanged = false
        if (changed) {
          this.finishMutation(reason)
        }
        return result
      } catch (error) {
        this.transactionDepth = 0
        this.transactionChanged = false
        await this.restore(before)
        throw error
      }
    }
    const result = this.atomicQueue.then(execute, execute)
    this.atomicQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  public getTool(): EditorTool {
    return this.currentTool
  }

  public setTool(tool: EditorTool, brushOptions?: BrushOptions): void {
    this.assertUsable()
    this.currentTool = tool
    if (brushOptions) {
      this.setBrushOptions(brushOptions)
    }

    this.isPanning = false
    this.lastPanPoint = null
    this.canvas.isDrawingMode = tool === 'brush' || tool === 'eraser'
    this.canvas.selection = tool === 'select'
    this.canvas.skipTargetFind = tool !== 'select'
    this.canvas.defaultCursor = tool === 'pan' ? 'grab' : 'default'
    this.canvas.hoverCursor = tool === 'pan' ? 'grab' : 'move'
    this.canvas.freeDrawingCursor = tool === 'eraser' ? 'cell' : 'crosshair'
    this.withSuppressedEvents(() => {
      this.configureObjectInteractivity()
      this.applyBrushOptions()
      this.canvas.discardActiveObject()
      this.canvas.requestRenderAll()
    })
    this.emitSelection()
    this.emitLayers()
  }

  public setBrushOptions(options: BrushOptions): void {
    this.assertUsable()
    if (typeof options.color === 'string' && options.color.trim()) {
      this.brushColor = options.color
    }
    if (typeof options.size === 'number' && Number.isFinite(options.size)) {
      this.brushSize = clamp(options.size, 1, 512)
    }
    if (
      typeof options.opacity === 'number' &&
      Number.isFinite(options.opacity)
    ) {
      this.brushOpacity = clamp(options.opacity, 0.01, 1)
    }
    this.applyBrushOptions()
  }

  public getBrushOptions(): Required<BrushOptions> {
    return {
      color: this.brushColor,
      size: this.brushSize,
      opacity: this.brushOpacity,
    }
  }

  public async importImage(
    dataUrl: string,
    name = 'Image',
    options: ImportImageOptions = {},
  ): Promise<string> {
    this.assertUsable()
    let image: FabricImage | undefined

    try {
      const declared = inspectEmbeddedImageDataUrl(dataUrl).dimensions
      const loadedImage = await FabricImage.fromURL(dataUrl)
      image = loadedImage
      this.assertUsable()
      assertSafeImageDimensions({
        width: loadedImage.width,
        height: loadedImage.height,
      })
      const matchesHeader = imageDimensionsMatchHeader(
        { width: loadedImage.width, height: loadedImage.height },
        declared,
      )
      if (!matchesHeader) {
        throw new ImageSafetyError(
          'image-dimension-mismatch',
          'The embedded image header does not match its decoded dimensions.',
        )
      }
      const editorObject = loadedImage as EditorObject
      this.normalizeObjectOrigin(editorObject)
      this.initializeEditorObject(
        editorObject,
        this.uniqueLayerName(name.trim() || 'Image'),
      )

      const canvasWasEmpty = this.canvas.getObjects().length === 0
      const resizeCanvas =
        options.resizeCanvasIfEmpty === true && canvasWasEmpty
      const canvasWidth = resizeCanvas ? loadedImage.width : this.documentWidth
      const canvasHeight = resizeCanvas
        ? loadedImage.height
        : this.documentHeight
      const imageWidth = Math.max(loadedImage.width, 1)
      const imageHeight = Math.max(loadedImage.height, 1)
      const placementMargin = canvasWasEmpty ? 1 : 0.9
      const scale = Math.min(
        1,
        (canvasWidth * placementMargin) / imageWidth,
        (canvasHeight * placementMargin) / imageHeight,
      )
      loadedImage.set({
        ...TOP_LEFT_ORIGIN,
        left: (canvasWidth - imageWidth * scale) / 2,
        top: (canvasHeight - imageHeight * scale) / 2,
        scaleX: scale,
        scaleY: scale,
      })

      this.mutate('object-added', () => {
        if (resizeCanvas) {
          this.documentWidth = documentDimension(canvasWidth)
          this.documentHeight = documentDimension(canvasHeight)
          this.setDocumentClip()
        }
        this.canvas.add(loadedImage)
        this.canvas.setActiveObject(loadedImage)
      })
      this.emitStatus('画像を読み込みました。', 'success')
      return this.requireEditorId(editorObject)
    } catch (error) {
      if (image) {
        this.disposeResources([image], this.canvas.getObjects())
      }
      if (!isAbortLikeError(error)) {
        this.emitStatus('画像を読み込めませんでした。', 'error')
      }
      throw error
    }
  }

  /**
   * Imports SVG that has already crossed the svgSafety sanitizer boundary.
   * The parsed objects are grouped into one editable vector layer.
   */
  public async importSvg(sanitizedSvg: string, name = 'SVG'): Promise<string> {
    this.assertUsable()
    const parsed = await loadSVGFromString(sanitizedSvg)
    this.assertUsable()
    const objects = parsed.objects.filter(
      (object): object is FabricObject => object instanceof FabricObject,
    )
    if (objects.length === 0) {
      throw new TypeError('The SVG does not contain any supported objects.')
    }

    let grouped: FabricObject | undefined
    try {
      grouped = util.groupSVGElements(objects, parsed.options)
      const editorObject = grouped as EditorObject
      editorObject.editorKind = 'svg'
      this.initializeEditorObject(
        editorObject,
        this.uniqueLayerName(name.trim() || 'SVG'),
      )
      const bounds = grouped.getBoundingRect()
      const scale = Math.min(
        1,
        (this.documentWidth * 0.82) / Math.max(1, bounds.width),
        (this.documentHeight * 0.82) / Math.max(1, bounds.height),
      )
      grouped.set({
        ...TOP_LEFT_ORIGIN,
        left: (this.documentWidth - bounds.width * scale) / 2,
        top: (this.documentHeight - bounds.height * scale) / 2,
        scaleX: grouped.scaleX * scale,
        scaleY: grouped.scaleY * scale,
      })
      grouped.setCoords()
      this.mutate('svg-import', () => {
        this.canvas.add(grouped!)
        this.canvas.setActiveObject(grouped!)
      })
      this.emitStatus('SVGをベクターレイヤーとして読み込みました。', 'success')
      return this.requireEditorId(editorObject)
    } catch (error) {
      this.disposeResources(
        grouped ? [grouped] : objects,
        this.canvas.getObjects(),
      )
      throw error
    }
  }

  /** Inserts a validated semantic chart and its editable source model. */
  public async insertChartModel(
    model: ChartModel,
    palette: readonly string[] = [],
    name = 'Chart',
  ): Promise<string> {
    this.assertUsable()
    const [charts, { sanitizeSvg }] = await Promise.all([
      import('../charts'),
      import('../lib/svgSafety'),
    ])
    const normalized = charts.parseChartModel(model)
    const normalizedPalette = normalizeChartPalette(palette)
    const scene = charts.buildChartVectorScene(normalized, {
      width: 800,
      height: 520,
      palette: normalizedPalette,
    })
    const source = sanitizeSvg(charts.chartVectorSceneToSvg(scene)).source

    return this.runAtomic('chart', async () => {
      const id = await this.importSvg(source, name)
      const target = this.findLayer(id)
      if (!target) throw new Error('The inserted chart layer is unavailable.')
      this.mutate('chart', () => {
        target.editorKind = 'chart'
        target.editorChartModel = structuredClone(normalized)
        target.editorChartPalette = [...normalizedPalette]
        target.editorTableModel = undefined
      })
      return id
    })
  }

  /** Inserts a validated semantic table and its editable source model. */
  public async insertTableModel(
    model: TableModel,
    name = 'Table',
  ): Promise<string> {
    this.assertUsable()
    const [tables, { sanitizeSvg }] = await Promise.all([
      import('../tables'),
      import('../lib/svgSafety'),
    ])
    const normalized = tables.parseTableModel(model)
    const source = sanitizeSvg(tables.tableModelToSvg(normalized)).source

    return this.runAtomic('table', async () => {
      const id = await this.importSvg(source, name)
      const target = this.findLayer(id)
      if (!target) throw new Error('The inserted table layer is unavailable.')
      this.mutate('table', () => {
        target.editorKind = 'table'
        target.editorTableModel = structuredClone(normalized)
        target.editorChartModel = undefined
        target.editorChartPalette = undefined
      })
      return id
    })
  }

  /** Returns an immutable copy of a selected or id-addressed chart model. */
  public getChartLayer(id?: string): ChartLayerData | null {
    this.assertUsable()
    const target = id
      ? this.findLayer(id)
      : this.canvas.getActiveObjects().length === 1
        ? this.normalizeEditorObject(this.canvas.getActiveObjects()[0])
        : undefined
    if (!target?.editorChartModel) return null
    return {
      layerId: this.requireEditorId(target),
      model: structuredClone(target.editorChartModel),
      palette: [...(target.editorChartPalette ?? [])],
    }
  }

  /** Returns an immutable copy of a selected or id-addressed table model. */
  public getTableLayer(id?: string): TableLayerData | null {
    this.assertUsable()
    const target = id
      ? this.findLayer(id)
      : this.canvas.getActiveObjects().length === 1
        ? this.normalizeEditorObject(this.canvas.getActiveObjects()[0])
        : undefined
    if (!target?.editorTableModel) return null
    return {
      layerId: this.requireEditorId(target),
      model: structuredClone(target.editorTableModel),
    }
  }

  /** Regenerates a chart layer while preserving its editor-layer identity. */
  public async updateChartLayer(
    model: ChartModel,
    options: UpdateChartLayerOptions = {},
  ): Promise<boolean> {
    this.assertUsable()
    const current = this.getChartLayer(options.id)
    if (!current) return false
    const [charts, { sanitizeSvg }] = await Promise.all([
      import('../charts'),
      import('../lib/svgSafety'),
    ])
    const normalized = charts.parseChartModel(model)
    const normalizedPalette = normalizeChartPalette(
      options.palette ?? current.palette,
    )
    const scene = charts.buildChartVectorScene(normalized, {
      width: 800,
      height: 520,
      palette: normalizedPalette,
    })
    const source = sanitizeSvg(charts.chartVectorSceneToSvg(scene)).source
    return this.replaceSemanticSvgLayer(
      current.layerId,
      source,
      'chart',
      (replacement) => {
        replacement.editorChartModel = structuredClone(normalized)
        replacement.editorChartPalette = [...normalizedPalette]
        replacement.editorTableModel = undefined
      },
    )
  }

  /** Regenerates a table layer while preserving its editor-layer identity. */
  public async updateTableLayer(
    model: TableModel,
    options: UpdateTableLayerOptions = {},
  ): Promise<boolean> {
    this.assertUsable()
    const current = this.getTableLayer(options.id)
    if (!current) return false
    const [tables, { sanitizeSvg }] = await Promise.all([
      import('../tables'),
      import('../lib/svgSafety'),
    ])
    const normalized = tables.parseTableModel(model)
    const source = sanitizeSvg(tables.tableModelToSvg(normalized)).source
    return this.replaceSemanticSvgLayer(
      current.layerId,
      source,
      'table',
      (replacement) => {
        replacement.editorTableModel = structuredClone(normalized)
        replacement.editorChartModel = undefined
        replacement.editorChartPalette = undefined
      },
    )
  }

  public async exportSvg(
    scope: 'document' | 'selection' = 'document',
  ): Promise<string> {
    await this.waitForAdjustmentLayers()
    if (scope === 'document') {
      if (
        this.canvas.getObjects().some((object) => this.hasNestedClip(object))
      ) {
        const dataUrl = await this.exportDataUrl('png', 1, 1)
        return this.createRasterSvg(
          dataUrl,
          0,
          0,
          this.documentWidth,
          this.documentHeight,
          'Pixelweave document',
        )
      }
      return this.canvas.toSVG({
        width: `${this.documentWidth}`,
        height: `${this.documentHeight}`,
        viewBox: {
          x: 0,
          y: 0,
          width: this.documentWidth,
          height: this.documentHeight,
        },
      })
    }

    const object = this.canvas.getActiveObject()
    if (!object) {
      throw new Error('SVGとして書き出すオブジェクトを選択してください。')
    }
    const bounds = object.getBoundingRect()
    const left = Math.floor(bounds.left)
    const top = Math.floor(bounds.top)
    const width = Math.max(1, Math.ceil(bounds.width))
    const height = Math.max(1, Math.ceil(bounds.height))
    const label = escapeXmlAttribute(
      this.requireEditorName(this.normalizeEditorObject(object)),
    )
    if (this.hasNestedClip(object)) {
      const source = this.createIsolatedLayerCanvas(object)
      const output = document.createElement('canvas')
      output.width = width
      output.height = height
      const context = output.getContext('2d')
      if (!context) {
        throw new Error('SVGラスターフォールバックを作成できませんでした。')
      }
      context.drawImage(source, left, top, width, height, 0, 0, width, height)
      return this.createRasterSvg(
        output.toDataURL('image/png'),
        left,
        top,
        width,
        height,
        label,
      )
    }
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" role="img" aria-label="${label}">`,
      object.toSVG(),
      '</svg>',
    ].join('')
  }

  public addRect(options: AddShapeOptions = {}): string {
    this.assertUsable()
    const width = Math.max(1, finiteOr(options.width, 240))
    const height = Math.max(1, finiteOr(options.height, 160))
    const rect = new Rect({
      ...TOP_LEFT_ORIGIN,
      left: finiteOr(options.left, (this.documentWidth - width) / 2),
      top: finiteOr(options.top, (this.documentHeight - height) / 2),
      width,
      height,
      fill: options.fill ?? '#4f46e5',
      stroke: options.stroke ?? 'transparent',
      strokeWidth: Math.max(0, finiteOr(options.strokeWidth, 0)),
      rx: 10,
      ry: 10,
    }) as EditorObject
    this.initializeEditorObject(
      rect,
      this.uniqueLayerName(options.name?.trim() || 'Rectangle'),
    )
    this.addAndSelect(rect)
    return this.requireEditorId(rect)
  }

  /** Marks a rectangular layer as a drop target before it is nested in a grid. */
  public markLayerAsGridCell(id: string): boolean {
    this.assertUsable()
    const target = this.findLayer(id)
    if (!(target instanceof Rect)) return false
    const editorTarget = target as EditorObject & Rect
    this.mutate('asset', () => {
      editorTarget.editorKind = 'grid-cell'
      editorTarget.editorGridCellId = id
    })
    return true
  }

  /** Returns draggable internal dividers for the selected grid/group/cell. */
  public getSelectedGridBoundaries(): GridBoundaryInfo[] {
    this.assertUsable()
    const resolved = this.selectedGridGroupLayout()
    if (!resolved) return []
    const groupId = this.requireEditorId(resolved.group)
    return gridBoundaries(resolved.layout).map((boundary) => ({
      ...boundary,
      groupId,
    }))
  }

  /** Commits one bounded grid divider drag as one undoable editor mutation. */
  public moveSelectedGridBoundary(
    boundaryId: string,
    position: number,
  ): boolean {
    this.assertUsable()
    const resolved = this.selectedGridGroupLayout()
    if (!resolved || !Number.isFinite(position)) return false
    const boundary = gridBoundaries(resolved.layout).find(
      ({ id }) => id === boundaryId,
    )
    if (!boundary) return false
    const boundedPosition = clamp(position, boundary.minimum, boundary.maximum)
    if (Math.abs(boundedPosition - boundary.position) < EPSILON) return false
    const next = moveGridBoundary(resolved.layout, boundaryId, boundedPosition)

    this.mutate('asset', () => {
      next.forEach((layout) => {
        const cell = resolved.cells.get(layout.id)
        if (!cell) return
        cell.set({
          ...TOP_LEFT_ORIGIN,
          left: resolved.left + layout.x * resolved.width,
          top: resolved.top + layout.y * resolved.height,
          width: layout.width * resolved.width,
          height: layout.height * resolved.height,
          scaleX: 1,
          scaleY: 1,
          dirty: true,
        })
        cell.setCoords()
      })
      resolved.group.triggerLayout()
      resolved.group.setCoords()
    })
    return true
  }

  /** Marks a catalog frame so an image can be dropped into it. */
  public markLayerAsDropFrame(id: string): boolean {
    this.assertUsable()
    const target = this.findLayer(id)
    if (!target || target instanceof FabricImage) return false
    this.mutate('asset', () => {
      target.editorKind = 'frame'
    })
    return true
  }

  /**
   * Covers a grid cell with a decoded raster and retains a serializable clip.
   * Image header validation remains the caller's file-boundary responsibility;
   * importImage performs the second decoded-dimension safety check.
   */
  public async fillGridCell(
    cellId: string,
    dataUrl: string,
    name = 'Grid image',
  ): Promise<string> {
    this.assertUsable()
    const cell = this.findLayer(cellId)
    if (
      !(cell instanceof Rect) ||
      (cell as EditorObject).editorKind !== 'grid-cell' ||
      (cell as EditorObject).editorGridCellId !== cellId
    ) {
      throw new RangeError('The requested grid cell does not exist.')
    }
    const editorCell = cell as EditorObject & Rect
    const bounds = editorCell.getBoundingRect()
    if (
      ![bounds.left, bounds.top, bounds.width, bounds.height].every(
        Number.isFinite,
      ) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      throw new RangeError('The requested grid cell has invalid bounds.')
    }

    const removedContents: FabricObject[] = []
    const imageId = await this.runAtomic('asset', async () => {
      const imageId = await this.importImage(dataUrl, name)
      const image = this.findLayer(imageId)
      if (!(image instanceof FabricImage)) {
        throw new TypeError('The decoded grid content is not an image.')
      }
      const editorImage = image as EditorObject & FabricImage
      const frame = new Rect({
        ...TOP_LEFT_ORIGIN,
        left: 0,
        top: 0,
        width: Math.max(1, editorCell.width),
        height: Math.max(1, editorCell.height),
        fill: '#000000',
        strokeWidth: 0,
        absolutePositioned: true,
        selectable: false,
        evented: false,
      }) as EditorObject
      frame.editorKind = 'frame'
      this.initializeEditorObject(
        frame,
        this.uniqueLayerName(`${this.requireEditorName(editorCell)} frame`),
      )
      const priorContents = this.canvas.getObjects().filter((object) => {
        const candidate = object as EditorObject
        return (
          candidate !== image &&
          candidate.editorKind === 'grid-cell-image' &&
          candidate.editorGridCellId === cellId
        )
      })

      this.mutate('asset', () => {
        if (priorContents.length > 0) {
          this.canvas.remove(...priorContents)
          removedContents.push(...priorContents)
        }
        editorImage.editorKind = 'grid-cell-image'
        editorImage.editorGridCellId = cellId
        editorImage.editorClipFrameId = this.requireEditorId(frame)
        editorImage.set({
          clipPath: frame,
          dirty: true,
        })
        this.syncGridCellContent(editorImage, editorCell)
        this.canvas.setActiveObject(editorImage)
      })
      return imageId
    })
    this.disposeResources(removedContents, this.canvasOwnedResources())
    return imageId
  }

  /** Fills a catalog frame through the same clipping operation as the UI. */
  public async fillDropFrame(
    frameId: string,
    dataUrl: string,
    name = 'Frame image',
  ): Promise<string> {
    this.assertUsable()
    const frame = this.findLayer(frameId)
    if (
      !frame ||
      frame instanceof FabricImage ||
      (frame as EditorObject).editorKind !== 'frame'
    ) {
      throw new RangeError('The requested frame does not exist.')
    }
    const editorFrame = frame as EditorObject
    const bounds = editorFrame.getBoundingRect()
    if (
      ![bounds.left, bounds.top, bounds.width, bounds.height].every(
        Number.isFinite,
      ) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      throw new RangeError('The requested frame has invalid bounds.')
    }

    return this.runAtomic('asset', async () => {
      const imageId = await this.importImage(dataUrl, name)
      const image = this.findLayer(imageId)
      if (!(image instanceof FabricImage)) {
        throw new TypeError('The decoded frame content is not an image.')
      }
      const editorImage = image as EditorObject & FabricImage
      const sourceWidth = Math.max(1, editorImage.width)
      const sourceHeight = Math.max(1, editorImage.height)
      const scale = Math.max(
        bounds.width / sourceWidth,
        bounds.height / sourceHeight,
      )
      this.mutate('asset', () => {
        editorImage.set({
          ...TOP_LEFT_ORIGIN,
          left: bounds.left + (bounds.width - sourceWidth * scale) / 2,
          top: bounds.top + (bounds.height - sourceHeight * scale) / 2,
          scaleX: scale,
          scaleY: scale,
          dirty: true,
        })
        editorImage.setCoords()
        this.canvas.discardActiveObject()
        this.activateObjects([editorFrame, editorImage])
      })
      if (this.createClipFrame() !== imageId) {
        throw new Error('The frame could not be applied to the dropped image.')
      }
      return imageId
    })
  }

  public addEllipse(options: AddShapeOptions = {}): string {
    this.assertUsable()
    const width = Math.max(1, finiteOr(options.width, 220))
    const height = Math.max(1, finiteOr(options.height, 160))
    const ellipse = new Ellipse({
      ...TOP_LEFT_ORIGIN,
      left: finiteOr(options.left, (this.documentWidth - width) / 2),
      top: finiteOr(options.top, (this.documentHeight - height) / 2),
      rx: width / 2,
      ry: height / 2,
      fill: options.fill ?? '#0891b2',
      stroke: options.stroke ?? 'transparent',
      strokeWidth: Math.max(0, finiteOr(options.strokeWidth, 0)),
    }) as EditorObject
    this.initializeEditorObject(
      ellipse,
      this.uniqueLayerName(options.name?.trim() || 'Ellipse'),
    )
    this.addAndSelect(ellipse)
    return this.requireEditorId(ellipse)
  }

  public addDesignShape(
    kind: DesignShapeKind,
    options: AddShapeOptions = {},
  ): string {
    if (kind === 'rounded-rectangle') {
      return this.addRect({
        ...options,
        name: options.name ?? 'Rounded rectangle',
      })
    }
    const definitions: Record<
      Exclude<DesignShapeKind, 'rounded-rectangle'>,
      string
    > = {
      triangle: 'M 100 0 L 200 180 L 0 180 Z',
      pentagon: 'M 100 0 L 195 69 L 159 180 L 41 180 L 5 69 Z',
      star: 'M 100 0 L 124 62 L 190 65 L 139 107 L 156 172 L 100 136 L 44 172 L 61 107 L 10 65 L 76 62 Z',
      arrow: 'M 0 55 L 125 55 L 125 20 L 200 90 L 125 160 L 125 125 L 0 125 Z',
      line: 'M 0 90 L 200 90',
      'speech-bubble':
        'M 18 10 H 182 Q 195 10 195 24 V 126 Q 195 140 182 140 H 78 L 34 178 L 45 140 H 18 Q 5 140 5 126 V 24 Q 5 10 18 10 Z',
      arch: 'M 0 180 V 100 C 0 45 45 0 100 0 C 155 0 200 45 200 100 V 180 Z',
    }
    const width = Math.max(1, finiteOr(options.width, 220))
    const height = Math.max(1, finiteOr(options.height, 180))
    const lineOnly = kind === 'line'
    const path = new Path(definitions[kind], {
      ...TOP_LEFT_ORIGIN,
      left: finiteOr(options.left, (this.documentWidth - width) / 2),
      top: finiteOr(options.top, (this.documentHeight - height) / 2),
      fill: lineOnly ? 'transparent' : (options.fill ?? '#7c3aed'),
      stroke:
        options.stroke ??
        (lineOnly ? (options.fill ?? '#7c3aed') : 'transparent'),
      strokeWidth: Math.max(0, finiteOr(options.strokeWidth, lineOnly ? 8 : 0)),
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
    }) as EditorObject
    path.set({
      scaleX: width / Math.max(1, path.width),
      scaleY: height / Math.max(1, path.height),
    })
    this.initializeEditorObject(
      path,
      this.uniqueLayerName(options.name?.trim() || kind),
    )
    this.addAndSelect(path)
    return this.requireEditorId(path)
  }

  public addText(text = 'Text', options: AddTextOptions = {}): string {
    this.assertUsable()
    const source = text.length > 0 ? text : 'Text'
    const value = options.vertical ? [...source].join('\n') : source
    const layoutMode = options.layoutMode ?? 'auto'
    const textOptions = {
      ...TOP_LEFT_ORIGIN,
      left: finiteOr(options.left, this.documentWidth / 2 - 80),
      top: finiteOr(options.top, this.documentHeight / 2 - 24),
      fill: options.fill ?? '#111827',
      fontFamily: options.fontFamily ?? 'system-ui, sans-serif',
      fontSize: clamp(finiteOr(options.fontSize, 48), 6, 512),
      fontWeight: options.fontWeight ?? 600,
      lineHeight: options.vertical ? 0.9 : 1.16,
      textAlign: options.vertical ? ('center' as const) : ('left' as const),
    }
    const textObject = (
      layoutMode === 'auto'
        ? new IText(value, textOptions)
        : new Textbox(value, {
            ...textOptions,
            width: Math.max(24, finiteOr(options.width, 320)),
            splitByGrapheme: true,
          })
    ) as EditorObject
    textObject.editorTextLayoutMode = layoutMode
    textObject.editorVerticalText = Boolean(options.vertical)
    this.initializeEditorObject(
      textObject,
      this.uniqueLayerName(options.name?.trim() || 'Text'),
    )
    this.addAndSelect(textObject)
    return this.requireEditorId(textObject)
  }

  public setSelectedFontFamily(fontFamily: string): boolean {
    const selected = this.canvas.getActiveObjects()
    if (
      selected.length !== 1 ||
      !(selected[0] instanceof IText) ||
      !fontFamily.trim()
    ) {
      return false
    }
    this.mutate('text-style', () => {
      selected[0].set('fontFamily', fontFamily.trim())
      selected[0].set('dirty', true)
    })
    return true
  }

  public applyTextEffect(preset: TextEffectPreset): boolean {
    const selected = this.canvas.getActiveObjects()
    if (selected.length !== 1 || !(selected[0] instanceof IText)) return false
    const text = selected[0]
    this.mutate('text-style', () => {
      if (preset === 'none') {
        text.set({ stroke: 'transparent', strokeWidth: 0, shadow: null })
      } else if (preset === 'neon') {
        text.set({
          fill: '#ffffff',
          stroke: '#22d3ee',
          strokeWidth: 1,
          shadow: new Shadow({
            color: '#22d3ee',
            blur: 24,
            offsetX: 0,
            offsetY: 0,
          }),
        })
      } else if (preset === 'splice') {
        text.set({
          fill: 'transparent',
          stroke: '#7c3aed',
          strokeWidth: 3,
          shadow: new Shadow({
            color: '#f97316',
            blur: 0,
            offsetX: 8,
            offsetY: 8,
          }),
        })
      } else if (preset === 'background') {
        text.set({
          fill: '#ffffff',
          stroke: '#111827',
          strokeWidth: 8,
          paintFirst: 'stroke',
          shadow: null,
        })
      } else {
        text.set({
          fill: '#f8fafc',
          stroke: 'transparent',
          strokeWidth: 0,
          shadow: new Shadow({
            color: '#7c3aed',
            blur: 0,
            offsetX: 10,
            offsetY: 10,
          }),
        })
      }
      text.set('dirty', true)
    })
    return true
  }

  public getSelectedTextStyle():
    | (Required<Omit<TextStyleSettings, 'gradient' | 'shadow'>> & {
        gradient: TextGradientSettings | null
        shadow: TextShadowSettings | null
      })
    | null {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length !== 1 || !(selected[0] instanceof IText)) {
      return null
    }
    const text = selected[0]
    const gradientStops =
      text.fill instanceof Gradient
        ? [...text.fill.colorStops].sort(
            (left, right) => left.offset - right.offset,
          )
        : []
    const fill =
      typeof text.fill === 'string'
        ? text.fill
        : (gradientStops[0]?.color ?? '#111827')
    const shadow = text.shadow
      ? {
          color: text.shadow.color,
          blur: text.shadow.blur,
          offsetX: text.shadow.offsetX,
          offsetY: text.shadow.offsetY,
        }
      : null
    let gradient: TextGradientSettings | null = null
    if (text.fill instanceof Gradient) {
      gradient = {
        start: gradientStops[0]?.color ?? '#111827',
        end: gradientStops.at(-1)?.color ?? '#7c3aed',
        angle: 0,
      }
    }
    return {
      fill,
      stroke: typeof text.stroke === 'string' ? text.stroke : 'transparent',
      strokeWidth: text.strokeWidth,
      gradient,
      shadow,
      charSpacing: text.charSpacing,
      lineHeight: text.lineHeight,
    }
  }

  public setSelectedTextStyle(settings: TextStyleSettings): boolean {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length !== 1 || !(selected[0] instanceof IText)) {
      this.emitStatus(
        '装飾するテキストレイヤーを1つ選択してください。',
        'warning',
      )
      return false
    }
    const text = selected[0]
    this.mutate('text-style', () => {
      if (settings.gradient === null) {
        text.set('fill', settings.fill ?? '#111827')
      } else if (settings.gradient) {
        const angle = ((settings.gradient.angle ?? 0) * Math.PI) / 180
        const width = Math.max(1, text.width)
        const height = Math.max(1, text.height)
        const centerX = width / 2
        const centerY = height / 2
        const radius =
          Math.abs(Math.cos(angle)) * width * 0.5 +
          Math.abs(Math.sin(angle)) * height * 0.5
        text.set(
          'fill',
          new Gradient({
            type: 'linear',
            gradientUnits: 'pixels',
            coords: {
              x1: centerX - Math.cos(angle) * radius,
              y1: centerY - Math.sin(angle) * radius,
              x2: centerX + Math.cos(angle) * radius,
              y2: centerY + Math.sin(angle) * radius,
            },
            colorStops: [
              { offset: 0, color: settings.gradient.start },
              { offset: 1, color: settings.gradient.end },
            ],
          }),
        )
      } else if (settings.fill) {
        text.set('fill', settings.fill)
      }
      if (settings.stroke !== undefined) {
        text.set('stroke', settings.stroke)
      }
      if (settings.strokeWidth !== undefined) {
        text.set({
          strokeWidth: clamp(settings.strokeWidth, 0, 64),
          strokeUniform: true,
          paintFirst: 'stroke',
        })
      }
      if (settings.shadow === null) {
        text.set('shadow', null)
      } else if (settings.shadow) {
        text.set(
          'shadow',
          new Shadow({
            color: settings.shadow.color,
            blur: clamp(settings.shadow.blur, 0, 128),
            offsetX: clamp(settings.shadow.offsetX, -256, 256),
            offsetY: clamp(settings.shadow.offsetY, -256, 256),
          }),
        )
      }
      if (settings.charSpacing !== undefined) {
        text.set('charSpacing', clamp(settings.charSpacing, -500, 2_000))
      }
      if (settings.lineHeight !== undefined) {
        text.set('lineHeight', clamp(settings.lineHeight, 0.5, 5))
      }
      text.initDimensions()
      text.setCoords()
      text.set('dirty', true)
    })
    return true
  }

  public setSelectedTextArc(radius: number | null): boolean {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length !== 1 || !(selected[0] instanceof IText)) {
      this.emitStatus(
        '円弧へ配置するテキストレイヤーを1つ選択してください。',
        'warning',
      )
      return false
    }
    const text = selected[0]
    this.mutate('text-style', () => {
      if (radius === null || !Number.isFinite(radius) || radius <= 0) {
        text.set('path', undefined)
      } else {
        const safeRadius = clamp(radius, 24, 4_096)
        text.set(
          'path',
          new Path(
            `M 0 ${safeRadius} A ${safeRadius} ${safeRadius} 0 0 1 ${safeRadius * 2} ${safeRadius}`,
            {
              visible: false,
              fill: null,
              stroke: null,
            },
          ),
        )
        text.set({
          pathAlign: 'center',
          pathSide: 'left',
          pathStartOffset: 0,
        })
      }
      text.initDimensions()
      text.setCoords()
      text.set('dirty', true)
    })
    return true
  }

  public async addLogoVariation(variation: LogoVariation): Promise<string[]> {
    this.assertUsable()
    return this.runAtomic('logo', () => {
      const scale = Math.min(
        1,
        (this.documentWidth * 0.82) / variation.canvas.width,
        (this.documentHeight * 0.82) / variation.canvas.height,
      )
      const offsetX = (this.documentWidth - variation.canvas.width * scale) / 2
      const offsetY =
        (this.documentHeight - variation.canvas.height * scale) / 2
      const names = this.layerNames()
      const objects: EditorObject[] = variation.elements.map((element) => {
        let object: EditorObject
        if (element.kind === 'shape') {
          if (element.shape === 'ellipse') {
            object = new Ellipse({
              ...TOP_LEFT_ORIGIN,
              left: offsetX + element.x * scale,
              top: offsetY + element.y * scale,
              rx: (element.width * scale) / 2,
              ry: (element.height * scale) / 2,
              fill: element.fill,
              stroke: element.stroke,
              strokeWidth: element.strokeWidth * scale,
              angle: element.rotation,
              opacity: element.opacity,
            }) as EditorObject
          } else {
            object = new Rect({
              ...TOP_LEFT_ORIGIN,
              left: offsetX + element.x * scale,
              top: offsetY + element.y * scale,
              width: element.width * scale,
              height: element.height * scale,
              rx: element.cornerRadius * scale,
              ry: element.cornerRadius * scale,
              fill: element.fill,
              stroke: element.stroke,
              strokeWidth: element.strokeWidth * scale,
              angle: element.rotation,
              opacity: element.opacity,
            }) as EditorObject
          }
        } else {
          const text = new IText(element.text, {
            ...TOP_LEFT_ORIGIN,
            left: offsetX + element.x * scale,
            top: offsetY + element.y * scale,
            fill: element.color,
            fontFamily: element.fontFamily,
            fontSize: element.fontSize * scale,
            fontWeight: element.fontWeight,
            charSpacing: element.letterSpacing,
            lineHeight: element.lineHeight,
            textAlign: element.align,
            angle: element.rotation,
            opacity: element.opacity,
          })
          const availableWidth = element.maxWidth * scale
          const textWidth = text.getScaledWidth()
          if (textWidth > availableWidth && textWidth > EPSILON) {
            text.set('scaleX', availableWidth / textWidth)
          } else if (element.align === 'center') {
            text.set('left', text.left + (availableWidth - textWidth) / 2)
          } else if (element.align === 'right') {
            text.set('left', text.left + availableWidth - textWidth)
          }
          object = text as EditorObject
        }
        object.editorKind = 'logo'
        object.editorTemplateId = variation.templateId
        this.initializeEditorObject(
          object,
          this.uniqueLayerName(
            `${variation.templateName} ${element.id}`,
            names,
          ),
        )
        return object
      })

      this.mutate('logo', () => {
        this.canvas.discardActiveObject()
        this.canvas.add(...objects)
        this.activateObjects(objects)
      })
      return objects.map((object) => this.requireEditorId(object))
    })
  }

  public setSelectionPaint(fill: string, stroke?: string): boolean {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length === 0) {
      return false
    }
    this.mutate('object-modified', () => {
      selected.forEach((object) => {
        if ('fill' in object) {
          object.set('fill', fill)
        }
        if (stroke !== undefined && 'stroke' in object) {
          object.set('stroke', stroke)
        }
        object.set('dirty', true)
      })
    })
    return true
  }

  public setSelectionColor(color: string, target: 'fill' | 'stroke'): boolean {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length === 0) {
      this.emitStatus('色を適用するオブジェクトを選択してください。', 'warning')
      return false
    }
    this.mutate('object-modified', () => {
      selected.forEach((object) => {
        if (target in object) {
          object.set(target, color)
          object.set('dirty', true)
        }
      })
    })
    return true
  }

  public deleteSelection(): boolean {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length === 0) {
      return false
    }

    const ownedGridContents = this.gridContentsOwnedBy(selected)
    const objectsToRemove = [...new Set([...selected, ...ownedGridContents])]
    this.mutate('object-removed', () => {
      this.canvas.discardActiveObject()
      const topLevel = new Set(this.canvas.getObjects())
      const affectedGroups = new Set<Group>()
      objectsToRemove.forEach((object) => {
        if (topLevel.has(object)) {
          this.canvas.remove(object)
          return
        }
        const owner = object.group
        if (owner instanceof Group && !(owner instanceof ActiveSelection)) {
          owner.remove(object)
          affectedGroups.add(owner)
        }
      })
      affectedGroups.forEach((group) => {
        group.triggerLayout()
        group.setCoords()
      })
    })
    return true
  }

  /**
   * Adds an undoable, non-destructive erasure layer for the current pixel
   * selection. Object deletion remains available through deleteSelection();
   * callers can choose this method when a pixel mask is active.
   */
  public deleteSelectedPixels(name = 'Pixel deletion'): string | null {
    this.assertUsable()
    if (!this.selectionMask || !this.selectionBounds) {
      return null
    }

    const bounds = this.selectionBounds
    const clipPath = createSelectionMaskClip(this.selectionMask, bounds)
    const deletion = new Rect({
      ...TOP_LEFT_ORIGIN,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      fill: '#000000',
      strokeWidth: 0,
      globalCompositeOperation: 'destination-out',
      clipPath,
    }) as EditorObject
    deletion.editorKind = 'pixel-delete'
    deletion.editorLocked = true
    this.initializeEditorObject(
      deletion,
      this.uniqueLayerName(name.trim() || 'Pixel deletion'),
    )
    const id = this.requireEditorId(deletion)

    this.mutate('pixel-delete', () => {
      this.canvas.discardActiveObject()
      this.canvas.add(deletion)
      this.canvas.setActiveObject(deletion)
    })
    return id
  }

  public async duplicateSelection(offset = 16): Promise<string[]> {
    this.assertUsable()
    const source = this.canvas.getActiveObjects()
    if (source.length === 0) {
      return []
    }

    const ownedGridContents = this.gridContentsOwnedBy(source)
    const duplicateSources = [
      ...source,
      ...ownedGridContents.filter((object) => !source.includes(object)),
    ]
    const clones = await this.cloneObjects(duplicateSources)
    try {
      this.assertUsable()
      const reservedNames = this.layerNames()
      this.preparePastedObjects(clones, offset, reservedNames)
      const primaryClones = clones.slice(0, source.length)

      this.mutate('duplicate', () => {
        this.canvas.discardActiveObject()
        this.canvas.add(...clones)
        this.activateObjects(primaryClones)
      })
      return primaryClones.map((clone) => this.requireEditorId(clone))
    } catch (error) {
      this.disposeResources(clones, this.canvas.getObjects())
      throw error
    }
  }

  /** Combines the selected top-level layers into a serializable Fabric group. */
  public groupSelection(name = 'Group'): string | null {
    this.assertUsable()
    const selectedSet = new Set(this.canvas.getActiveObjects())
    const selected = this.canvas
      .getObjects()
      .filter((object) => selectedSet.has(object))
    if (selected.length < 2) return null
    const containsGridCell = (object: FabricObject): boolean =>
      (object as EditorObject).editorKind === 'grid-cell' ||
      (object instanceof Group && object.getObjects().some(containsGridCell))
    const constructingGrid = selected.every(
      (object) => (object as EditorObject).editorKind === 'grid-cell',
    )
    if (
      !constructingGrid &&
      selected.some(
        (object) =>
          (object as EditorObject).editorKind === 'grid-cell-image' ||
          containsGridCell(object),
      )
    ) {
      return null
    }

    const group = new Group([], {
      ...TOP_LEFT_ORIGIN,
      interactive: true,
      subTargetCheck: true,
    }) as EditorObject & Group
    group.editorKind = 'group'
    this.initializeEditorObject(
      group,
      this.uniqueLayerName(name.trim() || 'Group'),
    )

    this.mutate('group', () => {
      this.canvas.discardActiveObject()
      this.canvas.remove(...selected)
      group.add(...selected)
      group.triggerLayout()
      this.canvas.add(group)
      this.canvas.setActiveObject(group)
    })
    return this.requireEditorId(group)
  }

  /** Restores the selected group children as independently editable layers. */
  public ungroupSelection(): string[] {
    this.assertUsable()
    const active = this.canvas.getActiveObject()
    if (!(active instanceof Group) || active instanceof ActiveSelection) {
      return []
    }
    const groupIndex = this.canvas.getObjects().indexOf(active)
    const children = active.getObjects()
    if (children.length === 0) return []

    this.mutate('group', () => {
      this.canvas.discardActiveObject()
      active.removeAll()
      this.canvas.remove(active)
      children.forEach((child) => this.normalizeEditorObject(child))
      this.canvas.insertAt(Math.max(0, groupIndex), ...children)
      this.activateObjects(children)
    })
    return children.map((child) =>
      this.requireEditorId(this.normalizeEditorObject(child)),
    )
  }

  /**
   * Uses a selected vector layer as an absolute clip frame for a selected
   * image. The frame remains embedded and can be released later.
   */
  public createClipFrame(): string | null {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    const image = selected.find(
      (object): object is FabricImage => object instanceof FabricImage,
    )
    const frame = selected.find((object) => object !== image)
    if (!image || !frame || selected.length !== 2) return null
    const editorImage = this.normalizeEditorObject(image)
    const editorFrame = this.normalizeEditorObject(frame)
    const frameId = this.requireEditorId(editorFrame)
    const layerMaskClip =
      editorImage.editorLayerMask &&
      editorImage.editorLayerMaskEnabled !== false
        ? editorImage.clipPath
        : undefined

    this.mutate('clip', () => {
      this.canvas.discardActiveObject()
      this.canvas.remove(frame)
      editorFrame.editorKind = 'frame'
      frame.set({
        absolutePositioned: true,
        selectable: false,
        evented: false,
        clipPath: layerMaskClip,
      })
      editorImage.editorClipFrameId = frameId
      editorImage.editorClipSettings = {
        fit: 'cover',
        position: { x: 0.5, y: 0.5 },
        scale: 1,
        rotation: 0,
      }
      editorImage.set('clipPath', frame)
      editorImage.set('dirty', true)
      this.canvas.setActiveObject(image)
    })
    return this.requireEditorId(editorImage)
  }

  public releaseClipFrame(id?: string): string | null {
    this.assertUsable()
    const target = id
      ? this.findLayer(id)
      : this.canvas.getActiveObjects().length === 1
        ? this.normalizeEditorObject(this.canvas.getActiveObjects()[0])
        : undefined
    const frame = target ? this.embeddedClipFrame(target) : undefined
    if (!target || !target.editorClipFrameId || !frame) return null
    const editorFrame = frame as EditorObject
    editorFrame.editorId = target.editorClipFrameId
    editorFrame.editorName ||= this.uniqueLayerName('Frame')
    target.editorClipFrameId = undefined
    target.editorClipSettings = undefined
    const layerMaskClip =
      target.editorLayerMask && target.editorLayerMaskEnabled !== false
        ? (frame.clipPath ?? this.createStoredLayerMaskClip(target))
        : undefined

    this.mutate('clip', () => {
      if (target.editorLayerMask) {
        frame.set('clipPath', undefined)
      }
      target.set('clipPath', layerMaskClip)
      target.set('dirty', true)
      frame.set({ absolutePositioned: false })
      this.normalizeEditorObject(frame)
      this.canvas.add(frame)
      this.canvas.setActiveObject(frame)
    })
    return this.requireEditorId(editorFrame)
  }

  /** Applies the current 8-bit document selection as a layer mask. */
  public applySelectionAsLayerMask(id?: string): boolean {
    this.assertUsable()
    const target = id
      ? this.findLayer(id)
      : this.canvas.getActiveObjects().length === 1
        ? this.normalizeEditorObject(this.canvas.getActiveObjects()[0])
        : undefined
    const bounds = this.selectionMask?.getNonEmptyBounds()
    if (!target || !this.selectionMask || !bounds) return false
    const encoded = encodeSelectionMaskForProject(this.selectionMask)
    const clipPath = createSelectionMaskClip(this.selectionMask, bounds)

    this.mutate('layer-mask', () => {
      target.editorLayerMask = encoded
      target.editorLayerMaskEnabled = true
      target.editorLayerMaskSettings = {
        inverted: false,
        opacity: 1,
        offsetX: 0,
        offsetY: 0,
      }
      this.setLayerMaskClip(target, clipPath)
    })
    return true
  }

  public setLayerMaskEnabled(id: string, enabled: boolean): boolean {
    this.assertUsable()
    const target = this.findLayer(id)
    if (!target?.editorLayerMask) return false
    const mask = decodeSelectionMaskFromProject(target.editorLayerMask)
    const bounds = mask.getNonEmptyBounds()
    if (enabled && !bounds) return false

    this.mutate('layer-mask', () => {
      target.editorLayerMaskEnabled = enabled
      this.setLayerMaskClip(
        target,
        enabled && bounds ? createSelectionMaskClip(mask, bounds) : undefined,
      )
    })
    return true
  }

  public removeLayerMask(id?: string): boolean {
    this.assertUsable()
    const target = id
      ? this.findLayer(id)
      : this.canvas.getActiveObjects().length === 1
        ? this.normalizeEditorObject(this.canvas.getActiveObjects()[0])
        : undefined
    if (!target?.editorLayerMask) return false
    this.mutate('layer-mask', () => {
      target.editorLayerMask = undefined
      target.editorLayerMaskEnabled = undefined
      target.editorLayerMaskSettings = undefined
      this.setLayerMaskClip(target, undefined)
    })
    return true
  }

  /**
   * Bakes an enabled layer mask into the selected layer's pixels. The result
   * occupies the same document coordinates and retains the layer id, stacking
   * order, visibility, opacity, blend mode, and any independently editable
   * clipping frame.
   */
  public async rasterizeLayerMask(id?: string): Promise<boolean> {
    await this.waitForAdjustmentLayers()
    const target = id
      ? this.findLayer(id)
      : this.canvas.getActiveObjects().length === 1
        ? this.normalizeEditorObject(this.canvas.getActiveObjects()[0])
        : undefined
    if (!target?.editorLayerMask || target.editorLayerMaskEnabled === false) {
      return false
    }
    const objects = this.canvas.getObjects()
    const index = objects.indexOf(target)
    if (index < 0) return false

    const frame = this.embeddedClipFrame(target)
    const maskClip = frame?.clipPath ?? target.clipPath
    if (!maskClip) return false
    const visibility = objects.map((object) => object.visible)
    const backgroundColor = this.canvas.backgroundColor
    const backgroundImage = this.canvas.backgroundImage
    const overlayColor = this.canvas.overlayColor
    const overlayImage = this.canvas.overlayImage
    const originalVisible = target.visible
    const originalOpacity = target.opacity
    const originalBlend = target.globalCompositeOperation
    let raster: HTMLCanvasElement

    try {
      this.withSuppressedEvents(() => {
        objects.forEach((object) => object.set('visible', object === target))
        target.set({
          visible: true,
          opacity: 1,
          globalCompositeOperation: 'source-over',
          clipPath: maskClip,
          dirty: true,
        })
        if (frame) frame.set('clipPath', undefined)
        this.canvas.backgroundColor = 'transparent'
        this.canvas.backgroundImage = undefined
        this.canvas.overlayColor = 'transparent'
        this.canvas.overlayImage = undefined
      })
      raster = this.createDocumentCanvas()
    } finally {
      this.withSuppressedEvents(() => {
        objects.forEach((object, objectIndex) =>
          object.set('visible', visibility[objectIndex]),
        )
        target.set({
          visible: originalVisible,
          opacity: originalOpacity,
          globalCompositeOperation: originalBlend,
          clipPath: frame ?? maskClip,
          dirty: true,
        })
        if (frame) frame.set('clipPath', maskClip)
        this.canvas.backgroundColor = backgroundColor
        this.canvas.backgroundImage = backgroundImage
        this.canvas.overlayColor = overlayColor
        this.canvas.overlayImage = overlayImage
        this.canvas.requestRenderAll()
      })
    }

    const rasterized = new FabricImage(raster, {
      ...TOP_LEFT_ORIGIN,
      left: 0,
      top: 0,
      width: this.documentWidth,
      height: this.documentHeight,
      visible: originalVisible,
      opacity: originalOpacity,
      globalCompositeOperation: originalBlend,
    }) as FabricImage & EditorObject
    rasterized.editorId = this.requireEditorId(target)
    rasterized.editorName = this.requireEditorName(target)
    rasterized.editorLocked = Boolean(target.editorLocked)
    rasterized.editorTemplateId = target.editorTemplateId
    if (frame) {
      frame.set('clipPath', undefined)
      rasterized.editorClipFrameId = target.editorClipFrameId
      rasterized.editorClipSettings = target.editorClipSettings
        ? structuredClone(target.editorClipSettings)
        : undefined
      rasterized.set('clipPath', frame)
    }
    this.initializeEditorObject(rasterized, rasterized.editorName)
    rasterized.setCoords()

    this.mutate('layer-mask', () => {
      this.canvas.discardActiveObject()
      target.set('clipPath', undefined)
      this.canvas.remove(target)
      this.canvas.insertAt(index, rasterized)
      this.canvas.setActiveObject(rasterized)
    })
    return true
  }

  public getLayerTree(): LayerTreeInfo[] {
    const selectedIds = new Set(this.getSelectedLayerIds())
    const result: LayerTreeInfo[] = []
    const visit = (
      objects: readonly FabricObject[],
      depth: number,
      parentId?: string,
    ): void => {
      ;[...objects].reverse().forEach((object) => {
        const editorObject = this.normalizeEditorObject(object)
        if (editorObject.editorKind === 'grid-cell-image') return
        const id = this.requireEditorId(editorObject)
        const children = object instanceof Group ? object.getObjects() : []
        result.push({
          id,
          name: this.requireEditorName(editorObject),
          type: this.layerType(editorObject),
          visible: editorObject.visible,
          locked: Boolean(editorObject.editorLocked),
          opacity: editorObject.opacity,
          blend: editorObject.globalCompositeOperation,
          selected: selectedIds.has(id),
          ...(parentId ? { parentId } : {}),
          depth,
          hasChildren: children.length > 0,
          clipped: Boolean(editorObject.editorClipFrameId),
          masked: Boolean(editorObject.editorLayerMask),
        })
        if (children.length > 0) visit(children, depth + 1, id)
      })
    }
    visit(this.canvas.getObjects(), 0)
    return result
  }

  /** Applies renderer-neutral timeline output to a disposable preview canvas. */
  public applyEvaluatedAnimationState(
    states: readonly EvaluatedElementState[],
  ): void {
    this.assertUsable()
    this.withSuppressedEvents(() => {
      states.forEach((state) => {
        const object = this.findLayer(state.elementId)
        if (!object) return
        object.set({
          visible: state.visible,
          opacity: clamp(object.opacity * state.opacity, 0, 1),
          left: object.left + state.translateX,
          top: object.top + state.translateY,
          scaleX: object.scaleX * state.scaleX,
          scaleY: object.scaleY * state.scaleY,
        })
        object.setCoords()
        object.set('dirty', true)
        if (state.clipProgress < 1) {
          const bounds = object.getBoundingRect()
          const width = bounds.width * clamp(state.clipProgress, 0, 1)
          const left =
            state.clipDirection === 'left'
              ? bounds.left + bounds.width - width
              : bounds.left
          this.appendClipIntersection(
            object,
            new Rect({
              ...TOP_LEFT_ORIGIN,
              left,
              top: bounds.top,
              width,
              height: bounds.height,
              absolutePositioned: true,
              selectable: false,
              evented: false,
            }),
          )
        }
      })
      this.canvas.requestRenderAll()
    })
  }

  public getLayers(): LayerInfo[] {
    const selectedIds = new Set(this.getSelectedLayerIds())
    return [...this.canvas.getObjects()]
      .filter(
        (object) => (object as EditorObject).editorKind !== 'grid-cell-image',
      )
      .reverse()
      .map((object) => {
        const editorObject = this.normalizeEditorObject(object)
        return {
          id: this.requireEditorId(editorObject),
          name: this.requireEditorName(editorObject),
          type: this.layerType(editorObject),
          visible: editorObject.visible,
          locked: Boolean(editorObject.editorLocked),
          opacity: editorObject.opacity,
          blend: editorObject.globalCompositeOperation,
          selected: selectedIds.has(this.requireEditorId(editorObject)),
        }
      })
  }

  public getSelectedLayerIds(): string[] {
    return this.canvas
      .getActiveObjects()
      .map((object) => this.requireEditorId(this.normalizeEditorObject(object)))
  }

  public selectLayer(id: string, additive = false): boolean {
    this.assertUsable()
    const target = this.findLayer(id)
    if (!target || target.editorLocked || !target.visible) {
      return false
    }

    this.withSuppressedEvents(() => {
      if (!additive) {
        this.canvas.discardActiveObject()
        this.canvas.setActiveObject(target)
        return
      }

      const current = this.canvas
        .getActiveObjects()
        .filter((object) => object !== target)
      current.push(target)
      this.canvas.discardActiveObject()
      this.activateObjects(current)
    })
    this.canvas.requestRenderAll()
    this.emitSelection()
    this.emitLayers()
    return true
  }

  public renameLayer(id: string, name: string): boolean {
    const target = this.findLayer(id)
    const repaired = repairRendererLayerName(name, '')
    if (!target || !repaired) {
      return false
    }
    this.mutate('layer', () => {
      target.editorName = repaired.slice(0, MAX_LAYER_NAME_LENGTH)
    })
    return true
  }

  public setLayerVisible(id: string, visible: boolean): boolean {
    const target = this.findLayer(id)
    if (!target) {
      return false
    }
    const ownedGridContents = this.gridContentsOwnedBy([target])
    const ownedGridContentSet = new Set<FabricObject>(ownedGridContents)
    this.mutate('layer', () => {
      target.set('visible', visible)
      ownedGridContents.forEach((image) => image.set('visible', visible))
      if (
        !visible &&
        this.canvas
          .getActiveObjects()
          .some(
            (object) => object === target || ownedGridContentSet.has(object),
          )
      ) {
        this.canvas.discardActiveObject()
      }
    })
    return true
  }

  public setLayerLocked(id: string, locked: boolean): boolean {
    const target = this.findLayer(id)
    if (!target) {
      return false
    }
    const ownedGridContents = this.gridContentsOwnedBy([target])
    const ownedGridContentSet = new Set<FabricObject>(ownedGridContents)
    this.mutate('layer', () => {
      target.editorLocked = locked
      this.configureSingleObjectInteractivity(target)
      ownedGridContents.forEach((image) => {
        image.editorLocked = locked
        this.configureSingleObjectInteractivity(image)
      })
      if (
        locked &&
        this.canvas
          .getActiveObjects()
          .some(
            (object) => object === target || ownedGridContentSet.has(object),
          )
      ) {
        this.canvas.discardActiveObject()
      }
    })
    return true
  }

  public setLayerOpacity(id: string, opacity: number): boolean {
    const target = this.findLayer(id)
    if (!target || !Number.isFinite(opacity)) {
      return false
    }
    const ownedGridContents = this.gridContentsOwnedBy([target])
    this.mutate('layer-opacity', () => {
      const normalized = clamp(opacity, 0, 1)
      target.set('opacity', normalized)
      ownedGridContents.forEach((image) => image.set('opacity', normalized))
    })
    return true
  }

  public setLayerBlend(id: string, blend: GlobalCompositeOperation): boolean {
    const target = this.findLayer(id)
    if (!target) {
      return false
    }
    const ownedGridContents = this.gridContentsOwnedBy([target])
    this.mutate('layer', () => {
      target.set('globalCompositeOperation', blend)
      ownedGridContents.forEach((image) =>
        image.set('globalCompositeOperation', blend),
      )
    })
    return true
  }

  /**
   * Moves a layer to a zero-based index in the order returned by getLayers
   * (index 0 is the visually topmost/front layer).
   */
  public moveLayer(id: string, index: number): boolean {
    const target = this.findLayer(id)
    if (!target || !Number.isFinite(index)) {
      return false
    }
    const owner = this.persistentObjectOwner(target)
    if (owner) {
      const siblings = owner.getObjects()
      if (siblings.length < 2) return false
      const uiIndex = clamp(Math.round(index), 0, siblings.length - 1)
      const ownerIndex = siblings.length - 1 - uiIndex
      if (siblings.indexOf(target) === ownerIndex) return false
      this.mutate('layer', () => {
        owner.moveObjectTo(target, ownerIndex)
        owner.triggerLayout()
        owner.setCoords()
      })
      return true
    }

    const units = this.topLevelStackUnits()
    const sourceIndex = units.findIndex((unit) => unit.includes(target))
    if (sourceIndex < 0 || units.length < 2) return false
    const uiIndex = clamp(Math.round(index), 0, units.length - 1)
    const targetIndex = units.length - 1 - uiIndex
    if (sourceIndex === targetIndex) return false
    this.mutate('layer', () => {
      const [unit] = units.splice(sourceIndex, 1)
      units.splice(targetIndex, 0, unit)
      this.applyTopLevelStackUnits(units)
    })
    return true
  }

  public moveLayerForward(id: string): boolean {
    return this.moveLayerInStack(id, 'forward')
  }

  public moveLayerBackward(id: string): boolean {
    return this.moveLayerInStack(id, 'backward')
  }

  public moveLayerToFront(id: string): boolean {
    return this.moveLayerInStack(id, 'front')
  }

  public moveLayerToBack(id: string): boolean {
    return this.moveLayerInStack(id, 'back')
  }

  public getSelectionTransform(): SelectionTransform | null {
    const selected = this.canvas.getActiveObjects()
    if (selected.length !== 1) {
      return null
    }
    const object = this.normalizeEditorObject(selected[0])
    return {
      id: this.requireEditorId(object),
      left: object.left,
      top: object.top,
      width: object.getScaledWidth(),
      height: object.getScaledHeight(),
      angle: object.angle,
      flipX: object.flipX,
      flipY: object.flipY,
    }
  }

  public updateSelectionTransform(update: SelectionTransformUpdate): boolean {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length !== 1) {
      return false
    }
    const object = selected[0]
    if ((object as EditorObject).editorLocked) {
      return false
    }

    this.mutate('object-modified', () => {
      if (typeof update.left === 'number' && Number.isFinite(update.left)) {
        object.set('left', update.left)
      }
      if (typeof update.top === 'number' && Number.isFinite(update.top)) {
        object.set('top', update.top)
      }
      if (typeof update.angle === 'number' && Number.isFinite(update.angle)) {
        object.set('angle', update.angle)
      }
      if (typeof update.flipX === 'boolean') {
        object.set('flipX', update.flipX)
      }
      if (typeof update.flipY === 'boolean') {
        object.set('flipY', update.flipY)
      }
      if (
        typeof update.width === 'number' &&
        Number.isFinite(update.width) &&
        update.width > 0
      ) {
        const currentWidth = Math.max(object.getScaledWidth(), EPSILON)
        object.set('scaleX', object.scaleX * (update.width / currentWidth))
      }
      if (
        typeof update.height === 'number' &&
        Number.isFinite(update.height) &&
        update.height > 0
      ) {
        const currentHeight = Math.max(object.getScaledHeight(), EPSILON)
        object.set('scaleY', object.scaleY * (update.height / currentHeight))
      }
      object.setCoords()
    })
    return true
  }

  public alignSelection(
    mode: AlignmentMode,
    reference: 'selection' | 'canvas' = 'selection',
  ): boolean {
    this.assertUsable()
    const selected = this.canvas
      .getActiveObjects()
      .filter((object) => !(object as EditorObject).editorLocked)
    const minimum = mode.startsWith('distribute') ? 3 : 1
    if (selected.length < minimum) {
      this.emitStatus(
        mode.startsWith('distribute')
          ? '分布するオブジェクトを3つ以上選択してください。'
          : '整列するオブジェクトを選択してください。',
        'warning',
      )
      return false
    }

    const bounds = new Map(
      selected.map((object) => [object, object.getBoundingRect()] as const),
    )
    const selectedBounds = [...bounds.values()]
    const union = {
      left: Math.min(...selectedBounds.map((bound) => bound.left)),
      top: Math.min(...selectedBounds.map((bound) => bound.top)),
      right: Math.max(
        ...selectedBounds.map((bound) => bound.left + bound.width),
      ),
      bottom: Math.max(
        ...selectedBounds.map((bound) => bound.top + bound.height),
      ),
    }
    const frame =
      reference === 'canvas' || selected.length === 1
        ? {
            left: 0,
            top: 0,
            right: this.documentWidth,
            bottom: this.documentHeight,
          }
        : union

    const translate = (object: FabricObject, dx: number, dy: number) => {
      object.set({
        left: object.left + dx,
        top: object.top + dy,
      })
      object.setCoords()
    }

    this.mutate('alignment', () => {
      if (mode === 'distribute-x') {
        const ordered = [...selected].sort(
          (left, right) => bounds.get(left)!.left - bounds.get(right)!.left,
        )
        const totalWidth = ordered.reduce(
          (sum, object) => sum + bounds.get(object)!.width,
          0,
        )
        const gap =
          (frame.right - frame.left - totalWidth) / (ordered.length - 1)
        let cursor = frame.left
        ordered.forEach((object) => {
          const bound = bounds.get(object)!
          translate(object, cursor - bound.left, 0)
          cursor += bound.width + gap
        })
        return
      }
      if (mode === 'distribute-y') {
        const ordered = [...selected].sort(
          (left, right) => bounds.get(left)!.top - bounds.get(right)!.top,
        )
        const totalHeight = ordered.reduce(
          (sum, object) => sum + bounds.get(object)!.height,
          0,
        )
        const gap =
          (frame.bottom - frame.top - totalHeight) / (ordered.length - 1)
        let cursor = frame.top
        ordered.forEach((object) => {
          const bound = bounds.get(object)!
          translate(object, 0, cursor - bound.top)
          cursor += bound.height + gap
        })
        return
      }

      selected.forEach((object) => {
        const bound = bounds.get(object)!
        if (mode === 'left') {
          translate(object, frame.left - bound.left, 0)
        } else if (mode === 'center-x') {
          translate(
            object,
            (frame.left + frame.right - bound.width) / 2 - bound.left,
            0,
          )
        } else if (mode === 'right') {
          translate(object, frame.right - bound.width - bound.left, 0)
        } else if (mode === 'top') {
          translate(object, 0, frame.top - bound.top)
        } else if (mode === 'center-y') {
          translate(
            object,
            0,
            (frame.top + frame.bottom - bound.height) / 2 - bound.top,
          )
        } else if (mode === 'bottom') {
          translate(object, 0, frame.bottom - bound.height - bound.top)
        }
      })
    })
    return true
  }

  public getEditorState(): ProjectEditorState {
    this.assertUsable()
    return normalizeEditorState(
      this.editorState,
      this.documentWidth,
      this.documentHeight,
    )
  }

  public addGuide(axis: ProjectGuide['axis'], position: number): boolean {
    this.assertUsable()
    if (!Number.isFinite(position) || this.editorState.guides.length >= 200) {
      return false
    }
    const limit = axis === 'x' ? this.documentWidth : this.documentHeight
    const safePosition = clamp(position, 0, limit)
    if (
      this.editorState.guides.some(
        (guide) =>
          guide.axis === axis &&
          Math.abs(guide.position - safePosition) < EPSILON,
      )
    ) {
      return false
    }
    this.mutate('guide', () => {
      this.editorState = {
        ...this.editorState,
        guides: [...this.editorState.guides, { axis, position: safePosition }],
      }
    })
    return true
  }

  public addGuideFromPointer(
    axis: ProjectGuide['axis'],
    event: MouseEvent,
  ): boolean {
    this.assertUsable()
    const point = this.canvas.getScenePoint(event)
    return this.addGuide(axis, axis === 'x' ? point.x : point.y)
  }

  public removeGuide(
    axis: ProjectGuide['axis'],
    position: number,
    tolerance = 2,
  ): boolean {
    this.assertUsable()
    const index = this.editorState.guides.findIndex(
      (guide) =>
        guide.axis === axis &&
        Math.abs(guide.position - position) <= Math.max(0, tolerance),
    )
    if (index < 0) {
      return false
    }
    this.mutate('guide', () => {
      this.editorState = {
        ...this.editorState,
        guides: this.editorState.guides.filter(
          (_guide, guideIndex) => guideIndex !== index,
        ),
      }
    })
    return true
  }

  public clearGuides(): boolean {
    this.assertUsable()
    if (this.editorState.guides.length === 0) {
      return false
    }
    this.mutate('guide', () => {
      this.editorState = {
        ...this.editorState,
        guides: [],
      }
    })
    return true
  }

  public setSnapTolerance(tolerance: number): number {
    this.assertUsable()
    const value = clamp(finiteOr(tolerance, DEFAULT_SNAP_TOLERANCE), 1, 100)
    if (Math.abs(value - this.editorState.snapTolerance) < EPSILON) {
      return value
    }
    this.mutate('guide', () => {
      this.editorState = {
        ...this.editorState,
        snapTolerance: value,
      }
    })
    return value
  }

  public setSelectionMask(mask: EncodedSelectionMask | undefined): boolean {
    this.assertUsable()
    if (
      mask &&
      (mask.width !== this.documentWidth ||
        mask.height !== this.documentHeight ||
        mask.encoding !== 'rle-base64' ||
        !mask.data)
    ) {
      return false
    }
    let decoded: SelectionMask | undefined
    try {
      decoded = mask ? decodeSelectionMaskFromProject(mask) : undefined
    } catch {
      return false
    }
    this.mutate('selection-mask', () => {
      this.editorState = {
        ...this.editorState,
        ...(mask
          ? { selectionMask: copySelectionMask(mask) }
          : { selectionMask: undefined }),
      }
      this.selectionMask = decoded
      this.selectionBounds = decoded?.getNonEmptyBounds() ?? null
      this.selectionOverlay = undefined
      this.syncSelectionOverlayAnimation()
    })
    return true
  }

  public setPixelSelectionMask(mask: SelectionMask | undefined): boolean {
    this.assertUsable()
    if (
      mask &&
      (mask.width !== this.documentWidth || mask.height !== this.documentHeight)
    ) {
      return false
    }
    return this.setSelectionMask(
      mask ? encodeSelectionMaskForProject(mask) : undefined,
    )
  }

  public getPixelSelectionMask(): SelectionMask | undefined {
    this.assertUsable()
    return this.selectionMask
  }

  public getZoom(): number {
    return this.canvas.getZoom()
  }

  public setZoom(zoom: number): number {
    this.assertUsable()
    const nextZoom = clamp(finiteOr(zoom, 1), MIN_ZOOM, MAX_ZOOM)
    const center = new Point(
      this.canvas.getWidth() / 2,
      this.canvas.getHeight() / 2,
    )
    this.canvas.zoomToPoint(center, nextZoom)
    this.canvas.requestRenderAll()
    this.emitZoom()
    return nextZoom
  }

  public zoomAtPoint(x: number, y: number, zoom: number): number {
    this.assertUsable()
    const nextZoom = clamp(finiteOr(zoom, 1), MIN_ZOOM, MAX_ZOOM)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this.getZoom()
    this.canvas.zoomToPoint(new Point(x, y), nextZoom)
    this.canvas.requestRenderAll()
    this.emitZoom()
    return nextZoom
  }

  public zoomIn(factor = 1.2): number {
    const safeFactor = Math.max(1.01, finiteOr(factor, 1.2))
    return this.setZoom(this.getZoom() * safeFactor)
  }

  public zoomOut(factor = 1.2): number {
    const safeFactor = Math.max(1.01, finiteOr(factor, 1.2))
    return this.setZoom(this.getZoom() / safeFactor)
  }

  public zoom100(): number {
    return this.setZoom(1)
  }

  /**
   * Fits document pixels into a host-provided viewport. The Fabric surface and
   * its CSS box become the viewport size; document pixels remain independent.
   */
  public fitToViewport(
    viewportWidth: number,
    viewportHeight: number,
    padding = 32,
  ): number {
    this.assertUsable()
    const safeViewportWidth = Math.max(
      1,
      Math.round(finiteOr(viewportWidth, this.canvas.getWidth())),
    )
    const safeViewportHeight = Math.max(
      1,
      Math.round(finiteOr(viewportHeight, this.canvas.getHeight())),
    )
    const safePadding = Math.max(0, finiteOr(padding, 32))
    const availableWidth = Math.max(1, safeViewportWidth - safePadding * 2)
    const availableHeight = Math.max(1, safeViewportHeight - safePadding * 2)
    const zoom = clamp(
      Math.min(
        availableWidth / this.documentWidth,
        availableHeight / this.documentHeight,
      ),
      MIN_FIT_ZOOM,
      MAX_ZOOM,
    )
    const offsetX = (safeViewportWidth - this.documentWidth * zoom) / 2
    const offsetY = (safeViewportHeight - this.documentHeight * zoom) / 2
    this.canvas.setDimensions({
      width: safeViewportWidth,
      height: safeViewportHeight,
    })
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, offsetX, offsetY])
    this.canvas.requestRenderAll()
    this.emitZoom()
    return zoom
  }

  public panBy(deltaX: number, deltaY: number): void {
    this.assertUsable()
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return
    }
    const transform = [...this.canvas.viewportTransform] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    transform[4] += deltaX
    transform[5] += deltaY
    this.canvas.setViewportTransform(transform)
    this.canvas.requestRenderAll()
  }

  public resetViewport(): void {
    this.assertUsable()
    this.canvas.setViewportTransform([...iMatrix])
    this.canvas.requestRenderAll()
    this.emitZoom()
  }

  public getDocumentSize(): { width: number; height: number } {
    return {
      width: this.documentWidth,
      height: this.documentHeight,
    }
  }

  /** Maps a DOM drop into bounded document coordinates and an optional grid cell. */
  public getCanvasDropTarget(event: MouseEvent): CanvasDropTarget | undefined {
    this.assertUsable()
    const scenePoint = this.canvas.getScenePoint(event)
    if (
      !Number.isFinite(scenePoint.x) ||
      !Number.isFinite(scenePoint.y) ||
      scenePoint.x < 0 ||
      scenePoint.y < 0 ||
      scenePoint.x > this.documentWidth ||
      scenePoint.y > this.documentHeight
    ) {
      return undefined
    }
    const point = { x: scenePoint.x, y: scenePoint.y }
    const cell = this.findGridCellAtPoint(scenePoint)
    const frame = cell ? undefined : this.findDropFrameAtPoint(scenePoint)
    return {
      point,
      ...(cell ? { gridCellId: this.requireEditorId(cell) } : {}),
      ...(frame ? { frameLayerId: this.requireEditorId(frame) } : {}),
    }
  }

  public getViewportSize(): { width: number; height: number } {
    return {
      width: this.canvas.getWidth(),
      height: this.canvas.getHeight(),
    }
  }

  /**
   * Starts an empty document while preserving the current viewport transform.
   * Supplying dimensions changes only the logical document pixel size.
   */
  public clear(width?: number, height?: number): void {
    this.assertUsable()
    const nextWidth = documentDimension(finiteOr(width, this.documentWidth))
    const nextHeight = documentDimension(finiteOr(height, this.documentHeight))
    this.mutate('clear', () => {
      const objects = this.canvas.getObjects()
      this.canvas.discardActiveObject()
      if (objects.length > 0) {
        this.canvas.remove(...objects)
      }
      this.documentWidth = nextWidth
      this.documentHeight = nextHeight
      this.editorState = normalizeEditorState(undefined, nextWidth, nextHeight)
      this.selectionMask = undefined
      this.selectionBounds = null
      this.selectionOverlay = undefined
      this.stopSelectionOverlayAnimation()
      this.setDocumentClip()
      this.pasteGeneration = 0
    })
  }

  /**
   * Changes logical document pixels without resizing the display viewport.
   */
  public setCanvasSize(width: number, height: number): void {
    this.assertUsable()
    const safeWidth = documentDimension(width)
    const safeHeight = documentDimension(height)
    if (
      safeWidth === this.documentWidth &&
      safeHeight === this.documentHeight
    ) {
      return
    }

    this.mutate('canvas-size', () => {
      this.documentWidth = safeWidth
      this.documentHeight = safeHeight
      this.editorState = normalizeEditorState(
        this.editorState,
        safeWidth,
        safeHeight,
      )
      this.syncSelectionMask()
      this.setDocumentClip()
    })
  }

  public setSolidBackground(color: string): void {
    this.assertUsable()
    this.mutate('background', () => {
      this.canvas.backgroundColor = color
    })
  }

  public setGradientBackground(start: string, end: string, angle = 45): void {
    this.assertUsable()
    const radians = (angle * Math.PI) / 180
    const centerX = this.documentWidth / 2
    const centerY = this.documentHeight / 2
    const radius = Math.hypot(this.documentWidth, this.documentHeight) / 2
    const deltaX = Math.cos(radians) * radius
    const deltaY = Math.sin(radians) * radius
    this.mutate('background', () => {
      this.canvas.backgroundColor = new Gradient({
        type: 'linear',
        gradientUnits: 'pixels',
        coords: {
          x1: centerX - deltaX,
          y1: centerY - deltaY,
          x2: centerX + deltaX,
          y2: centerY + deltaY,
        },
        colorStops: [
          { offset: 0, color: start },
          { offset: 1, color: end },
        ],
      })
    })
  }

  public clearBackground(): void {
    this.setSolidBackground('transparent')
  }

  /** Resizes the document and reflows all top-level objects as one undo step. */
  public magicResize(
    width: number,
    height: number,
    anchor: ResizeAnchor = 'center',
    mode: MagicResizeMode = 'fit',
  ): void {
    this.assertUsable()
    const nextWidth = documentDimension(width)
    const nextHeight = documentDimension(height)
    const previousWidth = this.documentWidth
    const previousHeight = this.documentHeight
    if (nextWidth === previousWidth && nextHeight === previousHeight) return

    const scaleX = nextWidth / previousWidth
    const scaleY = nextHeight / previousHeight
    const uniformScale =
      mode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY)
    const appliedScaleX = mode === 'stretch' ? scaleX : uniformScale
    const appliedScaleY = mode === 'stretch' ? scaleY : uniformScale
    const contentWidth = previousWidth * appliedScaleX
    const contentHeight = previousHeight * appliedScaleY
    const horizontal =
      anchor.endsWith('left') || anchor === 'left'
        ? 0
        : anchor.endsWith('right') || anchor === 'right'
          ? 1
          : 0.5
    const vertical =
      anchor.startsWith('top') || anchor === 'top'
        ? 0
        : anchor.startsWith('bottom') || anchor === 'bottom'
          ? 1
          : 0.5
    const offsetX = (nextWidth - contentWidth) * horizontal
    const offsetY = (nextHeight - contentHeight) * vertical

    this.mutate('magic-resize', () => {
      this.canvas.getObjects().forEach((object) => {
        object.set({
          left: object.left * appliedScaleX + offsetX,
          top: object.top * appliedScaleY + offsetY,
          scaleX: object.scaleX * appliedScaleX,
          scaleY: object.scaleY * appliedScaleY,
        })
        object.setCoords()
      })
      const transform: DocumentSpaceTransform = {
        scaleX: appliedScaleX,
        scaleY: appliedScaleY,
        offsetX,
        offsetY,
        width: nextWidth,
        height: nextHeight,
      }
      this.transformAbsoluteClipPaths(transform)
      this.transformStoredLayerMasks((mask) =>
        transformDocumentMask(mask, transform),
      )
      const transformedSelection = this.selectionMask
        ? transformDocumentMask(this.selectionMask, transform)
        : undefined
      this.documentWidth = nextWidth
      this.documentHeight = nextHeight
      this.editorState = normalizeEditorState(
        this.editorState,
        nextWidth,
        nextHeight,
      )
      if (transformedSelection) {
        this.editorState = {
          ...this.editorState,
          selectionMask: encodeSelectionMaskForProject(transformedSelection),
        }
      }
      this.syncSelectionMask()
      this.setDocumentClip()
    })
  }

  public cropToSelection(): { width: number; height: number } | null {
    this.assertUsable()
    const activeObject = this.canvas.getActiveObject()
    if (!activeObject) {
      this.emitStatus('切り抜く範囲を選択してください。', 'warning')
      return null
    }

    const bounds = activeObject.getBoundingRect()
    const left = clamp(Math.floor(bounds.left), 0, this.documentWidth - 1)
    const top = clamp(Math.floor(bounds.top), 0, this.documentHeight - 1)
    const right = clamp(
      Math.ceil(bounds.left + bounds.width),
      left + 1,
      this.documentWidth,
    )
    const bottom = clamp(
      Math.ceil(bounds.top + bounds.height),
      top + 1,
      this.documentHeight,
    )
    const width = documentDimension(right - left)
    const height = documentDimension(bottom - top)

    this.mutate('crop', () => {
      this.canvas.discardActiveObject()
      this.canvas.getObjects().forEach((object) => {
        object.set({
          left: object.left - left,
          top: object.top - top,
        })
        object.setCoords()
      })
      const transform: DocumentSpaceTransform = {
        scaleX: 1,
        scaleY: 1,
        offsetX: -left,
        offsetY: -top,
        width,
        height,
      }
      this.transformAbsoluteClipPaths(transform)
      this.transformStoredLayerMasks((mask) =>
        transformDocumentMask(mask, transform),
      )
      const transformedSelection = this.selectionMask
        ? transformDocumentMask(this.selectionMask, transform)
        : undefined
      this.documentWidth = width
      this.documentHeight = height
      this.editorState = {
        guides: this.editorState.guides
          .map((guide) => ({
            ...guide,
            position:
              guide.axis === 'x' ? guide.position - left : guide.position - top,
          }))
          .filter(
            (guide) =>
              guide.position >= 0 &&
              guide.position <=
                (guide.axis === 'x' ? this.documentWidth : this.documentHeight),
          ),
        snapTolerance: this.editorState.snapTolerance,
        ...(transformedSelection
          ? {
              selectionMask:
                encodeSelectionMaskForProject(transformedSelection),
            }
          : {}),
      }
      this.syncSelectionMask()
      this.setDocumentClip()
      this.canvas.setViewportTransform([...iMatrix])
    })
    this.emitZoom()
    return { width, height }
  }

  public applyImageFilters(settings: ImageFilterSettings): boolean {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length !== 1 || !(selected[0] instanceof FabricImage)) {
      this.emitStatus(
        'フィルターを適用する画像レイヤーを1つ選択してください。',
        'warning',
      )
      return false
    }

    const image = selected[0]
    const normalized = normalizeFilterSettings(settings)
    const nextFilters = createImageFilters(normalized)
    const isAdjustment = (image as EditorObject).editorKind === 'adjustment'

    this.mutate(isAdjustment ? 'adjustment-layer' : 'filter', () => {
      image.filters = nextFilters
      ;(image as EditorObject).editorFilterSettings = {
        ...normalized,
      }
      delete (image as EditorObject).editorFilterOperations
      if (!isAdjustment) {
        image.applyFilters()
      }
      image.set('dirty', true)
    })
    return true
  }

  /**
   * Reads editable filter parameters from the single selected image.
   * Returns null for non-image or multi-selection states.
   */
  public getSelectedImageFilters(): Required<ImageFilterSettings> | null {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length !== 1 || !(selected[0] instanceof FabricImage)) {
      return null
    }

    const stored = (selected[0] as EditorObject).editorFilterSettings
    if (stored) {
      return normalizeFilterSettings(stored as ImageFilterSettings)
    }

    const settings: Required<ImageFilterSettings> = {
      ...DEFAULT_IMAGE_FILTER_SETTINGS,
    }

    selected[0].filters.forEach((filter) => {
      if (filter instanceof filters.Brightness) {
        settings.brightness = filter.brightness
      } else if (filter instanceof filters.Contrast) {
        settings.contrast = filter.contrast
      } else if (filter instanceof filters.Saturation) {
        settings.saturation = filter.saturation
      } else if (filter instanceof filters.HueRotation) {
        settings.hue = filter.rotation
      } else if (filter instanceof filters.Blur) {
        settings.blur = filter.blur
      } else if (filter instanceof filters.Grayscale) {
        settings.grayscale = true
      } else if (
        filter instanceof DeterministicNoiseFilter ||
        filter instanceof filters.Noise
      ) {
        settings.noise = clamp(filter.noise / 500, 0, 1)
      } else if (filter instanceof filters.Pixelate) {
        settings.pixelate = filter.blocksize
      } else if (filter instanceof filters.Sepia) {
        settings.sepia = 1
      } else if (filter instanceof filters.Invert) {
        settings.invert = 1
      } else if (filter instanceof filters.Gamma) {
        settings.gamma = filter.gamma[0]
      }
    })

    return settings
  }

  public getAdjustmentLayerFilters(
    id: string,
  ): Required<ImageFilterSettings> | null {
    this.assertUsable()
    const layer = this.findLayer(id)
    if (
      !(layer instanceof FabricImage) ||
      (layer as EditorObject).editorKind !== 'adjustment' ||
      (layer as EditorObject).editorFilterOperations
    ) {
      return null
    }
    const adjustment = layer as FabricImage & EditorObject
    return normalizeFilterSettings(
      (adjustment.editorFilterSettings ?? {}) as ImageFilterSettings,
    )
  }

  public setAdjustmentLayerFilters(
    id: string,
    settings: ImageFilterSettings,
  ): boolean {
    this.assertUsable()
    const layer = this.findLayer(id)
    if (
      !(layer instanceof FabricImage) ||
      (layer as EditorObject).editorKind !== 'adjustment'
    ) {
      return false
    }
    const adjustment = layer as FabricImage & EditorObject
    const normalized = normalizeFilterSettings(settings)
    this.mutate('adjustment-layer', () => {
      adjustment.editorFilterSettings = { ...normalized }
      delete adjustment.editorFilterOperations
      adjustment.filters = createImageFilters(normalized)
      adjustment.set('dirty', true)
    })
    return true
  }

  public async addAdjustmentLayer(
    settings: ImageFilterSettings,
    name = 'Adjustment',
  ): Promise<string> {
    this.assertUsable()
    return this.runAtomic('adjustment-layer', () => {
      const source = document.createElement('canvas')
      source.width = this.documentWidth
      source.height = this.documentHeight
      const normalized = normalizeFilterSettings(settings)
      const adjustment = new FabricImage(source, {
        ...TOP_LEFT_ORIGIN,
        left: 0,
        top: 0,
        width: this.documentWidth,
        height: this.documentHeight,
        scaleX: 1,
        scaleY: 1,
        globalCompositeOperation: 'copy',
      }) as FabricImage & EditorObject
      const id = createEditorId()
      adjustment.editorId = id
      adjustment.editorKind = 'adjustment'
      adjustment.editorName = this.uniqueLayerName(name)
      adjustment.editorFilterSettings = { ...normalized }
      delete adjustment.editorFilterOperations
      adjustment.filters = createImageFilters(normalized)
      this.initializeEditorObject(adjustment, adjustment.editorName)
      adjustment.setCoords()
      this.mutate('adjustment-layer', () => {
        this.canvas.add(adjustment)
        this.canvas.setActiveObject(adjustment)
      })
      return id
    })
  }

  public getAdvancedAdjustmentLayerOperations(
    id: string,
  ): FilterOperation[] | null {
    this.assertUsable()
    const layer = this.findLayer(id)
    if (
      !(layer instanceof FabricImage) ||
      (layer as EditorObject).editorKind !== 'adjustment' ||
      !(layer as EditorObject).editorFilterOperations
    ) {
      return null
    }
    return cloneAdvancedFilterOperations(
      (layer as EditorObject).editorFilterOperations!,
    )
  }

  public async setAdvancedAdjustmentLayerOperations(
    id: string,
    operations: readonly FilterOperation[],
  ): Promise<boolean> {
    this.assertUsable()
    const layer = this.findLayer(id)
    if (
      !(layer instanceof FabricImage) ||
      (layer as EditorObject).editorKind !== 'adjustment'
    ) {
      return false
    }
    const adjustment = layer as FabricImage & EditorObject
    const normalized = await validateAdvancedFilterOperations(operations)
    this.mutate('adjustment-layer', () => {
      delete adjustment.editorFilterSettings
      adjustment.editorFilterOperations =
        cloneAdvancedFilterOperations(normalized)
      adjustment.filters = []
      adjustment.set('dirty', true)
    })
    await this.waitForAdjustmentLayers()
    return true
  }

  public async addAdvancedAdjustmentLayer(
    operations: readonly FilterOperation[],
    name = 'Advanced adjustment',
  ): Promise<string> {
    this.assertUsable()
    if (operations.length === 0) {
      throw new RangeError('詳細フィルターを1つ以上指定してください。')
    }
    const normalized = await validateAdvancedFilterOperations(operations)
    const id = await this.runAtomic('adjustment-layer', () => {
      const source = document.createElement('canvas')
      source.width = this.documentWidth
      source.height = this.documentHeight
      const adjustment = new FabricImage(source, {
        ...TOP_LEFT_ORIGIN,
        left: 0,
        top: 0,
        width: this.documentWidth,
        height: this.documentHeight,
        scaleX: 1,
        scaleY: 1,
        globalCompositeOperation: 'copy',
      }) as FabricImage & EditorObject
      const adjustmentId = createEditorId()
      adjustment.editorId = adjustmentId
      adjustment.editorKind = 'adjustment'
      adjustment.editorName = this.uniqueLayerName(name)
      delete adjustment.editorFilterSettings
      adjustment.editorFilterOperations =
        cloneAdvancedFilterOperations(normalized)
      adjustment.filters = []
      this.initializeEditorObject(adjustment, adjustment.editorName)
      adjustment.setCoords()
      this.mutate('adjustment-layer', () => {
        this.canvas.add(adjustment)
        this.canvas.setActiveObject(adjustment)
      })
      return adjustmentId
    })
    await this.waitForAdjustmentLayers()
    return id
  }

  /** Waits until the newest derived adjustment caches have been rebuilt. */
  public async waitForAdjustmentLayers(): Promise<void> {
    this.assertUsable()
    let pending: Promise<void>
    do {
      pending = this.adjustmentRefreshPromise
      await pending
    } while (pending !== this.adjustmentRefreshPromise)
    this.assertUsable()
  }

  public async rasterizeAdvancedAdjustmentLayer(id: string): Promise<boolean> {
    this.assertUsable()
    const layer = this.findLayer(id)
    if (!layer?.editorFilterOperations) {
      return false
    }
    return this.rasterizeAdjustmentLayer(id)
  }

  public async rasterizeAdjustmentLayer(id: string): Promise<boolean> {
    await this.waitForAdjustmentLayers()
    const layer = this.findLayer(id)
    if (
      !(layer instanceof FabricImage) ||
      (layer as EditorObject).editorKind !== 'adjustment'
    ) {
      return false
    }
    const adjustment = layer as FabricImage & EditorObject
    const source = adjustment.getElement()
    const raster = document.createElement('canvas')
    raster.width = this.documentWidth
    raster.height = this.documentHeight
    const context = raster.getContext('2d')
    if (!context) {
      throw new Error('調整レイヤーのラスタライズに失敗しました。')
    }
    context.drawImage(source, 0, 0, this.documentWidth, this.documentHeight)
    this.mutate('adjustment-layer', () => {
      adjustment.filters = []
      delete adjustment.editorFilterSettings
      delete adjustment.editorFilterOperations
      adjustment.setElement(raster, {
        width: this.documentWidth,
        height: this.documentHeight,
      })
      delete adjustment.editorKind
      adjustment.set({
        ...TOP_LEFT_ORIGIN,
        left: 0,
        top: 0,
        scaleX: 1,
        scaleY: 1,
        globalCompositeOperation: 'source-over',
        dirty: true,
      })
      adjustment.setCoords()
      this.configureSingleObjectInteractivity(adjustment)
    })
    return true
  }

  public snapshot(): EditorSnapshot {
    this.assertUsable()
    const activeObject = this.canvas.getActiveObject()
    const selected = this.canvas.getActiveObjects()
    const needsTemporaryUngroup = activeObject instanceof ActiveSelection
    let json: Record<string, unknown>

    this.withSuppressedEvents(() => {
      if (needsTemporaryUngroup) {
        this.canvas.discardActiveObject()
      }
      try {
        json = this.canvas.toObject([
          ...SERIALIZED_EDITOR_PROPERTIES,
        ]) as Record<string, unknown>
      } finally {
        if (needsTemporaryUngroup) {
          this.activateObjects(selected)
          this.canvas.requestRenderAll()
        }
      }
    })
    return {
      json: json!,
      width: this.documentWidth,
      height: this.documentHeight,
      editorState: normalizeEditorState(
        this.editorState,
        this.documentWidth,
        this.documentHeight,
      ),
    }
  }

  /**
   * Restores are serialized to avoid Fabric's asynchronous enlivening races.
   * No onChanged callback is fired, which prevents undo/redo from recursively
   * creating new history entries.
   */
  public restore(snapshot: EditorSnapshot): Promise<void> {
    this.assertUsable()
    const queued = this.restoreQueue
      .catch(() => undefined)
      .then(async () => {
        assertRestorableEditorSnapshot(snapshot)
        const prepared = await this.prepareRestore(snapshot)
        let applicationStarted = false
        try {
          const rollback = this.snapshot()
          const rollbackSelectedIds = new Set(this.getSelectedLayerIds())
          const rollbackViewportTransform = [
            ...this.canvas.viewportTransform,
          ] as Canvas['viewportTransform']
          try {
            this.applyPreparedRestore(prepared, {
              onApplicationStart: () => {
                applicationStarted = true
              },
            })
            this.refreshAdjustmentLayers()
            await this.waitForAdjustmentLayers()
          } catch (error) {
            if (applicationStarted) {
              try {
                const preparedRollback = await this.prepareRestore(rollback)
                this.applyPreparedRestore(preparedRollback, {
                  selectedEditorIds: rollbackSelectedIds,
                  viewportTransform: rollbackViewportTransform,
                })
                this.refreshAdjustmentLayers()
                await this.waitForAdjustmentLayers()
                this.disposePreparedRestore(prepared)
              } catch {
                // Preserve the original error. The canvas may own part of the
                // incoming restore when rollback also fails, so do not dispose it.
              }
            }
            throw error
          }
        } catch (error) {
          if (!applicationStarted) {
            this.disposePreparedRestore(prepared)
          }
          throw error
        }
      })
    this.restoreQueue = queued
    return queued
  }

  public async exportDataUrl(
    format: ExportImageFormat = 'png',
    quality = 0.92,
    multiplier = 1,
    options: ExportDataUrlOptions = {},
  ): Promise<string> {
    await this.waitForAdjustmentLayers()
    const resolvedMultiplier = options.exactSafeMultiplier
      ? multiplier
      : clamp(finiteOr(multiplier, 1), 0.1, 8)
    if (
      options.exactSafeMultiplier &&
      (!Number.isFinite(resolvedMultiplier) || resolvedMultiplier <= 0)
    ) {
      throw new RangeError('Export multiplier must be positive and finite.')
    }
    if (options.exactSafeMultiplier) {
      assertSafeImageDimensions({
        width: Math.max(1, Math.ceil(this.documentWidth * resolvedMultiplier)),
        height: Math.max(
          1,
          Math.ceil(this.documentHeight * resolvedMultiplier),
        ),
      })
    }
    const previousTransform = [
      ...this.canvas.viewportTransform,
    ] as typeof this.canvas.viewportTransform
    const previousViewportWidth = this.canvas.getWidth()
    const previousViewportHeight = this.canvas.getHeight()
    let dataUrl: string
    try {
      this.isExporting = true
      this.withSuppressedEvents(() => {
        this.canvas.setDimensions(
          {
            width: this.documentWidth,
            height: this.documentHeight,
          },
          { backstoreOnly: true },
        )
        this.canvas.setViewportTransform([...iMatrix])
        this.canvas.requestRenderAll()
      })
      dataUrl = this.canvas.toDataURL({
        format,
        quality: clamp(finiteOr(quality, 0.92), 0, 1),
        multiplier: resolvedMultiplier,
        left: 0,
        top: 0,
        width: this.documentWidth,
        height: this.documentHeight,
        enableRetinaScaling: false,
      })
      this.emitStatus('画像を書き出しました。', 'success')
    } finally {
      this.isExporting = false
      this.withSuppressedEvents(() => {
        this.canvas.setDimensions(
          {
            width: previousViewportWidth,
            height: previousViewportHeight,
          },
          { backstoreOnly: true },
        )
        this.canvas.setViewportTransform(previousTransform)
        this.canvas.requestRenderAll()
      })
    }
    return dataUrl
  }

  public async exportSizedPng(
    width: number,
    height: number,
    fit: 'contain' | 'cover' | 'stretch' = 'contain',
    background = 'transparent',
  ): Promise<string> {
    await this.waitForAdjustmentLayers()
    const outputWidth = documentDimension(width)
    const outputHeight = documentDimension(height)
    assertSafeImageDimensions({ width: outputWidth, height: outputHeight })
    const source = this.createDocumentCanvas()
    const output = document.createElement('canvas')
    output.width = outputWidth
    output.height = outputHeight
    const context = output.getContext('2d')
    if (!context) {
      throw new Error('画像書き出し用Canvasを作成できませんでした。')
    }
    context.clearRect(0, 0, outputWidth, outputHeight)
    if (background !== 'transparent') {
      context.fillStyle = background
      context.fillRect(0, 0, outputWidth, outputHeight)
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    if (fit === 'stretch') {
      context.drawImage(source, 0, 0, outputWidth, outputHeight)
      return output.toDataURL('image/png')
    }
    const scale =
      fit === 'cover'
        ? Math.max(
            outputWidth / this.documentWidth,
            outputHeight / this.documentHeight,
          )
        : Math.min(
            outputWidth / this.documentWidth,
            outputHeight / this.documentHeight,
          )
    const drawWidth = this.documentWidth * scale
    const drawHeight = this.documentHeight * scale
    context.drawImage(
      source,
      (outputWidth - drawWidth) / 2,
      (outputHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
    )
    return output.toDataURL('image/png')
  }

  public async getDocumentImageData(): Promise<ImageData> {
    await this.waitForAdjustmentLayers()
    const source = this.createDocumentCanvas()
    const context = source.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('画像処理用Canvasを作成できませんでした。')
    }
    return context.getImageData(0, 0, this.documentWidth, this.documentHeight)
  }

  /**
   * Applies the renderer-neutral filter registry with its deterministic CPU
   * fallback and adds the result as a new raster layer. The source document is
   * left intact, while the single layer insertion is observed as one Undo
   * operation and serialized through the ordinary image-layer project path.
   */
  public async applyAdvancedFilterOperations(
    operations: readonly FilterOperation[],
    name = 'Advanced filters',
  ): Promise<string> {
    this.assertUsable()
    if (operations.length === 0) {
      throw new RangeError('詳細フィルターを1つ以上指定してください。')
    }
    const normalized = await validateAdvancedFilterOperations(operations)
    const source = await this.getDocumentImageData()
    const input = {
      width: source.width,
      height: source.height,
      data: new Uint8ClampedArray(source.data),
    }
    const selectionMask = this.selectionMask
    const filtered = await this.runAdvancedFilterOperations(
      input,
      normalized,
      selectionMask,
      selectionMask ? 'selection-overlay' : undefined,
    )
    return this.addImageDataLayer(
      {
        width: filtered.width,
        height: filtered.height,
        data: new Uint8ClampedArray(filtered.data),
      },
      name,
      'filter',
    )
  }

  private async runAdvancedFilterOperations(
    input: PixelBuffer,
    operations: readonly FilterOperation[],
    mask?: SelectionMask,
    outputMode?: 'selection-overlay',
  ): Promise<PixelBuffer> {
    if (typeof Worker === 'undefined') {
      if (mask) {
        const { applySelectionFilterOperationsCpu } =
          await import('./filters/selectionFilter')
        const filtered = applySelectionFilterOperationsCpu(
          input,
          mask,
          operations,
        )
        if (outputMode === 'selection-overlay') {
          const maskBytes = mask.toBytes()
          for (let pixel = 0; pixel < maskBytes.length; pixel += 1) {
            if (maskBytes[pixel] === 0) {
              filtered.data[pixel * 4 + 3] = 0
            }
          }
        }
        return filtered
      }
      const { applyFilterChainCpu } = await import('./filters/cpu')
      return applyFilterChainCpu(input, operations)
    }

    const { SelectionFilterClient } =
      await import('./filters/selectionFilterClient')
    const client = new SelectionFilterClient()
    try {
      return await client.run(
        {
          image: input,
          ...(mask ? { mask } : {}),
          operations,
          ...(outputMode ? { outputMode } : {}),
        },
        { transferOwnership: true },
      )
    } finally {
      client.dispose()
    }
  }

  public async addImageDataLayer(
    image: Pick<ImageData, 'width' | 'height' | 'data'>,
    name = 'Processed image',
    reason: EditorChangeReason = 'background-removal',
  ): Promise<string> {
    this.assertUsable()
    assertSafeImageDimensions({ width: image.width, height: image.height })
    if (
      !(image.data instanceof Uint8ClampedArray) ||
      image.data.length !== image.width * image.height * 4
    ) {
      throw new RangeError('画像データの長さが寸法と一致しません。')
    }
    const output = document.createElement('canvas')
    output.width = image.width
    output.height = image.height
    const context = output.getContext('2d')
    if (!context) {
      throw new Error('画像レイヤー用Canvasを作成できませんでした。')
    }
    const pixels = context.createImageData(image.width, image.height)
    pixels.data.set(image.data)
    context.putImageData(pixels, 0, 0)
    return this.runAtomic(reason, () =>
      this.importImage(output.toDataURL('image/png'), name),
    )
  }

  public async copySelection(): Promise<boolean> {
    this.assertUsable()
    const selected = this.canvas.getActiveObjects()
    if (selected.length === 0) {
      return false
    }
    const ownedGridContents = this.gridContentsOwnedBy(selected)
    const sources = [
      ...selected,
      ...ownedGridContents.filter((object) => !selected.includes(object)),
    ]
    const clones = await this.cloneObjects(sources)
    if (this.disposed) {
      this.disposeObjects(clones)
      this.assertUsable()
    }
    this.replaceClipboard(clones, selected.length)
    this.emitStatus('選択範囲をコピーしました。', 'info')
    return true
  }

  public async cutSelection(): Promise<boolean> {
    this.assertUsable()
    const selected = [...this.canvas.getActiveObjects()]
    if (selected.length === 0) {
      return false
    }

    const ownedGridContents = this.gridContentsOwnedBy(selected)
    const sources = [
      ...selected,
      ...ownedGridContents.filter((object) => !selected.includes(object)),
    ]
    const clones = await this.cloneObjects(sources)
    if (this.disposed) {
      this.disposeObjects(clones)
      this.assertUsable()
    }
    const selectedSet = new Set(selected)
    const objectsOnCanvas = new Set(this.canvas.getObjects())
    const objectsToRemove = [
      ...new Set(
        sources.filter(
          (object) =>
            objectsOnCanvas.has(object) ||
            this.persistentObjectOwner(object) !== undefined,
        ),
      ),
    ]
    if (objectsToRemove.length === 0) {
      this.disposeObjects(clones)
      return false
    }

    try {
      this.mutate('cut', () => {
        if (
          this.canvas
            .getActiveObjects()
            .some((object) => selectedSet.has(object))
        ) {
          this.canvas.discardActiveObject()
        }
        const affectedGroups = new Set<Group>()
        objectsToRemove.forEach((object) => {
          if (objectsOnCanvas.has(object)) {
            this.canvas.remove(object)
            return
          }
          const owner = this.persistentObjectOwner(object)
          if (owner) {
            owner.remove(object)
            affectedGroups.add(owner)
          }
        })
        affectedGroups.forEach((group) => {
          group.triggerLayout()
          group.setCoords()
        })
      })
    } catch (error) {
      this.disposeObjects(clones)
      throw error
    }
    this.replaceClipboard(clones, selected.length)
    this.emitStatus('選択範囲を切り取りました。', 'info')
    return true
  }

  public async pasteSelection(offset = 16): Promise<string[]> {
    this.assertUsable()
    if (this.clipboard.length === 0) {
      return []
    }
    const clones = await this.cloneObjects(this.clipboard)
    try {
      this.assertUsable()
      const appliedOffset = this.nextPasteOffset(clones, offset)
      const reservedNames = this.layerNames()
      this.preparePastedObjects(clones, appliedOffset, reservedNames)
      const primaryClones = clones.slice(0, this.clipboardPrimaryCount)

      this.mutate('paste', () => {
        this.canvas.discardActiveObject()
        this.canvas.add(...clones)
        this.activateObjects(primaryClones)
      })
      return primaryClones.map((clone) => this.requireEditorId(clone))
    } catch (error) {
      this.disposeResources(clones, this.canvas.getObjects())
      throw error
    }
  }

  private bindEvents(): void {
    this.eventDisposers.push(
      this.canvas.on('object:added', ({ target }) => {
        const drawingPath =
          this.eventSuppressionDepth === 0 &&
          this.canvas.isDrawingMode &&
          target.type === 'path'
        const object = target as EditorObject
        if (drawingPath) {
          this.normalizeObjectOrigin(object, true)
        }
        if (
          drawingPath &&
          this.currentTool === 'eraser' &&
          object.type === 'path'
        ) {
          object.set({
            globalCompositeOperation: 'destination-out',
            opacity: this.brushOpacity,
          })
          object.editorName ||= this.uniqueLayerName('Eraser stroke')
        } else if (
          drawingPath &&
          this.currentTool === 'brush' &&
          object.type === 'path'
        ) {
          object.set('opacity', this.brushOpacity)
          object.editorName ||= this.uniqueLayerName('Brush stroke')
        }
        if (drawingPath && object.type === 'path' && this.selectionMask) {
          object.clipPath = this.maskClip(object)
          object.set('dirty', true)
        }
        this.normalizeEditorObject(object)
        this.handleDocumentEvent('object-added')
      }),
      this.canvas.on('object:removed', () => {
        this.handleDocumentEvent('object-removed')
      }),
      this.canvas.on('object:moving', ({ target }) => {
        if (target) {
          this.snapMovingObject(target)
        }
      }),
      this.canvas.on('object:modified', () => {
        this.syncGridCellContents()
        this.handleDocumentEvent('object-modified')
      }),
      this.canvas.on('text:changed', () => {
        this.handleDocumentEvent('text-changed')
      }),
      this.canvas.on('selection:created', () => {
        this.handleSelectionEvent()
      }),
      this.canvas.on('selection:updated', () => {
        this.handleSelectionEvent()
      }),
      this.canvas.on('selection:cleared', () => {
        this.handleSelectionEvent()
      }),
      this.canvas.on('mouse:down', ({ e, viewportPoint }) => {
        if (this.currentTool !== 'pan') {
          return
        }
        this.isPanning = true
        this.lastPanPoint = new Point(viewportPoint.x, viewportPoint.y)
        this.canvas.defaultCursor = 'grabbing'
        e.preventDefault()
      }),
      this.canvas.on('mouse:move', ({ e, viewportPoint }) => {
        if (
          this.currentTool !== 'pan' ||
          !this.isPanning ||
          !this.lastPanPoint
        ) {
          return
        }
        const nextPoint = new Point(viewportPoint.x, viewportPoint.y)
        this.panBy(
          nextPoint.x - this.lastPanPoint.x,
          nextPoint.y - this.lastPanPoint.y,
        )
        this.lastPanPoint = nextPoint
        e.preventDefault()
      }),
      this.canvas.on('mouse:up', () => {
        if (this.currentTool !== 'pan') {
          return
        }
        this.isPanning = false
        this.lastPanPoint = null
        this.canvas.defaultCursor = 'grab'
      }),
      this.canvas.on('mouse:wheel', ({ e, viewportPoint }) => {
        const wheel = e as WheelEvent
        wheel.preventDefault()
        wheel.stopPropagation()
        const nextZoom = clamp(
          this.canvas.getZoom() * 0.999 ** wheel.deltaY,
          MIN_ZOOM,
          MAX_ZOOM,
        )
        this.canvas.zoomToPoint(viewportPoint, nextZoom)
        this.canvas.requestRenderAll()
        this.emitZoom()
      }),
      this.canvas.on('after:render', ({ ctx }) => {
        this.renderDocumentFrame(ctx)
        this.renderGuides(ctx)
        this.renderSelectionMask(ctx)
      }),
    )
  }

  private setDocumentClip(): void {
    const clip = new Rect({
      left: 0,
      top: 0,
      width: this.documentWidth,
      height: this.documentHeight,
      originX: 'left',
      originY: 'top',
      absolutePositioned: true,
      fill: '#000000',
      selectable: false,
      evented: false,
      excludeFromExport: true,
    })
    this.canvas.clipPath = clip
  }

  private hasNestedClip(object: FabricObject): boolean {
    if (object.clipPath?.clipPath) return true
    return (
      object instanceof Group &&
      object.getObjects().some((child) => this.hasNestedClip(child))
    )
  }

  private createRasterSvg(
    dataUrl: string,
    left: number,
    top: number,
    width: number,
    height: number,
    escapedLabel: string,
  ): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}" role="img" aria-label="${escapedLabel}">`,
      `<image x="${left}" y="${top}" width="${width}" height="${height}" href="${escapeXmlAttribute(dataUrl)}" />`,
      '</svg>',
    ].join('')
  }

  private createIsolatedLayerCanvas(target: FabricObject): HTMLCanvasElement {
    const objects = this.canvas.getObjects()
    const visibility = objects.map((object) => object.visible)
    const backgroundColor = this.canvas.backgroundColor
    const backgroundImage = this.canvas.backgroundImage
    const overlayColor = this.canvas.overlayColor
    const overlayImage = this.canvas.overlayImage
    const topLevelTarget = objects.includes(target) ? target : undefined
    try {
      this.withSuppressedEvents(() => {
        if (topLevelTarget) {
          objects.forEach((object) => object.set('visible', object === target))
          target.set('visible', true)
        }
        this.canvas.backgroundColor = 'transparent'
        this.canvas.backgroundImage = undefined
        this.canvas.overlayColor = 'transparent'
        this.canvas.overlayImage = undefined
      })
      return this.createDocumentCanvas()
    } finally {
      this.withSuppressedEvents(() => {
        objects.forEach((object, index) =>
          object.set('visible', visibility[index]),
        )
        this.canvas.backgroundColor = backgroundColor
        this.canvas.backgroundImage = backgroundImage
        this.canvas.overlayColor = overlayColor
        this.canvas.overlayImage = overlayImage
        this.canvas.requestRenderAll()
      })
    }
  }

  private createDocumentCanvas(): HTMLCanvasElement {
    const previousTransform = [
      ...this.canvas.viewportTransform,
    ] as typeof this.canvas.viewportTransform
    const previousViewportWidth = this.canvas.getWidth()
    const previousViewportHeight = this.canvas.getHeight()
    try {
      this.isExporting = true
      this.withSuppressedEvents(() => {
        this.canvas.setDimensions(
          { width: this.documentWidth, height: this.documentHeight },
          { backstoreOnly: true },
        )
        this.canvas.setViewportTransform([...iMatrix])
        this.canvas.requestRenderAll()
      })
      return this.canvas.toCanvasElement(1, {
        left: 0,
        top: 0,
        width: this.documentWidth,
        height: this.documentHeight,
      })
    } finally {
      this.isExporting = false
      this.withSuppressedEvents(() => {
        this.canvas.setDimensions(
          {
            width: previousViewportWidth,
            height: previousViewportHeight,
          },
          { backstoreOnly: true },
        )
        this.canvas.setViewportTransform(previousTransform)
        this.canvas.requestRenderAll()
      })
    }
  }

  /**
   * Rebuilds each adjustment image from the visible layers below it.
   *
   * Fabric does not expose a renderer-level adjustment-layer primitive, so an
   * adjustment is represented by a full-document image using `copy`
   * compositing. The cached image is derived state: filter parameters remain
   * the persisted source of truth and every document mutation rebuilds the
   * cache from the current lower stack.
   */
  private refreshAdjustmentLayers(): void {
    if (this.isRefreshingAdjustments || this.disposed) {
      return
    }
    const objects = this.canvas.getObjects()
    const adjustments = objects.filter(
      (object): object is FabricImage & EditorObject =>
        object instanceof FabricImage &&
        (object as EditorObject).editorKind === 'adjustment',
    )
    this.adjustmentRefreshGeneration += 1
    const generation = this.adjustmentRefreshGeneration
    if (adjustments.length === 0) {
      this.adjustmentRefreshPromise = this.adjustmentRefreshPromise.catch(
        () => undefined,
      )
      return
    }

    // Scalar Fabric filters stay synchronous for backwards compatibility.
    // Advanced chains are rebuilt below in document order; that second pass
    // also makes mixed scalar/advanced stacks exact after awaited work.
    this.isRefreshingAdjustments = true
    try {
      adjustments.forEach((adjustment) => {
        if (adjustment.editorFilterOperations) {
          adjustment.filters = []
          return
        }
        const index = objects.indexOf(adjustment)
        const composite = this.captureVisibleLowerStack(objects, index)
        const normalized = normalizeFilterSettings(
          (adjustment.editorFilterSettings ?? {}) as ImageFilterSettings,
        )
        adjustment.editorFilterSettings = { ...normalized }
        adjustment.filters = createImageFilters(normalized)
        this.setAdjustmentCache(adjustment, composite)
      })
    } finally {
      this.isRefreshingAdjustments = false
    }

    if (
      !adjustments.some(({ editorFilterOperations }) => editorFilterOperations)
    ) {
      this.adjustmentRefreshPromise = this.adjustmentRefreshPromise.catch(
        () => undefined,
      )
      return
    }

    const previous = this.adjustmentRefreshPromise
    const refresh = previous
      .catch(() => undefined)
      .then(() => this.rebuildAdvancedAdjustmentLayers(generation))
    this.adjustmentRefreshPromise = refresh
    void refresh.catch((error: unknown) => {
      if (generation !== this.adjustmentRefreshGeneration || this.disposed) {
        return
      }
      this.emitStatus(
        error instanceof Error
          ? `調整レイヤーを再構築できませんでした: ${error.message}`
          : '調整レイヤーを再構築できませんでした。',
        'error',
      )
    })
  }

  private captureVisibleLowerStack(
    objects: readonly FabricObject[],
    adjustmentIndex: number,
  ): HTMLCanvasElement {
    const hidden = objects.slice(adjustmentIndex)
    const visibility = hidden.map((candidate) => candidate.visible)
    try {
      hidden.forEach((candidate) => candidate.set('visible', false))
      return this.createDocumentCanvas()
    } finally {
      hidden.forEach((candidate, index) =>
        candidate.set('visible', visibility[index]),
      )
    }
  }

  private setAdjustmentCache(
    adjustment: FabricImage & EditorObject,
    source: HTMLCanvasElement,
  ): void {
    adjustment.setElement(source, {
      width: this.documentWidth,
      height: this.documentHeight,
    })
    adjustment.set({
      ...TOP_LEFT_ORIGIN,
      left: 0,
      top: 0,
      scaleX: 1,
      scaleY: 1,
      globalCompositeOperation: 'copy',
      dirty: true,
    })
    adjustment.setCoords()
  }

  private async rebuildAdvancedAdjustmentLayers(
    generation: number,
  ): Promise<void> {
    if (generation !== this.adjustmentRefreshGeneration || this.disposed) {
      return
    }
    const objects = this.canvas.getObjects()
    for (let index = 0; index < objects.length; index += 1) {
      if (generation !== this.adjustmentRefreshGeneration || this.disposed) {
        return
      }
      const object = objects[index]
      const adjustment = object as FabricImage & EditorObject
      if (
        !(object instanceof FabricImage) ||
        adjustment.editorKind !== 'adjustment'
      ) {
        continue
      }

      const composite = this.captureVisibleLowerStack(objects, index)
      const operations = adjustment.editorFilterOperations
      if (!operations) {
        const normalized = normalizeFilterSettings(
          (adjustment.editorFilterSettings ?? {}) as ImageFilterSettings,
        )
        adjustment.editorFilterSettings = { ...normalized }
        adjustment.filters = createImageFilters(normalized)
        this.setAdjustmentCache(adjustment, composite)
        continue
      }

      const context = composite.getContext('2d', { willReadFrequently: true })
      if (!context) {
        throw new Error('調整レイヤーの画像データを取得できませんでした。')
      }
      const source = context.getImageData(
        0,
        0,
        this.documentWidth,
        this.documentHeight,
      )
      const filtered = await this.runAdvancedFilterOperations(
        {
          width: source.width,
          height: source.height,
          data: new Uint8ClampedArray(source.data),
        },
        operations,
      )
      if (generation !== this.adjustmentRefreshGeneration || this.disposed) {
        return
      }
      const output = document.createElement('canvas')
      output.width = filtered.width
      output.height = filtered.height
      const outputContext = output.getContext('2d')
      if (!outputContext) {
        throw new Error('調整レイヤーの画像を作成できませんでした。')
      }
      const outputPixels = outputContext.createImageData(
        filtered.width,
        filtered.height,
      )
      outputPixels.data.set(filtered.data)
      outputContext.putImageData(outputPixels, 0, 0)
      adjustment.editorFilterOperations =
        cloneAdvancedFilterOperations(operations)
      delete adjustment.editorFilterSettings
      adjustment.filters = []
      this.setAdjustmentCache(adjustment, output)
    }
    if (generation === this.adjustmentRefreshGeneration && !this.disposed) {
      this.canvas.requestRenderAll()
    }
  }

  private renderDocumentFrame(ctx: CanvasRenderingContext2D): void {
    if (this.isExporting || this.disposed) {
      return
    }

    const [a, b, c, d, e, f] = this.canvas.viewportTransform
    const corners = [
      [e, f],
      [a * this.documentWidth + e, b * this.documentWidth + f],
      [c * this.documentHeight + e, d * this.documentHeight + f],
      [
        a * this.documentWidth + c * this.documentHeight + e,
        b * this.documentWidth + d * this.documentHeight + f,
      ],
    ]
    const xValues = corners.map(([x]) => x)
    const yValues = corners.map(([, y]) => y)
    const left = Math.min(...xValues)
    const top = Math.min(...yValues)
    const right = Math.max(...xValues)
    const bottom = Math.max(...yValues)

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    ctx.rect(0, 0, this.canvas.getWidth(), this.canvas.getHeight())
    ctx.rect(left, top, right - left, bottom - top)
    ctx.fillStyle = 'rgba(3, 6, 12, 0.72)'
    ctx.fill('evenodd')
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.52)'
    ctx.lineWidth = 1
    ctx.strokeRect(
      Math.round(left) + 0.5,
      Math.round(top) + 0.5,
      Math.max(0, Math.round(right - left) - 1),
      Math.max(0, Math.round(bottom - top) - 1),
    )
    ctx.restore()
  }

  private renderGuides(ctx: CanvasRenderingContext2D): void {
    if (
      this.isExporting ||
      this.disposed ||
      this.editorState.guides.length === 0
    ) {
      return
    }
    const [a, b, c, d, e, f] = this.canvas.viewportTransform
    const origin = new Point(e, f)
    const horizontalEnd = new Point(
      a * this.documentWidth + e,
      b * this.documentWidth + f,
    )
    const verticalEnd = new Point(
      c * this.documentHeight + e,
      d * this.documentHeight + f,
    )

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.92)'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    this.editorState.guides.forEach((guide) => {
      ctx.beginPath()
      if (guide.axis === 'x') {
        const x = a * guide.position + e
        const y = b * guide.position + f
        ctx.moveTo(x + c * 0, y + d * 0)
        ctx.lineTo(
          x + (verticalEnd.x - origin.x),
          y + (verticalEnd.y - origin.y),
        )
      } else {
        const x = c * guide.position + e
        const y = d * guide.position + f
        ctx.moveTo(x + a * 0, y + b * 0)
        ctx.lineTo(
          x + (horizontalEnd.x - origin.x),
          y + (horizontalEnd.y - origin.y),
        )
      }
      ctx.stroke()
    })
    ctx.restore()
  }

  private renderSelectionMask(ctx: CanvasRenderingContext2D): void {
    if (this.isExporting || this.disposed || !this.selectionMask) {
      return
    }
    this.selectionOverlay ??= this.createSelectionOverlay(this.selectionMask)
    const [a, b, c, d, e, f] = this.canvas.viewportTransform
    ctx.save()
    ctx.setTransform(a, b, c, d, e, f)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      this.selectionOverlay,
      0,
      0,
      this.documentWidth,
      this.documentHeight,
    )
    ctx.restore()
  }

  private createSelectionOverlay(mask: SelectionMask): HTMLCanvasElement {
    const maximumSide = 1_024
    const scale = Math.min(1, maximumSide / Math.max(mask.width, mask.height))
    const width = Math.max(1, Math.round(mask.width * scale))
    const height = Math.max(1, Math.round(mask.height * scale))
    const overlay = document.createElement('canvas')
    overlay.width = width
    overlay.height = height
    const context = overlay.getContext('2d')
    if (!context) {
      return overlay
    }
    const source = mask.toBytes()
    const output = context.createImageData(width, height)
    const selectedAt = (x: number, y: number): boolean => {
      const sourceX = Math.min(
        mask.width - 1,
        Math.floor((x / width) * mask.width),
      )
      const sourceY = Math.min(
        mask.height - 1,
        Math.floor((y / height) * mask.height),
      )
      return source[sourceY * mask.width + sourceX] > 0
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!selectedAt(x, y)) continue
        const boundary =
          x === 0 ||
          y === 0 ||
          x === width - 1 ||
          y === height - 1 ||
          !selectedAt(x - 1, y) ||
          !selectedAt(x + 1, y) ||
          !selectedAt(x, y - 1) ||
          !selectedAt(x, y + 1)
        const offset = (y * width + x) * 4
        if (boundary) {
          const light = (x + y + this.selectionOverlayPhase) % 8 < 4
          output.data[offset] = light ? 255 : 15
          output.data[offset + 1] = light ? 255 : 23
          output.data[offset + 2] = light ? 255 : 42
          output.data[offset + 3] = 235
        } else {
          output.data[offset] = 124
          output.data[offset + 1] = 108
          output.data[offset + 2] = 255
          output.data[offset + 3] = 22
        }
      }
    }
    context.putImageData(output, 0, 0)
    return overlay
  }

  private syncSelectionMask(): void {
    try {
      this.selectionMask = this.editorState.selectionMask
        ? decodeSelectionMaskFromProject(this.editorState.selectionMask)
        : undefined
      this.selectionBounds = this.selectionMask?.getNonEmptyBounds() ?? null
    } catch {
      this.selectionMask = undefined
      this.selectionBounds = null
      this.editorState = { ...this.editorState, selectionMask: undefined }
    }
    this.selectionOverlay = undefined
    this.syncSelectionOverlayAnimation()
  }

  private syncSelectionOverlayAnimation(): void {
    if (!this.selectionMask) {
      this.stopSelectionOverlayAnimation()
      return
    }
    if (this.selectionOverlayTimer !== undefined) {
      return
    }
    this.selectionOverlayTimer = globalThis.setInterval(() => {
      if (this.disposed) return
      this.selectionOverlayPhase = (this.selectionOverlayPhase + 1) % 8
      this.selectionOverlay = undefined
      this.canvas.requestRenderAll()
    }, 120)
  }

  private stopSelectionOverlayAnimation(): void {
    if (this.selectionOverlayTimer === undefined) {
      return
    }
    globalThis.clearInterval(this.selectionOverlayTimer)
    this.selectionOverlayTimer = undefined
  }

  /**
   * A clipping frame is always the outer clip on its owning layer. Any layer
   * mask is nested inside it, which lets either feature be toggled without
   * replacing the other one's serializable Fabric object.
   */
  private embeddedClipFrame(target: EditorObject): EditorObject | undefined {
    if (!target.editorClipFrameId || !target.clipPath) return undefined
    const candidate = target.clipPath as EditorObject
    return candidate.editorId === target.editorClipFrameId ||
      candidate.editorKind === 'frame'
      ? candidate
      : undefined
  }

  private transformAbsoluteClipPaths(transform: DocumentSpaceTransform): void {
    const visited = new Set<FabricObject>()
    const visitClip = (clip: FabricObject): void => {
      if (visited.has(clip)) return
      visited.add(clip)
      if (clip.absolutePositioned) {
        clip.set({
          left: clip.left * transform.scaleX + transform.offsetX,
          top: clip.top * transform.scaleY + transform.offsetY,
          scaleX: clip.scaleX * transform.scaleX,
          scaleY: clip.scaleY * transform.scaleY,
        })
        clip.setCoords()
      }
      if (clip.clipPath) visitClip(clip.clipPath as FabricObject)
    }
    const visitObject = (object: FabricObject): void => {
      if (object.clipPath) visitClip(object.clipPath as FabricObject)
      if (object instanceof Group) object.getObjects().forEach(visitObject)
    }
    this.canvas.getObjects().forEach(visitObject)
  }

  private transformStoredLayerMasks(
    transform: (mask: SelectionMask) => SelectionMask,
  ): void {
    const visit = (object: FabricObject): void => {
      const target = object as EditorObject
      if (target.editorLayerMask) {
        const transformed = transform(
          decodeSelectionMaskFromProject(target.editorLayerMask),
        )
        target.editorLayerMask = encodeSelectionMaskForProject(transformed)
        const bounds = transformed.getNonEmptyBounds()
        this.setLayerMaskClip(
          target,
          target.editorLayerMaskEnabled !== false && bounds
            ? createSelectionMaskClip(transformed, bounds)
            : undefined,
        )
      }
      if (object instanceof Group) object.getObjects().forEach(visit)
    }
    this.canvas.getObjects().forEach(visit)
  }

  private createStoredLayerMaskClip(
    target: EditorObject,
  ): FabricObject | undefined {
    if (!target.editorLayerMask || target.editorLayerMaskEnabled === false) {
      return undefined
    }
    const mask = decodeSelectionMaskFromProject(target.editorLayerMask)
    const bounds = mask.getNonEmptyBounds()
    return bounds ? createSelectionMaskClip(mask, bounds) : undefined
  }

  private setLayerMaskClip(
    target: EditorObject,
    clipPath: FabricObject | undefined,
  ): void {
    const frame = this.embeddedClipFrame(target)
    const host = frame ?? target
    host.set('clipPath', clipPath)
    host.set('dirty', true)
    target.set('dirty', true)
  }

  /** Appends an absolute clip as an intersection without disturbing clips. */
  private appendClipIntersection(
    target: FabricObject,
    clipPath: FabricObject,
  ): void {
    const outer = target.clipPath
    if (!outer) {
      target.set('clipPath', clipPath)
      target.set('dirty', true)
      return
    }

    let tail = outer as FabricObject
    const visited = new Set<FabricObject>()
    while (tail.clipPath && !visited.has(tail)) {
      visited.add(tail)
      tail = tail.clipPath as FabricObject
    }
    tail.set('clipPath', clipPath)
    tail.set('dirty', true)
    target.set('dirty', true)
  }

  private maskClip(object: FabricObject): FabricObject {
    if (!this.selectionMask || !this.selectionBounds) {
      return createEmptyAbsoluteClip()
    }

    const objectBounds = object.getBoundingRect()
    const selected = this.selectionBounds
    const left = Math.max(0, selected.left, Math.floor(objectBounds.left) - 1)
    const top = Math.max(0, selected.top, Math.floor(objectBounds.top) - 1)
    const right = Math.min(
      this.documentWidth,
      selected.left + selected.width,
      Math.ceil(objectBounds.left + objectBounds.width) + 1,
    )
    const bottom = Math.min(
      this.documentHeight,
      selected.top + selected.height,
      Math.ceil(objectBounds.top + objectBounds.height) + 1,
    )

    if (right <= left || bottom <= top) {
      return createEmptyAbsoluteClip()
    }
    return createSelectionMaskClip(this.selectionMask, {
      left,
      top,
      width: right - left,
      height: bottom - top,
    })
  }

  private snapMovingObject(target: FabricObject): void {
    if ((target as EditorObject).editorLocked) {
      return
    }
    const bounds = target.getBoundingRect()
    const ownX = [
      bounds.left,
      bounds.left + bounds.width / 2,
      bounds.left + bounds.width,
    ]
    const ownY = [
      bounds.top,
      bounds.top + bounds.height / 2,
      bounds.top + bounds.height,
    ]
    const targetX = [0, this.documentWidth / 2, this.documentWidth]
    const targetY = [0, this.documentHeight / 2, this.documentHeight]
    this.editorState.guides.forEach((guide) => {
      ;(guide.axis === 'x' ? targetX : targetY).push(guide.position)
    })
    this.canvas.getObjects().forEach((object) => {
      if (object === target || !object.visible) {
        return
      }
      const other = object.getBoundingRect()
      targetX.push(
        other.left,
        other.left + other.width / 2,
        other.left + other.width,
      )
      targetY.push(
        other.top,
        other.top + other.height / 2,
        other.top + other.height,
      )
    })
    const tolerance =
      this.editorState.snapTolerance / Math.max(this.getZoom(), MIN_ZOOM)
    const closest = (sources: number[], destinations: number[]): number => {
      let best = 0
      let distance = tolerance + EPSILON
      sources.forEach((source) => {
        destinations.forEach((destination) => {
          const delta = destination - source
          if (Math.abs(delta) < distance) {
            best = delta
            distance = Math.abs(delta)
          }
        })
      })
      return distance <= tolerance ? best : 0
    }
    const deltaX = closest(ownX, targetX)
    const deltaY = closest(ownY, targetY)
    if (Math.abs(deltaX) > EPSILON || Math.abs(deltaY) > EPSILON) {
      target.set({
        left: target.left + deltaX,
        top: target.top + deltaY,
      })
      target.setCoords()
    }
  }

  private applyBrushOptions(): void {
    const brush =
      this.canvas.freeDrawingBrush ??
      (this.canvas.freeDrawingBrush = new PencilBrush(this.canvas))
    brush.color = this.currentTool === 'eraser' ? '#000000' : this.brushColor
    brush.width = this.brushSize
  }

  private initializeEditorObject(object: EditorObject, name: string): void {
    this.normalizeObjectOrigin(object)
    object.editorId = object.editorId || createEditorId()
    object.editorName = object.editorName || name
    object.editorLocked = Boolean(object.editorLocked)
    this.configureSingleObjectInteractivity(object)
    if (object instanceof Group) {
      object
        .getObjects()
        .forEach((child) =>
          this.initializeEditorObject(
            child as EditorObject,
            this.defaultNameForObject(child),
          ),
        )
    }
  }

  private normalizeEditorObject(object: FabricObject): EditorObject {
    const editorObject = object as EditorObject
    this.normalizeObjectOrigin(editorObject)
    if (!editorObject.editorId) {
      editorObject.editorId = createEditorId()
    }
    if (!editorObject.editorName) {
      editorObject.editorName = this.uniqueLayerName(
        this.defaultNameForObject(editorObject),
      )
    }
    editorObject.editorLocked = Boolean(editorObject.editorLocked)
    this.configureSingleObjectInteractivity(editorObject)
    if (editorObject instanceof Group) {
      editorObject
        .getObjects()
        .forEach((child) => this.normalizeEditorObject(child))
    }
    return editorObject
  }

  private configureObjectInteractivity(): void {
    this.canvas.getObjects().forEach((object) => {
      this.configureSingleObjectInteractivity(
        this.normalizeEditorObject(object),
      )
    })
  }

  private configureSingleObjectInteractivity(object: EditorObject): void {
    const interactive = this.currentTool === 'select' && !object.editorLocked
    const transformable = interactive && object.editorKind !== 'adjustment'
    object.set({
      selectable: interactive,
      evented: interactive,
      hasControls: transformable,
      lockMovementX: !transformable,
      lockMovementY: !transformable,
      lockRotation: !transformable,
      lockScalingX: !transformable,
      lockScalingY: !transformable,
      lockSkewingX: !transformable,
      lockSkewingY: !transformable,
    })
  }

  private addAndSelect(object: EditorObject): void {
    this.mutate('object-added', () => {
      this.canvas.add(object)
      this.canvas.setActiveObject(object)
    })
  }

  private activateObjects(objects: FabricObject[]): void {
    if (objects.length === 0) {
      return
    }
    if (objects.length === 1) {
      this.canvas.setActiveObject(objects[0])
      return
    }
    this.canvas.setActiveObject(new ActiveSelection(objects))
  }

  private async replaceSemanticSvgLayer(
    id: string,
    sanitizedSvg: string,
    kind: 'chart' | 'table',
    applyMetadata: (replacement: EditorObject) => void,
  ): Promise<boolean> {
    const parsed = await loadSVGFromString(sanitizedSvg)
    this.assertUsable()
    const parsedObjects = parsed.objects.filter(
      (object): object is FabricObject => object instanceof FabricObject,
    )
    if (parsedObjects.length === 0) {
      throw new TypeError(
        'The semantic SVG does not contain supported objects.',
      )
    }

    let replacement: FabricObject | undefined
    try {
      replacement = util.groupSVGElements(parsedObjects, parsed.options)
      const target = this.findLayer(id)
      const index = target ? this.canvas.getObjects().indexOf(target) : -1
      if (!target || index < 0) {
        this.disposeResources([replacement], this.canvas.getObjects())
        return false
      }

      const selected = this.canvas.getActiveObjects()
      const selectedAfterReplacement = selected.map((object) =>
        object === target ? replacement! : object,
      )
      const targetWasSelected = selected.includes(target)
      const clipPath = target.clipPath
      const editorReplacement = replacement as EditorObject
      this.normalizeObjectOrigin(editorReplacement)
      editorReplacement.editorId = this.requireEditorId(target)
      editorReplacement.editorName = this.requireEditorName(target)
      editorReplacement.editorLocked = Boolean(target.editorLocked)
      editorReplacement.editorKind = kind
      editorReplacement.editorTemplateId = target.editorTemplateId
      editorReplacement.editorLayerType = target.editorLayerType
      editorReplacement.editorClipFrameId = target.editorClipFrameId
      editorReplacement.editorClipSettings = target.editorClipSettings
        ? structuredClone(target.editorClipSettings)
        : undefined
      editorReplacement.editorLayerMask = copySelectionMask(
        target.editorLayerMask,
      )
      editorReplacement.editorLayerMaskEnabled = target.editorLayerMaskEnabled
      editorReplacement.editorLayerMaskSettings = target.editorLayerMaskSettings
        ? structuredClone(target.editorLayerMaskSettings)
        : undefined
      applyMetadata(editorReplacement)
      this.initializeEditorObject(
        editorReplacement,
        editorReplacement.editorName,
      )
      replacement.set({
        ...TOP_LEFT_ORIGIN,
        left: target.left,
        top: target.top,
        scaleX: target.scaleX,
        scaleY: target.scaleY,
        skewX: target.skewX,
        skewY: target.skewY,
        angle: target.angle,
        flipX: target.flipX,
        flipY: target.flipY,
        visible: target.visible,
        opacity: target.opacity,
        globalCompositeOperation: target.globalCompositeOperation,
        shadow: target.shadow,
        clipPath,
        dirty: true,
      })
      replacement.setCoords()

      this.mutate(kind, () => {
        if (targetWasSelected) this.canvas.discardActiveObject()
        target.set('clipPath', undefined)
        this.canvas.remove(target)
        this.canvas.insertAt(index, replacement!)
        if (targetWasSelected) this.activateObjects(selectedAfterReplacement)
      })
      return true
    } catch (error) {
      this.disposeResources(
        replacement ? [replacement] : parsedObjects,
        this.canvas.getObjects(),
      )
      throw error
    }
  }

  private syncGridCellContent(
    image: EditorObject & FabricImage,
    cell: EditorObject & Rect,
  ): void {
    const frame = this.embeddedClipFrame(image)
    if (!frame) return
    const transform = cell.calcTransformMatrix()
    const decomposition = util.qrDecompose(transform)
    const sourceWidth = Math.max(1, image.width)
    const sourceHeight = Math.max(1, image.height)
    const cellWidth = Math.max(1, cell.width)
    const cellHeight = Math.max(1, cell.height)
    const owner =
      cell.group instanceof Group ? (cell.group as EditorObject & Group) : null
    const coverScale = Math.max(
      cellWidth / sourceWidth,
      cellHeight / sourceHeight,
    )
    const imageTopLeft = util.transformPoint(
      new Point(
        (-sourceWidth * coverScale) / 2,
        (-sourceHeight * coverScale) / 2,
      ),
      transform,
    )
    const frameTopLeft = util.transformPoint(
      new Point(-cellWidth / 2, -cellHeight / 2),
      transform,
    )
    image.set({
      ...TOP_LEFT_ORIGIN,
      left: imageTopLeft.x,
      top: imageTopLeft.y,
      scaleX: Math.abs(decomposition.scaleX) * coverScale,
      scaleY: Math.abs(decomposition.scaleY) * coverScale,
      angle: decomposition.angle,
      skewX: decomposition.skewX,
      skewY: 0,
      visible: cell.visible && (owner?.visible ?? true),
      opacity: cell.opacity * (owner?.opacity ?? 1),
      globalCompositeOperation:
        cell.globalCompositeOperation !== 'source-over'
          ? cell.globalCompositeOperation
          : (owner?.globalCompositeOperation ?? 'source-over'),
      dirty: true,
    })
    image.editorLocked =
      Boolean(cell.editorLocked) || Boolean(owner?.editorLocked)
    this.configureSingleObjectInteractivity(image)
    frame.set({
      ...TOP_LEFT_ORIGIN,
      left: frameTopLeft.x,
      top: frameTopLeft.y,
      width: cellWidth,
      height: cellHeight,
      scaleX: Math.abs(decomposition.scaleX),
      scaleY: Math.abs(decomposition.scaleY),
      angle: decomposition.angle,
      skewX: decomposition.skewX,
      skewY: 0,
      absolutePositioned: true,
      dirty: true,
    })
    frame.setCoords()
    image.setCoords()
  }

  private selectedGridGroupLayout(): ResolvedGridGroupLayout | undefined {
    const selectedObjects = this.canvas
      .getActiveObjects()
      .map((object) => object as EditorObject)
    const selectedIds = new Set(
      selectedObjects.flatMap((object) => [
        this.requireEditorId(object),
        ...(object.editorGridCellId ? [object.editorGridCellId] : []),
      ]),
    )
    if (selectedIds.size === 0) return undefined

    const visit = (
      objects: readonly FabricObject[],
    ): ResolvedGridGroupLayout | undefined => {
      for (const object of objects) {
        if (!(object instanceof Group)) continue
        const group = object as EditorObject & Group
        const gridCells = group
          .getObjects()
          .filter(
            (child): child is EditorObject & Rect =>
              child instanceof Rect &&
              (child as EditorObject).editorKind === 'grid-cell' &&
              Boolean((child as EditorObject).editorGridCellId),
          )
        const groupSelected = selectedIds.has(this.requireEditorId(group))
        const childSelected = gridCells.some((cell) =>
          selectedIds.has(this.requireEditorId(cell)),
        )
        if (gridCells.length >= 2 && (groupSelected || childSelected)) {
          const left = Math.min(...gridCells.map((cell) => cell.left))
          const top = Math.min(...gridCells.map((cell) => cell.top))
          const right = Math.max(
            ...gridCells.map(
              (cell) => cell.left + Math.abs(cell.width * cell.scaleX),
            ),
          )
          const bottom = Math.max(
            ...gridCells.map(
              (cell) => cell.top + Math.abs(cell.height * cell.scaleY),
            ),
          )
          const width = right - left
          const height = bottom - top
          if (width <= EPSILON || height <= EPSILON) return undefined
          const cells = new Map(
            gridCells.map((cell) => [this.requireEditorId(cell), cell]),
          )
          return {
            group,
            cells,
            left,
            top,
            width,
            height,
            layout: gridCells.map((cell) => ({
              id: this.requireEditorId(cell),
              x: (cell.left - left) / width,
              y: (cell.top - top) / height,
              width: Math.abs(cell.width * cell.scaleX) / width,
              height: Math.abs(cell.height * cell.scaleY) / height,
            })),
          }
        }
        const nested = visit(group.getObjects())
        if (nested) return nested
      }
      return undefined
    }

    return visit(this.canvas.getObjects())
  }

  private gridContentsOwnedBy(
    objects: readonly FabricObject[],
  ): Array<EditorObject & FabricImage> {
    const ownedCellIds = new Set<string>()
    const visit = (object: FabricObject): void => {
      const editorObject = object as EditorObject
      if (
        editorObject.editorKind === 'grid-cell' &&
        editorObject.editorGridCellId
      ) {
        ownedCellIds.add(editorObject.editorGridCellId)
      }
      if (object instanceof Group) object.getObjects().forEach(visit)
    }
    objects.forEach(visit)
    if (ownedCellIds.size === 0) return []
    return this.canvas
      .getObjects()
      .filter((object): object is EditorObject & FabricImage => {
        const editorObject = object as EditorObject
        return (
          object instanceof FabricImage &&
          editorObject.editorKind === 'grid-cell-image' &&
          Boolean(
            editorObject.editorGridCellId &&
            ownedCellIds.has(editorObject.editorGridCellId),
          )
        )
      })
  }

  private syncGridCellContents(): void {
    this.canvas.getObjects().forEach((object) => {
      const image = object as EditorObject & FabricImage
      if (
        !(object instanceof FabricImage) ||
        image.editorKind !== 'grid-cell-image' ||
        !image.editorGridCellId
      ) {
        return
      }
      const cell = this.findLayer(image.editorGridCellId)
      if (!(cell instanceof Rect)) return
      this.syncGridCellContent(image, cell as EditorObject & Rect)
    })
  }

  private findGridCellAtPoint(point: Point): EditorObject | undefined {
    const visit = (
      objects: readonly FabricObject[],
    ): EditorObject | undefined => {
      for (let index = objects.length - 1; index >= 0; index -= 1) {
        const object = objects[index]
        if (!object.visible) continue
        if (object instanceof Group) {
          const nested = visit(object.getObjects())
          if (nested) return nested
        }
        const editorObject = object as EditorObject
        if (
          editorObject.editorKind !== 'grid-cell' ||
          !editorObject.editorGridCellId
        ) {
          continue
        }
        const bounds = object.getBoundingRect()
        if (
          point.x >= bounds.left &&
          point.x <= bounds.left + bounds.width &&
          point.y >= bounds.top &&
          point.y <= bounds.top + bounds.height
        ) {
          return editorObject
        }
      }
      return undefined
    }
    return visit(this.canvas.getObjects())
  }

  private findDropFrameAtPoint(point: Point): EditorObject | undefined {
    for (
      let index = this.canvas.getObjects().length - 1;
      index >= 0;
      index -= 1
    ) {
      const object = this.canvas.getObjects()[index]
      const editorObject = object as EditorObject
      if (
        !object.visible ||
        object instanceof FabricImage ||
        editorObject.editorKind !== 'frame'
      ) {
        continue
      }
      const bounds = object.getBoundingRect()
      if (
        point.x >= bounds.left &&
        point.x <= bounds.left + bounds.width &&
        point.y >= bounds.top &&
        point.y <= bounds.top + bounds.height
      ) {
        return editorObject
      }
    }
    return undefined
  }

  private findLayer(id: string): EditorObject | undefined {
    const visit = (
      objects: readonly FabricObject[],
    ): EditorObject | undefined => {
      for (const object of objects) {
        const editorObject = this.normalizeEditorObject(object)
        if (editorObject.editorId === id) {
          return editorObject
        }
        if (object instanceof Group) {
          const nested = visit(object.getObjects())
          if (nested) return nested
        }
      }
      return undefined
    }
    return visit(this.canvas.getObjects())
  }

  private persistentObjectOwner(object: FabricObject): Group | undefined {
    const owner = object.group
    return owner instanceof Group && !(owner instanceof ActiveSelection)
      ? owner
      : undefined
  }

  private topLevelStackUnits(): FabricObject[][] {
    const objects = this.canvas.getObjects()
    const contentsByOwner = new Map<FabricObject, FabricObject[]>()
    const ownedContents = new Set<FabricObject>()
    objects.forEach((object) => {
      if ((object as EditorObject).editorKind === 'grid-cell-image') return
      const contents = this.gridContentsOwnedBy([object])
      if (contents.length === 0) return
      const ordered = objects.filter((candidate) =>
        contents.includes(candidate as EditorObject & FabricImage),
      )
      contentsByOwner.set(object, ordered)
      ordered.forEach((content) => ownedContents.add(content))
    })
    return objects.flatMap((object) =>
      ownedContents.has(object)
        ? []
        : [[object, ...(contentsByOwner.get(object) ?? [])]],
    )
  }

  private applyTopLevelStackUnits(units: readonly FabricObject[][]): void {
    units
      .flat()
      .forEach((object, index) => this.canvas.moveObjectTo(object, index))
  }

  private moveLayerInStack(
    id: string,
    direction: 'forward' | 'backward' | 'front' | 'back',
  ): boolean {
    const target = this.findLayer(id)
    if (!target) return false
    const owner = this.persistentObjectOwner(target)
    if (owner) {
      const siblings = owner.getObjects()
      const sourceIndex = siblings.indexOf(target)
      const targetIndex =
        direction === 'front'
          ? siblings.length - 1
          : direction === 'back'
            ? 0
            : clamp(
                sourceIndex + (direction === 'forward' ? 1 : -1),
                0,
                siblings.length - 1,
              )
      if (sourceIndex < 0 || sourceIndex === targetIndex) return false
      this.mutate('layer', () => {
        owner.moveObjectTo(target, targetIndex)
        owner.triggerLayout()
        owner.setCoords()
      })
      return true
    }

    const units = this.topLevelStackUnits()
    const sourceIndex = units.findIndex((unit) => unit.includes(target))
    if (sourceIndex < 0) return false
    const targetIndex =
      direction === 'front'
        ? units.length - 1
        : direction === 'back'
          ? 0
          : clamp(
              sourceIndex + (direction === 'forward' ? 1 : -1),
              0,
              units.length - 1,
            )
    if (sourceIndex === targetIndex) return false
    this.mutate('layer', () => {
      const [unit] = units.splice(sourceIndex, 1)
      units.splice(targetIndex, 0, unit)
      this.applyTopLevelStackUnits(units)
    })
    return true
  }

  private async cloneObjects(
    objects: FabricObject[],
  ): Promise<ClipboardObject[]> {
    const activeObject = this.canvas.getActiveObject()
    const needsTemporaryUngroup =
      activeObject instanceof ActiveSelection &&
      objects.some((object) => object.group === activeObject)

    if (needsTemporaryUngroup) {
      this.withSuppressedEvents(() => {
        this.canvas.discardActiveObject()
      })
    }
    try {
      const results = await Promise.allSettled(
        objects.map(async (object) => {
          return (await object.clone([
            ...SERIALIZED_EDITOR_PROPERTIES,
          ])) as ClipboardObject
        }),
      )
      const clones = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      )
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )
      if (failure) {
        this.disposeObjects(clones)
        throw failure.reason
      }
      return clones
    } finally {
      if (needsTemporaryUngroup && !this.disposed) {
        this.withSuppressedEvents(() => {
          const currentObjects = new Set(this.canvas.getObjects())
          const selectionCanBeRestored =
            this.currentTool === 'select' &&
            objects.every(
              (object) =>
                currentObjects.has(object) &&
                object.visible &&
                object.selectable,
            )
          if (!this.canvas.getActiveObject() && selectionCanBeRestored) {
            this.activateObjects(objects)
          }
          this.canvas.requestRenderAll()
        })
      }
    }
  }

  private preparePastedObjects(
    objects: ClipboardObject[],
    offset: number,
    reservedNames = this.layerNames(),
  ): void {
    const idMap = new Map<string, string>()
    const assignIds = (object: EditorObject): void => {
      const originalId = this.requireEditorId(object)
      const frame = this.embeddedClipFrame(object)
      const replacementId = createEditorId()
      idMap.set(originalId, replacementId)
      object.editorId = replacementId
      if (object instanceof Group) {
        object.getObjects().forEach((child) => assignIds(child as EditorObject))
      }
      if (frame) assignIds(frame)
    }
    const remapReferences = (object: EditorObject): void => {
      if (object.editorGridCellId) {
        object.editorGridCellId =
          idMap.get(object.editorGridCellId) ?? object.editorGridCellId
      }
      if (object.editorClipFrameId) {
        object.editorClipFrameId =
          idMap.get(object.editorClipFrameId) ?? object.editorClipFrameId
      }
      if (object instanceof Group) {
        object
          .getObjects()
          .forEach((child) => remapReferences(child as EditorObject))
      }
      const frame = this.embeddedClipFrame(object)
      if (frame) remapReferences(frame)
    }

    objects.forEach(assignIds)
    objects.forEach(remapReferences)
    objects.forEach((object) => {
      const originalName = this.requireEditorName(object)
      object.editorName = this.uniqueLayerName(
        `${originalName} copy`,
        reservedNames,
      )
      object.set({
        left: object.left + offset,
        top: object.top + offset,
      })
      this.configureSingleObjectInteractivity(object)
      object.setCoords()
    })
  }

  private nextPasteOffset(
    objects: ClipboardObject[],
    requestedOffset: number,
  ): number {
    const step = clamp(
      Math.round(Math.max(0, finiteOr(requestedOffset, 16))),
      0,
      MAX_DOCUMENT_SIZE,
    )
    if (step === 0 || objects.length === 0) {
      this.pasteGeneration = 0
      return 0
    }

    const bounds = objects.map((object) => object.getBoundingRect())
    // Keep the diagonal paste cascade bounded so every target retains a
    // visible portion, then wrap back to the first offset.
    const visibleOffsets = bounds.flatMap((bound) => {
      const visibleWidth = Math.min(
        MIN_VISIBLE_PASTE_PIXELS,
        Math.max(1, finiteOr(bound.width, 1)),
        this.documentWidth,
      )
      const visibleHeight = Math.min(
        MIN_VISIBLE_PASTE_PIXELS,
        Math.max(1, finiteOr(bound.height, 1)),
        this.documentHeight,
      )
      return [
        this.documentWidth - visibleWidth - finiteOr(bound.left, 0),
        this.documentHeight - visibleHeight - finiteOr(bound.top, 0),
      ]
    })
    const maximumVisibleOffset = clamp(
      Math.floor(finiteOr(Math.min(...visibleOffsets), 0)),
      0,
      MAX_DOCUMENT_SIZE,
    )
    const maximumGeneration = Math.floor(maximumVisibleOffset / step)
    if (maximumGeneration < 1) {
      this.pasteGeneration = 0
      return 0
    }

    this.pasteGeneration = (this.pasteGeneration % maximumGeneration) + 1
    return step * this.pasteGeneration
  }

  private async prepareRestore(
    snapshot: EditorSnapshot,
  ): Promise<PreparedEditorRestore> {
    const serializedObjects = Array.isArray(snapshot.json.objects)
      ? snapshot.json.objects
      : []
    const validatedAdvancedOperations = new Map<unknown, FilterOperation[]>()
    const validatedChartModels = new Map<unknown, ChartModel>()
    const validatedChartPalettes = new Map<unknown, string[]>()
    const validatedTableModels = new Map<unknown, TableModel>()
    await Promise.all(
      serializedObjects.map(async (serialized, index) => {
        if (
          typeof serialized !== 'object' ||
          serialized === null ||
          Array.isArray(serialized)
        ) {
          return
        }
        const record = serialized as Record<string, unknown>
        if (
          record.editorChartModel !== undefined &&
          record.editorTableModel !== undefined
        ) {
          throw new TypeError(
            `objects[${index}] cannot be both a chart and a table.`,
          )
        }
        if (
          record.editorKind === 'chart' ||
          record.editorChartModel !== undefined ||
          record.editorChartPalette !== undefined
        ) {
          if (record.editorChartModel === undefined) {
            throw new TypeError(
              `objects[${index}] is missing its semantic chart model.`,
            )
          }
          const charts = await import('../charts')
          validatedChartModels.set(
            serialized,
            charts.parseChartModel(record.editorChartModel),
          )
          validatedChartPalettes.set(
            serialized,
            parseChartPalette(
              record.editorChartPalette,
              `objects[${index}].editorChartPalette`,
            ),
          )
        }
        if (
          record.editorKind === 'table' ||
          record.editorTableModel !== undefined
        ) {
          if (record.editorTableModel === undefined) {
            throw new TypeError(
              `objects[${index}] is missing its semantic table model.`,
            )
          }
          const tables = await import('../tables')
          validatedTableModels.set(
            serialized,
            tables.parseTableModel(record.editorTableModel),
          )
        }
        if (
          record.editorKind !== 'adjustment' ||
          record.editorFilterOperations === undefined
        ) {
          return
        }
        const operations = await validateAdvancedFilterOperations(
          record.editorFilterOperations,
          `objects[${index}].editorFilterOperations`,
        )
        validatedAdvancedOperations.set(serialized, operations)
      }),
    )
    const restoredNames = new Set<string>()
    const [objectsResult, enlivablesResult] = await Promise.allSettled([
      util.enlivenObjects<FabricObject>(serializedObjects, {
        reviver: (serialized, object, error) => {
          if (error) {
            throw error
          }
          if (!(object instanceof FabricObject)) {
            throw new TypeError('The project contains an invalid layer.')
          }
          const editorObject = object as EditorObject
          const record = serialized as Record<string, unknown>
          // Pixelweave v1 stored left/top as logical top-left coordinates even
          // though Fabric 7 rendered center-origin objects with an offset. Keep
          // those serialized coordinates and repair the origin on restore.
          this.normalizeObjectOrigin(editorObject)
          editorObject.editorId =
            typeof record.editorId === 'string' && record.editorId
              ? record.editorId
              : createEditorId()
          const serializedName =
            typeof record.editorName === 'string'
              ? record.editorName.trim()
              : ''
          editorObject.editorName = this.uniqueLayerName(
            serializedName || this.defaultNameForObject(editorObject),
            restoredNames,
          )
          editorObject.editorLocked = Boolean(record.editorLocked)
          const chartModel = validatedChartModels.get(serialized)
          if (chartModel) {
            editorObject.editorKind = 'chart'
            editorObject.editorChartModel = structuredClone(chartModel)
            editorObject.editorChartPalette = [
              ...(validatedChartPalettes.get(serialized) ?? []),
            ]
            delete editorObject.editorTableModel
          }
          const tableModel = validatedTableModels.get(serialized)
          if (tableModel) {
            editorObject.editorKind = 'table'
            editorObject.editorTableModel = structuredClone(tableModel)
            delete editorObject.editorChartModel
            delete editorObject.editorChartPalette
          }
          if (record.editorKind === 'adjustment') {
            if (!(object instanceof FabricImage)) {
              throw new TypeError(
                'The project contains an invalid adjustment layer.',
              )
            }
            if (record.editorFilterOperations !== undefined) {
              const operations = validatedAdvancedOperations.get(serialized)
              if (!operations) {
                throw new TypeError(
                  'The project contains invalid advanced adjustment filters.',
                )
              }
              editorObject.editorKind = 'adjustment'
              delete editorObject.editorFilterSettings
              editorObject.editorFilterOperations =
                cloneAdvancedFilterOperations(operations)
              object.filters = []
              object.set('globalCompositeOperation', 'copy')
              return
            }
            const serializedSettings =
              record.editorFilterSettings &&
              typeof record.editorFilterSettings === 'object' &&
              !Array.isArray(record.editorFilterSettings)
                ? (record.editorFilterSettings as ImageFilterSettings)
                : {}
            const normalized = normalizeFilterSettings(serializedSettings)
            editorObject.editorKind = 'adjustment'
            editorObject.editorFilterSettings = { ...normalized }
            delete editorObject.editorFilterOperations
            object.filters = createImageFilters(normalized)
            object.applyFilters()
            object.set('globalCompositeOperation', 'copy')
          }
        },
      }),
      util.enlivenObjectEnlivables<RestoredCanvasEnlivables>({
        backgroundImage: snapshot.json.backgroundImage,
        backgroundColor: snapshot.json.background,
        overlayImage: snapshot.json.overlayImage,
        overlayColor: snapshot.json.overlay,
      }),
    ])

    if (
      objectsResult.status === 'rejected' ||
      enlivablesResult.status === 'rejected'
    ) {
      if (objectsResult.status === 'fulfilled') {
        this.disposeObjects(objectsResult.value)
      }
      if (enlivablesResult.status === 'fulfilled') {
        this.disposeCanvasEnlivables(enlivablesResult.value)
      }
      if (objectsResult.status === 'rejected') {
        throw objectsResult.reason
      }
      if (enlivablesResult.status === 'rejected') {
        throw enlivablesResult.reason
      }
    }

    return {
      objects: objectsResult.value,
      enlivables: enlivablesResult.value,
      width: documentDimension(snapshot.width),
      height: documentDimension(snapshot.height),
      editorState: normalizeEditorState(
        snapshot.editorState,
        documentDimension(snapshot.width),
        documentDimension(snapshot.height),
      ),
    }
  }

  private applyPreparedRestore(
    prepared: PreparedEditorRestore,
    options: PreparedRestoreApplicationOptions = {},
  ): void {
    const replacedResources = this.canvasOwnedResources()
    this.eventSuppressionDepth += 1
    const previousRenderOnAddRemove = this.canvas.renderOnAddRemove
    try {
      this.canvas.renderOnAddRemove = false
      options.onApplicationStart?.()
      this.canvas.clear()
      this.canvas.add(...prepared.objects)
      this.canvas.set(prepared.enlivables)
      this.documentWidth = prepared.width
      this.documentHeight = prepared.height
      this.editorState = normalizeEditorState(
        prepared.editorState,
        prepared.width,
        prepared.height,
      )
      this.syncSelectionMask()
      this.setDocumentClip()
      this.canvas.setViewportTransform(
        options.viewportTransform ?? [...iMatrix],
      )
      this.configureObjectInteractivity()
      this.syncGridCellContents()
      if (options.selectedEditorIds?.size) {
        this.activateObjects(
          prepared.objects.filter((object) =>
            options.selectedEditorIds?.has(
              this.requireEditorId(object as EditorObject),
            ),
          ),
        )
      }
      this.canvas.requestRenderAll()
    } finally {
      this.canvas.renderOnAddRemove = previousRenderOnAddRemove
      this.eventSuppressionDepth -= 1
      this.disposeResources(replacedResources, this.canvasOwnedResources())
    }

    this.emitLayers()
    this.emitSelection()
    this.emitZoom()
  }

  private normalizeObjectOrigin(
    object: FabricObject,
    preserveVisualPosition = false,
  ): void {
    if (object.originX === 'left' && object.originY === 'top') {
      return
    }

    if (preserveVisualPosition) {
      const position = object.getPositionByOrigin('left', 'top')
      object.set({
        ...TOP_LEFT_ORIGIN,
        left: position.x,
        top: position.y,
      })
    } else {
      object.set(TOP_LEFT_ORIGIN)
    }
    object.setCoords()
  }

  private replaceClipboard(
    objects: ClipboardObject[],
    primaryCount = objects.length,
  ): void {
    const previous = this.clipboard
    this.clipboard = objects
    this.clipboardPrimaryCount = Math.min(objects.length, primaryCount)
    this.pasteGeneration = 0
    this.disposeObjects(previous)
  }

  private disposePreparedRestore(prepared: PreparedEditorRestore): void {
    this.disposeResources([
      ...prepared.objects,
      ...Object.values(prepared.enlivables),
    ])
  }

  private disposeCanvasEnlivables(enlivables: RestoredCanvasEnlivables): void {
    this.disposeResources(Object.values(enlivables))
  }

  private disposeObjects(objects: FabricObject[]): void {
    this.disposeResources(objects)
  }

  private canvasOwnedResources(): unknown[] {
    return [
      ...this.canvas.getObjects(),
      this.canvas.backgroundImage,
      this.canvas.backgroundColor,
      this.canvas.overlayImage,
      this.canvas.overlayColor,
      this.canvas.clipPath,
    ]
  }

  private disposeResources(
    resources: Iterable<unknown>,
    retainedResources: Iterable<unknown> = [],
  ): void {
    const retained = new Set(retainedResources)
    const disposedInCall = new Set<unknown>()
    for (const resource of resources) {
      const disposable = resource as { dispose?: VoidFunction }
      if (
        !resource ||
        retained.has(resource) ||
        disposedInCall.has(resource) ||
        typeof disposable.dispose !== 'function'
      ) {
        continue
      }
      const identity = resource as object
      if (this.disposedResources.has(identity)) {
        continue
      }
      disposedInCall.add(resource)
      this.disposedResources.add(identity)
      try {
        disposable.dispose()
      } catch {
        // Disposal is best-effort and must not hide the operation's result.
      }
    }
  }

  private mutate(reason: EditorChangeReason, mutation: () => void): void {
    this.assertUsable()
    this.withSuppressedEvents(() => {
      mutation()
      this.syncGridCellContents()
    })
    this.finishMutation(reason)
  }

  private finishMutation(reason: EditorChangeReason): void {
    if (this.transactionDepth > 0) {
      this.transactionChanged = true
      this.canvas.requestRenderAll()
      return
    }
    this.refreshAdjustmentLayers()
    this.canvas.requestRenderAll()
    this.callbacks.onChanged?.(reason)
    this.emitSelection()
    this.emitLayers()
  }

  private withSuppressedEvents<T>(operation: () => T): T {
    this.eventSuppressionDepth += 1
    try {
      return operation()
    } finally {
      this.eventSuppressionDepth -= 1
    }
  }

  private handleDocumentEvent(reason: EditorChangeReason): void {
    if (this.eventSuppressionDepth > 0 || this.disposed) {
      return
    }
    if (this.transactionDepth > 0) {
      this.transactionChanged = true
      this.canvas.requestRenderAll()
      return
    }
    this.refreshAdjustmentLayers()
    this.canvas.requestRenderAll()
    this.callbacks.onChanged?.(reason)
    this.emitSelection()
    this.emitLayers()
  }

  private handleSelectionEvent(): void {
    if (this.eventSuppressionDepth > 0 || this.disposed) {
      return
    }
    this.emitSelection()
    this.emitLayers()
  }

  private emitLayers(): void {
    if (!this.disposed) {
      this.callbacks.onLayersChanged?.(this.getLayers())
    }
  }

  private emitSelection(): void {
    if (!this.disposed) {
      this.callbacks.onSelectionChanged?.(this.getSelectedLayerIds())
    }
  }

  private emitZoom(): void {
    if (!this.disposed) {
      this.callbacks.onZoomChanged?.(this.canvas.getZoom())
    }
  }

  private emitStatus(message: string, kind: EditorStatusKind): void {
    if (!this.disposed) {
      this.callbacks.onStatus?.({ message, kind })
    }
  }

  private layerNames(): Set<string> {
    return new Set(
      this.canvas
        .getObjects()
        .map((object) => (object as EditorObject).editorName)
        .filter((name): name is string => Boolean(name)),
    )
  }

  private uniqueLayerName(baseName: string, names = this.layerNames()): string {
    const normalized = baseName.trim() || 'Layer'
    if (!names.has(normalized)) {
      names.add(normalized)
      return normalized
    }

    let suffix = 2
    while (names.has(`${normalized} ${suffix}`)) {
      suffix += 1
    }
    const uniqueName = `${normalized} ${suffix}`
    names.add(uniqueName)
    return uniqueName
  }

  private defaultNameForObject(object: FabricObject): string {
    if (object instanceof FabricImage) {
      return 'Image'
    }
    if (object instanceof Rect) {
      return 'Rectangle'
    }
    if (object instanceof Ellipse) {
      return 'Ellipse'
    }
    if (object instanceof IText) {
      return 'Text'
    }
    if (object.type === 'path') {
      return object.globalCompositeOperation === 'destination-out'
        ? 'Eraser stroke'
        : 'Brush stroke'
    }
    return 'Layer'
  }

  private layerType(object: FabricObject): string {
    const editorKind = (object as EditorObject).editorKind
    if (editorKind) {
      return editorKind
    }
    if (object instanceof Group) {
      return 'group'
    }
    if (object instanceof FabricImage) {
      return 'image'
    }
    if (object instanceof IText) {
      return 'text'
    }
    if (object instanceof Rect) {
      return 'rectangle'
    }
    if (object instanceof Ellipse) {
      return 'ellipse'
    }
    if (object.type === 'path') {
      return object.globalCompositeOperation === 'destination-out'
        ? 'eraser'
        : 'brush'
    }
    return object.type || 'object'
  }

  private requireEditorId(object: EditorObject): string {
    if (!object.editorId) {
      object.editorId = createEditorId()
    }
    return object.editorId
  }

  private requireEditorName(object: EditorObject): string {
    if (!object.editorName) {
      object.editorName = this.uniqueLayerName(
        this.defaultNameForObject(object),
      )
    }
    return object.editorName
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('FabricEditorEngine has been disposed.')
    }
  }
}
