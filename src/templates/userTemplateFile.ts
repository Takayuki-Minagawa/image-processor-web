import { serializeProject, validateProjectDocument } from '../editor/project'
import { PROJECT_APP_ID, type ProjectDocument } from '../editor/types'
import { MAX_PROJECT_BYTES } from '../lib/fileCore'

export const USER_TEMPLATE_APP_ID = PROJECT_APP_ID
export const USER_TEMPLATE_FILE_KIND = 'pixelweave-user-template' as const
export const USER_TEMPLATE_FILE_SCHEMA_VERSION = 1 as const
export const USER_TEMPLATE_FILE_EXTENSION = '.pwxtemplate.json' as const
export const MAX_USER_TEMPLATE_FILE_BYTES = MAX_PROJECT_BYTES

export type UserTemplateFileErrorCode =
  | 'invalid-json'
  | 'source-too-large'
  | 'invalid-envelope'
  | 'invalid-app'
  | 'unsupported-version'
  | 'invalid-project'

export class UserTemplateFileError extends Error {
  readonly code: UserTemplateFileErrorCode

  constructor(
    code: UserTemplateFileErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'UserTemplateFileError'
    this.code = code
  }
}

/** Canonical on-disk project fields; runtime active-page aliases are omitted. */
export type UserTemplateProjectPayload = Pick<
  ProjectDocument,
  | 'appId'
  | 'schemaVersion'
  | 'pages'
  | 'activePageId'
  | 'metadata'
  | 'updatedAt'
>

export interface UserTemplateFileEnvelope {
  appId: typeof USER_TEMPLATE_APP_ID
  kind: typeof USER_TEMPLATE_FILE_KIND
  schemaVersion: typeof USER_TEMPLATE_FILE_SCHEMA_VERSION
  project: UserTemplateProjectPayload
}

const ENVELOPE_KEYS = new Set(['appId', 'kind', 'schemaVersion', 'project'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const byteLength = (source: string): number =>
  new TextEncoder().encode(source).byteLength

const assertBoundedSource = (source: string): void => {
  if (
    source.length > MAX_USER_TEMPLATE_FILE_BYTES ||
    byteLength(source) > MAX_USER_TEMPLATE_FILE_BYTES
  ) {
    throw new UserTemplateFileError(
      'source-too-large',
      `User template files may contain at most ${MAX_USER_TEMPLATE_FILE_BYTES} bytes.`,
    )
  }
}

const invalidEnvelope = (message: string): never => {
  throw new UserTemplateFileError(
    'invalid-envelope',
    `The user template envelope is invalid: ${message}`,
  )
}

const parseEnvelope = (value: unknown): UserTemplateFileEnvelope => {
  if (!isRecord(value)) {
    invalidEnvelope('the root value must be an object.')
  }
  const envelope = value as Record<string, unknown>
  if (envelope.appId !== USER_TEMPLATE_APP_ID) {
    throw new UserTemplateFileError(
      'invalid-app',
      `This file belongs to "${String(envelope.appId)}", not "${USER_TEMPLATE_APP_ID}".`,
    )
  }
  if (envelope.schemaVersion !== USER_TEMPLATE_FILE_SCHEMA_VERSION) {
    throw new UserTemplateFileError(
      'unsupported-version',
      `User template envelope version ${String(envelope.schemaVersion)} is unsupported.`,
    )
  }
  if (envelope.kind !== USER_TEMPLATE_FILE_KIND) {
    invalidEnvelope(`kind must be "${USER_TEMPLATE_FILE_KIND}".`)
  }
  const keys = Object.keys(envelope)
  if (
    keys.length !== ENVELOPE_KEYS.size ||
    keys.some((key) => !ENVELOPE_KEYS.has(key))
  ) {
    invalidEnvelope('it contains missing or unknown fields.')
  }
  if (!isRecord(envelope.project)) {
    invalidEnvelope('project must be an object.')
  }
  return envelope as unknown as UserTemplateFileEnvelope
}

const canonicalProjectPayload = (
  project: ProjectDocument,
): UserTemplateProjectPayload => {
  try {
    return JSON.parse(
      serializeProject(project, 0),
    ) as UserTemplateProjectPayload
  } catch (cause) {
    throw new UserTemplateFileError(
      'invalid-project',
      'The project cannot be serialized as a user template.',
      { cause },
    )
  }
}

/** Creates a first-class envelope rather than disguising a project file. */
export const createUserTemplateFileEnvelope = (
  project: ProjectDocument,
): UserTemplateFileEnvelope => ({
  appId: USER_TEMPLATE_APP_ID,
  kind: USER_TEMPLATE_FILE_KIND,
  schemaVersion: USER_TEMPLATE_FILE_SCHEMA_VERSION,
  project: canonicalProjectPayload(project),
})

/** Serializes an exact-fidelity project payload inside the user-template envelope. */
export const serializeUserTemplateFile = (
  project: ProjectDocument,
  space: number | string = 2,
): string => {
  const source = JSON.stringify(
    createUserTemplateFileEnvelope(project),
    null,
    space,
  )
  assertBoundedSource(source)
  return source
}

/**
 * Parses an untrusted user-template file. Nested project validation also runs
 * all supported v1-v4 project migrations and always returns schema v4.
 */
export const parseUserTemplateFile = (source: string): ProjectDocument => {
  assertBoundedSource(source)
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch (cause) {
    throw new UserTemplateFileError(
      'invalid-json',
      'The user template file is not valid JSON.',
      { cause },
    )
  }
  const envelope = parseEnvelope(value)
  try {
    return validateProjectDocument(envelope.project)
  } catch (cause) {
    throw new UserTemplateFileError(
      'invalid-project',
      `The nested project is invalid${
        cause instanceof Error ? `: ${cause.message}` : '.'
      }`,
      { cause },
    )
  }
}

/** Concise aliases for integration points that already imply a file codec. */
export const serializeUserTemplate = serializeUserTemplateFile
export const parseUserTemplate = parseUserTemplateFile
