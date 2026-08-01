import { describe, expect, it } from 'vitest'
import {
  MAX_DESIGN_TEMPLATE_ELEMENTS_PER_PAGE,
  DesignTemplateValidationError,
  loadValidDesignTemplates,
  parseDesignTemplate,
} from './schema'
import { minimalDesignTemplate } from '../test/fixtures/designTemplate'

describe('parseDesignTemplate', () => {
  it('normalizes defaults while preserving brand and image-placeholder tokens', () => {
    const result = parseDesignTemplate(minimalDesignTemplate())
    expect(result.warnings).toEqual([])
    expect(result.template.document.pages[0]).toMatchObject({
      background: { type: 'brand-color', role: 'background' },
      elements: [
        {
          kind: 'text',
          rotation: 0,
          opacity: 1,
          fontWeight: 400,
          align: 'left',
          writingMode: 'horizontal-tb',
          resizeMode: 'wrap',
        },
        {
          kind: 'shape',
          stroke: 'none',
          strokeWidth: 0,
        },
        {
          kind: 'image-placeholder',
          label: 'Image',
          cropMode: 'cover',
        },
      ],
    })
  })

  it('skips unknown, malformed, and duplicate elements with structured warnings', () => {
    const source = minimalDesignTemplate()
    const document = source.document as Record<string, unknown>
    const pages = document.pages as Array<Record<string, unknown>>
    const elements = pages[0].elements as unknown[]
    elements.push(
      { kind: 'future-widget', id: 'future' },
      {
        kind: 'asset',
        id: 'unsafe-asset',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        reference: { type: 'asset', assetId: 'https://evil.test/a.svg' },
      },
      { ...(elements[0] as Record<string, unknown>) },
    )

    const result = parseDesignTemplate(source)
    expect(result.template.document.pages[0].elements).toHaveLength(3)
    expect(result.warnings.map(({ code }) => code)).toEqual([
      'unknown-element',
      'invalid-element',
      'duplicate-element-id',
    ])
  })

  it('rejects unsupported versions, oversized inputs, and duplicate pages', () => {
    expect(() =>
      parseDesignTemplate(minimalDesignTemplate({ schemaVersion: 99 })),
    ).toThrow(expect.objectContaining({ code: 'unsupported-template-version' }))

    const tooMany = minimalDesignTemplate()
    const tooManyDocument = tooMany.document as Record<string, unknown>
    const pages = tooManyDocument.pages as Array<Record<string, unknown>>
    pages[0].elements = Array.from(
      { length: MAX_DESIGN_TEMPLATE_ELEMENTS_PER_PAGE + 1 },
      () => null,
    )
    expect(() => parseDesignTemplate(tooMany)).toThrow(
      expect.objectContaining({ code: 'template-element-limit' }),
    )

    const duplicates = minimalDesignTemplate()
    const duplicateDocument = duplicates.document as Record<string, unknown>
    const duplicatePages = duplicateDocument.pages as unknown[]
    duplicatePages.push(structuredClone(duplicatePages[0]))
    expect(() => parseDesignTemplate(duplicates)).toThrow(/duplicate page id/u)
  })

  it('loads valid templates independently from invalid collection items', () => {
    const result = loadValidDesignTemplates([
      minimalDesignTemplate(),
      { schemaVersion: 1, id: 'broken' },
      minimalDesignTemplate({ id: 'second-card', name: 'Second card' }),
    ])
    expect(result.templates.map(({ id }) => id)).toEqual([
      'social-card',
      'second-card',
    ])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.error).toBeInstanceOf(
      DesignTemplateValidationError,
    )
  })
})
