import { describe, expect, it } from 'vitest'
import {
  MACRO_APP_ID,
  MACRO_SCHEMA_VERSION,
  MAX_MACRO_SOURCE_LENGTH,
  MacroFormatError,
  MacroParameterError,
  createMacro,
  parameter,
  parseMacro,
  resolveMacroParameters,
  serializeMacro,
} from './macros'

const baseMacro = () =>
  createMacro({
    appVersion: '0.2.0',
    id: 'web-watermark',
    name: 'Web watermark',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:01.000Z',
    parameters: [
      {
        name: 'width',
        label: 'Width',
        type: 'number',
        required: true,
        minimum: 1,
        maximum: 8_192,
      },
      {
        name: 'text',
        label: 'Watermark',
        type: 'string',
        default: 'Pixelweave',
      },
    ],
    commands: [
      {
        type: 'resizeImage',
        width: parameter('width'),
        height: 512,
        fit: 'contain',
        background: 'transparent',
      },
      {
        type: 'addWatermark',
        text: parameter('text'),
        position: 'bottomRight',
      },
    ],
  })

describe('macro v1 codec', () => {
  it('round-trips a versioned macro and resolves typed parameters', () => {
    const source = serializeMacro(baseMacro())
    const parsed = parseMacro(source)
    const commands = resolveMacroParameters(parsed.macro, {
      width: 640,
      text: 'Sample',
    })

    expect(parsed.diagnostics).toEqual([])
    expect(parsed.macro).toMatchObject({
      appId: MACRO_APP_ID,
      schemaVersion: MACRO_SCHEMA_VERSION,
      appVersion: '0.2.0',
      name: 'Web watermark',
    })
    expect(commands).toMatchObject([
      { type: 'resizeImage', width: 640, height: 512 },
      { type: 'addWatermark', text: 'Sample' },
    ])
  })

  it('safely skips unknown and malformed commands with indexed diagnostics', () => {
    const source = JSON.stringify({
      ...baseMacro(),
      commands: [
        { type: 'futureCommand', arbitrary: { deeply: ['nested'] } },
        { type: 'resizeImage', width: -1, height: 10 },
        { type: 'addWatermark', text: 'Safe' },
      ],
    })
    const parsed = parseMacro(source)

    expect(parsed.macro.commands).toEqual([
      { type: 'addWatermark', text: 'Safe' },
    ])
    expect(parsed.diagnostics).toMatchObject([
      { code: 'unknown-command', commandIndex: 0, severity: 'warning' },
      { code: 'invalid-command', commandIndex: 1, severity: 'error' },
    ])
  })

  it('revalidates runScript source during macro import', () => {
    const parsed = parseMacro(
      JSON.stringify({
        ...baseMacro(),
        commands: [
          {
            type: 'runScript',
            source: 'fetch("https://example.com/secret")',
          },
          {
            type: 'runScript',
            source: 'editor.applyFilter("invert", { amount: 0.5 });',
          },
        ],
      }),
    )

    expect(parsed.macro.commands).toEqual([
      {
        type: 'runScript',
        source: 'editor.applyFilter("invert", { amount: 0.5 });',
      },
    ])
    expect(parsed.diagnostics).toMatchObject([
      { code: 'invalid-command', commandIndex: 0, severity: 'error' },
    ])
  })

  it('skips commands with undefined references and duplicate result aliases', () => {
    const source = JSON.stringify({
      ...baseMacro(),
      commands: [
        { type: 'addWatermark', text: parameter('missing') },
        { type: 'addText', text: 'One', commandId: 'created' },
        { type: 'addText', text: 'Two', commandId: 'created' },
      ],
    })
    const parsed = parseMacro(source)

    expect(parsed.macro.commands).toHaveLength(1)
    expect(parsed.diagnostics.map(({ code }) => code)).toEqual([
      'unresolved-parameter',
      'invalid-command',
    ])
  })

  it('rejects oversized, malformed, foreign, and unsupported envelopes', () => {
    expect(() => parseMacro('x'.repeat(MAX_MACRO_SOURCE_LENGTH + 1))).toThrow(
      expect.objectContaining({ code: 'source-too-large' }),
    )
    expect(() => parseMacro('{broken')).toThrow(
      expect.objectContaining({ code: 'invalid-json' }),
    )
    expect(() =>
      parseMacro(JSON.stringify({ ...baseMacro(), appId: 'other-app' })),
    ).toThrow(expect.objectContaining({ code: 'invalid-app' }))
    expect(() =>
      parseMacro(JSON.stringify({ ...baseMacro(), schemaVersion: 99 })),
    ).toThrow(expect.objectContaining({ code: 'unsupported-version' }))
  })

  it('rejects wrong, missing, unknown, and out-of-range parameter values before replay', () => {
    const macro = baseMacro()
    expect(() => resolveMacroParameters(macro)).toThrow(MacroParameterError)
    expect(() => resolveMacroParameters(macro, { width: 'wide' })).toThrow(
      /wrong type/,
    )
    expect(() => resolveMacroParameters(macro, { width: 9_000 })).toThrow(
      /outside/,
    )
    expect(() =>
      resolveMacroParameters(macro, { width: 640, extra: true }),
    ).toThrow(/Unknown/)
  })

  it('refuses to serialize an invalid in-memory envelope', () => {
    expect(() =>
      serializeMacro({
        ...baseMacro(),
        name: '',
      }),
    ).toThrow(MacroFormatError)
  })
})
