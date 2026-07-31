import { describe, expect, it } from 'vitest'
import { EditorScriptError, parseEditorScript } from './parser'

describe('capability-free editor script parser', () => {
  it('emits only whitelisted serializable editor commands', () => {
    const program = parseEditorScript(`
      // A restricted editor recipe, not evaluated JavaScript.
      editor.resize(800, 600);
      editor.addText("Pixelweave", {
        left: 40,
        top: 50,
        fill: "#ffffff",
        fontSize: 48,
        fontWeight: 700
      });
      editor.applyFilter("invert", { amount: 0.25 });
      editor.forEachLayer(layer => {
        editor.applyFilter("sepia", { amount: .5 }, layer.id);
      });
    `)

    expect(program.schemaVersion).toBe(1)
    expect(program.commands).toHaveLength(4)
    expect(program.commands[0]).toEqual({
      type: 'resizeCanvas',
      width: 800,
      height: 600,
    })
    expect(program.commands[1]).toEqual({
      type: 'addText',
      text: 'Pixelweave',
      options: {
        left: 40,
        top: 50,
        fill: '#ffffff',
        fontSize: 48,
        fontWeight: 700,
      },
    })
    expect(program.commands[2]).toMatchObject({
      type: 'applyFilter',
      operation: { id: 'invert', params: { amount: 0.25 } },
    })
    expect(program.commands[3]).toEqual({
      type: 'forEachLayer',
      binding: 'layer',
      commands: [
        {
          type: 'applyFilter',
          operation: { id: 'sepia', params: { amount: 0.5 } },
          targetLayer: {
            kind: 'current-layer',
            binding: 'layer',
            property: 'id',
          },
        },
      ],
    })
    expect(() => JSON.stringify(program)).not.toThrow()
  })

  it('applies registry defaults to partial filter parameter objects', () => {
    const program = parseEditorScript(
      'editor.applyFilter("glitch", { amount: 0.2, seed: 7 });',
    )
    expect(program.commands[0]).toEqual({
      type: 'applyFilter',
      operation: {
        id: 'glitch',
        params: { amount: 0.2, offset: 8, scanlines: 0.2, seed: 7 },
      },
    })
  })

  it.each([
    'fetch("https://example.com")',
    'document.body',
    'globalThis.fetch("/secret")',
    'window.location',
    'self.postMessage("data")',
    'navigator.sendBeacon("/log")',
    'XMLHttpRequest()',
    'WebSocket("wss://example.com")',
    'eval("editor.resize(1, 1)")',
    'Function("return document")()',
    'editor.constructor("return fetch")',
  ])('rejects browser/global capability access: %s', (source) => {
    expect(() => parseEditorScript(source)).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'forbidden-global',
      }),
    )
  })

  it('does not reject capability names inside inert string literals/comments', () => {
    expect(() =>
      parseEditorScript(`
        /* fetch and document are plain comment text. */
        editor.addText("fetch(document) is not executed");
      `),
    ).not.toThrow()
  })

  it('rejects prototype keys, arbitrary property traversal, and unknown APIs', () => {
    expect(() =>
      parseEditorScript(
        'editor.applyFilter("invert", { __proto__: { amount: 1 } });',
      ),
    ).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'forbidden-global',
      }),
    )
    expect(() =>
      parseEditorScript(`
        editor.forEachLayer(layer => {
          editor.applyFilter("invert", {}, layer.constructor);
        });
      `),
    ).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'forbidden-global',
      }),
    )
    expect(() => parseEditorScript('editor.runAnything();')).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'unsupported-command',
      }),
    )
  })

  it('validates dimensions, filter identifiers, and text options', () => {
    expect(() => parseEditorScript('editor.resize(9000, 10);')).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'invalid-argument',
      }),
    )
    expect(() =>
      parseEditorScript('editor.applyFilter("remote-filter", {});'),
    ).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'invalid-argument',
      }),
    )
    expect(() =>
      parseEditorScript('editor.addText("x", { src: "https://x" });'),
    ).toThrow('Unsupported text option')
  })

  it('enforces source, command, collection, and nesting limits', () => {
    expect(() =>
      parseEditorScript('editor.resize(1, 1);', {
        maximumSourceLength: 10,
      }),
    ).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'source-limit',
      }),
    )
    expect(() =>
      parseEditorScript(
        'editor.applyFilter("invert"); editor.applyFilter("sepia");',
        { maximumCommands: 1 },
      ),
    ).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'command-limit',
      }),
    )
    expect(() =>
      parseEditorScript('editor.addText("x", { name: "x", fill: "#fff" });', {
        maximumCollectionEntries: 1,
      }),
    ).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'source-limit',
      }),
    )
    expect(() =>
      parseEditorScript('editor.addText("x", { name: "x" });', {
        maximumNesting: 1,
      }),
    ).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'nesting-limit',
      }),
    )
  })

  it('rejects loops and executable expressions rather than evaluating them', () => {
    expect(() =>
      parseEditorScript('while (true) { editor.resize(1, 1); }'),
    ).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'syntax',
      }),
    )
    expect(() => parseEditorScript('editor.resize(1 + 1, 2);')).toThrow(
      expect.objectContaining<Partial<EditorScriptError>>({
        code: 'syntax',
      }),
    )
  })
})
