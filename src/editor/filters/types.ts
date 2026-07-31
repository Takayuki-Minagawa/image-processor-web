export type FilterCategory = 'built-in' | 'custom'

export type FilterId =
  | 'sharpen'
  | 'emboss'
  | 'noise'
  | 'pixelate'
  | 'sepia'
  | 'invert'
  | 'levels'
  | 'curves'
  | 'white-balance'
  | 'vignette'
  | 'gradient-map'
  | 'duotone'
  | 'halftone'
  | 'glitch'

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface GradientStop {
  offset: number
  color: RgbColor
}

export interface SharpenParameters {
  amount: number
}

export interface EmbossParameters {
  strength: number
}

export interface NoiseParameters {
  amount: number
  seed: number
  monochrome: boolean
}

export interface PixelateParameters {
  size: number
}

export interface SepiaParameters {
  amount: number
}

export interface InvertParameters {
  amount: number
}

export interface LevelsParameters {
  inputBlack: number
  inputWhite: number
  gamma: number
  outputBlack: number
  outputWhite: number
}

export interface CurvesParameters {
  master: number[]
  red: number[]
  green: number[]
  blue: number[]
}

export interface WhiteBalanceParameters {
  temperature: number
  tint: number
}

export interface VignetteParameters {
  amount: number
  midpoint: number
  softness: number
  color: RgbColor
}

export interface GradientMapParameters {
  stops: GradientStop[]
}

export interface DuotoneParameters {
  shadows: RgbColor
  highlights: RgbColor
}

export interface HalftoneParameters {
  size: number
  angle: number
  foreground: RgbColor
  background: RgbColor
}

export interface GlitchParameters {
  amount: number
  offset: number
  scanlines: number
  seed: number
}

export interface FilterParametersById {
  sharpen: SharpenParameters
  emboss: EmbossParameters
  noise: NoiseParameters
  pixelate: PixelateParameters
  sepia: SepiaParameters
  invert: InvertParameters
  levels: LevelsParameters
  curves: CurvesParameters
  'white-balance': WhiteBalanceParameters
  vignette: VignetteParameters
  'gradient-map': GradientMapParameters
  duotone: DuotoneParameters
  halftone: HalftoneParameters
  glitch: GlitchParameters
}

export type FilterOperation<I extends FilterId = FilterId> = {
  [K in I]: {
    id: K
    params: FilterParametersById[K]
  }
}[I]

export interface FilterDefinition<I extends FilterId = FilterId> {
  id: I
  label: string
  category: FilterCategory
  defaults: FilterParametersById[I]
}

export interface PixelBuffer {
  width: number
  height: number
  data: Uint8ClampedArray
}

export const createIdentityCurve = (): number[] =>
  Array.from({ length: 256 }, (_, index) => index)

export const cloneFilterOperation = (
  operation: FilterOperation,
): FilterOperation => JSON.parse(JSON.stringify(operation)) as FilterOperation
