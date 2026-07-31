import { MAX_EDITOR_SCRIPT_SOURCE_LENGTH, parseEditorScript } from './parser'
import type { EditorScriptProgram } from './types'

export const EDITOR_SCRIPT_APP_ID = 'image-processor-web' as const
export const EDITOR_SCRIPT_SCHEMA_VERSION = 1 as const
export const MAX_SAVED_SCRIPT_SOURCE_LENGTH = MAX_EDITOR_SCRIPT_SOURCE_LENGTH
export const MAX_SAVED_SCRIPT_DOCUMENT_LENGTH = 512 * 1024

export interface SavedEditorScript {
  appId: typeof EDITOR_SCRIPT_APP_ID
  schemaVersion: typeof EDITOR_SCRIPT_SCHEMA_VERSION
  appVersion: string
  id: string
  name: string
  source: string
  createdAt: string
  updatedAt: string
}

export interface SavedEditorScriptEntry {
  script: SavedEditorScript
  program: EditorScriptProgram
}

export type SavedEditorScriptErrorCode =
  | 'invalid-json'
  | 'invalid-root'
  | 'invalid-app'
  | 'unsupported-version'
  | 'source-too-large'
  | 'invalid-script'

export class SavedEditorScriptError extends Error {
  readonly code: SavedEditorScriptErrorCode

  constructor(
    code: SavedEditorScriptErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SavedEditorScriptError'
    this.code = code
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 64 &&
  Number.isFinite(Date.parse(value))

const validIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,63}$/i.test(value)

const validShortText = (value: unknown, maximum = 128): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= maximum

const hasExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => {
  const keys = new Set(allowed)
  return (
    Object.keys(value).length === allowed.length &&
    Object.keys(value).every((key) => keys.has(key))
  )
}

const parseScriptSource = (source: string): EditorScriptProgram => {
  try {
    return parseEditorScript(source, {
      maximumSourceLength: MAX_SAVED_SCRIPT_SOURCE_LENGTH,
    })
  } catch (error) {
    throw new SavedEditorScriptError(
      'invalid-script',
      'The saved script does not contain a valid editor DSL program.',
      error,
    )
  }
}

export const validateSavedEditorScript = (
  value: unknown,
): SavedEditorScriptEntry => {
  if (!isRecord(value)) {
    throw new SavedEditorScriptError(
      'invalid-root',
      'The saved script root must be an object.',
    )
  }
  if (value.appId !== EDITOR_SCRIPT_APP_ID) {
    throw new SavedEditorScriptError(
      'invalid-app',
      `This script belongs to "${String(value.appId)}", not "${EDITOR_SCRIPT_APP_ID}".`,
    )
  }
  if (value.schemaVersion !== EDITOR_SCRIPT_SCHEMA_VERSION) {
    throw new SavedEditorScriptError(
      'unsupported-version',
      `Script schema version ${String(value.schemaVersion)} is not supported.`,
    )
  }
  if (
    !hasExactKeys(value, [
      'appId',
      'schemaVersion',
      'appVersion',
      'id',
      'name',
      'source',
      'createdAt',
      'updatedAt',
    ]) ||
    !validShortText(value.appVersion, 64) ||
    !validIdentifier(value.id) ||
    !validShortText(value.name) ||
    typeof value.source !== 'string' ||
    value.source.trim().length === 0 ||
    value.source.length > MAX_SAVED_SCRIPT_SOURCE_LENGTH ||
    !validTimestamp(value.createdAt) ||
    !validTimestamp(value.updatedAt)
  ) {
    throw new SavedEditorScriptError(
      'invalid-root',
      'The saved script metadata or source is invalid.',
    )
  }

  const script: SavedEditorScript = {
    appId: EDITOR_SCRIPT_APP_ID,
    schemaVersion: EDITOR_SCRIPT_SCHEMA_VERSION,
    appVersion: value.appVersion.trim(),
    id: value.id,
    name: value.name.trim(),
    source: value.source,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
  return {
    script,
    program: parseScriptSource(script.source),
  }
}

export const parseSavedEditorScript = (
  source: string,
): SavedEditorScriptEntry => {
  if (
    typeof source !== 'string' ||
    source.length > MAX_SAVED_SCRIPT_DOCUMENT_LENGTH
  ) {
    throw new SavedEditorScriptError(
      'source-too-large',
      `Saved script files must not exceed ${MAX_SAVED_SCRIPT_DOCUMENT_LENGTH} characters.`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch (error) {
    throw new SavedEditorScriptError(
      'invalid-json',
      'The saved script file is not valid JSON.',
      error,
    )
  }
  return validateSavedEditorScript(parsed)
}

export const serializeSavedEditorScript = (
  value: SavedEditorScript,
  space: number | string = 2,
): string =>
  JSON.stringify(validateSavedEditorScript(value).script, null, space)

export interface CreateSavedEditorScriptInput {
  appVersion: string
  id: string
  name: string
  source: string
  createdAt?: string
  updatedAt?: string
}

export const createSavedEditorScript = (
  input: CreateSavedEditorScriptInput,
): SavedEditorScript => {
  const now = input.updatedAt ?? new Date().toISOString()
  return validateSavedEditorScript({
    appId: EDITOR_SCRIPT_APP_ID,
    schemaVersion: EDITOR_SCRIPT_SCHEMA_VERSION,
    appVersion: input.appVersion,
    id: input.id,
    name: input.name,
    source: input.source,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  }).script
}
