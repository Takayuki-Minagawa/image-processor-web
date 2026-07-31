import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_FILTER_PRESETS,
  FILTER_PRESET_SCHEMA_VERSION,
  FilterPresetError,
  createFilterPreset,
  parseFilterPreset,
  serializeFilterPreset,
  validateFilterPreset,
} from './presets'

describe('filter presets', () => {
  it('round-trips validated filter chains', () => {
    const preset = createFilterPreset({
      id: 'test-chain',
      name: 'Test chain',
      description: 'A deterministic test preset.',
      filters: [
        { id: 'invert', params: { amount: 0.5 } },
        { id: 'pixelate', params: { size: 4 } },
      ],
    })

    expect(parseFilterPreset(serializeFilterPreset(preset))).toEqual({
      preset,
      warnings: [],
    })
  })

  it('safely skips unknown future filters and preserves known filters', () => {
    const result = validateFilterPreset({
      schemaVersion: FILTER_PRESET_SCHEMA_VERSION,
      id: 'future',
      name: 'Future preset',
      filters: [
        { id: 'future-filter', params: { value: 1 } },
        { id: 'sepia', params: { amount: 0.4 } },
      ],
    })

    expect(result.preset.filters).toEqual([
      { id: 'sepia', params: { amount: 0.4 } },
    ])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({ index: 0 })
  })

  it('rejects malformed known filters instead of silently changing them', () => {
    expect(() =>
      validateFilterPreset({
        schemaVersion: FILTER_PRESET_SCHEMA_VERSION,
        id: 'broken',
        name: 'Broken preset',
        filters: [{ id: 'pixelate', params: { size: 0 } }],
      }),
    ).toThrow(
      expect.objectContaining<Partial<FilterPresetError>>({
        code: 'invalid-preset',
      }),
    )
  })

  it('rejects malformed JSON and unsupported schema versions', () => {
    expect(() => parseFilterPreset('{')).toThrow(
      expect.objectContaining<Partial<FilterPresetError>>({
        code: 'invalid-json',
      }),
    )
    expect(() =>
      validateFilterPreset({
        schemaVersion: 99,
        id: 'future',
        name: 'Future',
        filters: [],
      }),
    ).toThrow(
      expect.objectContaining<Partial<FilterPresetError>>({
        code: 'unsupported-version',
      }),
    )
  })

  it('keeps bundled presets valid', () => {
    expect(BUILT_IN_FILTER_PRESETS.length).toBeGreaterThan(0)
    BUILT_IN_FILTER_PRESETS.forEach((preset) => {
      expect(validateFilterPreset(preset).warnings).toEqual([])
    })
  })
})
