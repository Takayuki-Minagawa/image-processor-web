import type { AppLocale } from './uiPreferences'

const ja = {
  title: 'PDFページを画像として開く',
  exportSettings: 'PDF 画像として出力…',
  encodedExportLimit:
    'PDF画像が128 MiBの出力上限を超えます。ページ数を減らすか、JPEGを選択してください。',
  compressionUnavailable:
    'このブラウザは可逆PDF圧縮に対応していません。ブラウザを更新するか、JPEGを選択してください。',
  dropFormats: 'PNG・JPEG・WebP・SVG・PDF・Pixelweave project',
  unsupportedFile:
    'PNG、JPEG、WebP、SVG、PDFまたはPixelweaveプロジェクトを選択してください。',
  description:
    '元PDFの文字・図形は背景画像になります。追加した文字・図形は編集できます。',
  appearance:
    '保存済みの注釈・フォームの外観を取り込みます。動的フォーム、リンク操作、添付、電子署名は引き継ぎません。',
  loading: 'PDFを解析しています…',
  preview: 'ページプレビュー',
  previous: '前のページ',
  next: '次のページ',
  current: '表示ページだけ選択',
  toggle: '表示ページを選択に追加・解除',
  range: 'ページ範囲（例: 1, 3-5）',
  dpi: '読込DPI',
  target: '取込先',
  replace: '新規ドキュメントとして開く',
  append: '現在の文書へページ追加',
  submit: '選択ページを取り込む',
  cancel: '取消',
  selected: '選択ページ数',
  pixels: '合計画素数',
  largest: '最大ページ画素数',
  memory: '概算作業メモリ',
  estimateNote:
    'RGBAの6倍で見積もった目安です。PDFの内容やブラウザにより増加します。',
  limits:
    'PDF 50 MiB、元文書1,000ページ、取込20ページ、1辺8,192px、1ページ32MP、合計64MPまで。超過時はDPIまたは選択ページ数を減らしてください。',
  confirmReplace:
    '現在の未保存の編集を閉じて、PDFから新規ドキュメントを作成しますか？',
  imported: 'PDFページをロック済み背景画像として取り込みました。',
  history: 'PDFページを取り込み',
  untitled: 'PDFからのデザイン',
  committing: 'ページを文書へ反映しています…',
  projectLimit:
    'プロジェクトの上限（100ページ・100 MB）を超えます。ページ数または読込DPIを減らしてください。',
  errors: {
    range: 'ページ範囲を確認してください。例: 1, 3-5',
    'file-too-large': 'PDFは空でない50 MiB以下のファイルを選択してください。',
    'page-count-limit':
      '元PDFは1,000ページまでです。別のツールで分割してください。',
    'password-required':
      'パスワード付きPDFには対応していません。解除済みのPDFを選択してください。',
    'invalid-pdf':
      'PDFを解析できませんでした。破損していないPDFを選択してください。',
    'unsupported-xfa':
      'XFA形式の動的フォームには対応していません。通常のPDFに変換してから選択してください。',
    'page-size-limit':
      'ページの寸法・画素数が上限を超えます。読込DPIを下げてください。',
    'selection-limit':
      '選択ページ数・合計画素数が上限を超えます。ページ数または読込DPIを減らしてください。',
    'encoded-size-limit':
      '取込画像の容量が上限を超えます。ページ数または読込DPIを減らしてください。',
    'render-failed':
      'このPDFの描画に失敗しました。対応していない画像やフォームが含まれる可能性があります。',
  },
}
const en: typeof ja = {
  title: 'Open PDF pages as images',
  exportSettings: 'PDF — export as images…',
  encodedExportLimit:
    'PDF images exceed 128 MiB. Select fewer pages or use JPEG.',
  compressionUnavailable:
    'Lossless PDF compression is unavailable. Update your browser or select JPEG.',
  dropFormats: 'PNG · JPEG · WebP · SVG · PDF · Pixelweave project',
  unsupportedFile: 'Select PNG, JPEG, WebP, SVG, PDF or a Pixelweave project.',
  description:
    'Original PDF text and shapes become background images. Text and shapes you add remain editable.',
  appearance:
    'Saved annotation and form appearances are rendered. Dynamic forms, interactive links, attachments and digital signatures are not retained.',
  loading: 'Reading PDF…',
  preview: 'Page preview',
  previous: 'Previous page',
  next: 'Next page',
  current: 'Select only this page',
  toggle: 'Add or remove this page',
  range: 'Page range (e.g. 1, 3-5)',
  dpi: 'Import DPI',
  target: 'Destination',
  replace: 'Open as a new document',
  append: 'Append to current document',
  submit: 'Import selected pages',
  cancel: 'Cancel',
  selected: 'Selected pages',
  pixels: 'Total pixels',
  largest: 'Largest page',
  memory: 'Estimated working memory',
  estimateNote:
    'Estimate uses six RGBA copies. PDF contents and browser behavior may increase memory use.',
  limits:
    'Limits: 50 MiB PDF, 1,000 source pages, 20 imported pages, 8,192px per side, 32MP per page, 64MP total. Reduce DPI or the page selection if needed.',
  confirmReplace:
    'Close unsaved edits and create a new document from this PDF?',
  imported: 'PDF pages imported as locked background images.',
  history: 'Import PDF pages',
  untitled: 'Design from PDF',
  committing: 'Adding pages to the document…',
  projectLimit:
    'The project exceeds 100 pages or 100 MB. Reduce the selection or import DPI.',
  errors: {
    range: 'Check the page range. Example: 1, 3-5',
    'file-too-large': 'Choose a non-empty PDF no larger than 50 MiB.',
    'page-count-limit':
      'Source PDFs may contain up to 1,000 pages. Split the PDF first.',
    'password-required':
      'Password-protected PDFs are not supported. Select an unlocked PDF.',
    'invalid-pdf': 'The PDF could not be parsed. Select an undamaged PDF.',
    'unsupported-xfa':
      'XFA dynamic forms are not supported. Convert to a standard PDF first.',
    'page-size-limit':
      'The page exceeds dimension or pixel limits. Lower the import DPI.',
    'selection-limit':
      'The selection exceeds the page or total pixel limit. Reduce pages or DPI.',
    'encoded-size-limit':
      'The imported images exceed the size limit. Reduce pages or DPI.',
    'render-failed':
      'PDF rendering failed. The file may contain unsupported images or forms.',
  },
}
export const pdfCopy = (locale: AppLocale) => (locale === 'ja' ? ja : en)
export function pdfErrorMessage(error: unknown, locale: AppLocale): string {
  const copy = pdfCopy(locale)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : error instanceof RangeError
        ? error.message
        : ''
  return (
    copy.errors[code as keyof typeof copy.errors] ??
    (error instanceof Error && error.message === copy.projectLimit
      ? error.message
      : copy.errors['render-failed'])
  )
}

export function pdfExportErrorMessage(
  error: unknown,
  locale: AppLocale,
): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error))
    return undefined
  if (error.code === 'pdf-encoded-limit')
    return pdfCopy(locale).encodedExportLimit
  if (error.code === 'pdf-compression-unavailable')
    return pdfCopy(locale).compressionUnavailable
  return undefined
}
