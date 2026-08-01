import type {
  BrandColorRole,
  BrandFontRole,
  DesignTemplate,
  DesignTemplateElement,
  DesignTemplatePage,
  TemplateColor,
  TemplateFont,
} from '../schema'

export interface BuiltinTemplatePackOptions {
  packId: string
  category: string
  width: number
  height: number
  pageCount: number
  ids: readonly string[]
}

const brandColor = (role: BrandColorRole): TemplateColor => ({
  type: 'brand-color',
  role,
})

const brandFont = (role: BrandFontRole): TemplateFont => ({
  type: 'brand-font',
  role,
})

const titleFromId = (id: string): string =>
  id
    .split('-')
    .map((word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`)
    .join(' ')

const rounded = (value: number): number => Math.max(1, Math.round(value))

const pageElements = (
  name: string,
  pageIndex: number,
  variant: number,
  width: number,
  height: number,
  category: string,
): DesignTemplateElement[] => {
  const shortEdge = Math.min(width, height)
  const padding = rounded(shortEdge * 0.065)
  const hasPhoto = (variant + pageIndex) % 3 !== 1
  const photoOnLeft = (variant + pageIndex) % 2 === 1
  const contentX = hasPhoto && photoOnLeft ? rounded(width * 0.5) : padding
  const contentWidth = hasPhoto
    ? rounded(width * 0.43)
    : rounded(width - padding * 2)
  const photoX = photoOnLeft ? padding : rounded(width * 0.56)
  const photoWidth = rounded(width * 0.38)
  const headingSize = rounded(shortEdge * (category === 'flyer' ? 0.075 : 0.09))
  const pageSuffix = pageIndex === 0 ? '' : ` — ${pageIndex + 1}`
  const shapeIds = [
    'shape-rounded-rectangle',
    'shape-polygon',
    'shape-star',
  ] as const
  const elements: DesignTemplateElement[] = [
    {
      kind: 'shape',
      id: 'color-field',
      x: variant % 2 === 0 ? 0 : rounded(width * 0.68),
      y: 0,
      width: rounded(width * (variant % 2 === 0 ? 0.34 : 0.32)),
      height,
      rotation: 0,
      opacity: variant % 3 === 0 ? 1 : 0.18,
      shapeAssetId: 'shape-rounded-rectangle',
      fill: brandColor(variant % 3 === 0 ? 'primary' : 'secondary'),
      stroke: 'none',
      strokeWidth: 0,
    },
    {
      kind: 'shape',
      id: 'accent-mark',
      x: contentX,
      y: padding,
      width: rounded(shortEdge * 0.11),
      height: rounded(shortEdge * 0.11),
      rotation: variant * 8,
      opacity: 1,
      shapeAssetId: shapeIds[variant % shapeIds.length],
      fill: brandColor('accent'),
      stroke: 'none',
      strokeWidth: 0,
    },
    {
      kind: 'text',
      id: 'headline',
      x: contentX,
      y: rounded(padding + shortEdge * 0.16),
      width: contentWidth,
      height: rounded(height * 0.28),
      rotation: 0,
      opacity: 1,
      text: `${name}${pageSuffix}`,
      font: brandFont('heading'),
      fontSize: headingSize,
      fontWeight: 700,
      color: brandColor('foreground'),
      align: 'left',
      lineHeight: 1.05,
      letterSpacing: -15,
      writingMode: 'horizontal-tb',
      resizeMode: 'wrap',
    },
    {
      kind: 'text',
      id: 'body-copy',
      x: contentX,
      y: rounded(height * 0.55),
      width: contentWidth,
      height: rounded(height * 0.2),
      rotation: 0,
      opacity: 1,
      text:
        pageIndex === 0
          ? 'Add your message, details, and call to action.'
          : 'Replace this supporting text with your own content.',
      font: brandFont('body'),
      fontSize: rounded(shortEdge * 0.035),
      fontWeight: 400,
      color: brandColor('foreground'),
      align: 'left',
      lineHeight: 1.35,
      letterSpacing: 0,
      writingMode: 'horizontal-tb',
      resizeMode: 'wrap',
    },
    {
      kind: 'shape',
      id: 'call-to-action',
      x: contentX,
      y: rounded(height * 0.81),
      width: rounded(Math.min(contentWidth, shortEdge * 0.42)),
      height: rounded(shortEdge * 0.1),
      rotation: 0,
      opacity: 1,
      shapeAssetId: 'shape-rounded-rectangle',
      fill: brandColor('primary'),
      stroke: 'none',
      strokeWidth: 0,
    },
  ]

  if (hasPhoto) {
    elements.push({
      kind: 'image-placeholder',
      id: 'hero-image',
      x: photoX,
      y: padding,
      width: photoWidth,
      height: rounded(height - padding * 2),
      rotation: 0,
      opacity: 1,
      label: 'Replace image',
      cropMode: 'cover',
      acceptedMediaTypes: ['image/png', 'image/jpeg', 'image/webp'],
    })
  }

  if (category === 'business-card' && pageIndex === 0) {
    elements.push({
      kind: 'asset',
      id: 'brand-logo',
      x: contentX,
      y: rounded(height * 0.72),
      width: rounded(shortEdge * 0.24),
      height: rounded(shortEdge * 0.12),
      rotation: 0,
      opacity: 1,
      reference: { type: 'brand-logo', role: 'primary' },
    })
  }
  return elements
}

const makePage = (
  name: string,
  pageIndex: number,
  variant: number,
  options: BuiltinTemplatePackOptions,
): DesignTemplatePage => ({
  id: `page-${pageIndex + 1}`,
  name:
    options.category === 'business-card'
      ? pageIndex === 0
        ? 'Front'
        : 'Back'
      : pageIndex === 0
        ? 'Title'
        : `Content ${pageIndex}`,
  background: brandColor('background'),
  elements: pageElements(
    name,
    pageIndex,
    variant,
    options.width,
    options.height,
    options.category,
  ),
})

export const createBuiltinTemplateSources = (
  options: BuiltinTemplatePackOptions,
): DesignTemplate[] =>
  options.ids.map((id, variant) => {
    const name = titleFromId(id)
    return {
      schemaVersion: 1,
      id,
      name,
      description: `${name} built-in editable design template.`,
      category: options.category,
      tags: [options.category, 'built-in', 'editable'],
      document: {
        width: options.width,
        height: options.height,
        pages: Array.from({ length: options.pageCount }, (_, pageIndex) =>
          makePage(name, pageIndex, variant, options),
        ),
      },
    }
  })
