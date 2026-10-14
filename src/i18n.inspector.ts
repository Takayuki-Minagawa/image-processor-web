import type { AppLocale } from './uiPreferences'

const ja = {
  invalidNumber: '有効な数値を入力してください。',
  invalidInteger: '整数を入力してください。',
  outOfRange: (min?: number, max?: number) =>
    min !== undefined && max !== undefined
      ? `${min}〜${max}の範囲で入力してください。`
      : min !== undefined
        ? `${min}以上の数値を入力してください。`
        : `${max}以下の数値を入力してください。`,
  numericLabel: (label: string) => `${label}（数値）`,
  range: (min: number, max: number, unit: string) => `${min}〜${max}${unit}`,
  opacity: '不透明度',
  brightness: '明るさ',
  contrast: 'コントラスト',
  saturation: '彩度',
  hue: '色相',
  blur: 'ぼかし',
  sharpen: 'シャープ',
  emboss: 'エンボス',
  noise: 'ノイズ',
  pixelate: 'ピクセレート',
  gamma: 'ガンマ',
  temperature: '色温度',
  tint: '色かぶり補正',
  vignette: 'ビネット',
  duotone: 'デュオトーン',
  halftone: 'ハーフトーン',
  glitch: 'グリッチ',
  hideLayer: (name: string) => `レイヤー「${name}」を隠す`,
  showLayer: (name: string) => `レイヤー「${name}」を表示する`,
  lockLayer: (name: string) => `レイヤー「${name}」をロック`,
  unlockLayer: (name: string) => `レイヤー「${name}」のロックを解除`,
  layerGroup: (name: string) => `レイヤー「${name}」`,
  currentPage: (name: string, index: number, count: number) =>
    `${name}（${index + 1}/${count}ページ）`,
  filterProgress: '選択範囲フィルターの進捗',
  filterRunning: '選択範囲へフィルターを適用中',
  filterProgressDescription:
    '処理が完了するまでお待ちください。キャンセルすると変更を適用せずに編集へ戻ります。',
  cancelFilter: 'フィルターをキャンセル',
  newDocument: '新規ドキュメント',
  openProject: 'プロジェクトを開く',
  restoreAutosave: '自動保存を復元',
}

const en: typeof ja = {
  invalidNumber: 'Enter a valid number.',
  invalidInteger: 'Enter a whole number.',
  outOfRange: (min, max) =>
    min !== undefined && max !== undefined
      ? `Enter a number from ${min} to ${max}.`
      : min !== undefined
        ? `Enter a number of at least ${min}.`
        : `Enter a number no greater than ${max}.`,
  numericLabel: (label) => `${label} (number)`,
  range: (min, max, unit) => `${min} to ${max}${unit}`,
  opacity: 'Opacity',
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
  hue: 'Hue',
  blur: 'Blur',
  sharpen: 'Sharpen',
  emboss: 'Emboss',
  noise: 'Noise',
  pixelate: 'Pixelate',
  gamma: 'Gamma',
  temperature: 'Temperature',
  tint: 'Tint',
  vignette: 'Vignette',
  duotone: 'Duotone',
  halftone: 'Halftone',
  glitch: 'Glitch',
  hideLayer: (name) => `Hide layer “${name}”`,
  showLayer: (name) => `Show layer “${name}”`,
  lockLayer: (name) => `Lock layer “${name}”`,
  unlockLayer: (name) => `Unlock layer “${name}”`,
  layerGroup: (name) => `Layer “${name}”`,
  currentPage: (name, index, count) => `${name} (page ${index + 1}/${count})`,
  filterProgress: 'Selection filter progress',
  filterRunning: 'Applying filters to selection',
  filterProgressDescription:
    'Please wait for processing to finish. Cancel to return to editing without applying changes.',
  cancelFilter: 'Cancel filter',
  newDocument: 'New document',
  openProject: 'Open project',
  restoreAutosave: 'Restore autosave',
}

export const inspectorCopy = (locale: AppLocale) => (locale === 'en' ? en : ja)
