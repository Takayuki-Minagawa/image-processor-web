import type { AppLocale } from './uiPreferences'

const ja = {
  heading: '出力設定プリセット',
  select: '保存したプリセット',
  placeholder: 'プリセットを選択',
  name: 'プリセット名',
  apply: '適用',
  save: '新規保存',
  update: '上書き保存',
  remove: '削除',
  loading: 'プリセットを読み込んでいます…',
  working: 'プリセットを保存しています…',
  note: 'このブラウザに保存します。出力範囲・選択内容・用紙サイズは保存せず、適用しても書き出しは開始しません。',
  session:
    'ブラウザへ保存できないため、このタブを開いている間だけ保持します。再読み込みすると今回の変更は失われます。',
  modified: '現在の設定は、選択したプリセットと異なります。',
  invalidCurrent:
    '現在の出力設定を確認してください。保存できる範囲の値を指定してください。',
  applied: 'プリセットを適用しました。出力範囲と仕上がりを確認してください。',
  saved: 'プリセットを保存しました。',
  updated: 'プリセットを更新しました。',
  removed: 'プリセットを削除しました。',
  sessionSaved: 'プリセットをこのタブを開いている間だけ保存しました。',
  sessionRemoved: 'プリセットをこのタブを開いている間だけ削除しました。',
  confirmRemove: (name: string) => `プリセット「${name}」を削除しますか？`,
  failed: 'プリセットの操作に失敗しました。もう一度お試しください。',
  errors: {
    'invalid-settings':
      '出力設定の値が不正です。現在の設定を確認してください。',
    'invalid-name': '空白以外を含む80文字以内の名前を入力してください。',
    'invalid-preset': 'このプリセットは使用できません。',
    'duplicate-name':
      '同じ種類に同名のプリセットがあります。別の名前にするか、既存のプリセットを選んで上書き保存してください。',
    'preset-limit':
      'プリセットは合計50件までです。不要なプリセットを削除してください。',
    'preset-not-found':
      'プリセットが見つかりません。別のタブで削除された可能性があります。',
  },
}
const en: typeof ja = {
  heading: 'Output presets',
  select: 'Saved presets',
  placeholder: 'Choose a preset',
  name: 'Preset name',
  apply: 'Apply',
  save: 'Save new',
  update: 'Overwrite',
  remove: 'Delete',
  loading: 'Loading presets…',
  working: 'Saving presets…',
  note: 'Saved in this browser. Output range, selections and page size stay with the current document. Applying a preset does not start an export.',
  session:
    'Browser storage is unavailable. Changes last only while this app is open and will be lost on reload.',
  modified: 'Current settings differ from the selected preset.',
  invalidCurrent: 'Check the current output settings before saving a preset.',
  applied:
    'Preset applied. Check the output range and dimensions before exporting.',
  saved: 'Preset saved.',
  updated: 'Preset updated.',
  removed: 'Preset deleted.',
  sessionSaved: 'Preset saved for this session only.',
  sessionRemoved: 'Preset deleted for this session only.',
  confirmRemove: (name: string) => `Delete preset “${name}”?`,
  failed: 'Could not complete the preset operation. Try again.',
  errors: {
    'invalid-settings': 'Invalid output settings. Check the current settings.',
    'invalid-name': 'Enter a nonblank name up to 80 characters.',
    'invalid-preset': 'This preset cannot be used.',
    'duplicate-name':
      'A preset of this type already has this name. Choose another name or select the existing preset and overwrite it.',
    'preset-limit':
      'You can save up to 50 presets. Delete an unused preset first.',
    'preset-not-found':
      'Preset not found. It may have been deleted in another tab.',
  },
}
export const exportPresetCopy = (locale: AppLocale) =>
  locale === 'ja' ? ja : en
export const exportPresetErrorMessage = (error: unknown, locale: AppLocale) => {
  const copy = exportPresetCopy(locale)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
  return code in copy.errors
    ? copy.errors[code as keyof typeof copy.errors]
    : copy.failed
}
