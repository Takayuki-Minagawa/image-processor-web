import { describe, expect, it, vi } from 'vitest'
import { parseMacro, serializeMacro, validateMacro } from '../automation'
import {
  ScriptMacroRegistrationError,
  createMacroFromSavedScript,
  editorScriptSourceToMacroCommand,
  registerSavedScriptAsMacro,
} from './macroRegistration'
import { createSavedEditorScript } from './savedScripts'

const savedScript = (source: string) =>
  createSavedEditorScript({
    appVersion: '0.1.0',
    id: 'safe-script',
    name: 'Safe script',
    source,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  })

describe('saved script macro registration', () => {
  it('round-trips every valid DSL command as a revalidated runScript command', () => {
    const source = `
      editor.resize(800, 600);
      editor.addText("Pixelweave", {
        left: 24,
        top: 40,
        fill: "#ffffff",
        fontFamily: "sans-serif",
        fontSize: 48,
        fontWeight: 700,
        name: "Title"
      });
      editor.forEachLayer(layer => {
        editor.applyFilter("invert", { amount: 0.5 }, layer.id);
      });
    `
    const macro = createMacroFromSavedScript(savedScript(source), {
      id: 'registered-script',
      name: 'Registered script',
    })

    expect(validateMacro(macro).diagnostics).toEqual([])
    expect(macro).toMatchObject({
      id: 'registered-script',
      name: 'Registered script',
      parameters: [],
      commands: [{ type: 'runScript', source }],
    })
    expect(parseMacro(serializeMacro(macro)).macro).toEqual(macro)
  })

  it('registers only the program reparsed from the saved source', () => {
    const script = savedScript('editor.resize(320, 240);')
    const save = vi.fn()
    const macro = registerSavedScriptAsMacro(
      {
        get: () => ({
          script,
          program: {
            schemaVersion: 1,
            commands: [
              {
                type: 'addText',
                text: 'This untrusted cached program must be ignored',
                options: {},
              },
            ],
          },
        }),
      },
      { save },
      { scriptId: script.id },
    )

    expect(macro.commands).toEqual([
      { type: 'runScript', source: script.source },
    ])
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(macro)
  })

  it('validates before mutating the macro repository', () => {
    const safe = savedScript('editor.resize(10, 10);')
    const unsafe = {
      ...safe,
      source: 'fetch("https://example.com/x")',
    }
    const save = vi.fn()

    expect(() =>
      registerSavedScriptAsMacro(
        {
          get: () => ({
            script: unsafe,
            program: { schemaVersion: 1, commands: [] },
          }),
        },
        { save },
        { scriptId: unsafe.id },
      ),
    ).toThrow(
      expect.objectContaining<Partial<ScriptMacroRegistrationError>>({
        code: 'invalid-script',
      }),
    )
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects forbidden source at the command boundary', () => {
    expect(() =>
      editorScriptSourceToMacroCommand(
        'globalThis.fetch("https://example.com")',
      ),
    ).toThrow(
      expect.objectContaining<Partial<ScriptMacroRegistrationError>>({
        code: 'invalid-script',
        path: 'source',
      }),
    )
  })

  it('reports missing scripts without mutating the macro repository', () => {
    const save = vi.fn()
    expect(() =>
      registerSavedScriptAsMacro(
        { get: () => null },
        { save },
        { scriptId: 'missing' },
      ),
    ).toThrow(
      expect.objectContaining<Partial<ScriptMacroRegistrationError>>({
        code: 'script-not-found',
      }),
    )
    expect(save).not.toHaveBeenCalled()
  })
})
