import type { DesignTemplatePack } from '../registry'
import { createBuiltinTemplateSources } from './factory'

export const BANNER_TEMPLATE_PACK: DesignTemplatePack = {
  schemaVersion: 1,
  id: 'templates-banners',
  templates: createBuiltinTemplateSources({
    packId: 'templates-banners',
    category: 'banner',
    width: 1500,
    height: 500,
    pageCount: 1,
    ids: [
      'banner-sale',
      'banner-event',
      'banner-product',
      'banner-newsletter',
      'banner-webinar',
      'banner-launch',
    ],
  }),
}
