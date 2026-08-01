import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_DESIGN_TEMPLATE_CATALOG,
  BUILTIN_DESIGN_TEMPLATE_PACK_MANIFESTS,
  createBuiltinDesignTemplateRegistry,
} from './index'
import { DesignTemplateRegistry } from './registry'

describe('built-in design templates', () => {
  it('indexes at least thirty unique templates across the planned categories', () => {
    expect(BUILTIN_DESIGN_TEMPLATE_CATALOG.length).toBeGreaterThanOrEqual(30)
    expect(
      new Set(BUILTIN_DESIGN_TEMPLATE_CATALOG.map(({ id }) => id)).size,
    ).toBe(BUILTIN_DESIGN_TEMPLATE_CATALOG.length)
    expect(
      new Set(BUILTIN_DESIGN_TEMPLATE_CATALOG.map(({ category }) => category)),
    ).toEqual(
      new Set([
        'social',
        'thumbnail',
        'banner',
        'business-card',
        'flyer',
        'presentation',
      ]),
    )
    expect(BUILTIN_DESIGN_TEMPLATE_PACK_MANIFESTS).toHaveLength(6)
  })

  it('searches English and Japanese metadata without loading any payload pack', () => {
    const loaders = BUILTIN_DESIGN_TEMPLATE_PACK_MANIFESTS.map((manifest) => ({
      ...manifest,
      load: vi.fn(manifest.load),
    }))
    const registry = new DesignTemplateRegistry(
      BUILTIN_DESIGN_TEMPLATE_CATALOG,
      loaders,
    )

    expect(registry.search('real estate')[0]?.id).toBe('flyer-real-estate')
    expect(registry.search('不動産 チラシ')[0]?.id).toBe('flyer-real-estate')
    expect(registry.search('SNS 写真')[0]?.id).toBe('social-photo-frame')
    expect(registry.search('', 'presentation')).toHaveLength(6)
    expect(loaders.every(({ load }) => load.mock.calls.length === 0)).toBe(true)
  })

  it('loads only the requested category chunk and caches it', async () => {
    const loaders = BUILTIN_DESIGN_TEMPLATE_PACK_MANIFESTS.map((manifest) => ({
      ...manifest,
      load: vi.fn(manifest.load),
    }))
    const registry = new DesignTemplateRegistry(
      BUILTIN_DESIGN_TEMPLATE_CATALOG,
      loaders,
    )

    await registry.loadTemplate('social-bold')
    await registry.loadTemplate('social-minimal')

    expect(
      loaders.find(({ id }) => id === 'templates-social')?.load,
    ).toHaveBeenCalledTimes(1)
    expect(
      loaders
        .filter(({ id }) => id !== 'templates-social')
        .every(({ load }) => load.mock.calls.length === 0),
    ).toBe(true)
  })

  it('validates every deferred template with no element warnings', async () => {
    const registry = createBuiltinDesignTemplateRegistry()
    const loaded = await Promise.all(
      BUILTIN_DESIGN_TEMPLATE_CATALOG.map(async (entry) => ({
        entry,
        parsed: await registry.loadTemplate(entry.id),
      })),
    )

    expect(loaded).toHaveLength(BUILTIN_DESIGN_TEMPLATE_CATALOG.length)
    for (const { entry, parsed } of loaded) {
      expect(parsed.warnings).toEqual([])
      expect(parsed.template).toMatchObject({
        id: entry.id,
        category: entry.category,
        document: {
          width: entry.width,
          height: entry.height,
        },
      })
      expect(parsed.template.document.pages).toHaveLength(entry.pageCount)
      expect(
        parsed.template.document.pages.every(
          ({ elements }) => elements.length >= 5,
        ),
      ).toBe(true)
    }
  })
})
