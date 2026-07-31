import { validateFilterOperation } from './filters/registry'
import type {
  CurvesParameters,
  FilterOperation,
  RgbColor,
} from './filters/types'
import {
  DEFAULT_IMAGE_FILTER_SETTINGS,
  type FabricEditorEngine,
  type ImageFilterSettings,
  type LayerInfo,
} from './fabricEngine'
import type {
  AddTextScriptOptions,
  ApplyFilterScriptCommand,
  EditorScriptCommand,
  EditorScriptProgram,
  ScriptLayerTarget,
} from '../scripting/types'

const MAXIMUM_SCRIPT_COMMANDS = 1_000
const MAXIMUM_EXECUTION_STEPS = 10_000
const MAXIMUM_SCRIPT_STRING_LENGTH = 4_096
const MAXIMUM_LAYER_TARGET_LENGTH = 100
const MAXIMUM_CANVAS_DIMENSION = 8_192
const MAXIMUM_CANVAS_PIXELS = 64 * 1024 * 1024

const FORBIDDEN_BINDINGS = new Set([
  'editor',
  'fetch',
  'document',
  'window',
  'globalThis',
  'self',
  'navigator',
  'constructor',
  '__proto__',
  'prototype',
])

export type EditorScriptExecutionErrorCode =
  | 'invalid-program'
  | 'invalid-command'
  | 'execution-limit'
  | 'target-not-found'
  | 'target-unavailable'
  | 'target-not-image'

export class EditorScriptExecutionError extends Error {
  readonly code: EditorScriptExecutionErrorCode
  readonly path: string

  constructor(
    code: EditorScriptExecutionErrorCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EditorScriptExecutionError'
    this.code = code
    this.path = path
  }
}

export interface EditorScriptExecutionResult {
  executedCommands: number
  affectedLayerIds: string[]
  addedLayerIds: string[]
}

interface ValidationState {
  commandCount: number
  activeValues: WeakSet<object>
}

interface ExecutionState {
  executedCommands: number
  affectedLayerIds: Set<string>
  addedLayerIds: string[]
  bindings: Map<string, LayerInfo>
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const fail = (
  code: EditorScriptExecutionErrorCode,
  path: string,
  message: string,
): never => {
  throw new EditorScriptExecutionError(code, path, message)
}

const plainRecordAt = (
  value: unknown,
  path: string,
  code: EditorScriptExecutionErrorCode = 'invalid-command',
): Record<string, unknown> => {
  if (!isPlainRecord(value)) {
    return fail(code, path, 'must be an object')
  }
  return value
}

const assertExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void => {
  const allowedKeys = new Set(allowed)
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (unexpected) {
    fail('invalid-command', `${path}.${unexpected}`, 'is not supported')
  }
  const missing = allowed.find((key) => !(key in value))
  if (missing) {
    fail('invalid-command', `${path}.${missing}`, 'is required')
  }
}

const withCycleGuard = <T>(
  value: object,
  path: string,
  state: ValidationState,
  operation: () => T,
): T => {
  if (state.activeValues.has(value)) {
    fail('invalid-program', path, 'must not contain cyclic values')
  }
  state.activeValues.add(value)
  try {
    return operation()
  } finally {
    state.activeValues.delete(value)
  }
}

const validBinding = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAXIMUM_SCRIPT_STRING_LENGTH &&
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) &&
  !FORBIDDEN_BINDINGS.has(value)

const validateLayerTarget = (
  value: unknown,
  path: string,
  binding: string | undefined,
): ScriptLayerTarget => {
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAXIMUM_LAYER_TARGET_LENGTH
  ) {
    return value
  }
  const record = plainRecordAt(value, path)
  assertExactKeys(record, ['kind', 'binding', 'property'], path)
  if (
    record.kind !== 'current-layer' ||
    record.binding !== binding ||
    (record.property !== 'id' && record.property !== 'name')
  ) {
    return fail(
      'invalid-command',
      path,
      'contains an invalid current-layer reference',
    )
  }
  return {
    kind: 'current-layer',
    binding: record.binding as string,
    property: record.property,
  }
}

const validateTextOptions = (
  value: unknown,
  path: string,
): AddTextScriptOptions => {
  const record = plainRecordAt(value, path)
  const allowed = [
    'left',
    'top',
    'fill',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'name',
  ] as const
  const allowedKeys = new Set<string>(allowed)
  const unexpected = Object.keys(record).find((key) => !allowedKeys.has(key))
  if (unexpected) {
    fail('invalid-command', `${path}.${unexpected}`, 'is not supported')
  }

  const options: AddTextScriptOptions = {}
  for (const key of ['left', 'top'] as const) {
    const candidate = record[key]
    if (candidate === undefined) continue
    if (
      typeof candidate !== 'number' ||
      !Number.isFinite(candidate) ||
      candidate < -8_192 ||
      candidate > 8_192
    ) {
      fail(
        'invalid-command',
        `${path}.${key}`,
        'must be a finite document coordinate',
      )
    }
    options[key] = candidate as number
  }

  for (const [key, maximum] of [
    ['fill', 100],
    ['fontFamily', 200],
    ['name', 200],
  ] as const) {
    const candidate = record[key]
    if (candidate === undefined) continue
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      candidate.length > maximum
    ) {
      fail(
        'invalid-command',
        `${path}.${key}`,
        'must be a bounded non-empty string',
      )
    }
    options[key] = candidate as string
  }

  if (record.fontSize !== undefined) {
    if (
      typeof record.fontSize !== 'number' ||
      !Number.isFinite(record.fontSize) ||
      record.fontSize < 1 ||
      record.fontSize > 1_024
    ) {
      fail(
        'invalid-command',
        `${path}.fontSize`,
        'must be a number from 1 to 1024',
      )
    }
    options.fontSize = record.fontSize as number
  }
  if (record.fontWeight !== undefined) {
    if (
      (typeof record.fontWeight !== 'string' &&
        typeof record.fontWeight !== 'number') ||
      (typeof record.fontWeight === 'number' &&
        !Number.isFinite(record.fontWeight)) ||
      (typeof record.fontWeight === 'string' &&
        record.fontWeight.length > MAXIMUM_SCRIPT_STRING_LENGTH)
    ) {
      fail(
        'invalid-command',
        `${path}.fontWeight`,
        'must be a bounded string or finite number',
      )
    }
    options.fontWeight = record.fontWeight as string | number
  }
  return options
}

const validateCommand = (
  value: unknown,
  path: string,
  binding: string | undefined,
  state: ValidationState,
): EditorScriptCommand => {
  const record = plainRecordAt(value, path)
  return withCycleGuard(record, path, state, () => {
    state.commandCount += 1
    if (state.commandCount > MAXIMUM_SCRIPT_COMMANDS) {
      fail(
        'execution-limit',
        path,
        `exceeds the ${MAXIMUM_SCRIPT_COMMANDS} command limit`,
      )
    }
    if (typeof record.type !== 'string') {
      return fail('invalid-command', `${path}.type`, 'must be a string')
    }

    switch (record.type) {
      case 'resizeCanvas': {
        if (binding) {
          fail(
            'invalid-command',
            path,
            'resizeCanvas cannot run inside forEachLayer',
          )
        }
        assertExactKeys(record, ['type', 'width', 'height'], path)
        if (
          !Number.isSafeInteger(record.width) ||
          !Number.isSafeInteger(record.height) ||
          (record.width as number) <= 0 ||
          (record.height as number) <= 0 ||
          (record.width as number) > MAXIMUM_CANVAS_DIMENSION ||
          (record.height as number) > MAXIMUM_CANVAS_DIMENSION ||
          (record.width as number) * (record.height as number) >
            MAXIMUM_CANVAS_PIXELS
        ) {
          fail('invalid-command', path, 'contains unsafe canvas dimensions')
        }
        return {
          type: 'resizeCanvas',
          width: record.width as number,
          height: record.height as number,
        }
      }
      case 'applyFilter': {
        assertExactKeys(
          record,
          record.targetLayer === undefined
            ? ['type', 'operation']
            : ['type', 'operation', 'targetLayer'],
          path,
        )
        const operation = (() => {
          try {
            return validateFilterOperation(
              record.operation,
              `${path}.operation`,
            )
          } catch (error) {
            return fail(
              'invalid-command',
              `${path}.operation`,
              error instanceof Error
                ? error.message
                : 'contains an invalid filter',
            )
          }
        })()
        if (binding && record.targetLayer === undefined) {
          fail(
            'invalid-command',
            `${path}.targetLayer`,
            'is required inside forEachLayer',
          )
        }
        const targetLayer =
          record.targetLayer === undefined
            ? undefined
            : validateLayerTarget(
                record.targetLayer,
                `${path}.targetLayer`,
                binding,
              )
        return {
          type: 'applyFilter',
          operation,
          ...(targetLayer === undefined ? {} : { targetLayer }),
        }
      }
      case 'addText': {
        if (binding) {
          fail(
            'invalid-command',
            path,
            'addText cannot run inside forEachLayer',
          )
        }
        assertExactKeys(record, ['type', 'text', 'options'], path)
        if (
          typeof record.text !== 'string' ||
          record.text.length === 0 ||
          record.text.length > MAXIMUM_SCRIPT_STRING_LENGTH
        ) {
          fail(
            'invalid-command',
            `${path}.text`,
            'must be a bounded non-empty string',
          )
        }
        return {
          type: 'addText',
          text: record.text as string,
          options: validateTextOptions(record.options, `${path}.options`),
        }
      }
      case 'forEachLayer': {
        if (binding) {
          fail(
            'invalid-command',
            path,
            'nested forEachLayer commands are not supported',
          )
        }
        assertExactKeys(record, ['type', 'binding', 'commands'], path)
        if (!validBinding(record.binding)) {
          fail(
            'invalid-command',
            `${path}.binding`,
            'must be a safe callback identifier',
          )
        }
        const commandsValue = record.commands
        if (!Array.isArray(commandsValue) || commandsValue.length === 0) {
          return fail(
            'invalid-command',
            `${path}.commands`,
            'must be a non-empty command array',
          )
        }
        const commands = withCycleGuard(
          commandsValue,
          `${path}.commands`,
          state,
          () =>
            commandsValue.map((command, index) =>
              validateCommand(
                command,
                `${path}.commands[${index}]`,
                record.binding as string,
                state,
              ),
            ),
        )
        return {
          type: 'forEachLayer',
          binding: record.binding as string,
          commands,
        }
      }
      default:
        return fail(
          'invalid-command',
          `${path}.type`,
          `unsupported command "${record.type}"`,
        )
    }
  })
}

const validateProgram = (value: unknown): EditorScriptProgram => {
  const record = plainRecordAt(value, 'program', 'invalid-program')
  assertExactKeys(record, ['schemaVersion', 'commands'], 'program')
  if (record.schemaVersion !== 1) {
    fail('invalid-program', 'program.schemaVersion', 'must be 1')
  }
  const commandsValue = record.commands
  if (!Array.isArray(commandsValue)) {
    return fail('invalid-program', 'program.commands', 'must be an array')
  }
  const state: ValidationState = {
    commandCount: 0,
    activeValues: new WeakSet(),
  }
  const commands = withCycleGuard(
    commandsValue,
    'program.commands',
    state,
    () =>
      commandsValue.map((command, index) =>
        validateCommand(
          command,
          `program.commands[${index}]`,
          undefined,
          state,
        ),
      ),
  )
  return { schemaVersion: 1, commands }
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

const finiteSetting = (
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, minimum, maximum)
    : fallback

const normalizedSettings = (
  settings: ImageFilterSettings | undefined,
): Required<ImageFilterSettings> => ({
  brightness: finiteSetting(settings?.brightness, 0, -1, 1),
  contrast: finiteSetting(settings?.contrast, 0, -1, 1),
  saturation: finiteSetting(settings?.saturation, 0, -1, 1),
  hue: finiteSetting(settings?.hue, 0, -1, 1),
  blur: finiteSetting(settings?.blur, 0, 0, 1),
  grayscale: Boolean(settings?.grayscale),
  sharpen: finiteSetting(settings?.sharpen, 0, 0, 2),
  emboss: finiteSetting(settings?.emboss, 0, 0, 2),
  noise: finiteSetting(settings?.noise, 0, 0, 1),
  pixelate: Math.round(finiteSetting(settings?.pixelate, 1, 1, 128)),
  sepia: finiteSetting(settings?.sepia, 0, 0, 1),
  invert: finiteSetting(settings?.invert, 0, 0, 1),
  gamma: finiteSetting(settings?.gamma, 1, 0.1, 2.2),
  temperature: finiteSetting(settings?.temperature, 0, -1, 1),
  tint: finiteSetting(settings?.tint, 0, -1, 1),
  vignette: finiteSetting(settings?.vignette, 0, 0, 1),
  duotone: finiteSetting(settings?.duotone, 0, 0, 1),
  halftone: finiteSetting(settings?.halftone, 0, 0, 1),
  glitch: finiteSetting(settings?.glitch, 0, 0, 1),
})

const colorDistance = (first: RgbColor, second: RgbColor): number =>
  Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b) /
  (Math.sqrt(3) * 255)

const curveOutput = (
  parameters: CurvesParameters,
  input: number,
  channel: 'red' | 'green' | 'blue',
): number => {
  const masterOutput = parameters.master[input]
  return parameters[channel][Math.round(masterOutput)]
}

const applyCurveApproximation = (
  settings: Required<ImageFilterSettings>,
  parameters: CurvesParameters,
): void => {
  const samples = [64, 128, 192] as const
  const luminance = (input: (typeof samples)[number]): number =>
    (curveOutput(parameters, input, 'red') +
      curveOutput(parameters, input, 'green') +
      curveOutput(parameters, input, 'blue')) /
    3
  const sampleOutputs = samples.map(luminance)
  settings.brightness = clamp(
    sampleOutputs.reduce(
      (total, output, index) => total + output - samples[index],
      0,
    ) /
      samples.length /
      255,
    -1,
    1,
  )
  settings.contrast = clamp(
    (sampleOutputs[2] - sampleOutputs[0]) / (samples[2] - samples[0]) - 1,
    -1,
    1,
  )

  const midpointInput = 128 / 255
  const midpointOutput = clamp(sampleOutputs[1] / 255, 1 / 255, 254 / 255)
  settings.gamma = clamp(
    Math.log(midpointInput) / Math.log(midpointOutput),
    0.1,
    2.2,
  )

  const red = curveOutput(parameters, 128, 'red')
  const green = curveOutput(parameters, 128, 'green')
  const blue = curveOutput(parameters, 128, 'blue')
  settings.temperature = clamp((red - blue) / 255, -1, 1)
  settings.tint = clamp((green - (red + blue) / 2) / 255, -1, 1)
}

/**
 * Projects the richer registry filter contract onto the filter controls that
 * FabricEditorEngine currently persists. Parameters without a direct Fabric
 * control are represented by a deterministic closest approximation.
 */
export const filterOperationToImageFilterSettings = (
  operation: FilterOperation,
  current: ImageFilterSettings = DEFAULT_IMAGE_FILTER_SETTINGS,
): Required<ImageFilterSettings> => {
  const validated = validateFilterOperation(operation)
  const settings = normalizedSettings(current)

  switch (validated.id) {
    case 'sharpen':
      settings.sharpen = validated.params.amount
      break
    case 'emboss':
      settings.emboss = clamp(validated.params.strength, 0, 2)
      break
    case 'noise':
      settings.noise = validated.params.amount
      break
    case 'pixelate':
      settings.pixelate = clamp(Math.round(validated.params.size), 1, 128)
      break
    case 'sepia':
      settings.sepia = validated.params.amount
      break
    case 'invert':
      settings.invert = validated.params.amount
      break
    case 'levels': {
      const inputRange =
        validated.params.inputWhite - validated.params.inputBlack
      const outputRange =
        validated.params.outputWhite - validated.params.outputBlack
      const inputMidpoint =
        (validated.params.inputBlack + validated.params.inputWhite) / 2
      const outputMidpoint =
        (validated.params.outputBlack + validated.params.outputWhite) / 2
      settings.brightness = clamp((outputMidpoint - inputMidpoint) / 255, -1, 1)
      settings.contrast = clamp(outputRange / inputRange - 1, -1, 1)
      settings.gamma = clamp(validated.params.gamma, 0.1, 2.2)
      break
    }
    case 'curves':
      applyCurveApproximation(settings, validated.params)
      break
    case 'white-balance':
      settings.temperature = validated.params.temperature
      settings.tint = validated.params.tint
      break
    case 'vignette':
      settings.vignette = validated.params.amount
      break
    case 'gradient-map': {
      const first = validated.params.stops[0].color
      const last = validated.params.stops.at(-1)!.color
      settings.duotone = clamp(colorDistance(first, last), 0, 1)
      break
    }
    case 'duotone':
      settings.duotone = clamp(
        colorDistance(validated.params.shadows, validated.params.highlights),
        0,
        1,
      )
      break
    case 'halftone':
      settings.halftone = clamp(validated.params.size / 18, 0, 1)
      break
    case 'glitch':
      settings.glitch = validated.params.amount
      break
  }
  return settings
}

const consumeExecutionStep = (state: ExecutionState, path: string): void => {
  state.executedCommands += 1
  if (state.executedCommands > MAXIMUM_EXECUTION_STEPS) {
    fail(
      'execution-limit',
      path,
      `exceeds the ${MAXIMUM_EXECUTION_STEPS} expanded-command limit`,
    )
  }
}

const resolveTargetLayerId = (
  engine: FabricEditorEngine,
  target: ScriptLayerTarget | undefined,
  path: string,
  state: ExecutionState,
): string => {
  if (target === undefined) {
    const selected = engine.getSelectedLayerIds()
    if (selected.length !== 1) {
      fail(
        'target-unavailable',
        path,
        'requires exactly one selected image layer',
      )
    }
    return selected[0]
  }
  if (typeof target === 'string') {
    return target
  }

  const boundLayer = state.bindings.get(target.binding)
  if (!boundLayer) {
    return fail(
      'target-unavailable',
      path,
      `references inactive binding "${target.binding}"`,
    )
  }
  if (target.property === 'id') {
    return boundLayer.id
  }
  const matches = engine
    .getLayers()
    .filter(({ name }) => name === boundLayer.name)
  if (matches.length !== 1) {
    fail(
      'target-not-found',
      path,
      `could not uniquely resolve layer name "${boundLayer.name}"`,
    )
  }
  return matches[0].id
}

const executeFilterCommand = (
  engine: FabricEditorEngine,
  command: ApplyFilterScriptCommand,
  path: string,
  state: ExecutionState,
): void => {
  const targetId = resolveTargetLayerId(
    engine,
    command.targetLayer,
    `${path}.targetLayer`,
    state,
  )
  const layer = engine.getLayers().find(({ id }) => id === targetId)
  if (!layer) {
    return fail(
      'target-not-found',
      `${path}.targetLayer`,
      `layer "${targetId}" was not found`,
    )
  }
  if (!layer.visible || layer.locked) {
    fail(
      'target-unavailable',
      `${path}.targetLayer`,
      `layer "${targetId}" is hidden or locked`,
    )
  }
  if (layer.type !== 'image' && layer.type !== 'adjustment') {
    fail(
      'target-not-image',
      `${path}.targetLayer`,
      `layer "${targetId}" is not an image layer`,
    )
  }
  if (
    (engine.getSelectedLayerIds().length !== 1 ||
      engine.getSelectedLayerIds()[0] !== targetId) &&
    !engine.selectLayer(targetId)
  ) {
    fail(
      'target-unavailable',
      `${path}.targetLayer`,
      `layer "${targetId}" could not be selected`,
    )
  }

  const current = engine.getSelectedImageFilters()
  if (!current) {
    return fail(
      'target-not-image',
      `${path}.targetLayer`,
      `layer "${targetId}" is not filterable`,
    )
  }
  const next = filterOperationToImageFilterSettings(command.operation, current)
  if (!engine.applyImageFilters(next)) {
    fail(
      'target-unavailable',
      path,
      `filter "${command.operation.id}" could not be applied`,
    )
  }
  state.affectedLayerIds.add(targetId)
}

const executeCommand = (
  engine: FabricEditorEngine,
  command: EditorScriptCommand,
  path: string,
  state: ExecutionState,
): void => {
  consumeExecutionStep(state, path)
  switch (command.type) {
    case 'resizeCanvas':
      engine.setCanvasSize(command.width, command.height)
      return
    case 'applyFilter':
      executeFilterCommand(engine, command, path, state)
      return
    case 'addText': {
      const id = engine.addText(command.text, command.options)
      state.addedLayerIds.push(id)
      state.affectedLayerIds.add(id)
      return
    }
    case 'forEachLayer': {
      const layers = engine.getLayers()
      for (const layer of layers) {
        state.bindings.set(command.binding, layer)
        try {
          command.commands.forEach((child, index) => {
            executeCommand(
              engine,
              child,
              `${path}.commands[${index}](${layer.id})`,
              state,
            )
          })
        } finally {
          state.bindings.delete(command.binding)
        }
      }
    }
  }
}

const restoreSelection = (
  engine: FabricEditorEngine,
  selectedLayerIds: readonly string[],
): void => {
  if (selectedLayerIds.length === 0) {
    engine.getCanvas().discardActiveObject()
    engine.getCanvas().requestRenderAll()
    return
  }
  selectedLayerIds.forEach((id, index) => {
    engine.selectLayer(id, index > 0)
  })
}

/**
 * Executes a parsed script as one editor transaction. The program is cloned
 * through a strict validation boundary before any mutation occurs.
 */
export const executeEditorScriptProgram = async (
  engine: FabricEditorEngine,
  program: EditorScriptProgram,
): Promise<EditorScriptExecutionResult> => {
  const validated = validateProgram(program)
  const selectedBefore = engine.getSelectedLayerIds()
  try {
    return await engine.runAtomic('script', () => {
      const state: ExecutionState = {
        executedCommands: 0,
        affectedLayerIds: new Set(),
        addedLayerIds: [],
        bindings: new Map(),
      }
      validated.commands.forEach((command, index) => {
        executeCommand(engine, command, `program.commands[${index}]`, state)
      })
      return {
        executedCommands: state.executedCommands,
        affectedLayerIds: [...state.affectedLayerIds],
        addedLayerIds: [...state.addedLayerIds],
      }
    })
  } catch (error) {
    restoreSelection(engine, selectedBefore)
    throw error
  }
}

export const executeEditorScript = executeEditorScriptProgram
