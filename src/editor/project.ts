import { decodeSelectionMaskFromProject } from '../selection/codec'
import { matchEmbeddedImageDataUrl } from '../lib/imageSafety'
import {
  assertRestorableEditorSnapshot,
  inspectEmbeddedImageDataUrl,
} from './snapshotValidation'
import {
  deriveLayerTreeFromRenderer,
  LayerTreeError,
  reconcileLayerTreeWithRenderer,
} from './layerTree'
import {
  DESIGN_DOCUMENT_SCHEMA_VERSION,
  EDITOR_STATE_PROJECT_SCHEMA_VERSION,
  LEGACY_PROJECT_SCHEMA_VERSION,
  PROJECT_APP_ID,
  PROJECT_SCHEMA_VERSION,
  type EncodedSelectionMask,
  type JsonObject,
  type JsonValue,
  type ProjectCanvasSize,
  type ProjectDocument,
  type ProjectEditorState,
  type ProjectElementAnimation,
  type ProjectGradientStop,
  type ProjectGuide,
  type ProjectLayerTree,
  type ProjectMetadata,
  type ProjectPage,
  type ProjectPageBackground,
  type ProjectPagePhysicalSize,
  type ProjectPageTimeline,
  type ProjectPageTransition,
  type SupportedProjectSchemaVersion,
} from './types'

export type ProjectFormatErrorCode =
  'invalid-json' | 'invalid-schema' | 'unsupported-version' | 'invalid-app'

/**
 * Error raised when a project cannot safely be opened.
 *
 * `code` is stable for UI handling while `message` intentionally includes a
 * human-readable reason and, when applicable, the invalid field path.
 */
export class ProjectFormatError extends Error {
  readonly code: ProjectFormatErrorCode

  constructor(
    code: ProjectFormatErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ProjectFormatError'
    this.code = code
  }
}

export interface CreateSinglePageProjectDocumentInput {
  fabricCanvas: JsonObject
  canvasSize: ProjectCanvasSize
  editorState?: Partial<ProjectEditorState>
  layerTree?: ProjectLayerTree
  background?: ProjectPageBackground
  physicalSize?: ProjectPagePhysicalSize
  timeline?: ProjectPageTimeline
  pageId?: string
  pageName?: string
  metadata?: JsonObject
  updatedAt?: string
}

export interface CreateMultiPageProjectDocumentInput {
  pages: Array<
    Pick<
      ProjectPage,
      'id' | 'name' | 'canvasSize' | 'fabricCanvas' | 'editorState'
    > &
      Partial<
        Pick<
          ProjectPage,
          'layerTree' | 'background' | 'physicalSize' | 'timeline' | 'thumbnail'
        >
      >
  >
  activePageId?: string
  metadata?: JsonObject
  updatedAt?: string
}

export type CreateProjectDocumentInput =
  CreateSinglePageProjectDocumentInput | CreateMultiPageProjectDocumentInput

const DEFAULT_SNAP_TOLERANCE = 8
const MAX_GUIDES = 200
const MAX_SELECTION_MASK_DATA_LENGTH = 128 * 1024 * 1024
export const MAX_PROJECT_PAGES = 100
const MAX_PAGE_NAME_LENGTH = 200
const MAX_THUMBNAIL_LENGTH = 8 * 1024 * 1024
const MAX_TIMELINE_DURATION_MS = 24 * 60 * 60 * 1_000
const MAX_ANIMATIONS_PER_LAYER = 100
const MAX_GRADIENT_STOPS = 32
const MAX_PHYSICAL_PAGE_MILLIMETERS = 10_000
const MAX_JSON_NESTING_DEPTH = 128
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isValidTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  Number.isFinite(Date.parse(value))

const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)

const isFiniteInRange = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })

function invalidSchema(reason: string): never {
  throw new ProjectFormatError(
    'invalid-schema',
    `The project does not match schema version ${PROJECT_SCHEMA_VERSION}: ${reason}`,
  )
}

/**
 * Validates that an unknown value can be serialized as JSON.
 *
 * The recursion stack rejects cycles while still allowing the same object to
 * appear in two independent branches (which JSON.stringify supports).
 */
function assertJsonValue(
  value: unknown,
  path: string,
  stack: WeakSet<object>,
  depth = 0,
): asserts value is JsonValue {
  if (depth > MAX_JSON_NESTING_DEPTH) {
    invalidSchema(`${path} exceeds the maximum JSON nesting depth`)
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      invalidSchema(`${path} must contain only finite numbers`)
    }
    return
  }

  if (typeof value !== 'object') {
    invalidSchema(`${path} contains a non-JSON value`)
  }

  if (stack.has(value)) {
    invalidSchema(`${path} contains a circular reference`)
  }

  stack.add(value)

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertJsonValue(item, `${path}[${index}]`, stack, depth + 1)
    })
  } else {
    Object.entries(value).forEach(([key, item]) => {
      if (UNSAFE_JSON_KEYS.has(key)) {
        invalidSchema(`${path} contains the unsafe key "${key}"`)
      }
      assertJsonValue(item, `${path}.${key}`, stack, depth + 1)
    })
  }

  stack.delete(value)
}

const validateCanvasSize = (
  value: unknown,
  path = 'canvasSize',
): ProjectCanvasSize => {
  if (!isRecord(value)) {
    invalidSchema(`${path} must be an object`)
  }

  const { width, height } = value
  if (!Number.isSafeInteger(width) || (width as number) <= 0) {
    invalidSchema(`${path}.width must be a positive integer`)
  }
  if (!Number.isSafeInteger(height) || (height as number) <= 0) {
    invalidSchema(`${path}.height must be a positive integer`)
  }

  return { width: width as number, height: height as number }
}

const validateMetadata = (value: unknown): ProjectMetadata => {
  if (!isRecord(value)) {
    invalidSchema('metadata must be an object')
  }

  if (typeof value.name !== 'string' || value.name.trim().length === 0) {
    invalidSchema('metadata.name must be a non-empty string')
  }
  if (!isValidTimestamp(value.createdAt)) {
    invalidSchema('metadata.createdAt must be a valid timestamp')
  }
  if (
    value.sourceFileName !== undefined &&
    typeof value.sourceFileName !== 'string'
  ) {
    invalidSchema('metadata.sourceFileName must be a string when present')
  }

  assertJsonValue(value, 'metadata', new WeakSet())
  return value as unknown as ProjectMetadata
}

const validateGuide = (
  value: unknown,
  canvasSize: ProjectCanvasSize,
  index: number,
  path: string,
): ProjectGuide => {
  if (!isRecord(value) || (value.axis !== 'x' && value.axis !== 'y')) {
    invalidSchema(`${path}.guides[${index}] must have axis "x" or "y"`)
  }
  if (
    typeof value.position !== 'number' ||
    !Number.isFinite(value.position) ||
    value.position < 0 ||
    value.position > (value.axis === 'x' ? canvasSize.width : canvasSize.height)
  ) {
    invalidSchema(`${path}.guides[${index}].position must be inside the canvas`)
  }
  return {
    axis: value.axis,
    position: value.position,
  }
}

const validateSelectionMask = (
  value: unknown,
  canvasSize: ProjectCanvasSize,
  path: string,
): EncodedSelectionMask => {
  if (!isRecord(value)) {
    invalidSchema(`${path}.selectionMask must be an object`)
  }
  if (value.width !== canvasSize.width || value.height !== canvasSize.height) {
    invalidSchema(`${path}.selectionMask dimensions must match canvasSize`)
  }
  if (value.encoding !== 'rle-base64') {
    invalidSchema(`${path}.selectionMask.encoding must be "rle-base64"`)
  }
  if (
    typeof value.data !== 'string' ||
    value.data.length === 0 ||
    value.data.length > MAX_SELECTION_MASK_DATA_LENGTH ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
  ) {
    invalidSchema(`${path}.selectionMask.data must be bounded Base64 data`)
  }
  const encoded: EncodedSelectionMask = {
    width: value.width as number,
    height: value.height as number,
    encoding: 'rle-base64',
    data: value.data,
  }
  try {
    decodeSelectionMaskFromProject(encoded)
  } catch {
    invalidSchema(
      `${path}.selectionMask.data must contain a valid bounded mask payload`,
    )
  }
  return encoded
}

const validateEditorState = (
  value: unknown,
  canvasSize: ProjectCanvasSize,
  path = 'editorState',
): ProjectEditorState => {
  if (!isRecord(value)) {
    invalidSchema(`${path} must be an object`)
  }
  if (!Array.isArray(value.guides) || value.guides.length > MAX_GUIDES) {
    invalidSchema(
      `${path}.guides must be an array with at most ${MAX_GUIDES} entries`,
    )
  }
  const guides = value.guides.map((guide, index) =>
    validateGuide(guide, canvasSize, index, path),
  )
  if (!isFiniteInRange(value.snapTolerance, 1, 100)) {
    invalidSchema(`${path}.snapTolerance must be between 1 and 100`)
  }

  assertJsonValue(value, path, new WeakSet())
  return {
    ...(value as JsonObject),
    guides,
    snapTolerance: value.snapTolerance,
    ...(value.selectionMask === undefined
      ? {}
      : {
          selectionMask: validateSelectionMask(
            value.selectionMask,
            canvasSize,
            path,
          ),
        }),
  }
}

const defaultEditorState = (): ProjectEditorState => ({
  guides: [],
  snapTolerance: DEFAULT_SNAP_TOLERANCE,
})

const safeCssColor = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  !containsControlCharacter(value) &&
  (/^#[0-9a-f]{3,8}$/i.test(value) ||
    /^(?:rgb|hsl)a?\([\d\s.,%+/-]+\)$/i.test(value) ||
    /^[a-z]{1,32}$/i.test(value))

const validateGradientStop = (
  value: unknown,
  index: number,
  path: string,
): ProjectGradientStop => {
  if (
    !isRecord(value) ||
    !isFiniteInRange(value.offset, 0, 1) ||
    !safeCssColor(value.color)
  ) {
    invalidSchema(`${path}.stops[${index}] is invalid`)
  }
  return { offset: value.offset, color: value.color }
}

const backgroundFromRenderer = (
  fabricCanvas: JsonObject,
): ProjectPageBackground =>
  safeCssColor(fabricCanvas.background)
    ? { kind: 'color', color: fabricCanvas.background }
    : { kind: 'transparent' }

export const validateProjectPageBackground = (
  value: unknown,
  path = 'background',
): ProjectPageBackground => {
  if (!isRecord(value)) {
    invalidSchema(`${path} must be an object`)
  }
  if (value.kind === 'transparent') return { kind: 'transparent' }
  if (value.kind === 'color') {
    if (!safeCssColor(value.color)) {
      invalidSchema(`${path}.color is invalid`)
    }
    return { kind: 'color', color: value.color }
  }
  if (value.kind === 'gradient') {
    if (value.gradientType !== 'linear' && value.gradientType !== 'radial') {
      invalidSchema(`${path}.gradientType is invalid`)
    }
    if (!isFiniteInRange(value.angle, -360_000, 360_000)) {
      invalidSchema(`${path}.angle must be finite`)
    }
    if (
      !Array.isArray(value.stops) ||
      value.stops.length < 2 ||
      value.stops.length > MAX_GRADIENT_STOPS
    ) {
      invalidSchema(
        `${path}.stops must contain 2 to ${MAX_GRADIENT_STOPS} stops`,
      )
    }
    const stops = value.stops.map((stop, index) =>
      validateGradientStop(stop, index, path),
    )
    if (
      stops.some(
        (stop, index) => index > 0 && stop.offset < stops[index - 1].offset,
      )
    ) {
      invalidSchema(`${path}.stops must be ordered by offset`)
    }
    return {
      kind: 'gradient',
      gradientType: value.gradientType,
      angle: value.angle,
      stops,
    }
  }
  if (value.kind === 'image') {
    if (
      typeof value.source !== 'string' ||
      !matchEmbeddedImageDataUrl(value.source)
    ) {
      invalidSchema(`${path}.source must be an embedded PNG, JPEG, or WebP`)
    }
    try {
      inspectEmbeddedImageDataUrl(value.source)
    } catch (error) {
      invalidSchema(
        `${path}.source is invalid: ${error instanceof Error ? error.message : 'unknown image error'}`,
      )
    }
    if (
      value.fit !== 'cover' &&
      value.fit !== 'contain' &&
      value.fit !== 'fill'
    ) {
      invalidSchema(`${path}.fit is invalid`)
    }
    if (
      !isRecord(value.position) ||
      !isFiniteInRange(value.position.x, 0, 1) ||
      !isFiniteInRange(value.position.y, 0, 1) ||
      !isFiniteInRange(value.opacity, 0, 1)
    ) {
      invalidSchema(`${path}.position or opacity is invalid`)
    }
    return {
      kind: 'image',
      source: value.source,
      fit: value.fit,
      position: { x: value.position.x, y: value.position.y },
      opacity: value.opacity,
    }
  }
  invalidSchema(`${path}.kind is invalid`)
}

const validateAnimation = (
  value: unknown,
  index: number,
  path: string,
): ProjectElementAnimation => {
  if (!isRecord(value) || !isSafeId(value.id)) {
    invalidSchema(`${path}[${index}] requires a valid id`)
  }
  if (
    value.phase !== 'enter' &&
    value.phase !== 'emphasis' &&
    value.phase !== 'exit'
  ) {
    invalidSchema(`${path}[${index}].phase is invalid`)
  }
  if (
    value.effect !== 'fade' &&
    value.effect !== 'slide-left' &&
    value.effect !== 'slide-right' &&
    value.effect !== 'slide-up' &&
    value.effect !== 'slide-down' &&
    value.effect !== 'zoom' &&
    value.effect !== 'wipe-left' &&
    value.effect !== 'wipe-right' &&
    value.effect !== 'pulse'
  ) {
    invalidSchema(`${path}[${index}].effect is invalid`)
  }
  if (!isRecord(value.start)) {
    invalidSchema(`${path}[${index}].start is invalid`)
  }
  if (
    value.start.mode !== 'with-page' &&
    value.start.mode !== 'after-previous'
  ) {
    invalidSchema(`${path}[${index}].start.mode is invalid`)
  }
  const delayMs = value.start.delayMs ?? 0
  if (
    !isFiniteInRange(delayMs, 0, MAX_TIMELINE_DURATION_MS) ||
    !isFiniteInRange(value.durationMs, 1, MAX_TIMELINE_DURATION_MS)
  ) {
    invalidSchema(`${path}[${index}] timing is invalid`)
  }
  if (
    value.easing !== undefined &&
    value.easing !== 'linear' &&
    value.easing !== 'ease-in' &&
    value.easing !== 'ease-out' &&
    value.easing !== 'ease-in-out'
  ) {
    invalidSchema(`${path}[${index}].easing is invalid`)
  }
  if (
    value.distancePx !== undefined &&
    !isFiniteInRange(value.distancePx, 0, 1_000_000)
  ) {
    invalidSchema(`${path}[${index}].distancePx is invalid`)
  }
  return {
    id: value.id,
    phase: value.phase,
    effect: value.effect,
    start: {
      mode: value.start.mode,
      ...(value.start.delayMs === undefined ? {} : { delayMs }),
    },
    durationMs: value.durationMs,
    ...(value.easing === undefined ? {} : { easing: value.easing }),
    ...(value.distancePx === undefined ? {} : { distancePx: value.distancePx }),
  }
}

const validateTransition = (
  value: unknown,
  path: string,
): ProjectPageTransition => {
  if (
    !isRecord(value) ||
    (value.type !== 'none' &&
      value.type !== 'fade' &&
      value.type !== 'slide-left' &&
      value.type !== 'slide-right') ||
    !isFiniteInRange(value.durationMs, 0, 60_000) ||
    (value.type === 'none' ? value.durationMs !== 0 : value.durationMs < 1)
  ) {
    invalidSchema(`${path} is invalid`)
  }
  if (
    value.easing !== undefined &&
    value.easing !== 'linear' &&
    value.easing !== 'ease-in' &&
    value.easing !== 'ease-out' &&
    value.easing !== 'ease-in-out'
  ) {
    invalidSchema(`${path}.easing is invalid`)
  }
  return {
    type: value.type,
    durationMs: value.durationMs,
    ...(value.easing === undefined ? {} : { easing: value.easing }),
  }
}

const validateTimeline = (
  value: unknown,
  layerIds: ReadonlySet<string>,
  path: string,
): ProjectPageTimeline => {
  if (
    !isRecord(value) ||
    !isFiniteInRange(value.durationMs, 1, MAX_TIMELINE_DURATION_MS) ||
    !isRecord(value.elements)
  ) {
    invalidSchema(`${path} is invalid`)
  }
  const durationMs = value.durationMs
  const elements: Record<string, ProjectElementAnimation[]> = {}
  let animationIdCount = 0
  const animationIds = new Set<string>()
  // Runtime preview/export flattens element arrays in insertion order. Keep
  // the same document-wide predecessor here so validation and playback agree.
  let previousEndMs = 0
  Object.entries(value.elements).forEach(([layerId, animations]) => {
    if (!layerIds.has(layerId)) {
      invalidSchema(`${path}.elements references unknown layer "${layerId}"`)
    }
    if (
      !Array.isArray(animations) ||
      animations.length > MAX_ANIMATIONS_PER_LAYER
    ) {
      invalidSchema(
        `${path}.elements.${layerId} must contain at most ${MAX_ANIMATIONS_PER_LAYER} animations`,
      )
    }
    elements[layerId] = animations.map((animation, index) => {
      const result = validateAnimation(
        animation,
        index,
        `${path}.elements.${layerId}`,
      )
      animationIdCount += 1
      if (animationIds.has(result.id)) {
        invalidSchema(`${path} contains duplicate animation id "${result.id}"`)
      }
      animationIds.add(result.id)
      const startMs =
        (result.start.mode === 'after-previous' ? previousEndMs : 0) +
        (result.start.delayMs ?? 0)
      previousEndMs = startMs + result.durationMs
      if (previousEndMs > durationMs) {
        invalidSchema(`${path} contains an animation beyond the page duration`)
      }
      return result
    })
  })
  if (
    animationIdCount >
    MAX_ANIMATIONS_PER_LAYER * Math.max(1, layerIds.size)
  ) {
    invalidSchema(`${path} contains too many animations`)
  }
  return {
    durationMs,
    ...(value.transition === undefined
      ? {}
      : {
          transition: validateTransition(
            value.transition,
            `${path}.transition`,
          ),
        }),
    elements,
  }
}

const validatePhysicalSize = (
  value: unknown,
  canvasSize: ProjectCanvasSize,
  path: string,
): ProjectPagePhysicalSize => {
  if (
    !isRecord(value) ||
    value.unit !== 'mm' ||
    !isFiniteInRange(value.widthMm, 0.01, MAX_PHYSICAL_PAGE_MILLIMETERS) ||
    !isFiniteInRange(value.heightMm, 0.01, MAX_PHYSICAL_PAGE_MILLIMETERS) ||
    !isFiniteInRange(value.sourceDpi, 36, 2_400)
  ) {
    invalidSchema(`${path} is invalid`)
  }
  const expectedWidth = Math.round((value.widthMm / 25.4) * value.sourceDpi)
  const expectedHeight = Math.round((value.heightMm / 25.4) * value.sourceDpi)
  if (
    Math.abs(expectedWidth - canvasSize.width) > 1 ||
    Math.abs(expectedHeight - canvasSize.height) > 1
  ) {
    invalidSchema(`${path} does not match the page canvas size`)
  }
  return {
    unit: 'mm',
    widthMm: value.widthMm,
    heightMm: value.heightMm,
    sourceDpi: value.sourceDpi,
  }
}

const validateThumbnail = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_THUMBNAIL_LENGTH ||
    !matchEmbeddedImageDataUrl(value)
  ) {
    invalidSchema(`${path} must be a bounded embedded image`)
  }
  try {
    inspectEmbeddedImageDataUrl(value)
  } catch (error) {
    invalidSchema(
      `${path} is invalid: ${
        error instanceof Error ? error.message : 'unknown image error'
      }`,
    )
  }
  return value
}

const normalizedLayerTree = (
  value: unknown,
  fabricCanvas: JsonObject,
  path: string,
): { fabricCanvas: JsonObject; layerTree: ProjectLayerTree } => {
  try {
    return value === undefined
      ? deriveLayerTreeFromRenderer(fabricCanvas)
      : reconcileLayerTreeWithRenderer(fabricCanvas, value)
  } catch (error) {
    if (error instanceof LayerTreeError) {
      invalidSchema(`${path} is invalid: ${error.message}`)
    }
    throw error
  }
}

export const validateProjectPage = (value: unknown, index = 0): ProjectPage => {
  const path = `pages[${index}]`
  if (!isRecord(value) || !isSafeId(value.id)) {
    invalidSchema(`${path}.id must be a safe non-empty id`)
  }
  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > MAX_PAGE_NAME_LENGTH ||
    containsControlCharacter(value.name)
  ) {
    invalidSchema(`${path}.name is invalid`)
  }
  const canvasSize = validateCanvasSize(value.canvasSize, `${path}.canvasSize`)
  if (!isRecord(value.fabricCanvas)) {
    invalidSchema(`${path}.fabricCanvas must be a JSON object`)
  }
  assertJsonValue(value.fabricCanvas, `${path}.fabricCanvas`, new WeakSet())
  const editorState = validateEditorState(
    value.editorState,
    canvasSize,
    `${path}.editorState`,
  )
  const treeValue =
    value.layerTree === undefined && isRecord(value.editorState)
      ? value.editorState.layerTree
      : value.layerTree
  const normalizedTree = normalizedLayerTree(
    treeValue,
    value.fabricCanvas as JsonObject,
    `${path}.layerTree`,
  )
  try {
    assertRestorableEditorSnapshot({
      json: normalizedTree.fabricCanvas,
      width: canvasSize.width,
      height: canvasSize.height,
    })
  } catch (error) {
    invalidSchema(
      `${path}.fabricCanvas cannot be restored safely: ${
        error instanceof Error ? error.message : 'unknown renderer error'
      }`,
    )
  }
  const layerIds = new Set<string>()
  const pending = [...normalizedTree.layerTree]
  while (pending.length > 0) {
    const node = pending.pop()!
    layerIds.add(node.id)
    if (node.kind === 'group') pending.push(...node.children)
  }
  const background =
    value.background === undefined
      ? backgroundFromRenderer(normalizedTree.fabricCanvas)
      : validateProjectPageBackground(value.background, `${path}.background`)
  return {
    id: value.id,
    name: value.name.trim(),
    canvasSize,
    fabricCanvas: normalizedTree.fabricCanvas,
    editorState,
    layerTree: normalizedTree.layerTree,
    background,
    ...(value.physicalSize === undefined
      ? {}
      : {
          physicalSize: validatePhysicalSize(
            value.physicalSize,
            canvasSize,
            `${path}.physicalSize`,
          ),
        }),
    ...(value.timeline === undefined
      ? {}
      : {
          timeline: validateTimeline(
            value.timeline,
            layerIds,
            `${path}.timeline`,
          ),
        }),
    ...(value.thumbnail === undefined
      ? {}
      : { thumbnail: validateThumbnail(value.thumbnail, `${path}.thumbnail`) }),
  }
}

const validatePages = (value: unknown): ProjectPage[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_PROJECT_PAGES
  ) {
    invalidSchema(`pages must contain 1 to ${MAX_PROJECT_PAGES} pages`)
  }
  const ids = new Set<string>()
  return value.map((page, index) => {
    const result = validateProjectPage(page, index)
    if (ids.has(result.id)) {
      invalidSchema(`pages contains duplicate page id "${result.id}"`)
    }
    ids.add(result.id)
    return result
  })
}

const pageFromLegacyRoot = (
  value: Record<string, unknown>,
  editorState: ProjectEditorState,
): ProjectPage => {
  const canvasSize = validateCanvasSize(value.canvasSize)
  if (!isRecord(value.fabricCanvas)) {
    invalidSchema('fabricCanvas must be a JSON object')
  }
  assertJsonValue(value.fabricCanvas, 'fabricCanvas', new WeakSet())
  return validateProjectPage(
    {
      id: 'page-1',
      name: 'Page 1',
      canvasSize,
      fabricCanvas: value.fabricCanvas,
      editorState,
      background: backgroundFromRenderer(value.fabricCanvas as JsonObject),
    },
    0,
  )
}

/** Adds the legacy active-canvas view without changing the canonical pages. */
export const withActivePageAliases = (
  project: Omit<ProjectDocument, 'canvasSize' | 'fabricCanvas' | 'editorState'>,
): ProjectDocument => {
  const activePage = project.pages.find(
    (page) => page.id === project.activePageId,
  )
  if (!activePage) {
    invalidSchema('activePageId must reference an existing page')
  }
  return {
    ...project,
    canvasSize: activePage.canvasSize,
    fabricCanvas: activePage.fabricCanvas,
    editorState: activePage.editorState,
  }
}

export const getActiveProjectPage = (project: ProjectDocument): ProjectPage => {
  const page = project.pages.find(({ id }) => id === project.activePageId)
  if (!page) {
    throw new ProjectFormatError(
      'invalid-schema',
      'The active page is missing from the design document.',
    )
  }
  return page
}

const validateCompatibilityAliases = (
  value: Record<string, unknown>,
  fallbackPage: ProjectPage,
): void => {
  if (value.canvasSize !== undefined) {
    validateCanvasSize(value.canvasSize)
  }
  const aliasCanvasSize =
    value.canvasSize === undefined
      ? fallbackPage.canvasSize
      : validateCanvasSize(value.canvasSize)
  if (value.fabricCanvas !== undefined) {
    if (!isRecord(value.fabricCanvas)) {
      invalidSchema('fabricCanvas must be a JSON object')
    }
    assertJsonValue(value.fabricCanvas, 'fabricCanvas', new WeakSet())
  }
  if (value.editorState !== undefined) {
    validateEditorState(value.editorState, aliasCanvasSize)
  }
}

const schemaVersionOf = (
  value: Record<string, unknown>,
): SupportedProjectSchemaVersion => {
  if (
    value.schemaVersion !== LEGACY_PROJECT_SCHEMA_VERSION &&
    value.schemaVersion !== EDITOR_STATE_PROJECT_SCHEMA_VERSION &&
    value.schemaVersion !== DESIGN_DOCUMENT_SCHEMA_VERSION &&
    value.schemaVersion !== PROJECT_SCHEMA_VERSION
  ) {
    const renderedVersion =
      typeof value.schemaVersion === 'number'
        ? String(value.schemaVersion)
        : 'missing or invalid'
    throw new ProjectFormatError(
      'unsupported-version',
      `Project schema version ${renderedVersion} is not supported; this app supports versions ${LEGACY_PROJECT_SCHEMA_VERSION} through ${PROJECT_SCHEMA_VERSION}.`,
    )
  }
  return value.schemaVersion
}

/**
 * Runtime validation and migration for values produced outside this module.
 *
 * v1/v2 single-canvas projects become one-page documents. v3 page documents
 * gain the optional v4 timeline envelope without changing their static output.
 */
export const validateProjectDocument = (value: unknown): ProjectDocument => {
  if (!isRecord(value)) {
    invalidSchema('the root value must be an object')
  }

  if (value.appId !== PROJECT_APP_ID) {
    throw new ProjectFormatError(
      'invalid-app',
      `This file belongs to "${String(value.appId)}", not "${PROJECT_APP_ID}".`,
    )
  }

  const schemaVersion = schemaVersionOf(value)
  const metadata = validateMetadata(value.metadata)
  if (!isValidTimestamp(value.updatedAt)) {
    invalidSchema('updatedAt must be a valid timestamp')
  }

  let pages: ProjectPage[]
  let activePageId: string
  if (
    schemaVersion === LEGACY_PROJECT_SCHEMA_VERSION ||
    schemaVersion === EDITOR_STATE_PROJECT_SCHEMA_VERSION
  ) {
    const canvasSize = validateCanvasSize(value.canvasSize)
    const editorState =
      schemaVersion === LEGACY_PROJECT_SCHEMA_VERSION
        ? defaultEditorState()
        : validateEditorState(value.editorState, canvasSize)
    pages = [pageFromLegacyRoot(value, editorState)]
    activePageId = pages[0].id
  } else {
    pages = validatePages(value.pages)
    if (!isSafeId(value.activePageId)) {
      invalidSchema('activePageId must be a safe page id')
    }
    activePageId = value.activePageId
    const activePage = pages.find((page) => page.id === activePageId)
    if (!activePage) {
      invalidSchema('activePageId must reference an existing page')
    }
    validateCompatibilityAliases(value, activePage)
  }

  return withActivePageAliases({
    appId: PROJECT_APP_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    pages,
    activePageId,
    metadata,
    updatedAt: value.updatedAt,
  })
}

const metadataForCreate = (
  providedMetadata: JsonObject,
  now: string,
): ProjectMetadata => ({
  ...providedMetadata,
  name:
    typeof providedMetadata.name === 'string'
      ? providedMetadata.name
      : 'Untitled project',
  createdAt:
    typeof providedMetadata.createdAt === 'string'
      ? providedMetadata.createdAt
      : now,
})

/** Creates a current project while retaining the historical one-page input. */
export const createProjectDocument = (
  input: CreateProjectDocumentInput,
): ProjectDocument => {
  const now = input.updatedAt ?? new Date().toISOString()
  const metadata = metadataForCreate(input.metadata ?? {}, now)

  if ('pages' in input) {
    return validateProjectDocument({
      appId: PROJECT_APP_ID,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      pages: input.pages,
      activePageId: input.activePageId ?? input.pages[0]?.id,
      metadata,
      updatedAt: now,
    })
  }

  const editorState: ProjectEditorState = {
    ...defaultEditorState(),
    ...input.editorState,
  }
  return validateProjectDocument({
    appId: PROJECT_APP_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    pages: [
      {
        id: input.pageId ?? 'page-1',
        name: input.pageName ?? 'Page 1',
        canvasSize: input.canvasSize,
        fabricCanvas: input.fabricCanvas,
        editorState,
        ...(input.layerTree === undefined
          ? {}
          : { layerTree: input.layerTree }),
        ...(input.background === undefined
          ? {}
          : { background: input.background }),
        ...(input.physicalSize === undefined
          ? {}
          : { physicalSize: input.physicalSize }),
        ...(input.timeline === undefined ? {} : { timeline: input.timeline }),
      },
    ],
    activePageId: input.pageId ?? 'page-1',
    metadata,
    updatedAt: now,
  })
}

/**
 * Serializes only canonical validated fields. Runtime active-page aliases are
 * deliberately excluded so a 4K page payload is never written twice.
 */
export const serializeProject = (
  project: ProjectDocument,
  space: number | string = 2,
): string => {
  const validated = validateProjectDocument(project)
  return JSON.stringify(
    {
      appId: validated.appId,
      schemaVersion: validated.schemaVersion,
      pages: validated.pages,
      activePageId: validated.activePageId,
      metadata: validated.metadata,
      updatedAt: validated.updatedAt,
    },
    null,
    space,
  )
}

/** Parses, validates, and migrates an untrusted project file. */
export const parseProject = (source: string): ProjectDocument => {
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch (error) {
    throw new ProjectFormatError(
      'invalid-json',
      'The project file is not valid JSON.',
      { cause: error },
    )
  }

  return validateProjectDocument(parsed)
}
