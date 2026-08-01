import { describe, expect, it } from 'vitest'
import { minimalDesignTemplate } from '../test/fixtures/designTemplate'
import { parseDesignTemplate } from '../templates/schema'
import {
  applyBrandKitToTemplate,
  parseBrandKit,
  resolveBrandColor,
  resolveBrandFont,
} from './brandKit'

const source = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: 'acme',
  name: 'Acme',
  palettes: [
    {
      id: 'default',
      name: 'Default',
      colors: {
        primary: '#112233',
        secondary: '#445566',
        accent: '#ff5500',
        background: '#fafafa',
        foreground: '#101010',
      },
    },
    {
      id: 'dark',
      name: 'Dark',
      colors: {
        primary: '#ddeeff',
        secondary: '#aabbcc',
        accent: '#ffaa00',
        background: '#101010',
        foreground: '#ffffff',
      },
    },
  ],
  fonts: {
    heading: { family: 'Bitter', fallback: 'serif', sourceId: 'bitter' },
    body: { family: 'Inter', fallback: 'sans-serif', sourceId: 'inter' },
  },
  logos: [
    {
      id: 'main-logo',
      name: 'Main logo',
      role: 'primary',
      assetId: 'my-brand-logo',
    },
  ],
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
})

describe('brand kit', () => {
  it('validates palettes, project-safe font references, and asset-only logos', () => {
    const kit = parseBrandKit(source())
    expect(resolveBrandColor(kit, 'accent', 'dark')).toBe('#ffaa00')
    expect(resolveBrandFont(kit, 'subheading')).toEqual(kit.fonts.heading)
    expect(kit.logos[0]).toMatchObject({ assetId: 'my-brand-logo' })
    expect(JSON.stringify(kit)).not.toMatch(/data:|ArrayBuffer/u)
  })

  it('applies colors and fonts immutably to a parsed template', () => {
    const kit = parseBrandKit(source())
    const original = parseDesignTemplate(minimalDesignTemplate()).template
    const result = applyBrandKitToTemplate(original, kit, 'dark')

    expect(result.warnings).toEqual([])
    expect(result.template.document.pages[0].background).toBe('#101010')
    expect(result.template.document.pages[0].elements[0]).toMatchObject({
      kind: 'text',
      font: { family: 'Bitter', sourceId: 'bitter' },
      color: '#ffffff',
    })
    expect(result.template.document.pages[0].elements[1]).toMatchObject({
      kind: 'shape',
      fill: '#ffaa00',
    })
    expect(original.document.pages[0].background).toEqual({
      type: 'brand-color',
      role: 'background',
    })
  })

  it('resolves brand logo tokens and warns when an optional role is absent', () => {
    const templateSource = minimalDesignTemplate()
    const document = templateSource.document as Record<string, unknown>
    const pages = document.pages as Array<Record<string, unknown>>
    const elements = pages[0].elements as unknown[]
    elements.push(
      {
        kind: 'asset',
        id: 'main-logo',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        reference: { type: 'brand-logo', role: 'primary' },
      },
      {
        kind: 'asset',
        id: 'alternate-logo',
        x: 0,
        y: 100,
        width: 100,
        height: 100,
        reference: { type: 'brand-logo', role: 'secondary' },
      },
    )
    const template = parseDesignTemplate(templateSource).template
    const result = applyBrandKitToTemplate(template, parseBrandKit(source()))
    expect(result.template.document.pages[0].elements[3]).toMatchObject({
      reference: { type: 'asset', assetId: 'my-brand-logo' },
    })
    expect(result.warnings).toEqual([
      expect.objectContaining({ elementId: 'alternate-logo' }),
    ])
  })

  it('rejects duplicate roles, invalid colors, and unknown palettes', () => {
    const duplicateLogos = [
      {
        id: 'one',
        name: 'One',
        role: 'primary',
        assetId: 'asset-one',
      },
      {
        id: 'two',
        name: 'Two',
        role: 'primary',
        assetId: 'asset-two',
      },
    ]
    expect(() => parseBrandKit(source({ logos: duplicateLogos }))).toThrow(
      /assigned once/u,
    )
    const invalid = source()
    const palettes = invalid.palettes as Array<Record<string, unknown>>
    const colors = palettes[0].colors as Record<string, unknown>
    colors.primary = 'red'
    expect(() => parseBrandKit(invalid)).toThrow(/hex color/u)

    const kit = parseBrandKit(source())
    const template = parseDesignTemplate(minimalDesignTemplate()).template
    expect(() => applyBrandKitToTemplate(template, kit, 'missing')).toThrow(
      /Unknown brand palette/u,
    )
  })
})
