import { describe, expect, it, vi } from 'vitest'
import type { ResolvedAutomationCommand } from './commands'
import {
  CommandDispatcher,
  MacroRecorder,
  MacroReplayError,
  replayMacroAtomic,
} from './dispatcher'
import { createMacro, parameter } from './macros'

describe('command dispatch and recording', () => {
  it('records successful user commands but not replay/system commands', async () => {
    const dispatcher = new CommandDispatcher(async (command) => ({
      result: command.type,
    }))
    const recorder = new MacroRecorder()
    recorder.attach(dispatcher)
    recorder.start({
      id: 'recording',
      name: 'Recording',
      appVersion: '0.2.0',
      startedAt: '2026-07-31T00:00:00.000Z',
    })

    await dispatcher.dispatch({
      type: 'resizeCanvas',
      width: 640,
      height: 480,
    })
    await dispatcher.dispatch(
      { type: 'addWatermark', text: 'Replay' },
      { origin: 'replay' },
    )
    const result = await dispatcher.dispatch({
      type: 'addText',
      text: 'Created',
      commandId: 'text',
    })
    const macro = recorder.stop('2026-07-31T00:00:01.000Z')

    expect(result.result).toBe('addText')
    expect(macro.commands.map(({ type }) => type)).toEqual([
      'resizeCanvas',
      'addText',
    ])
  })

  it('does not record a command when execution fails', async () => {
    const dispatcher = new CommandDispatcher(() => {
      throw new Error('failure')
    })
    const recorder = new MacroRecorder()
    recorder.attach(dispatcher)
    recorder.start({
      id: 'recording',
      name: 'Recording',
      appVersion: '0.2.0',
    })

    await expect(
      dispatcher.dispatch({ type: 'addText', text: 'Nope' }),
    ).rejects.toThrow('failure')
    expect(recorder.commandCount).toBe(0)
  })
})

describe('atomic macro replay contract', () => {
  const macro = () =>
    createMacro({
      id: 'atomic',
      name: 'Atomic',
      appVersion: '0.2.0',
      parameters: [
        {
          name: 'text',
          label: 'Text',
          type: 'string',
          required: true,
        },
      ],
      commands: [
        { type: 'resizeImage', width: 64, height: 64 },
        {
          type: 'addWatermark',
          text: parameter('text'),
          commandId: 'watermark',
        },
      ],
    })

  it('suppresses intermediate history and commits exactly once', async () => {
    const events: string[] = []
    const executed: ResolvedAutomationCommand[] = []
    const result = await replayMacroAtomic(
      macro(),
      {
        captureSnapshot: () => {
          events.push('capture')
          return { state: 'before' }
        },
        withoutHistory: async (operation) => {
          events.push('suppress:start')
          const value = await operation()
          events.push('suppress:end')
          return value
        },
        execute: (command) => {
          executed.push(command)
          return { result: command.type }
        },
        restoreSnapshot: () => {
          events.push('restore')
        },
        commit: () => {
          events.push('commit')
        },
      },
      { parameters: { text: 'Resolved' } },
    )

    expect(executed).toMatchObject([
      { type: 'resizeImage' },
      { type: 'addWatermark', text: 'Resolved' },
    ])
    expect(events).toEqual([
      'capture',
      'suppress:start',
      'suppress:end',
      'commit',
    ])
    expect(result.executedCommands).toBe(2)
    expect(result.resultAliases.get('watermark')).toBe('addWatermark')
  })

  it('rolls back partial replay and never commits after a command failure', async () => {
    const restore = vi.fn()
    const commit = vi.fn()
    let calls = 0

    await expect(
      replayMacroAtomic(
        macro(),
        {
          captureSnapshot: () => 'before',
          withoutHistory: (operation) => operation(),
          execute: () => {
            calls += 1
            if (calls === 2) {
              throw new Error('command failed')
            }
          },
          restoreSnapshot: restore,
          commit,
        },
        { parameters: { text: 'Watermark' } },
      ),
    ).rejects.toBeInstanceOf(MacroReplayError)

    expect(restore).toHaveBeenCalledExactlyOnceWith('before')
    expect(commit).not.toHaveBeenCalled()
  })

  it('reports rollback failure and handles pre-aborted replay without mutation', async () => {
    const controller = new AbortController()
    controller.abort()
    const capture = vi.fn()
    await expect(
      replayMacroAtomic(
        macro(),
        {
          captureSnapshot: capture,
          withoutHistory: (operation) => operation(),
          execute: vi.fn(),
          restoreSnapshot: vi.fn(),
          commit: vi.fn(),
        },
        { parameters: { text: 'x' }, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(capture).not.toHaveBeenCalled()

    const error = await replayMacroAtomic(
      macro(),
      {
        captureSnapshot: () => 'before',
        withoutHistory: (operation) => operation(),
        execute: () => {
          throw new Error('failure')
        },
        restoreSnapshot: () => {
          throw new Error('rollback failure')
        },
        commit: vi.fn(),
      },
      { parameters: { text: 'x' } },
    ).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      name: 'MacroReplayError',
      rollbackError: expect.any(Error),
    })
  })
})
