import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from '../lib/imageSafety'
import {
  MAX_EDITOR_SCRIPT_SOURCE_LENGTH,
  parseEditorScript,
} from '../scripting/parser'

export const MAX_AUTOMATION_COMMANDS = 500
export const MAX_COMMAND_STRING_LENGTH = 4_096
export const MAX_AUTOMATION_SCRIPT_SOURCE_LENGTH =
  MAX_EDITOR_SCRIPT_SOURCE_LENGTH

export type AutomationScalar = string | number | boolean

export interface ParameterReference {
  $parameter: string
}

export type CommandValue<T extends AutomationScalar> = T | ParameterReference

export type SemanticTarget<TString = CommandValue<string>> =
  | { kind: 'document' }
  | { kind: 'activeImage' }
  | { kind: 'topmostImage' }
  | { kind: 'layerName'; name: TString }
  | { kind: 'commandResult'; commandId: string }

interface CommandBase {
  /**
   * Optional stable alias for referring to the result of this command later in
   * the same replay. It is deliberately not a renderer/object id.
   */
  commandId?: string
}

export interface ResizeCanvasCommand<
  TNumber = CommandValue<number>,
> extends CommandBase {
  type: 'resizeCanvas'
  width: TNumber
  height: TNumber
  anchor?: 'topLeft' | 'center'
}

export interface ResizeImageCommand<
  TNumber = CommandValue<number>,
  TString = CommandValue<string>,
> extends CommandBase {
  type: 'resizeImage'
  width: TNumber
  height: TNumber
  fit?: 'stretch' | 'contain' | 'cover'
  background?: TString
}

export type AutomationFilter =
  'brightness' | 'contrast' | 'saturation' | 'hue' | 'blur' | 'grayscale'

export interface ApplyFilterCommand<
  TNumber = CommandValue<number>,
  TBoolean = CommandValue<boolean>,
  TString = CommandValue<string>,
> extends CommandBase {
  type: 'applyFilter'
  filter: AutomationFilter
  value: TNumber | TBoolean
  target?: SemanticTarget<TString>
}

export interface AddTextCommand<
  TNumber = CommandValue<number>,
  TString = CommandValue<string>,
> extends CommandBase {
  type: 'addText'
  text: TString
  x?: TNumber
  y?: TNumber
  fill?: TString
  fontSize?: TNumber
  fontFamily?: TString
  fontWeight?: TNumber | TString
  opacity?: TNumber
  name?: TString
}

export interface AddWatermarkCommand<
  TNumber = CommandValue<number>,
  TString = CommandValue<string>,
> extends CommandBase {
  type: 'addWatermark'
  text: TString
  position?: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center'
  color?: TString
  opacity?: TNumber
  fontSize?: TNumber
  fontFamily?: TString
  fontWeight?: TNumber | TString
  margin?: TNumber
}

export interface RunScriptCommand extends CommandBase {
  type: 'runScript'
  source: string
}

export type AutomationCommand =
  | ResizeCanvasCommand
  | ResizeImageCommand
  | ApplyFilterCommand
  | AddTextCommand
  | AddWatermarkCommand
  | RunScriptCommand

export type ResolvedAutomationCommand =
  | ResizeCanvasCommand<number>
  | ResizeImageCommand<number, string>
  | ApplyFilterCommand<number, boolean, string>
  | AddTextCommand<number, string>
  | AddWatermarkCommand<number, string>
  | RunScriptCommand

export type AutomationCommandType = AutomationCommand['type']

export interface CommandCapability {
  recordable: boolean
  batchSafe: boolean
  pointerDependent: boolean
}

export const COMMAND_CAPABILITIES: Readonly<
  Record<AutomationCommandType, CommandCapability>
> = Object.freeze({
  resizeCanvas: {
    recordable: true,
    batchSafe: false,
    pointerDependent: false,
  },
  resizeImage: {
    recordable: true,
    batchSafe: true,
    pointerDependent: false,
  },
  applyFilter: {
    recordable: true,
    batchSafe: true,
    pointerDependent: false,
  },
  addText: {
    recordable: true,
    batchSafe: false,
    pointerDependent: false,
  },
  addWatermark: {
    recordable: true,
    batchSafe: true,
    pointerDependent: false,
  },
  runScript: {
    recordable: true,
    batchSafe: false,
    pointerDependent: false,
  },
})

export interface CommandDiagnostic {
  severity: 'warning' | 'error'
  code:
    | 'unknown-command'
    | 'invalid-command'
    | 'batch-unsafe-command'
    | 'unresolved-parameter'
  message: string
  commandIndex?: number
  commandType?: string
}

export type CommandValidationResult =
  | { ok: true; command: AutomationCommand }
  | { ok: false; diagnostic: CommandDiagnostic }

const KNOWN_COMMAND_TYPES = new Set<AutomationCommandType>(
  Object.keys(COMMAND_CAPABILITIES) as AutomationCommandType[],
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => {
  const keys = new Set(allowed)
  return Object.keys(value).every((key) => keys.has(key))
}

export const isParameterReference = (
  value: unknown,
): value is ParameterReference =>
  isRecord(value) &&
  Object.keys(value).length === 1 &&
  typeof value.$parameter === 'string' &&
  /^[a-z][a-z0-9_.-]{0,63}$/i.test(value.$parameter)

const commandString = (
  value: unknown,
  allowParameters: boolean,
): value is CommandValue<string> =>
  (typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_COMMAND_STRING_LENGTH) ||
  (allowParameters && isParameterReference(value))

const optionalCommandString = (
  value: unknown,
  allowParameters: boolean,
): value is CommandValue<string> | undefined =>
  value === undefined || commandString(value, allowParameters)

const commandNumber = (
  value: unknown,
  allowParameters: boolean,
): value is CommandValue<number> =>
  (typeof value === 'number' && Number.isFinite(value)) ||
  (allowParameters && isParameterReference(value))

const optionalCommandNumber = (
  value: unknown,
  allowParameters: boolean,
): value is CommandValue<number> | undefined =>
  value === undefined || commandNumber(value, allowParameters)

const commandBoolean = (
  value: unknown,
  allowParameters: boolean,
): value is CommandValue<boolean> =>
  typeof value === 'boolean' || (allowParameters && isParameterReference(value))

const validCommandId = (value: unknown): value is string | undefined =>
  value === undefined ||
  (typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/i.test(value))

const validColor = (
  value: unknown,
  allowParameters: boolean,
): value is CommandValue<string> | undefined =>
  value === undefined ||
  (allowParameters && isParameterReference(value)) ||
  (typeof value === 'string' &&
    value.length <= 64 &&
    (/^#[0-9a-f]{3,8}$/i.test(value) ||
      /^(?:transparent|black|white)$/i.test(value) ||
      /^rgba?\([\d\s.,%+-]+\)$/i.test(value)))

const validDimensions = (
  width: unknown,
  height: unknown,
  allowParameters: boolean,
): boolean => {
  if (
    !commandNumber(width, allowParameters) ||
    !commandNumber(height, allowParameters)
  ) {
    return false
  }
  if (typeof width !== 'number' || typeof height !== 'number') {
    return true
  }
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_DIMENSION &&
    height <= MAX_IMAGE_DIMENSION &&
    width * height <= MAX_IMAGE_PIXELS
  )
}

const resolvedNumberInRange = (
  value: unknown,
  minimum: number,
  maximum: number,
  allowParameters: boolean,
): boolean =>
  (allowParameters && isParameterReference(value)) ||
  (typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum)

const validTarget = (
  value: unknown,
  allowParameters: boolean,
): value is SemanticTarget => {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false
  }
  switch (value.kind) {
    case 'document':
    case 'activeImage':
    case 'topmostImage':
      return Object.keys(value).length === 1
    case 'layerName':
      return (
        hasOnlyKeys(value, ['kind', 'name']) &&
        commandString(value.name, allowParameters)
      )
    case 'commandResult':
      return (
        hasOnlyKeys(value, ['kind', 'commandId']) &&
        typeof value.commandId === 'string' &&
        /^[a-z][a-z0-9_-]{0,63}$/i.test(value.commandId)
      )
    default:
      return false
  }
}

const diagnostic = (
  code: CommandDiagnostic['code'],
  message: string,
  commandType?: string,
): CommandValidationResult => ({
  ok: false,
  diagnostic: {
    severity: code === 'unknown-command' ? 'warning' : 'error',
    code,
    message,
    commandType,
  },
})

/**
 * Validates one untrusted command without traversing unknown command payloads.
 * Unknown commands are intentionally distinguishable from malformed known
 * commands so macro import can skip them with a warning.
 */
export const validateAutomationCommand = (
  value: unknown,
  options: { allowParameters?: boolean } = {},
): CommandValidationResult => {
  const allowParameters = options.allowParameters ?? true
  if (!isRecord(value) || typeof value.type !== 'string') {
    return diagnostic(
      'invalid-command',
      'A command must be an object with a string type.',
    )
  }
  const type = value.type
  if (!KNOWN_COMMAND_TYPES.has(type as AutomationCommandType)) {
    return diagnostic(
      'unknown-command',
      `Unknown command "${type}" was skipped.`,
      type,
    )
  }
  if (!validCommandId(value.commandId)) {
    return diagnostic(
      'invalid-command',
      `Command "${type}" has an invalid commandId.`,
      type,
    )
  }

  switch (type as AutomationCommandType) {
    case 'resizeCanvas':
      if (
        !hasOnlyKeys(value, [
          'type',
          'commandId',
          'width',
          'height',
          'anchor',
        ]) ||
        !validDimensions(value.width, value.height, allowParameters) ||
        (value.anchor !== undefined &&
          value.anchor !== 'topLeft' &&
          value.anchor !== 'center')
      ) {
        return diagnostic(
          'invalid-command',
          'resizeCanvas requires safe positive integer dimensions.',
          type,
        )
      }
      break
    case 'resizeImage':
      if (
        !hasOnlyKeys(value, [
          'type',
          'commandId',
          'width',
          'height',
          'fit',
          'background',
        ]) ||
        !validDimensions(value.width, value.height, allowParameters) ||
        (value.fit !== undefined &&
          value.fit !== 'stretch' &&
          value.fit !== 'contain' &&
          value.fit !== 'cover') ||
        !validColor(value.background, allowParameters)
      ) {
        return diagnostic(
          'invalid-command',
          'resizeImage has invalid dimensions, fit mode, or background.',
          type,
        )
      }
      break
    case 'applyFilter': {
      const filters = new Set<AutomationFilter>([
        'brightness',
        'contrast',
        'saturation',
        'hue',
        'blur',
        'grayscale',
      ])
      const validValue =
        value.filter === 'grayscale'
          ? commandBoolean(value.value, allowParameters)
          : value.filter === 'blur'
            ? resolvedNumberInRange(value.value, 0, 1, allowParameters)
            : resolvedNumberInRange(value.value, -1, 1, allowParameters)
      if (
        !hasOnlyKeys(value, [
          'type',
          'commandId',
          'filter',
          'value',
          'target',
        ]) ||
        typeof value.filter !== 'string' ||
        !filters.has(value.filter as AutomationFilter) ||
        !validValue ||
        (value.target !== undefined &&
          !validTarget(value.target, allowParameters))
      ) {
        return diagnostic(
          'invalid-command',
          'applyFilter has an invalid filter, value, or semantic target.',
          type,
        )
      }
      break
    }
    case 'addText':
      if (
        !hasOnlyKeys(value, [
          'type',
          'commandId',
          'text',
          'x',
          'y',
          'fill',
          'fontSize',
          'fontFamily',
          'fontWeight',
          'opacity',
          'name',
        ]) ||
        !commandString(value.text, allowParameters) ||
        !optionalCommandNumber(value.x, allowParameters) ||
        !optionalCommandNumber(value.y, allowParameters) ||
        !validColor(value.fill, allowParameters) ||
        !optionalCommandNumber(value.fontSize, allowParameters) ||
        !optionalCommandString(value.fontFamily, allowParameters) ||
        !(
          value.fontWeight === undefined ||
          commandNumber(value.fontWeight, allowParameters) ||
          commandString(value.fontWeight, allowParameters)
        ) ||
        !optionalCommandNumber(value.opacity, allowParameters) ||
        !optionalCommandString(value.name, allowParameters)
      ) {
        return diagnostic(
          'invalid-command',
          'addText has invalid text or style parameters.',
          type,
        )
      }
      if (
        (typeof value.fontSize === 'number' &&
          (value.fontSize < 1 || value.fontSize > 2_048)) ||
        (typeof value.opacity === 'number' &&
          (value.opacity < 0 || value.opacity > 1)) ||
        (typeof value.fontWeight === 'number' &&
          (value.fontWeight < 1 || value.fontWeight > 1_000))
      ) {
        return diagnostic(
          'invalid-command',
          'addText style parameters are outside their allowed ranges.',
          type,
        )
      }
      break
    case 'addWatermark':
      if (
        !hasOnlyKeys(value, [
          'type',
          'commandId',
          'text',
          'position',
          'color',
          'opacity',
          'fontSize',
          'fontFamily',
          'fontWeight',
          'margin',
        ]) ||
        !commandString(value.text, allowParameters) ||
        (value.position !== undefined &&
          value.position !== 'topLeft' &&
          value.position !== 'topRight' &&
          value.position !== 'bottomLeft' &&
          value.position !== 'bottomRight' &&
          value.position !== 'center') ||
        !validColor(value.color, allowParameters) ||
        !optionalCommandNumber(value.opacity, allowParameters) ||
        !optionalCommandNumber(value.fontSize, allowParameters) ||
        !optionalCommandString(value.fontFamily, allowParameters) ||
        !(
          value.fontWeight === undefined ||
          commandNumber(value.fontWeight, allowParameters) ||
          commandString(value.fontWeight, allowParameters)
        ) ||
        !optionalCommandNumber(value.margin, allowParameters)
      ) {
        return diagnostic(
          'invalid-command',
          'addWatermark has invalid text, placement, or style parameters.',
          type,
        )
      }
      if (
        (typeof value.opacity === 'number' &&
          (value.opacity < 0 || value.opacity > 1)) ||
        (typeof value.fontSize === 'number' &&
          (value.fontSize < 1 || value.fontSize > 2_048)) ||
        (typeof value.fontWeight === 'number' &&
          (value.fontWeight < 1 || value.fontWeight > 1_000)) ||
        (typeof value.margin === 'number' &&
          (value.margin < 0 || value.margin > MAX_IMAGE_DIMENSION))
      ) {
        return diagnostic(
          'invalid-command',
          'addWatermark style parameters are outside their allowed ranges.',
          type,
        )
      }
      break
    case 'runScript':
      if (
        !hasOnlyKeys(value, ['type', 'commandId', 'source']) ||
        typeof value.source !== 'string' ||
        value.source.trim().length === 0 ||
        value.source.length > MAX_AUTOMATION_SCRIPT_SOURCE_LENGTH
      ) {
        return diagnostic(
          'invalid-command',
          'runScript requires a bounded non-empty editor DSL source.',
          type,
        )
      }
      try {
        parseEditorScript(value.source, {
          maximumSourceLength: MAX_AUTOMATION_SCRIPT_SOURCE_LENGTH,
        })
      } catch {
        return diagnostic(
          'invalid-command',
          'runScript contains invalid or forbidden editor DSL source.',
          type,
        )
      }
      break
  }

  return { ok: true, command: value as unknown as AutomationCommand }
}

export const isBatchSafeCommand = (
  command: AutomationCommand | ResolvedAutomationCommand,
): boolean => {
  if (!COMMAND_CAPABILITIES[command.type].batchSafe) {
    return false
  }
  if (
    command.type === 'applyFilter' &&
    command.target?.kind !== undefined &&
    command.target.kind !== 'document' &&
    command.target.kind !== 'activeImage' &&
    command.target.kind !== 'topmostImage'
  ) {
    return false
  }
  return true
}

export const assertBatchSafeCommands = (
  commands: readonly (AutomationCommand | ResolvedAutomationCommand)[],
): void => {
  const unsafe = commands.find((command) => !isBatchSafeCommand(command))
  if (unsafe) {
    throw new TypeError(
      `Command "${unsafe.type}" cannot be replayed in the batch worker.`,
    )
  }
}
