import { describe, expect, it } from 'vitest'
import {
  BUILTIN_LOGO_TEMPLATES,
  BUILTIN_LOGO_TEMPLATE_SOURCES,
} from './templates'
import {
  LOGO_TEMPLATE_SCHEMA_VERSION,
  MAX_LOGO_TEMPLATE_ELEMENTS,
  LogoTemplateValidationError,
  loadValidLogoTemplates,
  parseLogoTemplate,
} from './templateSchema'

const minimalTemplate = (
  id = 'minimal',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schemaVersion: LOGO_TEMPLATE_SCHEMA_VERSION,
  id,
  name: 'Minimal',
  category: 'test',
  canvas: { width: 1000, height: 1000 },
  elements: [
    {
      kind: 'text',
      id: 'name',
      slot: 'name',
      font: 'display',
      color: 'foreground',
      x: 100,
      y: 100,
      fontSize: 100,
      maxWidth: 800,
    },
  ],
  ...overrides,
})

describe('bundled logo templates', () => {
  it('ships at least twenty valid, uniquely identified templates', () => {
    expect(BUILTIN_LOGO_TEMPLATE_SOURCES.length).toBeGreaterThanOrEqual(20)
    expect(BUILTIN_LOGO_TEMPLATES).toHaveLength(
      BUILTIN_LOGO_TEMPLATE_SOURCES.length,
    )
    expect(new Set(BUILTIN_LOGO_TEMPLATES.map(({ id }) => id)).size).toBe(
      BUILTIN_LOGO_TEMPLATES.length,
    )
    expect(
      new Set(BUILTIN_LOGO_TEMPLATES.map(({ category }) => category)).size,
    ).toBeGreaterThanOrEqual(6)
    for (const template of BUILTIN_LOGO_TEMPLATES) {
      expect(template.elements.some(({ kind }) => kind === 'text')).toBe(true)
    }
  })
})

describe('parseLogoTemplate', () => {
  it('normalizes optional element properties to safe defaults', () => {
    const template = parseLogoTemplate(minimalTemplate())
    expect(template.elements[0]).toMatchObject({
      kind: 'text',
      id: 'name',
      rotation: 0,
      opacity: 1,
      fontWeight: 600,
      letterSpacing: 0,
      lineHeight: 1.1,
      align: 'left',
      uppercase: false,
    })
  })

  it('rejects unknown versions, unsafe ids, and duplicate element ids', () => {
    expect(() =>
      parseLogoTemplate(minimalTemplate('minimal', { schemaVersion: 99 })),
    ).toThrow(
      expect.objectContaining({
        code: 'unsupported-template-version',
        path: '$.schemaVersion',
      }),
    )
    expect(() => parseLogoTemplate(minimalTemplate('../escape'))).toThrow(
      expect.objectContaining({ path: '$.id' }),
    )
    expect(() =>
      parseLogoTemplate(
        minimalTemplate('duplicates', {
          elements: [
            {
              kind: 'text',
              id: 'same',
              slot: 'name',
              font: 'display',
              color: 'foreground',
              x: 0,
              y: 0,
              fontSize: 20,
              maxWidth: 100,
            },
            {
              kind: 'shape',
              id: 'same',
              shape: 'rect',
              x: 0,
              y: 0,
              width: 20,
              height: 20,
            },
          ],
        }),
      ),
    ).toThrow(/duplicate id/i)
  })

  it('enforces element count and finite coordinate limits', () => {
    const elements = Array.from(
      { length: MAX_LOGO_TEMPLATE_ELEMENTS + 1 },
      (_, index) => ({
        kind: 'text',
        id: `text-${index}`,
        slot: 'name',
        font: 'display',
        color: 'foreground',
        x: 0,
        y: 0,
        fontSize: 20,
        maxWidth: 100,
      }),
    )
    expect(() =>
      parseLogoTemplate(minimalTemplate('too-many', { elements })),
    ).toThrow(expect.objectContaining({ code: 'template-element-limit' }))
    expect(() =>
      parseLogoTemplate(
        minimalTemplate('non-finite', {
          elements: [
            {
              kind: 'text',
              id: 'name',
              slot: 'name',
              font: 'display',
              color: 'foreground',
              x: Number.POSITIVE_INFINITY,
              y: 0,
              fontSize: 20,
              maxWidth: 100,
            },
          ],
        }),
      ),
    ).toThrow(expect.objectContaining({ path: '$.elements[0].x' }))
  })

  it('excludes only the invalid item when loading a template collection', () => {
    const result = loadValidLogoTemplates([
      minimalTemplate('valid-one'),
      { schemaVersion: 1, id: 'broken' },
      minimalTemplate('valid-two'),
    ])

    expect(result.templates.map(({ id }) => id)).toEqual([
      'valid-one',
      'valid-two',
    ])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({
      index: 1,
      error: expect.any(LogoTemplateValidationError),
    })
  })
})
