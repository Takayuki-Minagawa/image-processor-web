import { describe, expect, it, vi } from 'vitest'
import { minimalDesignTemplate } from '../test/fixtures/designTemplate'
import { DesignTemplateRegistry } from './registry'

describe('DesignTemplateRegistry', () => {
  it('searches lightweight metadata without loading template payloads', async () => {
    const load = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      id: 'social-pack',
      templates: [minimalDesignTemplate()],
    })
    const registry = new DesignTemplateRegistry(
      [
        {
          id: 'social-card',
          packId: 'social-pack',
          name: 'Social card',
          category: 'social',
          tags: ['SNS', '投稿'],
          width: 1080,
          height: 1080,
          pageCount: 1,
        },
      ],
      [{ id: 'social-pack', templateCount: 1, load }],
    )

    expect(registry.search('投稿')).toHaveLength(1)
    expect(load).not.toHaveBeenCalled()
    await registry.loadTemplate('social-card')
    await registry.loadTemplate('social-card')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('rejects a pack whose index dimensions do not match its payload', async () => {
    const registry = new DesignTemplateRegistry(
      [
        {
          id: 'social-card',
          packId: 'social-pack',
          name: 'Social card',
          category: 'social',
          tags: [],
          width: 100,
          height: 100,
          pageCount: 1,
        },
      ],
      [
        {
          id: 'social-pack',
          templateCount: 1,
          load: async () => ({
            schemaVersion: 1,
            id: 'social-pack',
            templates: [minimalDesignTemplate()],
          }),
        },
      ],
    )
    await expect(registry.loadTemplate('social-card')).rejects.toThrow(
      /metadata/u,
    )
  })
})
