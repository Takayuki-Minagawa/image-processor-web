import type { DesignTemplatePack } from '../registry'
import { createBuiltinTemplateSources } from './factory'

export const SOCIAL_TEMPLATE_PACK: DesignTemplatePack = {
  schemaVersion: 1,
  id: 'templates-social',
  templates: createBuiltinTemplateSources({
    packId: 'templates-social',
    category: 'social',
    width: 1080,
    height: 1080,
    pageCount: 1,
    ids: [
      'social-bold',
      'social-minimal',
      'social-gradient',
      'social-photo-frame',
      'social-quote',
      'social-announcement',
    ],
  }),
}
