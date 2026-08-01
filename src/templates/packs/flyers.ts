import type { DesignTemplatePack } from '../registry'
import { createBuiltinTemplateSources } from './factory'

export const FLYER_TEMPLATE_PACK: DesignTemplatePack = {
  schemaVersion: 1,
  id: 'templates-flyers',
  templates: createBuiltinTemplateSources({
    packId: 'templates-flyers',
    category: 'flyer',
    width: 1240,
    height: 1754,
    pageCount: 1,
    ids: [
      'flyer-editorial',
      'flyer-event',
      'flyer-sale',
      'flyer-restaurant',
      'flyer-workshop',
      'flyer-real-estate',
    ],
  }),
}
