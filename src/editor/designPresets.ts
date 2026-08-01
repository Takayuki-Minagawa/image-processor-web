export type DesignUnit = 'px' | 'mm'

export interface DesignSizePreset {
  id: string
  category: 'social' | 'presentation' | 'print' | 'banner'
  name: { ja: string; en: string }
  width: number
  height: number
  unit: DesignUnit
  dpi?: number
}

export interface PixelDimensions {
  width: number
  height: number
}

export const millimetersToPixels = (
  millimeters: number,
  dpi: number,
): number => {
  if (!Number.isFinite(millimeters) || millimeters <= 0) {
    throw new RangeError('Millimeters must be a positive finite number.')
  }
  if (!Number.isFinite(dpi) || dpi < 36 || dpi > 2_400) {
    throw new RangeError('DPI must be between 36 and 2400.')
  }
  return Math.max(1, Math.round((millimeters / 25.4) * dpi))
}

export const presetPixelDimensions = (
  preset: DesignSizePreset,
  dpi = preset.dpi ?? 300,
): PixelDimensions =>
  preset.unit === 'px'
    ? { width: Math.round(preset.width), height: Math.round(preset.height) }
    : {
        width: millimetersToPixels(preset.width, dpi),
        height: millimetersToPixels(preset.height, dpi),
      }

export const designSizeToPixels = (
  width: number,
  height: number,
  unit: DesignUnit,
  dpi = 300,
): PixelDimensions =>
  unit === 'px'
    ? {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      }
    : {
        width: millimetersToPixels(width, dpi),
        height: millimetersToPixels(height, dpi),
      }

export const DESIGN_SIZE_PRESETS: readonly DesignSizePreset[] = [
  {
    id: 'instagram-square',
    category: 'social',
    name: { ja: 'Instagram 正方形', en: 'Instagram square' },
    width: 1080,
    height: 1080,
    unit: 'px',
  },
  {
    id: 'instagram-story',
    category: 'social',
    name: { ja: 'Instagram ストーリー', en: 'Instagram story' },
    width: 1080,
    height: 1920,
    unit: 'px',
  },
  {
    id: 'x-landscape',
    category: 'social',
    name: { ja: 'X 横長投稿', en: 'X landscape post' },
    width: 1600,
    height: 900,
    unit: 'px',
  },
  {
    id: 'youtube-thumbnail',
    category: 'social',
    name: { ja: 'YouTube サムネイル', en: 'YouTube thumbnail' },
    width: 1280,
    height: 720,
    unit: 'px',
  },
  {
    id: 'presentation-wide',
    category: 'presentation',
    name: { ja: 'プレゼンテーション 16:9', en: 'Presentation 16:9' },
    width: 1920,
    height: 1080,
    unit: 'px',
  },
  {
    id: 'a4-portrait',
    category: 'print',
    name: { ja: 'A4 縦', en: 'A4 portrait' },
    width: 210,
    height: 297,
    unit: 'mm',
    dpi: 300,
  },
  {
    id: 'a4-landscape',
    category: 'print',
    name: { ja: 'A4 横', en: 'A4 landscape' },
    width: 297,
    height: 210,
    unit: 'mm',
    dpi: 300,
  },
  {
    id: 'business-card',
    category: 'print',
    name: { ja: '名刺', en: 'Business card' },
    width: 91,
    height: 55,
    unit: 'mm',
    dpi: 350,
  },
  {
    id: 'web-banner',
    category: 'banner',
    name: { ja: 'Web バナー', en: 'Web banner' },
    width: 1200,
    height: 400,
    unit: 'px',
  },
] as const
