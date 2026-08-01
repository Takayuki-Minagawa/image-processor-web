import { DESIGN_TEMPLATE_SCHEMA_VERSION } from '../../templates/schema'

export const minimalDesignTemplate = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
  id: 'social-card',
  name: 'Social card',
  description: 'A reusable social card',
  category: 'social',
  tags: ['social', 'card'],
  document: {
    width: 1080,
    height: 1080,
    pages: [
      {
        id: 'page-one',
        name: 'Page one',
        background: { type: 'brand-color', role: 'background' },
        elements: [
          {
            kind: 'text',
            id: 'headline',
            x: 80,
            y: 100,
            width: 920,
            height: 240,
            text: 'Headline',
            font: { type: 'brand-font', role: 'heading' },
            fontSize: 96,
            color: { type: 'brand-color', role: 'foreground' },
          },
          {
            kind: 'shape',
            id: 'accent-line',
            x: 80,
            y: 380,
            width: 300,
            height: 20,
            shapeAssetId: 'shape-rounded-rectangle',
            fill: { type: 'brand-color', role: 'accent' },
          },
          {
            kind: 'image-placeholder',
            id: 'photo',
            x: 80,
            y: 450,
            width: 920,
            height: 500,
            acceptedMediaTypes: ['image/png', 'image/jpeg'],
          },
        ],
      },
    ],
  },
  ...overrides,
})
