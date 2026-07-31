import {
  type MacroDocument,
  type MacroRepository,
  type RunScriptCommand,
  createMacro,
  validateAutomationCommand,
} from '../automation'
import {
  type SavedEditorScript,
  validateSavedEditorScript,
} from './savedScripts'
import type { ScriptRepository } from './scriptRepository'

export type ScriptMacroRegistrationErrorCode =
  'script-not-found' | 'invalid-script'

export class ScriptMacroRegistrationError extends Error {
  readonly code: ScriptMacroRegistrationErrorCode
  readonly path?: string

  constructor(
    code: ScriptMacroRegistrationErrorCode,
    message: string,
    path?: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ScriptMacroRegistrationError'
    this.code = code
    this.path = path
  }
}

/**
 * Keeps the original, bounded DSL source as data. The automation validator
 * reparses it here, macro import reparses it again, and the executor reparses
 * it immediately before use. No JavaScript evaluator is introduced.
 */
export const editorScriptSourceToMacroCommand = (
  source: string,
): RunScriptCommand => {
  const result = validateAutomationCommand(
    { type: 'runScript', source },
    {
      allowParameters: false,
    },
  )
  if (!result.ok || result.command.type !== 'runScript') {
    throw new ScriptMacroRegistrationError(
      'invalid-script',
      result.ok
        ? 'The editor DSL source could not be registered.'
        : result.diagnostic.message,
      'source',
    )
  }
  return result.command
}

export const createMacroFromSavedScript = (
  candidate: SavedEditorScript,
  options: CreateMacroFromSavedScriptOptions = {},
): MacroDocument => {
  try {
    const { script } = validateSavedEditorScript(candidate)
    const command = editorScriptSourceToMacroCommand(script.source)
    return createMacro({
      appVersion: options.appVersion ?? script.appVersion,
      id: options.id ?? script.id,
      name: options.name ?? script.name,
      createdAt: options.createdAt ?? script.createdAt,
      updatedAt: options.updatedAt ?? script.updatedAt,
      commands: [command],
    })
  } catch (error) {
    if (error instanceof ScriptMacroRegistrationError) {
      throw error
    }
    throw new ScriptMacroRegistrationError(
      'invalid-script',
      'The saved script could not be registered as a macro.',
      undefined,
      error,
    )
  }
}

export interface CreateMacroFromSavedScriptOptions {
  appVersion?: string
  id?: string
  name?: string
  createdAt?: string
  updatedAt?: string
}

export interface RegisterSavedScriptAsMacroOptions extends CreateMacroFromSavedScriptOptions {
  scriptId: string
}

/**
 * The macro repository is not mutated until the saved source has been parsed,
 * converted, and accepted by the macro runtime validator.
 */
export const registerSavedScriptAsMacro = (
  scripts: Pick<ScriptRepository, 'get'>,
  macros: Pick<MacroRepository, 'save'>,
  options: RegisterSavedScriptAsMacroOptions,
): MacroDocument => {
  const entry = scripts.get(options.scriptId)
  if (!entry) {
    throw new ScriptMacroRegistrationError(
      'script-not-found',
      `Saved script "${options.scriptId}" was not found.`,
    )
  }
  const macro = createMacroFromSavedScript(entry.script, options)
  macros.save(macro)
  return macro
}
