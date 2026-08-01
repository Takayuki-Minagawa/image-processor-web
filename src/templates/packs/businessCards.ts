import type { DesignTemplatePack } from '../registry'
import { createBuiltinTemplateSources } from './factory'

export const BUSINESS_CARD_TEMPLATE_PACK: DesignTemplatePack = {
  schemaVersion: 1,
  id: 'templates-business-cards',
  templates: createBuiltinTemplateSources({
    packId: 'templates-business-cards',
    category: 'business-card',
    width: 1050,
    height: 600,
    pageCount: 2,
    ids: [
      'business-card-modern',
      'business-card-classic',
      'business-card-minimal',
      'business-card-bold',
      'business-card-creative',
      'business-card-color-block',
    ],
  }),
}
