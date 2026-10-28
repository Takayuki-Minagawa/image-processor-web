import type { AppLocale } from './uiPreferences'

const ja = {
  title: 'SVGの原寸で開く',
  description:
    'SVGのサイズでページを作成します。図形はベクターレイヤーとして保持します。',
  loading: 'SVGを解析しています…',
  dimensions: 'ページサイズ',
  physical: '元の物理サイズ',
  inferredPhysical: '推定した物理サイズ',
  inferred:
    '寸法が確定していないため、viewBoxと指定寸法から推定したサイズです。',
  confirmInferred: '推定サイズで取り込むことを確認しました',
  units:
    'SVGの1 CSS pxは1/96インチです。ページのピクセル寸法は整数へ丸めます。',
  material:
    '現在のキャンバスへ素材として配置する場合は、画像追加またはドラッグ＆ドロップを使ってください。',
  limitations:
    'SVGの一部の効果やフォントは再現できない場合があります。アウトライン化された文字は文字として編集できません。',
  sanitized: '安全のため一部の要素・属性を削除しました。',
  target: '取込先',
  replace: '新規ドキュメントとして開く',
  append: '現在の文書へページ追加',
  submit: 'SVGを取り込む',
  cancel: '取消',
  committing: 'SVGを文書へ反映しています…',
  confirmReplace:
    '現在の未保存の編集を閉じて、SVGから新規ドキュメントを作成しますか？',
  imported: 'SVGを原寸のベクターページとして取り込みました。',
  history: 'SVGページを取り込み',
  untitled: 'SVGからのデザイン',
  projectLimit:
    'プロジェクトの上限（100ページ・100 MB）を超えます。ページやレイヤーを減らしてください。',
  failure:
    'SVGを読み込めませんでした。対応する図形と寸法を含むSVGを選択してください。',
  errors: {
    'invalid-svg':
      'SVGの形式または寸法が不正です。width・heightまたはviewBoxを確認してください。',
    'svg-byte-limit': 'SVGは空でない5 MiB以下のファイルを選択してください。',
    'svg-element-limit':
      'SVGの要素数が上限を超えます。図形を減らしてください。',
    'svg-attribute-limit':
      'SVGの属性が大きすぎます。データを簡略化してください。',
    'svg-dimension-limit': 'SVGの寸法が上限（1辺8,192px・64MP）を超えます。',
    'svg-css-size':
      'このCSSによるSVGのサイズ指定には対応していません。ルートのwidth・heightに絶対寸法を指定してください。',
    'svg-viewport':
      'SVGの表示領域を確定できません。width・heightまたはviewBoxを確認してください。',
    'svg-transform':
      'ルートSVGの変換を確定できません。ルートに適用されるCSS transformを除き、transform属性にSVG形式の数値変換を指定してください。',
  },
}
const en: typeof ja = {
  title: 'Open SVG at original size',
  description:
    'Create a page at the SVG dimensions and retain shapes as a vector layer.',
  loading: 'Reading SVG…',
  dimensions: 'Page dimensions',
  physical: 'Original physical size',
  inferredPhysical: 'Inferred physical size',
  inferred:
    'The dimensions are not explicit. This size is inferred from the viewBox and specified dimensions.',
  confirmInferred: 'I confirm importing at the inferred size',
  units:
    'One SVG CSS px equals 1/96 inch. Page pixel dimensions are rounded to integers.',
  material:
    'To place SVG as an asset on the current canvas, use Add image or drag and drop.',
  limitations:
    'Some SVG effects or fonts may render differently. Outlined text cannot be edited as text.',
  sanitized: 'Some elements or attributes were removed for safety.',
  target: 'Destination',
  replace: 'Open as a new document',
  append: 'Append to current document',
  submit: 'Import SVG',
  cancel: 'Cancel',
  committing: 'Adding SVG to the document…',
  confirmReplace:
    'Close unsaved edits and create a new document from this SVG?',
  imported: 'Imported SVG as a vector page at its original size.',
  history: 'Import SVG page',
  untitled: 'Design from SVG',
  projectLimit:
    'The project exceeds 100 pages or 100 MB. Remove pages or layers.',
  failure:
    'Could not import SVG. Choose an SVG with supported shapes and dimensions.',
  errors: {
    'invalid-svg':
      'Invalid SVG or dimensions. Check width, height and viewBox.',
    'svg-byte-limit': 'Select a nonempty SVG file up to 5 MiB.',
    'svg-element-limit':
      'SVG contains too many elements. Simplify the drawing.',
    'svg-attribute-limit': 'An SVG attribute is too large. Simplify the data.',
    'svg-dimension-limit': 'SVG exceeds 8,192px per side or 64MP.',
    'svg-css-size':
      'This CSS sizing is unsupported. Set absolute width and height on the root SVG.',
    'svg-viewport':
      'Could not determine the SVG viewport. Check width, height and viewBox.',
    'svg-transform':
      'Could not determine the root SVG transform. Remove stylesheet transforms targeting the root and use numeric SVG transform syntax in its transform attribute.',
  },
}

export const svgCopy = (locale: AppLocale) => (locale === 'ja' ? ja : en)

export const svgErrorMessage = (error: unknown, locale: AppLocale): string => {
  const copy = svgCopy(locale)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
  if (code in copy.errors) return copy.errors[code as keyof typeof copy.errors]
  if (error instanceof Error && error.message === copy.projectLimit)
    return error.message
  return copy.failure
}
