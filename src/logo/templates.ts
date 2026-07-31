import {
  LOGO_TEMPLATE_SCHEMA_VERSION,
  loadValidLogoTemplates,
  type LogoColorSlot,
  type LogoFontSlot,
  type LogoTemplate,
  type LogoTextSlot,
} from './templateSchema'

interface TextOptions {
  font?: LogoFontSlot
  color?: LogoColorSlot
  fontWeight?: number
  letterSpacing?: number
  lineHeight?: number
  align?: 'left' | 'center' | 'right'
  uppercase?: boolean
  rotation?: number
  opacity?: number
}

interface ShapeOptions {
  fill?: LogoColorSlot | 'none'
  stroke?: LogoColorSlot | 'none'
  strokeWidth?: number
  cornerRadius?: number
  rotation?: number
  opacity?: number
}

const text = (
  id: string,
  slot: LogoTextSlot,
  x: number,
  y: number,
  fontSize: number,
  maxWidth: number,
  options: TextOptions = {},
): Record<string, unknown> => ({
  kind: 'text',
  id,
  slot,
  x,
  y,
  fontSize,
  maxWidth,
  font: options.font ?? (slot === 'tagline' ? 'body' : 'display'),
  color: options.color ?? 'foreground',
  fontWeight: options.fontWeight ?? (slot === 'tagline' ? 500 : 700),
  letterSpacing: options.letterSpacing ?? (slot === 'tagline' ? 80 : 0),
  lineHeight: options.lineHeight ?? 1.1,
  align: options.align ?? 'left',
  uppercase: options.uppercase ?? false,
  rotation: options.rotation ?? 0,
  opacity: options.opacity ?? 1,
})

const shape = (
  id: string,
  shapeKind: 'rect' | 'ellipse',
  x: number,
  y: number,
  width: number,
  height: number,
  options: ShapeOptions = {},
): Record<string, unknown> => ({
  kind: 'shape',
  id,
  shape: shapeKind,
  x,
  y,
  width,
  height,
  fill: options.fill ?? 'primary',
  stroke: options.stroke ?? 'none',
  strokeWidth: options.strokeWidth ?? 0,
  cornerRadius: options.cornerRadius ?? 0,
  rotation: options.rotation ?? 0,
  opacity: options.opacity ?? 1,
})

const template = (
  id: string,
  name: string,
  category: string,
  elements: readonly Record<string, unknown>[],
  canvas = { width: 1_000, height: 1_000 },
): Record<string, unknown> => ({
  schemaVersion: LOGO_TEMPLATE_SCHEMA_VERSION,
  id,
  name,
  category,
  canvas,
  elements,
})

export const BUILTIN_LOGO_TEMPLATE_SOURCES: readonly Record<string, unknown>[] =
  [
    template('clean-wordmark', 'Clean Wordmark', 'wordmark', [
      text('name', 'name', 90, 390, 150, 820, { letterSpacing: 20 }),
      text('tagline', 'tagline', 96, 575, 42, 790, {
        color: 'secondary',
        uppercase: true,
      }),
    ]),
    template('underline-wordmark', 'Underline Wordmark', 'wordmark', [
      text('name', 'name', 100, 350, 142, 800, { uppercase: true }),
      shape('underline', 'rect', 100, 530, 800, 26, {
        fill: 'accent',
        cornerRadius: 13,
      }),
      text('tagline', 'tagline', 100, 600, 38, 800, {
        color: 'secondary',
      }),
    ]),
    template('circle-monogram', 'Circle Monogram', 'monogram', [
      shape('disc', 'ellipse', 170, 120, 660, 660, {
        fill: 'primary',
      }),
      text('initials', 'initials', 250, 285, 260, 500, {
        color: 'background',
        align: 'center',
        letterSpacing: 35,
      }),
      text('name', 'name', 130, 830, 72, 740, {
        align: 'center',
        uppercase: true,
      }),
    ]),
    template('square-monogram', 'Square Monogram', 'monogram', [
      shape('tile', 'rect', 180, 130, 640, 640, {
        fill: 'primary',
        cornerRadius: 96,
      }),
      shape('inset', 'rect', 230, 180, 540, 540, {
        fill: 'none',
        stroke: 'accent',
        strokeWidth: 18,
        cornerRadius: 64,
      }),
      text('initials', 'initials', 260, 315, 230, 480, {
        color: 'background',
        align: 'center',
      }),
      text('name', 'name', 150, 825, 68, 700, { align: 'center' }),
    ]),
    template('pill-signature', 'Pill Signature', 'badge', [
      shape('pill', 'rect', 80, 310, 840, 380, {
        fill: 'primary',
        cornerRadius: 190,
      }),
      text('name', 'name', 160, 395, 118, 680, {
        color: 'background',
        align: 'center',
      }),
      text('tagline', 'tagline', 190, 555, 32, 620, {
        color: 'background',
        align: 'center',
        uppercase: true,
      }),
    ]),
    template('split-panel', 'Split Panel', 'geometric', [
      shape('left-panel', 'rect', 80, 120, 330, 760, {
        fill: 'primary',
        cornerRadius: 40,
      }),
      shape('right-panel', 'rect', 410, 120, 510, 760, {
        fill: 'background',
        stroke: 'primary',
        strokeWidth: 12,
        cornerRadius: 40,
      }),
      text('initials', 'initials', 115, 370, 165, 260, {
        color: 'background',
        align: 'center',
      }),
      text('name', 'name', 470, 345, 104, 390, {
        color: 'primary',
      }),
      text('tagline', 'tagline', 475, 515, 34, 370, {
        color: 'secondary',
      }),
    ]),
    template('stacked-center', 'Stacked Center', 'stacked', [
      text('initials', 'initials', 250, 185, 220, 500, {
        color: 'primary',
        align: 'center',
      }),
      shape('divider', 'rect', 300, 455, 400, 18, {
        fill: 'accent',
        cornerRadius: 9,
      }),
      text('name', 'name', 140, 525, 92, 720, {
        align: 'center',
        uppercase: true,
      }),
      text('tagline', 'tagline', 180, 670, 34, 640, {
        color: 'secondary',
        align: 'center',
      }),
    ]),
    template('badge-ring', 'Badge Ring', 'badge', [
      shape('outer-ring', 'ellipse', 110, 110, 780, 780, {
        fill: 'none',
        stroke: 'primary',
        strokeWidth: 34,
      }),
      shape('inner-disc', 'ellipse', 205, 205, 590, 590, {
        fill: 'secondary',
      }),
      text('initials', 'initials', 270, 325, 205, 460, {
        color: 'background',
        align: 'center',
      }),
      text('name', 'name', 220, 585, 58, 560, {
        color: 'background',
        align: 'center',
        uppercase: true,
      }),
    ]),
    template('corner-frame', 'Corner Frame', 'geometric', [
      shape('top', 'rect', 100, 100, 520, 24, { fill: 'primary' }),
      shape('left', 'rect', 100, 100, 24, 520, { fill: 'primary' }),
      shape('bottom', 'rect', 380, 876, 520, 24, { fill: 'accent' }),
      shape('right', 'rect', 876, 380, 24, 520, { fill: 'accent' }),
      text('initials', 'initials', 190, 245, 190, 400, {
        color: 'primary',
      }),
      text('name', 'name', 190, 505, 88, 620),
      text('tagline', 'tagline', 194, 635, 34, 590, {
        color: 'secondary',
      }),
    ]),
    template('side-mark', 'Side Mark', 'combination', [
      shape('mark', 'ellipse', 90, 300, 330, 330, { fill: 'primary' }),
      text('initials', 'initials', 130, 390, 120, 250, {
        color: 'background',
        align: 'center',
      }),
      text('name', 'name', 475, 340, 105, 430),
      text('tagline', 'tagline', 480, 500, 34, 400, {
        color: 'secondary',
      }),
    ]),
    template('double-bar', 'Double Bar', 'wordmark', [
      shape('bar-top', 'rect', 100, 210, 800, 34, {
        fill: 'primary',
        cornerRadius: 17,
      }),
      text('name', 'name', 120, 350, 135, 760, {
        align: 'center',
        uppercase: true,
      }),
      text('tagline', 'tagline', 180, 535, 36, 640, {
        color: 'secondary',
        align: 'center',
      }),
      shape('bar-bottom', 'rect', 100, 690, 800, 34, {
        fill: 'accent',
        cornerRadius: 17,
      }),
    ]),
    template('offset-shadow', 'Offset Shadow', 'playful', [
      shape('shadow', 'rect', 205, 225, 610, 610, {
        fill: 'accent',
        cornerRadius: 74,
        rotation: 6,
      }),
      shape('card', 'rect', 150, 165, 610, 610, {
        fill: 'primary',
        cornerRadius: 74,
        rotation: -4,
      }),
      text('initials', 'initials', 225, 300, 205, 460, {
        color: 'background',
        align: 'center',
        rotation: -4,
      }),
      text('name', 'name', 160, 830, 66, 680, { align: 'center' }),
    ]),
    template('vertical-sign', 'Vertical Sign', 'stacked', [
      shape('spine', 'rect', 145, 90, 28, 820, {
        fill: 'accent',
        cornerRadius: 14,
      }),
      text('initials', 'initials', 245, 145, 180, 560, {
        color: 'primary',
      }),
      text('name', 'name', 245, 420, 96, 600, {
        uppercase: true,
      }),
      text('tagline', 'tagline', 250, 585, 34, 520, {
        color: 'secondary',
      }),
    ]),
    template('minimalist-dot', 'Minimalist Dot', 'minimal', [
      shape('dot', 'ellipse', 100, 420, 92, 92, { fill: 'accent' }),
      text('name', 'name', 235, 375, 120, 650, {
        letterSpacing: 10,
      }),
      text('tagline', 'tagline', 240, 545, 32, 610, {
        color: 'secondary',
      }),
    ]),
    template('bracketed', 'Bracketed', 'geometric', [
      shape('left-top', 'rect', 100, 180, 230, 24, { fill: 'primary' }),
      shape('left-side', 'rect', 100, 180, 24, 640, { fill: 'primary' }),
      shape('left-bottom', 'rect', 100, 796, 230, 24, { fill: 'primary' }),
      shape('right-top', 'rect', 670, 180, 230, 24, { fill: 'accent' }),
      shape('right-side', 'rect', 876, 180, 24, 640, { fill: 'accent' }),
      shape('right-bottom', 'rect', 670, 796, 230, 24, { fill: 'accent' }),
      text('initials', 'initials', 265, 300, 205, 470, {
        align: 'center',
        color: 'primary',
      }),
      text('name', 'name', 240, 575, 76, 520, {
        align: 'center',
      }),
    ]),
    template('horizon', 'Horizon', 'landscape', [
      shape('sun', 'ellipse', 365, 165, 270, 270, { fill: 'accent' }),
      shape('horizon', 'rect', 110, 455, 780, 28, {
        fill: 'primary',
        cornerRadius: 14,
      }),
      text('name', 'name', 120, 535, 108, 760, {
        align: 'center',
      }),
      text('tagline', 'tagline', 190, 690, 32, 620, {
        align: 'center',
        color: 'secondary',
      }),
    ]),
    template('capsule-initials', 'Capsule Initials', 'combination', [
      shape('capsule', 'rect', 90, 260, 360, 480, {
        fill: 'secondary',
        cornerRadius: 180,
      }),
      text('initials', 'initials', 135, 405, 135, 270, {
        color: 'background',
        align: 'center',
      }),
      text('name', 'name', 505, 355, 105, 410),
      text('tagline', 'tagline', 510, 520, 32, 380, {
        color: 'secondary',
      }),
    ]),
    template('twin-orbit', 'Twin Orbit', 'abstract', [
      shape('orbit-a', 'ellipse', 155, 155, 690, 430, {
        fill: 'none',
        stroke: 'primary',
        strokeWidth: 26,
        rotation: 24,
      }),
      shape('orbit-b', 'ellipse', 155, 410, 690, 430, {
        fill: 'none',
        stroke: 'accent',
        strokeWidth: 26,
        rotation: -24,
      }),
      text('initials', 'initials', 275, 330, 200, 450, {
        align: 'center',
      }),
      text('name', 'name', 180, 720, 66, 640, {
        align: 'center',
        uppercase: true,
      }),
    ]),
    template('editorial', 'Editorial', 'wordmark', [
      text('initials', 'initials', 100, 120, 92, 250, {
        color: 'accent',
        letterSpacing: 60,
      }),
      text('name', 'name', 100, 330, 160, 800, {
        fontWeight: 600,
      }),
      shape('rule', 'rect', 100, 555, 800, 10, { fill: 'foreground' }),
      text('tagline', 'tagline', 100, 625, 40, 800, {
        color: 'secondary',
        uppercase: true,
        letterSpacing: 130,
      }),
    ]),
    template('checker-block', 'Checker Block', 'geometric', [
      shape('block-a', 'rect', 130, 130, 370, 370, {
        fill: 'primary',
      }),
      shape('block-b', 'rect', 500, 130, 370, 370, {
        fill: 'accent',
      }),
      shape('block-c', 'rect', 130, 500, 370, 370, {
        fill: 'secondary',
      }),
      shape('block-d', 'rect', 500, 500, 370, 370, {
        fill: 'background',
        stroke: 'primary',
        strokeWidth: 12,
      }),
      text('initials', 'initials', 185, 245, 160, 260, {
        color: 'background',
        align: 'center',
      }),
      text('name', 'name', 545, 615, 66, 280, {
        color: 'primary',
        align: 'center',
      }),
    ]),
  ]

const loadedBuiltins = loadValidLogoTemplates(BUILTIN_LOGO_TEMPLATE_SOURCES)
if (loadedBuiltins.failures.length > 0) {
  const first = loadedBuiltins.failures[0]
  throw new Error(
    `Bundled logo template ${first.index} is invalid: ${first.error.message}`,
  )
}

export const BUILTIN_LOGO_TEMPLATES: readonly LogoTemplate[] = Object.freeze(
  loadedBuiltins.templates,
)
