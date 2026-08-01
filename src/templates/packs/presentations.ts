import type { DesignTemplatePack } from '../registry'
import { createBuiltinTemplateSources } from './factory'

export const PRESENTATION_TEMPLATE_PACK: DesignTemplatePack = {
  schemaVersion: 1,
  id: 'templates-presentations',
  templates: createBuiltinTemplateSources({
    packId: 'templates-presentations',
    category: 'presentation',
    width: 1920,
    height: 1080,
    pageCount: 3,
    ids: [
      'presentation-clean',
      'presentation-pitch',
      'presentation-report',
      'presentation-portfolio',
      'presentation-lesson',
      'presentation-product',
    ],
  }),
}
