import type { AppLocale } from './uiPreferences'
import { pdfErrorMessage } from './i18n.pdf'

const ja = {
  open: '参照PDFと比較…',
  title: '参照PDFと現在のページを比較',
  description:
    '開いた時点の現在ページと、選択したPDFの1ページを表示します。文書は変更しません。',
  loading: '比較プレビューを準備しています…',
  close: '閉じる',
  referenceFile: '参照PDFを選択',
  referenceNotice:
    '原PDFは保存していません。比較するPDFを選び直してください。同じ原本かどうかは自動確認できません。',
  chooseReference: '比較する参照PDFを選択してください。',
  current: '現在のページ',
  reference: '参照PDFのページ',
  referencePage: '参照ページ番号',
  previous: '前のページ',
  next: '次のページ',
  pageCount: '総ページ数',
  sourceCandidate:
    '取込時のページ番号を候補にしています。選んだPDFの対応ページであることを確認してください。',
  sourceFallback:
    '取込時のページ番号が選んだPDFの範囲外のため、1ページ目を表示します。対応ページを確認してください。',
  modes: '比較表示',
  sideBySide: '横並び',
  overlay: '重ね合わせ',
  difference: '差分',
  overlayImage: '現在と参照の重ね合わせ',
  differenceImage: '現在と参照の画素差分',
  referenceOpacity: '参照ページの不透明度',
  matched:
    '物理寸法が許容差内で一致しています。重ね合わせと差分を利用できます。',
  sizeMismatch:
    '物理寸法が異なります。画像はそれぞれ表示枠に収めているため、画面上の大きさは同じ尺度ではありません。重ね合わせと差分は利用できません。',
  unknownSize:
    '現在ページの物理寸法が不明です。画像はそれぞれ表示枠に収めているため、画面上の大きさは同じ尺度ではありません。重ね合わせと差分は利用できません。',
  physicalUnknown: '物理寸法なし',
  previewNotice:
    '最長辺1,600 px以下のプレビューです。透明部分は白として比較します。縮小や描画方式の違いでも差が出るため、完全一致の証明には使えません。',
  differenceNotice:
    '黒い部分は同じ画素、明るい部分は差がある画素です。自動で位置合わせや寸法補正は行いません。',
  fixedCapture: '現在のページは、この比較画面を開いた時点の表示です。',
  captureFailed:
    '現在ページのプレビューを作成できませんでした。閉じてからもう一度お試しください。',
  comparisonFailed:
    '比較プレビューを作成できませんでした。参照PDFやページを選び直してください。',
  pageSizeFailed:
    'このページの寸法では比較プレビューを作成できません。別のページまたはPDFを選択してください。',
}

const en: typeof ja = {
  open: 'Compare with reference PDF…',
  title: 'Compare reference PDF with current page',
  description:
    'View the current page captured when this dialog opened beside one page of a selected PDF. The document stays unchanged.',
  loading: 'Preparing comparison preview…',
  close: 'Close',
  referenceFile: 'Choose reference PDF',
  referenceNotice:
    'The original PDF is not stored. Select a PDF to compare. The app cannot verify that it is the same original file.',
  chooseReference: 'Choose a reference PDF to compare.',
  current: 'Current page',
  reference: 'Reference PDF page',
  referencePage: 'Reference page number',
  previous: 'Previous page',
  next: 'Next page',
  pageCount: 'Total pages',
  sourceCandidate:
    'The imported page number is a suggestion. Confirm that it is the corresponding page in the selected PDF.',
  sourceFallback:
    'The imported page number is outside the selected PDF, so page 1 is shown. Check the corresponding page.',
  modes: 'Comparison view',
  sideBySide: 'Side by side',
  overlay: 'Overlay',
  difference: 'Difference',
  overlayImage: 'Current and reference overlay',
  differenceImage: 'Current and reference pixel difference',
  referenceOpacity: 'Reference page opacity',
  matched:
    'Physical dimensions match within tolerance. Overlay and difference are available.',
  sizeMismatch:
    'Physical dimensions differ. Each image fits its own frame, so their displayed sizes are not on the same scale. Overlay and difference are unavailable.',
  unknownSize:
    'The current page has no physical dimensions. Each image fits its own frame, so their displayed sizes are not on the same scale. Overlay and difference are unavailable.',
  physicalUnknown: 'No physical dimensions',
  previewNotice:
    'Previews are at most 1,600 px on the longest side. Transparency is compared on white. Resizing and rendering differences can change pixels; this does not prove an exact match.',
  differenceNotice:
    'Black pixels match; brighter pixels differ. No automatic alignment or size correction is performed.',
  fixedCapture: 'The current page shows its state when this comparison opened.',
  captureFailed:
    'Could not capture the current page. Close this dialog and try again.',
  comparisonFailed:
    'Could not create the comparison preview. Select a reference PDF or page again.',
  pageSizeFailed:
    'This page cannot be previewed at its dimensions. Select another page or PDF.',
}

export const comparisonCopy = (locale: AppLocale) => (locale === 'ja' ? ja : en)

export const comparisonErrorMessage = (error: unknown, locale: AppLocale) => {
  const copy = comparisonCopy(locale)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
  return code === 'page-size-limit'
    ? copy.pageSizeFailed
    : code
      ? pdfErrorMessage(error, locale)
      : copy.comparisonFailed
}
