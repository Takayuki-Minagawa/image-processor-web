import type { ProjectCanvasSize } from './types'

export type MagicResizeAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type MagicResizeScaleMode = 'proportional' | 'stretch' | 'none'

/**
 * Renderer-neutral, top-left-origin layer bounds. Width/height are the visual
 * axis-aligned bounds supplied by the renderer adapter.
 */
export interface MagicResizeLayerLayout {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  fontSize?: number
  strokeWidth?: number
}

export interface MagicResizeLayerResult extends MagicResizeLayerLayout {
  scaleX: number
  scaleY: number
}

export interface MagicResizeOptions {
  anchor?: MagicResizeAnchor
  scaleMode?: MagicResizeScaleMode
  /** Defaults to true, including repair of objects outside the old canvas. */
  keepInside?: boolean
}

export interface MagicResizePlan {
  before: ProjectCanvasSize
  after: ProjectCanvasSize
  anchor: MagicResizeAnchor
  scaleMode: MagicResizeScaleMode
  scaleX: number
  scaleY: number
  layers: MagicResizeLayerResult[]
}

const ANCHOR_FACTORS: Record<MagicResizeAnchor, readonly [number, number]> = {
  'top-left': [0, 0],
  'top-center': [0.5, 0],
  'top-right': [1, 0],
  'center-left': [0, 0.5],
  center: [0.5, 0.5],
  'center-right': [1, 0.5],
  'bottom-left': [0, 1],
  'bottom-center': [0.5, 1],
  'bottom-right': [1, 1],
}

const assertCanvasSize = (value: ProjectCanvasSize, label: string): void => {
  if (
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    throw new RangeError(`${label} dimensions must be positive integers.`)
  }
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const assertLayer = (layer: MagicResizeLayerLayout, ids: Set<string>): void => {
  if (
    typeof layer.id !== 'string' ||
    layer.id.length === 0 ||
    ids.has(layer.id) ||
    !finite(layer.x) ||
    !finite(layer.y) ||
    !finite(layer.width) ||
    !finite(layer.height) ||
    layer.width <= 0 ||
    layer.height <= 0 ||
    (layer.rotation !== undefined && !finite(layer.rotation)) ||
    (layer.fontSize !== undefined &&
      (!finite(layer.fontSize) || layer.fontSize <= 0)) ||
    (layer.strokeWidth !== undefined &&
      (!finite(layer.strokeWidth) || layer.strokeWidth < 0))
  ) {
    throw new TypeError(`Layer layout "${String(layer.id)}" is invalid.`)
  }
  ids.add(layer.id)
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const mappedScale = (
  before: ProjectCanvasSize,
  after: ProjectCanvasSize,
  mode: MagicResizeScaleMode,
): readonly [number, number] => {
  const horizontal = after.width / before.width
  const vertical = after.height / before.height
  if (mode === 'stretch') return [horizontal, vertical]
  if (mode === 'none') return [1, 1]
  const uniform = Math.min(horizontal, vertical)
  return [uniform, uniform]
}

const fitInside = (
  layer: MagicResizeLayerResult,
  after: ProjectCanvasSize,
): MagicResizeLayerResult => {
  const fit = Math.min(
    1,
    after.width / layer.width,
    after.height / layer.height,
  )
  const width = layer.width * fit
  const height = layer.height * fit
  const fontSize =
    layer.fontSize === undefined ? undefined : layer.fontSize * fit
  const strokeWidth =
    layer.strokeWidth === undefined ? undefined : layer.strokeWidth * fit
  return {
    ...layer,
    x: clamp(layer.x, 0, Math.max(0, after.width - width)),
    y: clamp(layer.y, 0, Math.max(0, after.height - height)),
    width,
    height,
    scaleX: layer.scaleX * fit,
    scaleY: layer.scaleY * fit,
    ...(fontSize === undefined ? {} : { fontSize }),
    ...(strokeWidth === undefined ? {} : { strokeWidth }),
  }
}

/**
 * Creates a single-transaction resize plan. The adapter applies each result to
 * its renderer object, then records the plan as one history snapshot.
 */
export const createMagicResizePlan = (
  before: ProjectCanvasSize,
  after: ProjectCanvasSize,
  layers: readonly MagicResizeLayerLayout[],
  options: MagicResizeOptions = {},
): MagicResizePlan => {
  assertCanvasSize(before, 'Source canvas')
  assertCanvasSize(after, 'Target canvas')
  const anchor = options.anchor ?? 'center'
  const scaleMode = options.scaleMode ?? 'proportional'
  const anchorFactors = ANCHOR_FACTORS[anchor]
  if (!anchorFactors) {
    throw new TypeError(`Unknown magic-resize anchor "${String(anchor)}".`)
  }
  if (
    scaleMode !== 'proportional' &&
    scaleMode !== 'stretch' &&
    scaleMode !== 'none'
  ) {
    throw new TypeError(
      `Unknown magic-resize scale mode "${String(scaleMode)}".`,
    )
  }
  const ids = new Set<string>()
  layers.forEach((layer) => assertLayer(layer, ids))

  const [scaleX, scaleY] = mappedScale(before, after, scaleMode)
  const [anchorX, anchorY] = anchorFactors
  const oldAnchorX = before.width * anchorX
  const oldAnchorY = before.height * anchorY
  const newAnchorX = after.width * anchorX
  const newAnchorY = after.height * anchorY
  const fontScale = Math.min(scaleX, scaleY)
  const results = layers.map((layer): MagicResizeLayerResult => {
    const mapped: MagicResizeLayerResult = {
      ...layer,
      x: newAnchorX + (layer.x - oldAnchorX) * scaleX,
      y: newAnchorY + (layer.y - oldAnchorY) * scaleY,
      width: layer.width * scaleX,
      height: layer.height * scaleY,
      scaleX,
      scaleY,
      ...(layer.fontSize === undefined
        ? {}
        : { fontSize: layer.fontSize * fontScale }),
      ...(layer.strokeWidth === undefined
        ? {}
        : { strokeWidth: layer.strokeWidth * fontScale }),
    }
    return options.keepInside === false ? mapped : fitInside(mapped, after)
  })

  return {
    before: { ...before },
    after: { ...after },
    anchor,
    scaleMode,
    scaleX,
    scaleY,
    layers: results,
  }
}
