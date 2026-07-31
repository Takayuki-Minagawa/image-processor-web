import {
  LEGACY_PROJECT_SCHEMA_VERSION,
  PROJECT_APP_ID,
  PROJECT_SCHEMA_VERSION,
  type EncodedSelectionMask,
  type JsonObject,
  type JsonValue,
  type ProjectCanvasSize,
  type ProjectDocument,
  type ProjectEditorState,
  type ProjectGuide,
  type ProjectMetadata,
} from './types'
import { decodeSelectionMaskFromProject } from '../selection/codec'

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

export interface CreateProjectDocumentInput {
  fabricCanvas: JsonObject
  canvasSize: ProjectCanvasSize
  editorState?: Partial<ProjectEditorState>
  metadata?: JsonObject
  updatedAt?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isValidTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  Number.isFinite(Date.parse(value))

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
): asserts value is JsonValue {
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
      assertJsonValue(item, `${path}[${index}]`, stack)
    })
  } else {
    Object.entries(value).forEach(([key, item]) => {
      assertJsonValue(item, `${path}.${key}`, stack)
    })
  }

  stack.delete(value)
}

const validateCanvasSize = (value: unknown): ProjectCanvasSize => {
  if (!isRecord(value)) {
    invalidSchema('canvasSize must be an object')
  }

  const { width, height } = value
  if (!Number.isSafeInteger(width) || (width as number) <= 0) {
    invalidSchema('canvasSize.width must be a positive integer')
  }
  if (!Number.isSafeInteger(height) || (height as number) <= 0) {
    invalidSchema('canvasSize.height must be a positive integer')
  }

  return value as unknown as ProjectCanvasSize
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

const DEFAULT_SNAP_TOLERANCE = 8
const MAX_GUIDES = 200
const MAX_SELECTION_MASK_DATA_LENGTH = 128 * 1024 * 1024

const validateGuide = (
  value: unknown,
  canvasSize: ProjectCanvasSize,
  index: number,
): ProjectGuide => {
  if (!isRecord(value) || (value.axis !== 'x' && value.axis !== 'y')) {
    invalidSchema(`editorState.guides[${index}] must have axis "x" or "y"`)
  }
  if (
    typeof value.position !== 'number' ||
    !Number.isFinite(value.position) ||
    value.position < 0 ||
    value.position > (value.axis === 'x' ? canvasSize.width : canvasSize.height)
  ) {
    invalidSchema(
      `editorState.guides[${index}].position must be inside the canvas`,
    )
  }
  return {
    axis: value.axis,
    position: value.position,
  }
}

const validateSelectionMask = (
  value: unknown,
  canvasSize: ProjectCanvasSize,
): EncodedSelectionMask => {
  if (!isRecord(value)) {
    invalidSchema('editorState.selectionMask must be an object')
  }
  if (value.width !== canvasSize.width || value.height !== canvasSize.height) {
    invalidSchema('editorState.selectionMask dimensions must match canvasSize')
  }
  if (value.encoding !== 'rle-base64') {
    invalidSchema('editorState.selectionMask.encoding must be "rle-base64"')
  }
  if (
    typeof value.data !== 'string' ||
    value.data.length === 0 ||
    value.data.length > MAX_SELECTION_MASK_DATA_LENGTH ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
  ) {
    invalidSchema('editorState.selectionMask.data must be bounded Base64 data')
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
      'editorState.selectionMask.data must contain a valid bounded mask payload',
    )
  }
  return encoded
}

const validateEditorState = (
  value: unknown,
  canvasSize: ProjectCanvasSize,
): ProjectEditorState => {
  if (!isRecord(value)) {
    invalidSchema('editorState must be an object')
  }
  if (!Array.isArray(value.guides) || value.guides.length > MAX_GUIDES) {
    invalidSchema(
      `editorState.guides must be an array with at most ${MAX_GUIDES} entries`,
    )
  }
  const guides = value.guides.map((guide, index) =>
    validateGuide(guide, canvasSize, index),
  )
  if (
    typeof value.snapTolerance !== 'number' ||
    !Number.isFinite(value.snapTolerance) ||
    value.snapTolerance < 1 ||
    value.snapTolerance > 100
  ) {
    invalidSchema('editorState.snapTolerance must be between 1 and 100')
  }

  assertJsonValue(value, 'editorState', new WeakSet())
  return {
    ...(value as JsonObject),
    guides,
    snapTolerance: value.snapTolerance,
    ...(value.selectionMask === undefined
      ? {}
      : {
          selectionMask: validateSelectionMask(value.selectionMask, canvasSize),
        }),
  }
}

const defaultEditorState = (): ProjectEditorState => ({
  guides: [],
  snapTolerance: DEFAULT_SNAP_TOLERANCE,
})

/**
 * Runtime validation for values produced outside this module.
 *
 * The application and version checks run before the remaining schema checks so
 * callers receive an actionable migration/compatibility error.
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

  if (
    value.schemaVersion !== PROJECT_SCHEMA_VERSION &&
    value.schemaVersion !== LEGACY_PROJECT_SCHEMA_VERSION
  ) {
    const renderedVersion =
      typeof value.schemaVersion === 'number'
        ? String(value.schemaVersion)
        : 'missing or invalid'
    throw new ProjectFormatError(
      'unsupported-version',
      `Project schema version ${renderedVersion} is not supported; this app supports versions ${LEGACY_PROJECT_SCHEMA_VERSION} and ${PROJECT_SCHEMA_VERSION}.`,
    )
  }

  const canvasSize = validateCanvasSize(value.canvasSize)

  if (!isRecord(value.fabricCanvas)) {
    invalidSchema('fabricCanvas must be a JSON object')
  }
  assertJsonValue(value.fabricCanvas, 'fabricCanvas', new WeakSet())

  const editorState =
    value.schemaVersion === LEGACY_PROJECT_SCHEMA_VERSION
      ? defaultEditorState()
      : validateEditorState(value.editorState, canvasSize)
  const metadata = validateMetadata(value.metadata)

  if (!isValidTimestamp(value.updatedAt)) {
    invalidSchema('updatedAt must be a valid timestamp')
  }

  return {
    appId: PROJECT_APP_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    canvasSize,
    fabricCanvas: value.fabricCanvas as JsonObject,
    editorState,
    metadata,
    updatedAt: value.updatedAt,
  }
}

/**
 * Creates a valid version-1 project envelope around Fabric canvas JSON.
 */
export const createProjectDocument = (
  input: CreateProjectDocumentInput,
): ProjectDocument => {
  const now = input.updatedAt ?? new Date().toISOString()
  const providedMetadata = input.metadata ?? {}
  const metadata: ProjectMetadata = {
    ...providedMetadata,
    name:
      typeof providedMetadata.name === 'string'
        ? providedMetadata.name
        : 'Untitled project',
    createdAt:
      typeof providedMetadata.createdAt === 'string'
        ? providedMetadata.createdAt
        : now,
  }

  return validateProjectDocument({
    appId: PROJECT_APP_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    canvasSize: input.canvasSize,
    fabricCanvas: input.fabricCanvas,
    editorState: {
      ...defaultEditorState(),
      ...input.editorState,
    },
    metadata,
    updatedAt: now,
  })
}

/**
 * Serializes only validated project documents.
 */
export const serializeProject = (
  project: ProjectDocument,
  space: number | string = 2,
): string => JSON.stringify(validateProjectDocument(project), null, space)

/**
 * Parses and validates an untrusted project file.
 */
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
