import type { DesignTemplatePack } from '../registry'
import { createBuiltinTemplateSources } from './factory'

export const THUMBNAIL_TEMPLATE_PACK: DesignTemplatePack = {
  schemaVersion: 1,
  id: 'templates-thumbnails',
  templates: createBuiltinTemplateSources({
    packId: 'templates-thumbnails',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    pageCount: 1,
    ids: [
      'thumbnail-focus',
      'thumbnail-versus',
      'thumbnail-tutorial',
      'thumbnail-review',
      'thumbnail-live',
      'thumbnail-list',
    ],
  }),
}
