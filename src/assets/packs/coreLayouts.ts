import type { AssetPack } from '../types'

export const CORE_LAYOUTS_PACK: AssetPack = {
  schemaVersion: 1,
  id: 'core-layouts',
  items: [
    {
      id: 'frame-circle',
      payload: {
        type: 'frame',
        clipShape: { type: 'polygon', sides: 64 },
      },
    },
    {
      id: 'frame-rounded',
      payload: {
        type: 'frame',
        clipShape: { type: 'rounded-rectangle', cornerRadiusRatio: 0.12 },
      },
    },
    {
      id: 'grid-two-columns',
      payload: {
        type: 'grid',
        gapRatio: 0.02,
        cells: [
          { id: 'left', x: 0, y: 0, width: 0.49, height: 1 },
          { id: 'right', x: 0.51, y: 0, width: 0.49, height: 1 },
        ],
      },
    },
    {
      id: 'grid-three-columns',
      payload: {
        type: 'grid',
        gapRatio: 0.02,
        cells: [
          { id: 'left', x: 0, y: 0, width: 0.32, height: 1 },
          { id: 'middle', x: 0.34, y: 0, width: 0.32, height: 1 },
          { id: 'right', x: 0.68, y: 0, width: 0.32, height: 1 },
        ],
      },
    },
    {
      id: 'grid-feature-left',
      payload: {
        type: 'grid',
        gapRatio: 0.02,
        cells: [
          { id: 'feature', x: 0, y: 0, width: 0.66, height: 1 },
          { id: 'top-right', x: 0.68, y: 0, width: 0.32, height: 0.49 },
          {
            id: 'bottom-right',
            x: 0.68,
            y: 0.51,
            width: 0.32,
            height: 0.49,
          },
        ],
      },
    },
  ],
}
