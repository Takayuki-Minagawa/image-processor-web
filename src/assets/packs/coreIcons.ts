import type { AssetPack } from '../types'

const icon = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const CORE_ICONS_PACK: AssetPack = {
  schemaVersion: 1,
  id: 'core-icons',
  items: [
    {
      id: 'icon-heart',
      payload: {
        type: 'svg',
        source: icon(
          '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
        ),
      },
    },
    {
      id: 'icon-camera',
      payload: {
        type: 'svg',
        source: icon(
          '<path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3Z"/><circle cx="12" cy="13" r="3"/>',
        ),
      },
    },
    {
      id: 'icon-sparkles',
      payload: {
        type: 'svg',
        source: icon(
          '<path d="m12 3-1.8 4.7L5.5 9.5l4.7 1.8L12 16l1.8-4.7 4.7-1.8-4.7-1.8Z"/><path d="m19 16-.8 2.2L16 19l2.2.8L19 22l.8-2.2L22 19l-2.2-.8Z"/><path d="m5 2-.7 1.8L2.5 4.5l1.8.7L5 7l.7-1.8 1.8-.7-1.8-.7Z"/>',
        ),
      },
    },
  ],
}
