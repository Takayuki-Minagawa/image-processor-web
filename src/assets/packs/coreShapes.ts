import type { AssetPack } from '../types'

export const CORE_SHAPES_PACK: AssetPack = {
  schemaVersion: 1,
  id: 'core-shapes',
  items: [
    {
      id: 'shape-rounded-rectangle',
      payload: {
        type: 'procedural-shape',
        definition: { type: 'rounded-rectangle', cornerRadiusRatio: 0.12 },
      },
    },
    {
      id: 'shape-polygon',
      payload: {
        type: 'procedural-shape',
        definition: { type: 'polygon', sides: 6 },
      },
    },
    {
      id: 'shape-star',
      payload: {
        type: 'procedural-shape',
        definition: { type: 'star', points: 5, innerRadiusRatio: 0.45 },
      },
    },
    {
      id: 'shape-arrow',
      payload: {
        type: 'procedural-shape',
        definition: {
          type: 'arrow',
          direction: 'right',
          shaftRatio: 0.38,
          headLengthRatio: 0.35,
        },
      },
    },
    {
      id: 'shape-speech-bubble',
      payload: {
        type: 'procedural-shape',
        definition: {
          type: 'speech-bubble',
          cornerRadiusRatio: 0.1,
          tailPositionRatio: 0.72,
          tailWidthRatio: 0.22,
          tailHeightRatio: 0.22,
        },
      },
    },
    {
      id: 'shape-line',
      payload: {
        type: 'procedural-shape',
        definition: {
          type: 'line',
          routing: 'straight',
          startMarker: 'none',
          endMarker: 'none',
        },
      },
    },
    {
      id: 'shape-elbow-line',
      payload: {
        type: 'procedural-shape',
        definition: {
          type: 'line',
          routing: 'elbow',
          startMarker: 'none',
          endMarker: 'arrow',
        },
      },
    },
  ],
}
