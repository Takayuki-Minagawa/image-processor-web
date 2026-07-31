import type {
  AutomationCommand,
  AutomationScalar,
  ResolvedAutomationCommand,
} from './commands'
import { MAX_AUTOMATION_COMMANDS } from './commands'
import {
  type MacroDocument,
  type MacroParameterDefinition,
  createMacro,
  resolveMacroParameters,
} from './macros'

export type CommandOrigin = 'user' | 'replay' | 'system'

export interface CommandExecutionContext {
  origin: CommandOrigin
  signal?: AbortSignal
  resultAliases: Map<string, unknown>
}

export interface CommandExecutionResult {
  result?: unknown
}

export type CommandExecutor = (
  command: AutomationCommand | ResolvedAutomationCommand,
  context: CommandExecutionContext,
) => void | CommandExecutionResult | Promise<void | CommandExecutionResult>

export interface DispatchOptions {
  origin?: CommandOrigin
  signal?: AbortSignal
  resultAliases?: Map<string, unknown>
}

export interface DispatchedCommandEvent {
  command: AutomationCommand | ResolvedAutomationCommand
  origin: CommandOrigin
  result?: unknown
}

export class CommandDispatcher {
  readonly #executor: CommandExecutor
  readonly #listeners = new Set<(event: DispatchedCommandEvent) => void>()

  constructor(executor: CommandExecutor) {
    this.#executor = executor
  }

  subscribe(listener: (event: DispatchedCommandEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async dispatch(
    command: AutomationCommand | ResolvedAutomationCommand,
    options: DispatchOptions = {},
  ): Promise<CommandExecutionResult> {
    if (options.signal?.aborted) {
      throw new DOMException('The command was cancelled.', 'AbortError')
    }
    const origin = options.origin ?? 'user'
    const aliases = options.resultAliases ?? new Map<string, unknown>()
    const outcome =
      (await this.#executor(command, {
        origin,
        signal: options.signal,
        resultAliases: aliases,
      })) ?? {}
    if (command.commandId) {
      aliases.set(command.commandId, outcome.result)
    }
    const event: DispatchedCommandEvent = {
      command,
      origin,
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
    }
    this.#listeners.forEach((listener) => {
      try {
        listener(event)
      } catch {
        // Recording/telemetry observers must not turn a completed edit into a
        // failed command from the caller's perspective.
      }
    })
    return outcome
  }
}

const cloneCommand = (command: AutomationCommand): AutomationCommand =>
  structuredClone(command)

export class MacroRecorder {
  #recording:
    | {
        id: string
        name: string
        appVersion: string
        startedAt: string
        parameters: MacroParameterDefinition[]
        commands: AutomationCommand[]
        overflowed: boolean
      }
    | undefined
  #detach: (() => void) | undefined

  get isRecording(): boolean {
    return this.#recording !== undefined
  }

  get commandCount(): number {
    return this.#recording?.commands.length ?? 0
  }

  get overflowed(): boolean {
    return this.#recording?.overflowed ?? false
  }

  attach(dispatcher: CommandDispatcher): () => void {
    this.#detach?.()
    const detach = dispatcher.subscribe(({ command, origin }) => {
      if (origin === 'user') {
        this.record(command as AutomationCommand)
      }
    })
    this.#detach = detach
    return () => {
      detach()
      if (this.#detach === detach) {
        this.#detach = undefined
      }
    }
  }

  start(input: {
    id: string
    name: string
    appVersion: string
    parameters?: MacroParameterDefinition[]
    startedAt?: string
  }): void {
    if (this.#recording) {
      throw new Error('A macro recording is already in progress.')
    }
    this.#recording = {
      id: input.id,
      name: input.name,
      appVersion: input.appVersion,
      startedAt: input.startedAt ?? new Date().toISOString(),
      parameters: structuredClone(input.parameters ?? []),
      commands: [],
      overflowed: false,
    }
  }

  record(command: AutomationCommand): void {
    if (!this.#recording) {
      return
    }
    if (this.#recording.commands.length >= MAX_AUTOMATION_COMMANDS) {
      this.#recording.overflowed = true
      return
    }
    this.#recording.commands.push(cloneCommand(command))
  }

  stop(updatedAt = new Date().toISOString()): MacroDocument {
    const recording = this.#recording
    if (!recording) {
      throw new Error('No macro recording is in progress.')
    }
    this.#recording = undefined
    if (recording.overflowed) {
      throw new RangeError(
        `A macro can contain at most ${MAX_AUTOMATION_COMMANDS} commands.`,
      )
    }
    return createMacro({
      appVersion: recording.appVersion,
      id: recording.id,
      name: recording.name,
      createdAt: recording.startedAt,
      updatedAt,
      parameters: recording.parameters,
      commands: recording.commands,
    })
  }

  cancel(): void {
    this.#recording = undefined
  }
}

export interface AtomicReplayAdapter<TSnapshot> {
  captureSnapshot(): TSnapshot | Promise<TSnapshot>
  restoreSnapshot(snapshot: TSnapshot): void | Promise<void>
  /**
   * Must prevent intermediate editor mutations from entering history while
   * still allowing rendering/selection state to update.
   */
  withoutHistory<T>(operation: () => Promise<T>): Promise<T>
  execute(
    command: ResolvedAutomationCommand,
    context: CommandExecutionContext,
  ): void | CommandExecutionResult | Promise<void | CommandExecutionResult>
  /**
   * Commits the final editor state once. The pre-replay state is already the
   * current history entry, so one call gives replay exactly one Undo step.
   */
  commit(label: string): void | Promise<void>
}

export interface MacroReplayResult {
  executedCommands: number
  resultAliases: ReadonlyMap<string, unknown>
}

export class MacroReplayError extends Error {
  readonly rollbackError?: unknown

  constructor(message: string, cause: unknown, rollbackError?: unknown) {
    super(message, { cause })
    this.name = 'MacroReplayError'
    this.rollbackError = rollbackError
  }
}

export const replayMacroAtomic = async <TSnapshot>(
  macro: MacroDocument,
  adapter: AtomicReplayAdapter<TSnapshot>,
  options: {
    parameters?: Readonly<Record<string, AutomationScalar>>
    signal?: AbortSignal
    label?: string
  } = {},
): Promise<MacroReplayResult> => {
  const commands = resolveMacroParameters(macro, options.parameters)
  if (options.signal?.aborted) {
    throw new DOMException('Macro replay was cancelled.', 'AbortError')
  }
  const before = await adapter.captureSnapshot()
  const resultAliases = new Map<string, unknown>()
  let executedCommands = 0

  try {
    await adapter.withoutHistory(async () => {
      for (const command of commands) {
        if (options.signal?.aborted) {
          throw new DOMException('Macro replay was cancelled.', 'AbortError')
        }
        const outcome =
          (await adapter.execute(command, {
            origin: 'replay',
            signal: options.signal,
            resultAliases,
          })) ?? {}
        if (command.commandId) {
          resultAliases.set(command.commandId, outcome.result)
        }
        executedCommands += 1
      }
    })
    await adapter.commit(options.label ?? `マクロ「${macro.name}」を再生`)
    return { executedCommands, resultAliases }
  } catch (error) {
    let rollbackError: unknown
    try {
      await adapter.restoreSnapshot(before)
    } catch (restoreError) {
      rollbackError = restoreError
    }
    throw new MacroReplayError(
      rollbackError
        ? 'Macro replay failed and its rollback also failed.'
        : 'Macro replay failed and the original document was restored.',
      error,
      rollbackError,
    )
  }
}
