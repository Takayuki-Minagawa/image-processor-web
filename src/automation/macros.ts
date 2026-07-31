import {
  MAX_AUTOMATION_COMMANDS,
  MAX_COMMAND_STRING_LENGTH,
  type AutomationCommand,
  type AutomationScalar,
  type CommandDiagnostic,
  type ParameterReference,
  type ResolvedAutomationCommand,
  isParameterReference,
  validateAutomationCommand,
} from './commands'

export const MACRO_APP_ID = 'image-processor-web' as const
export const MACRO_SCHEMA_VERSION = 1 as const
export const MAX_MACRO_SOURCE_LENGTH = 1_000_000
export const MAX_MACRO_PARAMETERS = 100

export type MacroParameterType = 'string' | 'number' | 'boolean' | 'color'

export interface MacroParameterDefinition {
  name: string
  label: string
  type: MacroParameterType
  required?: boolean
  default?: AutomationScalar
  minimum?: number
  maximum?: number
  choices?: AutomationScalar[]
}

export interface MacroDocument {
  appId: typeof MACRO_APP_ID
  schemaVersion: typeof MACRO_SCHEMA_VERSION
  appVersion: string
  id: string
  name: string
  createdAt: string
  updatedAt: string
  parameters: MacroParameterDefinition[]
  commands: AutomationCommand[]
}

export interface MacroParseResult {
  macro: MacroDocument
  diagnostics: CommandDiagnostic[]
}

export class MacroFormatError extends Error {
  readonly code:
    | 'invalid-json'
    | 'invalid-root'
    | 'invalid-app'
    | 'unsupported-version'
    | 'source-too-large'

  constructor(
    code: MacroFormatError['code'],
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'MacroFormatError'
    this.code = code
  }
}

export class MacroParameterError extends Error {
  readonly parameterName?: string

  constructor(message: string, parameterName?: string) {
    super(message)
    this.name = 'MacroParameterError'
    this.parameterName = parameterName
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

const scalarMatchesType = (
  value: unknown,
  type: MacroParameterType,
): value is AutomationScalar => {
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'color':
      return (
        typeof value === 'string' &&
        (/^#[0-9a-f]{3,8}$/i.test(value) ||
          /^(?:transparent|black|white)$/i.test(value) ||
          /^rgba?\([\d\s.,%+-]+\)$/i.test(value))
      )
    case 'string':
      return (
        typeof value === 'string' && value.length <= MAX_COMMAND_STRING_LENGTH
      )
  }
}

const validateParameter = (value: unknown): MacroParameterDefinition | null => {
  if (
    !isRecord(value) ||
    !validIdentifier(value.name) ||
    !validShortText(value.label) ||
    (value.type !== 'string' &&
      value.type !== 'number' &&
      value.type !== 'boolean' &&
      value.type !== 'color') ||
    (value.required !== undefined && typeof value.required !== 'boolean') ||
    (value.minimum !== undefined &&
      (typeof value.minimum !== 'number' || !Number.isFinite(value.minimum))) ||
    (value.maximum !== undefined &&
      (typeof value.maximum !== 'number' || !Number.isFinite(value.maximum)))
  ) {
    return null
  }
  const parameterType = value.type as MacroParameterType
  if (
    value.minimum !== undefined &&
    value.maximum !== undefined &&
    value.minimum > value.maximum
  ) {
    return null
  }
  if (
    value.default !== undefined &&
    !scalarMatchesType(value.default, parameterType)
  ) {
    return null
  }
  if (
    value.choices !== undefined &&
    (!Array.isArray(value.choices) ||
      value.choices.length > 100 ||
      value.choices.some((choice) => !scalarMatchesType(choice, parameterType)))
  ) {
    return null
  }
  return {
    name: value.name,
    label: value.label.trim(),
    type: parameterType,
    ...(value.required === undefined ? {} : { required: value.required }),
    ...(value.default === undefined ? {} : { default: value.default }),
    ...(value.minimum === undefined ? {} : { minimum: value.minimum }),
    ...(value.maximum === undefined ? {} : { maximum: value.maximum }),
    ...(value.choices === undefined
      ? {}
      : { choices: [...value.choices] as AutomationScalar[] }),
  }
}

const collectReferences = (
  value: unknown,
  references: Set<string>,
  depth = 0,
): void => {
  if (depth > 12) {
    return
  }
  if (isParameterReference(value)) {
    references.add(value.$parameter)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectReferences(entry, references, depth + 1))
    return
  }
  if (isRecord(value)) {
    Object.values(value).forEach((entry) =>
      collectReferences(entry, references, depth + 1),
    )
  }
}

const parseMacroValue = (value: unknown): MacroParseResult => {
  if (!isRecord(value)) {
    throw new MacroFormatError(
      'invalid-root',
      'The macro root must be an object.',
    )
  }
  if (value.appId !== MACRO_APP_ID) {
    throw new MacroFormatError(
      'invalid-app',
      `This macro belongs to "${String(value.appId)}", not "${MACRO_APP_ID}".`,
    )
  }
  if (value.schemaVersion !== MACRO_SCHEMA_VERSION) {
    throw new MacroFormatError(
      'unsupported-version',
      `Macro schema version ${String(value.schemaVersion)} is not supported.`,
    )
  }
  if (
    !validShortText(value.appVersion, 64) ||
    !validIdentifier(value.id) ||
    !validShortText(value.name) ||
    !validTimestamp(value.createdAt) ||
    !validTimestamp(value.updatedAt) ||
    !Array.isArray(value.parameters) ||
    value.parameters.length > MAX_MACRO_PARAMETERS ||
    !Array.isArray(value.commands) ||
    value.commands.length > MAX_AUTOMATION_COMMANDS
  ) {
    throw new MacroFormatError(
      'invalid-root',
      'The macro metadata, parameters, or command list is invalid.',
    )
  }

  const parameters: MacroParameterDefinition[] = []
  const parameterNames = new Set<string>()
  for (const candidate of value.parameters) {
    const parameter = validateParameter(candidate)
    if (!parameter || parameterNames.has(parameter.name)) {
      throw new MacroFormatError(
        'invalid-root',
        'The macro contains an invalid or duplicate parameter.',
      )
    }
    parameterNames.add(parameter.name)
    parameters.push(parameter)
  }

  const commands: AutomationCommand[] = []
  const diagnostics: CommandDiagnostic[] = []
  const commandIds = new Set<string>()
  value.commands.forEach((candidate, commandIndex) => {
    const validated = validateAutomationCommand(candidate)
    if (!validated.ok) {
      diagnostics.push({
        ...validated.diagnostic,
        commandIndex,
      })
      return
    }
    if (
      validated.command.commandId &&
      commandIds.has(validated.command.commandId)
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'invalid-command',
        commandIndex,
        commandType: validated.command.type,
        message: `Duplicate commandId "${validated.command.commandId}" was skipped.`,
      })
      return
    }
    if (validated.command.commandId) {
      commandIds.add(validated.command.commandId)
    }
    const references = new Set<string>()
    collectReferences(validated.command, references)
    const missing = [...references].find((name) => !parameterNames.has(name))
    if (missing) {
      diagnostics.push({
        severity: 'error',
        code: 'unresolved-parameter',
        commandIndex,
        commandType: validated.command.type,
        message: `Command references undefined parameter "${missing}" and was skipped.`,
      })
      return
    }
    commands.push(validated.command)
  })

  return {
    macro: {
      appId: MACRO_APP_ID,
      schemaVersion: MACRO_SCHEMA_VERSION,
      appVersion: value.appVersion.trim(),
      id: value.id,
      name: value.name.trim(),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      parameters,
      commands,
    },
    diagnostics,
  }
}

export const parseMacro = (source: string): MacroParseResult => {
  if (source.length > MAX_MACRO_SOURCE_LENGTH) {
    throw new MacroFormatError(
      'source-too-large',
      `Macro files must not exceed ${MAX_MACRO_SOURCE_LENGTH} characters.`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch (error) {
    throw new MacroFormatError(
      'invalid-json',
      'The macro file is not valid JSON.',
      error,
    )
  }
  return parseMacroValue(parsed)
}

export const validateMacro = (value: unknown): MacroParseResult =>
  parseMacroValue(value)

export const serializeMacro = (
  macro: MacroDocument,
  space: number | string = 2,
): string => {
  const validated = validateMacro(macro)
  if (validated.diagnostics.length > 0) {
    throw new MacroFormatError(
      'invalid-root',
      'Cannot serialize a macro with invalid commands.',
    )
  }
  return JSON.stringify(validated.macro, null, space)
}

export interface CreateMacroInput {
  appVersion: string
  id: string
  name: string
  commands: AutomationCommand[]
  parameters?: MacroParameterDefinition[]
  createdAt?: string
  updatedAt?: string
}

export const createMacro = (input: CreateMacroInput): MacroDocument => {
  const now = input.updatedAt ?? new Date().toISOString()
  const validated = validateMacro({
    appId: MACRO_APP_ID,
    schemaVersion: MACRO_SCHEMA_VERSION,
    appVersion: input.appVersion,
    id: input.id,
    name: input.name,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    parameters: input.parameters ?? [],
    commands: input.commands,
  })
  if (validated.diagnostics.length > 0) {
    throw new MacroFormatError(
      'invalid-root',
      'Cannot create a macro with invalid commands.',
    )
  }
  return validated.macro
}

const resolveValue = (
  value: unknown,
  resolvedValues: Readonly<Record<string, AutomationScalar>>,
): unknown => {
  if (isParameterReference(value)) {
    if (!(value.$parameter in resolvedValues)) {
      throw new MacroParameterError(
        `No value was supplied for parameter "${value.$parameter}".`,
        value.$parameter,
      )
    }
    return resolvedValues[value.$parameter]
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, resolvedValues))
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveValue(entry, resolvedValues),
      ]),
    )
  }
  return value
}

const resolveParameterValues = (
  definitions: readonly MacroParameterDefinition[],
  overrides: Readonly<Record<string, AutomationScalar>>,
): Record<string, AutomationScalar> => {
  const values: Record<string, AutomationScalar> = {}
  for (const definition of definitions) {
    const value =
      overrides[definition.name] === undefined
        ? definition.default
        : overrides[definition.name]
    if (value === undefined) {
      if (definition.required) {
        throw new MacroParameterError(
          `Parameter "${definition.label}" is required.`,
          definition.name,
        )
      }
      continue
    }
    if (!scalarMatchesType(value, definition.type)) {
      throw new MacroParameterError(
        `Parameter "${definition.label}" has the wrong type.`,
        definition.name,
      )
    }
    if (
      typeof value === 'number' &&
      ((definition.minimum !== undefined && value < definition.minimum) ||
        (definition.maximum !== undefined && value > definition.maximum))
    ) {
      throw new MacroParameterError(
        `Parameter "${definition.label}" is outside its allowed range.`,
        definition.name,
      )
    }
    if (
      definition.choices &&
      !definition.choices.some((choice) => Object.is(choice, value))
    ) {
      throw new MacroParameterError(
        `Parameter "${definition.label}" is not an allowed choice.`,
        definition.name,
      )
    }
    values[definition.name] = value
  }
  return values
}

export const resolveMacroParameters = (
  macro: MacroDocument,
  overrides: Readonly<Record<string, AutomationScalar>> = {},
): ResolvedAutomationCommand[] => {
  const knownParameters = new Set(
    macro.parameters.map((parameter) => parameter.name),
  )
  const unknownOverride = Object.keys(overrides).find(
    (name) => !knownParameters.has(name),
  )
  if (unknownOverride) {
    throw new MacroParameterError(
      `Unknown macro parameter "${unknownOverride}".`,
      unknownOverride,
    )
  }
  const values = resolveParameterValues(macro.parameters, overrides)
  return macro.commands.map((command) => {
    const resolved = resolveValue(command, values)
    const validated = validateAutomationCommand(resolved, {
      allowParameters: false,
    })
    if (!validated.ok) {
      throw new MacroParameterError(
        `Resolved command "${command.type}" is invalid: ${validated.diagnostic.message}`,
      )
    }
    return validated.command as ResolvedAutomationCommand
  })
}

export const parameter = (name: string): ParameterReference => {
  const reference = { $parameter: name }
  if (!isParameterReference(reference)) {
    throw new MacroParameterError(`Invalid parameter name "${name}".`, name)
  }
  return reference
}
