import { describe, expect, it } from 'vitest'
import {
  MAX_AUTOMATION_SCRIPT_SOURCE_LENGTH,
  assertBatchSafeCommands,
  isBatchSafeCommand,
  validateAutomationCommand,
} from './commands'
import { parameter } from './macros'

describe('automation command schema', () => {
  it('accepts serializable commands with parameter references and semantic targets', () => {
    const result = validateAutomationCommand({
      type: 'applyFilter',
      filter: 'brightness',
      value: parameter('brightness'),
      target: { kind: 'topmostImage' },
    })

    expect(result).toEqual({
      ok: true,
      command: {
        type: 'applyFilter',
        filter: 'brightness',
        value: { $parameter: 'brightness' },
        target: { kind: 'topmostImage' },
      },
    })
  })

  it('distinguishes unknown commands from malformed known commands', () => {
    const unknown = validateAutomationCommand({
      type: 'launchMissiles',
      nested: { payload: new Array(100).fill('ignored') },
    })
    const malformed = validateAutomationCommand({
      type: 'resizeImage',
      width: 0,
      height: 20,
    })

    expect(unknown).toMatchObject({
      ok: false,
      diagnostic: { code: 'unknown-command', severity: 'warning' },
    })
    expect(malformed).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-command', severity: 'error' },
    })
  })

  it('rejects unsafe dimensions, non-finite values, raw layer identifiers, and loose parameter objects', () => {
    expect(
      validateAutomationCommand({
        type: 'resizeImage',
        width: 8_192,
        height: 8_192,
      }).ok,
    ).toBe(true)
    expect(
      validateAutomationCommand({
        type: 'resizeImage',
        width: 8_193,
        height: 1,
      }).ok,
    ).toBe(false)
    expect(
      validateAutomationCommand({
        type: 'applyFilter',
        filter: 'blur',
        value: Number.POSITIVE_INFINITY,
      }).ok,
    ).toBe(false)
    expect(
      validateAutomationCommand({
        type: 'applyFilter',
        filter: 'blur',
        value: 0.5,
        target: { kind: 'layerId', id: 'renderer-specific-id' },
      }).ok,
    ).toBe(false)
    expect(
      validateAutomationCommand({
        type: 'addWatermark',
        text: { $parameter: 'text', unexpected: true },
      }).ok,
    ).toBe(false)
    expect(
      validateAutomationCommand({
        type: 'addWatermark',
        text: 'Safe',
        hiddenPayload: { arbitrary: true },
      }).ok,
    ).toBe(false)
  })

  it('exposes batch-safe metadata and rejects selection-dependent targets', () => {
    expect(
      isBatchSafeCommand({
        type: 'resizeImage',
        width: 192,
        height: 192,
      }),
    ).toBe(true)
    expect(
      isBatchSafeCommand({
        type: 'resizeCanvas',
        width: 192,
        height: 192,
      }),
    ).toBe(false)
    expect(
      isBatchSafeCommand({
        type: 'applyFilter',
        filter: 'contrast',
        value: 0.2,
        target: { kind: 'layerName', name: 'Photo' },
      }),
    ).toBe(false)
    expect(() =>
      assertBatchSafeCommands([
        {
          type: 'addText',
          text: 'Editable layer',
        },
      ]),
    ).toThrow(/cannot be replayed/)
    expect(
      isBatchSafeCommand({
        type: 'runScript',
        source: 'editor.resize(10, 10);',
      }),
    ).toBe(false)
  })

  it('accepts only bounded, capability-free DSL in runScript commands', () => {
    const source = `
      editor.resize(640, 480);
      editor.forEachLayer(layer => {
        editor.applyFilter("invert", { amount: 0.5 }, layer.id);
      });
    `
    expect(validateAutomationCommand({ type: 'runScript', source })).toEqual({
      ok: true,
      command: { type: 'runScript', source },
    })

    for (const forbidden of [
      'fetch("https://example.com")',
      'document.body',
      'globalThis.fetch("/secret")',
    ]) {
      expect(
        validateAutomationCommand({ type: 'runScript', source: forbidden }),
      ).toMatchObject({
        ok: false,
        diagnostic: { code: 'invalid-command' },
      })
    }
    expect(
      validateAutomationCommand({
        type: 'runScript',
        source: ' '.repeat(MAX_AUTOMATION_SCRIPT_SOURCE_LENGTH + 1),
      }).ok,
    ).toBe(false)
  })
})
