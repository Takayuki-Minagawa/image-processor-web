import { describe, expect, it } from 'vitest'
import {
  validateExportPreset,
  validateExportPresetSettings,
  validateExportPresetName,
} from './presets'

const image = { kind: 'image', format: 'png', quality: 0.92, multiplier: 1 }
const pdf = {
  kind: 'pdf',
  dpi: 300,
  bleedMm: 3,
  cropMarks: true,
  pdfCompression: 'jpeg',
  jpegQuality: 0.85,
}

describe('export preset validation', () => {
  it('keeps only reusable image settings and returns a fresh value', () => {
    const input = {
      ...image,
      scope: 'all',
      svgScope: 'selection',
      selectedPageIds: ['private-page'],
      width: 4000,
      height: 3000,
      filename: 'private-file',
      dataUrl: 'secret',
    }
    const result = validateExportPresetSettings(input)
    expect(result).toEqual(image)
    expect(result).not.toBe(input)
  })

  it('keeps only reusable PDF settings without document metadata', () => {
    expect(
      validateExportPresetSettings({
        ...pdf,
        selectedPageIds: ['page'],
        physicalSize: { widthMm: 210 },
      }),
    ).toEqual(pdf)
  })

  it.each([
    null,
    [],
    { ...image, kind: 'video' },
    { ...image, format: 'gif' },
    { ...image, quality: NaN },
    { ...image, quality: Infinity },
    { ...image, quality: '0.9' },
    { ...image, quality: 0.09 },
    { ...image, multiplier: 3 },
    { ...image, multiplier: '1' },
    { ...pdf, dpi: 71 },
    { ...pdf, dpi: 601 },
    { ...pdf, dpi: NaN },
    { ...pdf, bleedMm: -1 },
    { ...pdf, bleedMm: 21 },
    { ...pdf, cropMarks: 'true' },
    { ...pdf, pdfCompression: 'raw' },
    { ...pdf, jpegQuality: 1.01 },
    { ...pdf, jpegQuality: 0 },
  ])('rejects settings that the output UI cannot represent: %j', (value) => {
    expect(() => validateExportPresetSettings(value)).toThrow(
      expect.objectContaining({ code: 'invalid-settings' }),
    )
  })

  it('accepts the exact supported scale and numeric boundary values', () => {
    for (const multiplier of [0.5, 1, 2]) {
      expect(
        validateExportPresetSettings({ ...image, multiplier, quality: 0.1 }),
      ).toMatchObject({ multiplier })
    }
    expect(
      validateExportPresetSettings({
        ...pdf,
        dpi: 72,
        bleedMm: 0,
        jpegQuality: 0.1,
      }),
    ).toMatchObject({ dpi: 72, bleedMm: 0 })
    expect(
      validateExportPresetSettings({
        ...pdf,
        dpi: 600,
        bleedMm: 20,
        jpegQuality: 1,
      }),
    ).toMatchObject({ dpi: 600, bleedMm: 20 })
  })

  it('trims bounded names and rejects empty or oversized names', () => {
    expect(validateExportPresetName('  印刷用  ')).toBe('印刷用')
    expect(validateExportPresetName('a'.repeat(80))).toHaveLength(80)
    for (const name of ['', ' \n ', 'a'.repeat(81), 5]) {
      expect(() => validateExportPresetName(name)).toThrow(
        expect.objectContaining({ code: 'invalid-name' }),
      )
    }
  })

  it('validates identifiers and strips arbitrary record fields', () => {
    expect(
      validateExportPreset({
        id: 'preset-1',
        name: '  Web  ',
        settings: image,
        secret: 'value',
      }),
    ).toEqual({ id: 'preset-1', name: 'Web', settings: image })
    for (const id of ['', 'a'.repeat(101), '../other', 42]) {
      expect(() =>
        validateExportPreset({ id, name: 'Web', settings: image }),
      ).toThrow(expect.objectContaining({ code: 'invalid-preset' }))
    }
  })
})
