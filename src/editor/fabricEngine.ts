import {
  ActiveSelection,
  Canvas,
  classRegistry,
  Ellipse,
  FabricImage,
  FabricObject,
  Gradient,
  IText,
  Path,
  PencilBrush,
  Point,
  Rect,
  Shadow,
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
import { SelectionMask, type SelectionMaskBounds } from '../selection/mask'
import { createSelectionMaskClip } from '../selection/fabricMaskClip'
import {
  decodeSelectionMaskFromProject,
  encodeSelectionMaskForProject,
} from '../selection/codec'
import { type FilterOperation, type PixelBuffer } from './filters/types'
import type {
  EncodedSelectionMask,
  ProjectEditorState,
  ProjectGuide,
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

export type ExportImageFormat = 'png' | 'jpeg' | 'webp'

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
}

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

type EditorObject = FabricObject & {
  editorId?: string
  editorName?: string
  editorLocked?: boolean
  editorKind?: 'svg' | 'adjustment' | 'logo' | 'pixel-delete'
  editorFilterSettings?: Record<string, unknown>
  editorFilterOperations?: FilterOperation[]
  editorTemplateId?: string
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

const SERIALIZED_EDITOR_PROPERTIES = [
  'editorId',
  'editorName',
  'editorLocked',
  'editorKind',
  'editorFilterSettings',
  'editorFilterOperations',
  'editorTemplateId',
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
  private disposed = false
  private isPanning = false
  private lastPanPoint: Point | null = null
  private clipboard: ClipboardObject[] = []
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
    this.assertUsable()
    if (this.transactionDepth > 0) {
      return operation()
    }
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

  public async exportSvg(
    scope: 'document' | 'selection' = 'document',
  ): Promise<string> {
    await this.waitForAdjustmentLayers()
    if (scope === 'document') {
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

  public addText(text = 'Text', options: AddTextOptions = {}): string {
    this.assertUsable()
    const value = text.length > 0 ? text : 'Text'
    const textObject = new IText(value, {
      ...TOP_LEFT_ORIGIN,
      left: finiteOr(options.left, this.documentWidth / 2 - 80),
      top: finiteOr(options.top, this.documentHeight / 2 - 24),
      fill: options.fill ?? '#111827',
      fontFamily: options.fontFamily ?? 'system-ui, sans-serif',
      fontSize: clamp(finiteOr(options.fontSize, 48), 6, 512),
      fontWeight: options.fontWeight ?? 600,
    }) as EditorObject
    this.initializeEditorObject(
      textObject,
      this.uniqueLayerName(options.name?.trim() || 'Text'),
    )
    this.addAndSelect(textObject)
    return this.requireEditorId(textObject)
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

    this.mutate('object-removed', () => {
      this.canvas.discardActiveObject()
      this.canvas.remove(...selected)
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

    const clones = await this.cloneObjects(source)
    try {
      this.assertUsable()
      const reservedNames = this.layerNames()
      clones.forEach((clone) => {
        this.preparePastedObject(clone, offset, reservedNames)
      })

      this.mutate('duplicate', () => {
        this.canvas.discardActiveObject()
        this.canvas.add(...clones)
        this.activateObjects(clones)
      })
      return clones.map((clone) => this.requireEditorId(clone))
    } catch (error) {
      this.disposeResources(clones, this.canvas.getObjects())
      throw error
    }
  }

  public getLayers(): LayerInfo[] {
    const selectedIds = new Set(this.getSelectedLayerIds())
    return [...this.canvas.getObjects()].reverse().map((object) => {
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
    const trimmed = name.trim()
    if (!target || !trimmed) {
      return false
    }
    this.mutate('layer', () => {
      target.editorName = trimmed
    })
    return true
  }

  public setLayerVisible(id: string, visible: boolean): boolean {
    const target = this.findLayer(id)
    if (!target) {
      return false
    }
    this.mutate('layer', () => {
      target.set('visible', visible)
      if (!visible && this.canvas.getActiveObjects().includes(target)) {
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
    this.mutate('layer', () => {
      target.editorLocked = locked
      this.configureSingleObjectInteractivity(target)
      if (locked && this.canvas.getActiveObjects().includes(target)) {
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
    this.mutate('layer-opacity', () => {
      target.set('opacity', clamp(opacity, 0, 1))
    })
    return true
  }

  public setLayerBlend(id: string, blend: GlobalCompositeOperation): boolean {
    const target = this.findLayer(id)
    if (!target) {
      return false
    }
    this.mutate('layer', () => {
      target.set('globalCompositeOperation', blend)
    })
    return true
  }

  /**
   * Moves a layer to a zero-based index in the order returned by getLayers
   * (index 0 is the visually topmost/front layer).
   */
  public moveLayer(id: string, index: number): boolean {
    const target = this.findLayer(id)
    const objects = this.canvas.getObjects()
    if (!target || !Number.isFinite(index) || objects.length < 2) {
      return false
    }
    const uiIndex = clamp(Math.round(index), 0, objects.length - 1)
    const canvasIndex = objects.length - 1 - uiIndex
    this.mutate('layer', () => {
      this.canvas.moveObjectTo(target, canvasIndex)
    })
    return true
  }

  public moveLayerForward(id: string): boolean {
    return this.moveLayerWith(id, (object) =>
      this.canvas.bringObjectForward(object),
    )
  }

  public moveLayerBackward(id: string): boolean {
    return this.moveLayerWith(id, (object) =>
      this.canvas.sendObjectBackwards(object),
    )
  }

  public moveLayerToFront(id: string): boolean {
    return this.moveLayerWith(id, (object) =>
      this.canvas.bringObjectToFront(object),
    )
  }

  public moveLayerToBack(id: string): boolean {
    return this.moveLayerWith(id, (object) =>
      this.canvas.sendObjectToBack(object),
    )
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
  ): Promise<string> {
    await this.waitForAdjustmentLayers()
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
        multiplier: clamp(finiteOr(multiplier, 1), 0.1, 8),
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
    const clones = await this.cloneObjects(selected)
    if (this.disposed) {
      this.disposeObjects(clones)
      this.assertUsable()
    }
    this.replaceClipboard(clones)
    this.emitStatus('選択範囲をコピーしました。', 'info')
    return true
  }

  public async cutSelection(): Promise<boolean> {
    this.assertUsable()
    const selected = [...this.canvas.getActiveObjects()]
    if (selected.length === 0) {
      return false
    }

    const clones = await this.cloneObjects(selected)
    if (this.disposed) {
      this.disposeObjects(clones)
      this.assertUsable()
    }
    const selectedSet = new Set(selected)
    const objectsOnCanvas = new Set(this.canvas.getObjects())
    const objectsToRemove = selected.filter((object) =>
      objectsOnCanvas.has(object),
    )
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
        this.canvas.remove(...objectsToRemove)
      })
    } catch (error) {
      this.disposeObjects(clones)
      throw error
    }
    this.replaceClipboard(clones)
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
      clones.forEach((clone) => {
        this.preparePastedObject(clone, appliedOffset, reservedNames)
      })

      this.mutate('paste', () => {
        this.canvas.discardActiveObject()
        this.canvas.add(...clones)
        this.activateObjects(clones)
      })
      return clones.map((clone) => this.requireEditorId(clone))
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

  private findLayer(id: string): EditorObject | undefined {
    for (const object of this.canvas.getObjects()) {
      const editorObject = this.normalizeEditorObject(object)
      if (editorObject.editorId === id) {
        return editorObject
      }
    }
    return undefined
  }

  private moveLayerWith(
    id: string,
    move: (object: FabricObject) => boolean,
  ): boolean {
    const target = this.findLayer(id)
    if (!target) {
      return false
    }
    let moved = false
    this.withSuppressedEvents(() => {
      moved = move(target)
    })
    if (!moved) {
      return false
    }
    this.finishMutation('layer')
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

  private preparePastedObject(
    object: ClipboardObject,
    offset: number,
    reservedNames = this.layerNames(),
  ): void {
    const originalName = this.requireEditorName(object)
    object.editorId = createEditorId()
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

  private replaceClipboard(objects: ClipboardObject[]): void {
    const previous = this.clipboard
    this.clipboard = objects
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
    this.withSuppressedEvents(mutation)
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
