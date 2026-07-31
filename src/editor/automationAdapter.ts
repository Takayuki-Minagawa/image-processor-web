import type {
  ApplyFilterCommand,
  AutomationCommand,
  CommandExecutionContext,
  CommandExecutionResult,
  ResolvedAutomationCommand,
  SemanticTarget,
} from '../automation'
import {
  DEFAULT_IMAGE_FILTER_SETTINGS,
  type FabricEditorEngine,
  type ImageFilterSettings,
} from './fabricEngine'

const resolvedNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be resolved to a finite number.`)
  }
  return value
}

const resolvedString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be resolved to a string.`)
  }
  return value
}

const selectTarget = (
  engine: FabricEditorEngine,
  target: SemanticTarget<string> | undefined,
  context: CommandExecutionContext,
): void => {
  if (target?.kind === 'document') {
    return
  }
  if (target?.kind === 'commandResult') {
    const id = context.resultAliases.get(target.commandId)
    if (typeof id !== 'string' || !engine.selectLayer(id)) {
      throw new Error(`Command result "${target.commandId}" is unavailable.`)
    }
    return
  }

  const layers = engine.getLayers()
  if (target?.kind === 'layerName') {
    const match = layers.find(({ name }) => name === target.name)
    if (!match || !engine.selectLayer(match.id)) {
      throw new Error(`Layer "${target.name}" was not found.`)
    }
    return
  }
  if (target?.kind === 'activeImage') {
    const active = layers.find(
      ({ selected, type }) => selected && type === 'image',
    )
    if (active) {
      return
    }
  }
  const topmost = layers.find(
    ({ type }) => type === 'image' || type === 'adjustment',
  )
  if (!topmost || !engine.selectLayer(topmost.id)) {
    throw new Error('An image layer is required for this command.')
  }
}

const applyFilterCommand = (
  engine: FabricEditorEngine,
  command: ApplyFilterCommand<number, boolean, string>,
  context: CommandExecutionContext,
): void => {
  selectTarget(engine, command.target, context)
  const current = engine.getSelectedImageFilters()
  if (!current) {
    throw new Error('The filter target is not an image layer.')
  }
  const next: Required<ImageFilterSettings> = {
    ...DEFAULT_IMAGE_FILTER_SETTINGS,
    ...current,
  }
  if (command.filter === 'grayscale') {
    if (typeof command.value !== 'boolean') {
      throw new TypeError('grayscale requires a boolean value.')
    }
    next.grayscale = command.value
  } else {
    const value = resolvedNumber(command.value, command.filter)
    next[command.filter] = value
  }
  if (!engine.applyImageFilters(next)) {
    throw new Error(`The ${command.filter} filter could not be applied.`)
  }
}

/**
 * Executes the renderer-neutral automation contract against FabricEditorEngine.
 * Parameters must be resolved before this boundary.
 */
export const executeEditorAutomationCommand = async (
  engine: FabricEditorEngine,
  command: AutomationCommand | ResolvedAutomationCommand,
  context: CommandExecutionContext,
): Promise<CommandExecutionResult> => {
  switch (command.type) {
    case 'resizeCanvas': {
      const width = resolvedNumber(command.width, 'width')
      const height = resolvedNumber(command.height, 'height')
      engine.setCanvasSize(width, height)
      return {}
    }
    case 'resizeImage': {
      const width = resolvedNumber(command.width, 'width')
      const height = resolvedNumber(command.height, 'height')
      selectTarget(engine, { kind: 'activeImage' }, context)
      const transform = engine.getSelectionTransform()
      if (!transform) {
        throw new Error('An image layer must be selected before resizing.')
      }
      const fit = command.fit ?? 'stretch'
      const scale =
        fit === 'stretch'
          ? null
          : fit === 'cover'
            ? Math.max(width / transform.width, height / transform.height)
            : Math.min(width / transform.width, height / transform.height)
      engine.updateSelectionTransform({
        width: scale === null ? width : transform.width * scale,
        height: scale === null ? height : transform.height * scale,
      })
      return {}
    }
    case 'applyFilter':
      applyFilterCommand(
        engine,
        command as ApplyFilterCommand<number, boolean, string>,
        context,
      )
      return {}
    case 'addText': {
      const id = engine.addText(resolvedString(command.text, 'text'), {
        left:
          command.x === undefined ? undefined : resolvedNumber(command.x, 'x'),
        top:
          command.y === undefined ? undefined : resolvedNumber(command.y, 'y'),
        fill:
          command.fill === undefined
            ? undefined
            : resolvedString(command.fill, 'fill'),
        fontSize:
          command.fontSize === undefined
            ? undefined
            : resolvedNumber(command.fontSize, 'fontSize'),
        fontFamily:
          command.fontFamily === undefined
            ? undefined
            : resolvedString(command.fontFamily, 'fontFamily'),
        fontWeight:
          command.fontWeight === undefined
            ? undefined
            : typeof command.fontWeight === 'number'
              ? command.fontWeight
              : resolvedString(command.fontWeight, 'fontWeight'),
        name:
          command.name === undefined
            ? undefined
            : resolvedString(command.name, 'name'),
      })
      if (command.opacity !== undefined) {
        engine.setLayerOpacity(id, resolvedNumber(command.opacity, 'opacity'))
      }
      return { result: id }
    }
    case 'addWatermark':
      return engine.runAtomic('macro', () => {
        const { width, height } = engine.getDocumentSize()
        const fontSize =
          command.fontSize === undefined
            ? Math.max(12, Math.round(Math.min(width, height) * 0.045))
            : resolvedNumber(command.fontSize, 'fontSize')
        const margin =
          command.margin === undefined
            ? Math.max(12, Math.round(fontSize * 0.75))
            : resolvedNumber(command.margin, 'margin')
        const text = resolvedString(command.text, 'text')
        const estimatedWidth = Math.max(fontSize, text.length * fontSize * 0.58)
        const estimatedHeight = fontSize * 1.25
        const position = command.position ?? 'bottomRight'
        const left = position.endsWith('Right')
          ? width - estimatedWidth - margin
          : position === 'center'
            ? (width - estimatedWidth) / 2
            : margin
        const top = position.startsWith('bottom')
          ? height - estimatedHeight - margin
          : position === 'center'
            ? (height - estimatedHeight) / 2
            : margin
        const id = engine.addText(text, {
          left,
          top,
          fill:
            command.color === undefined
              ? '#ffffff'
              : resolvedString(command.color, 'color'),
          fontSize,
          fontFamily:
            command.fontFamily === undefined
              ? 'system-ui, sans-serif'
              : resolvedString(command.fontFamily, 'fontFamily'),
          fontWeight:
            command.fontWeight === undefined
              ? 700
              : typeof command.fontWeight === 'number'
                ? command.fontWeight
                : resolvedString(command.fontWeight, 'fontWeight'),
          name: 'Watermark',
        })
        engine.setLayerOpacity(
          id,
          command.opacity === undefined
            ? 0.72
            : resolvedNumber(command.opacity, 'opacity'),
        )
        return { result: id }
      })
    case 'runScript': {
      const [{ parseEditorScript }, { executeEditorScriptProgram }] =
        await Promise.all([
          import('../scripting/parser'),
          import('./scriptAdapter'),
        ])
      const result = await executeEditorScriptProgram(
        engine,
        parseEditorScript(command.source),
      )
      return { result }
    }
  }
}
