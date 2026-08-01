import type { AppTheme } from './uiPreferences'

export interface EditorUiCopy {
  pageTitle: string
  pageDescription: string
  new: string
  open: string
  save: string
  studio: string
  export: string
  menu: string
  projectName: string
  unsavedChanges: string
  saved: string
  savedLocally: string
  saving: string
  autosaved: string
  autosaveFailed: string
  localEditing: string
  localOnlyHint: string
  preferences: string
  manual: string
  manualTitle: string
  manualDescription: string
  shortcuts: string
  shortcutsTitle: string
  shortcutsDescription: string
  shortcutRows: Array<[string, string]>
  close: string
  switchToEnglish: string
  switchToJapanese: string
  languageButton: string
  switchToLight: string
  switchToDark: string
  fileMenuTitle: string
  fileMenuDescription: string
  newCanvas: string
  openProject: string
  saveProject: string
  exportImage: string
  openStudio: string
  newCanvasTitle: string
  newCanvasDescription: string
  width: string
  height: string
  presets: string
  cancel: string
  create: string
  exportTitle: string
  exportDescription: string
  fileFormat: string
  quality: string
  svgScope: string
  wholeCanvas: string
  selectedObject: string
  scale: string
  download: string
  formatNotes: Record<'png' | 'jpeg' | 'webp' | 'svg', string>
  studioTitle: string
  studioDescription: string
  studioTabs: Record<'design' | 'logo' | 'automation' | 'advanced', string>
  studioLoading: string
  toolLabels: Record<'select' | 'brush' | 'eraser' | 'pan', string>
  tools: string
  basicTools: string
  addTools: string
  addImage: string
  addRectangle: string
  addEllipse: string
  addText: string
  cropToSelection: string
  drawingColor: string
  toolOptions: string
  undo: string
  redo: string
  size: string
  opacity: string
  angle: string
  flipHorizontal: string
  flipVertical: string
  alignmentAndDistribution: string
  zoomOut: string
  zoom100: string
  zoomIn: string
  fitCanvas: string
  canvas: string
  verticalGuide: string
  horizontalGuide: string
  clearGuides: string
  dragGuide: string
  snap: string
  snapTolerance: string
  canvasDescription: (projectName: string) => string
  emptyHeading: string
  emptyDescription: string
  chooseImage: string
  supportedFormats: string
  processing: string
  layersCount: (count: number) => string
}

export const JAPANESE_EDITOR_UI_COPY: EditorUiCopy = {
  pageTitle: 'Pixelweave Studio | ブラウザ画像編集',
  pageDescription:
    '画像を端末内で編集できる、レイヤー対応のWeb画像編集スタジオ',
  new: '新規',
  open: '開く',
  save: '保存',
  studio: 'Studio',
  export: '書き出す',
  menu: 'メニュー',
  projectName: 'プロジェクト名',
  unsavedChanges: '未保存の変更',
  saved: '保存済み',
  savedLocally: '編集内容は端末内にのみ自動保存されます',
  saving: '保存中…',
  autosaved: '自動保存済み',
  autosaveFailed: '自動保存失敗',
  localEditing: 'ローカル編集',
  localOnlyHint: '画像と編集内容はサーバーへ送信されません。',
  preferences: '表示と言語の設定',
  manual: '使い方',
  manualTitle: '簡易マニュアル',
  manualDescription:
    '基本的な編集から保存・書き出しまでを、短い手順で確認できます。',
  shortcuts: 'ショートカット',
  shortcutsTitle: 'キーボードショートカット',
  shortcutsDescription:
    '入力欄へフォーカスしている間は、1文字のツール切替を実行しません。',
  shortcutRows: [
    ['選択ツール', 'V'],
    ['ブラシ', 'B'],
    ['消しゴム', 'E'],
    ['手のひら', 'H'],
    ['元に戻す', '⌘ / Ctrl + Z'],
    ['やり直す', '⇧⌘ + Z / Ctrl + Y'],
    ['コピー / 切取 / 貼付', '⌘ / Ctrl + C / X / V'],
    ['保存', '⌘ / Ctrl + S'],
    ['開く', '⌘ / Ctrl + O'],
    ['拡大 / 縮小 / 100%', '+ / − / 0'],
    ['削除', 'Delete'],
    ['この一覧', '?'],
  ],
  close: '閉じる',
  switchToEnglish: '英語表示に切り替え',
  switchToJapanese: '日本語表示に切り替え',
  languageButton: 'EN',
  switchToLight: 'ライトモードに切り替え',
  switchToDark: 'ダークモードに切り替え',
  fileMenuTitle: 'ファイルメニュー',
  fileMenuDescription:
    'プロジェクトの作成、読み込み、保存、画像の書き出しを行います。',
  newCanvas: '新しいキャンバス',
  openProject: 'プロジェクトを開く',
  saveProject: 'プロジェクトを保存',
  exportImage: '画像を書き出す',
  openStudio: '拡張ツールを開く',
  newCanvasTitle: '新しいキャンバス',
  newCanvasDescription:
    '未保存の編集がある場合は確認してから切り替えます。新しいキャンバスのサイズを指定してください。',
  width: '幅 (px)',
  height: '高さ (px)',
  presets: 'プリセット',
  cancel: 'キャンセル',
  create: '作成',
  exportTitle: '画像を書き出す',
  exportDescription: 'すべての表示レイヤーを合成して、端末へ保存します。',
  fileFormat: 'ファイル形式',
  quality: '品質',
  svgScope: 'SVGの範囲',
  wholeCanvas: 'キャンバス全体',
  selectedObject: '選択オブジェクト',
  scale: '出力倍率',
  download: 'ダウンロード',
  formatNotes: {
    png: '透明度・高品質',
    jpeg: '写真・小容量',
    webp: '高圧縮・透明度',
    svg: '編集可能なベクター',
  },
  studioTitle: '拡張ツール',
  studioDescription:
    'ロゴ生成、自動化、選択・背景除去・スクリプトを端末内で実行します。',
  studioTabs: {
    design: 'デザイン',
    logo: 'ロゴ生成',
    automation: '自動化・バッチ',
    advanced: '選択・背景・スクリプト',
  },
  studioLoading: '拡張ツールを読み込んでいます…',
  toolLabels: {
    select: '選択・変形',
    brush: 'ブラシ',
    eraser: '消しゴム',
    pan: '手のひら',
  },
  tools: '編集ツール',
  basicTools: '基本ツール',
  addTools: '追加ツール',
  addImage: '画像を追加',
  addRectangle: '矩形を追加',
  addEllipse: '楕円を追加',
  addText: 'テキストを追加',
  cropToSelection: '選択オブジェクトの範囲へ切り抜く',
  drawingColor: '描画色',
  toolOptions: 'ツールオプション',
  undo: '元に戻す',
  redo: 'やり直す',
  size: 'サイズ',
  opacity: '不透明度',
  angle: '角度',
  flipHorizontal: '左右反転',
  flipVertical: '上下反転',
  alignmentAndDistribution: '整列と分布',
  zoomOut: '縮小',
  zoom100: '100%表示',
  zoomIn: '拡大',
  fitCanvas: '画面に合わせる',
  canvas: '画像編集キャンバス',
  verticalGuide: '縦ガイド',
  horizontalGuide: '横ガイド',
  clearGuides: 'ガイド消去',
  dragGuide: 'キャンバスへドラッグして配置',
  snap: 'スナップ',
  snapTolerance: 'スナップ許容距離',
  canvasDescription: (projectName) =>
    `${projectName}の編集キャンバス。レイヤーパネルと数値入力で代替操作できます。`,
  emptyHeading: '画像を開いて、つくり始める',
  emptyDescription:
    'ファイルは端末内で処理されます。\nここへドロップするか、画像を選択してください。',
  chooseImage: '画像を選択',
  supportedFormats: '対応形式',
  processing: '処理しています…',
  layersCount: (count) => `${count} レイヤー`,
}

export const loadEnglishUiCopy = async (): Promise<EditorUiCopy> =>
  (await import('./i18n.en')).ENGLISH_EDITOR_UI_COPY

export const themeColorFor = (theme: AppTheme): string =>
  theme === 'light' ? '#f5f7fb' : '#11131a'
