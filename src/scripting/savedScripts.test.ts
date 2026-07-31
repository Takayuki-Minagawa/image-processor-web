import { describe, expect, it } from 'vitest'
import {
  EDITOR_SCRIPT_APP_ID,
  EDITOR_SCRIPT_SCHEMA_VERSION,
  SavedEditorScriptError,
  createSavedEditorScript,
  parseSavedEditorScript,
  serializeSavedEditorScript,
  validateSavedEditorScript,
} from './savedScripts'

const input = {
  appVersion: '0.1.0',
  id: 'product-card',
  name: 'Product card',
  source: `
    editor.resize(640, 480);
    editor.addText("Local only", { fill: "#ffffff" });
  `,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
}

describe('saved editor script codec', () => {
  it('round-trips metadata while reparsing the capability-free source', () => {
    const script = createSavedEditorScript(input)
    const entry = parseSavedEditorScript(serializeSavedEditorScript(script))

    expect(entry.script).toEqual({
      appId: EDITOR_SCRIPT_APP_ID,
      schemaVersion: EDITOR_SCRIPT_SCHEMA_VERSION,
      ...input,
    })
    expect(entry.program.commands).toEqual([
      { type: 'resizeCanvas', width: 640, height: 480 },
      {
        type: 'addText',
        text: 'Local only',
        options: { fill: '#ffffff' },
      },
    ])
  })

  it('rejects forbidden source again when loading an otherwise valid envelope', () => {
    expect(() =>
      validateSavedEditorScript({
        appId: EDITOR_SCRIPT_APP_ID,
        schemaVersion: EDITOR_SCRIPT_SCHEMA_VERSION,
        ...input,
        source: 'fetch("https://example.com/secret")',
      }),
    ).toThrow(
      expect.objectContaining<Partial<SavedEditorScriptError>>({
        code: 'invalid-script',
      }),
    )
  })

  it('rejects foreign versions, unknown envelope fields, and invalid JSON', () => {
    const script = createSavedEditorScript(input)
    expect(() =>
      validateSavedEditorScript({ ...script, appId: 'another-app' }),
    ).toThrow(expect.objectContaining({ code: 'invalid-app' }))
    expect(() =>
      validateSavedEditorScript({ ...script, schemaVersion: 99 }),
    ).toThrow(expect.objectContaining({ code: 'unsupported-version' }))
    expect(() =>
      validateSavedEditorScript({ ...script, executable: true }),
    ).toThrow(expect.objectContaining({ code: 'invalid-root' }))
    expect(() => parseSavedEditorScript('{broken')).toThrow(
      expect.objectContaining({ code: 'invalid-json' }),
    )
  })
})
