import type { AppLocale } from './uiPreferences'

export interface DesignStudioCopy {
  title: string
  description: string
  tabs: Record<
    'pages' | 'elements' | 'text' | 'templates' | 'data' | 'motion' | 'export',
    string
  >
  search: string
  add: string
  apply: string
  pages: {
    heading: string
    add: string
    duplicate: string
    remove: string
    previous: string
    next: string
    presets: string
    custom: string
    width: string
    height: string
    dpi: string
    resize: string
    anchor: string
    mode: string
    fit: string
    fill: string
    stretch: string
    background: string
    solid: string
    gradient: string
    gradientAngle: string
    unit: string
  }
  elements: {
    heading: string
    group: string
    ungroup: string
    clip: string
    releaseClip: string
    mask: string
    disableMask: string
    enableMask: string
    removeMask: string
    rasterizeMask: string
    hint: string
    myAssets: string
    importAsset: string
    removeStored: string
    userAssetsEmpty: string
    category: string
    allCategories: string
    recent: string
    gridBoundary: string
    gridHorizontal: string
    gridVertical: string
    gridHint: string
  }
  text: {
    heading: string
    content: string
    horizontal: string
    vertical: string
    auto: string
    wrap: string
    fixed: string
    font: string
    effect: string
    layout: string
    listStyle: string
    listNone: string
    listBullet: string
    listNumber: string
    importFont: string
    removeFont: string
    fontLicense: string
    discoverLocalFonts: string
    localFonts: string
    importLocalFont: string
  }
  templates: {
    heading: string
    brand: string
    primary: string
    secondary: string
    accent: string
    headingFont: string
    bodyFont: string
    saveBrand: string
    name: string
    userTemplate: string
    importTemplate: string
    exportTemplate: string
    savedBrands: string
    noBrand: string
    removeBrand: string
  }
  data: {
    heading: string
    csv: string
    chart: string
    table: string
    insertChart: string
    insertTable: string
    updateChart: string
    updateTable: string
    addRow: string
    removeRow: string
    addColumn: string
    removeColumn: string
    cellBackground: string
    borderColor: string
    borderStyle: string
    rowHeight: string
    columnWidth: string
    invalid: string
  }
  motion: {
    heading: string
    duration: string
    transition: string
    preset: string
    preview: string
    stop: string
    previous: string
    next: string
    fullscreen: string
    close: string
    loading: string
  }
  export: {
    heading: string
    range: string
    active: string
    all: string
    selected: string
    selectedPages: string
    dpi: string
    bleed: string
    pdf: string
    gif: string
    video: string
    png: string
    export: string
    cancel: string
    progress: string
    cropMarks: string
    estimatedSize: string
  }
  status: {
    loading: string
    empty: string
    localOnly: string
    templateApplied: string
    templateSkipped: string
    fontMissing: string
    projectFontsMissing: string
    brandSaved: string
    brandSaveFailed: string
    exportComplete: string
    exportCancelled: string
    exportFailed: string
    previewStarted: string
    previewStopped: string
    libraryLoadFailed: string
    assetSaved: string
    assetRemoved: string
    assetFailed: string
    assetDropFailed: string
    pageOperationFailed: string
    fontSaved: string
    fontRemoved: string
    fontFailed: string
    templateSaved: string
    templateImported: string
    templateFailed: string
    templateUndone: string
    templateRedone: string
  }
}

const JA: DesignStudioCopy = {
  title: 'デザイン機能',
  description:
    '複数ページ、素材、テンプレート、図表、アニメーション、出力をまとめて操作します。',
  tabs: {
    pages: 'ページ',
    elements: '素材',
    text: 'テキスト',
    templates: 'テンプレート',
    data: '図表',
    motion: 'アニメーション',
    export: '出力',
  },
  search: '検索',
  add: '追加',
  apply: '適用',
  pages: {
    heading: 'デザインとページ',
    add: 'ページを追加',
    duplicate: '複製',
    remove: '削除',
    previous: '前へ',
    next: '次へ',
    presets: 'サイズプリセット',
    custom: 'カスタムサイズ',
    width: '幅',
    height: '高さ',
    dpi: 'DPI',
    resize: 'マジックリサイズ',
    anchor: 'アンカー',
    mode: '配置方法',
    fit: '収める',
    fill: '塗りつぶす',
    stretch: '引き伸ばす',
    background: 'ページ背景',
    solid: '単色',
    gradient: 'グラデーション',
    gradientAngle: 'グラデーション角度',
    unit: '単位',
  },
  elements: {
    heading: '素材ライブラリ',
    group: 'グループ化',
    ungroup: 'グループ解除',
    clip: 'フレームへ入れる',
    releaseClip: '切り抜き解除',
    mask: '選択範囲からマスク',
    disableMask: 'マスクを無効化',
    enableMask: 'マスクを有効化',
    removeMask: 'マスク削除',
    rasterizeMask: 'マスクをラスタライズ',
    hint: '2つのレイヤーを選択するとグループ化やフレーム切り抜きを利用できます。',
    myAssets: 'マイ素材',
    importAsset: '素材を登録',
    removeStored: '保存素材を削除',
    userAssetsEmpty: '登録済みの素材はありません。',
    category: 'カテゴリ',
    allCategories: 'すべて',
    recent: '最近使用した素材',
    gridBoundary: 'グリッド境界',
    gridHorizontal: '左右',
    gridVertical: '上下',
    gridHint: '選択中の写真グリッドの境界をドラッグして調整します。',
  },
  text: {
    heading: 'テキストとフォント',
    content: 'テキスト',
    horizontal: '横書き',
    vertical: '縦書き',
    auto: '自動拡張',
    wrap: '折り返し',
    fixed: '固定',
    font: 'フォント',
    effect: 'エフェクト',
    layout: 'レイアウト',
    listStyle: 'リスト',
    listNone: 'なし',
    listBullet: '箇条書き',
    listNumber: '番号付き',
    importFont: 'フォントを追加',
    removeFont: 'フォントを削除',
    fontLicense:
      '利用権限を確認したローカルフォントだけを追加してください。フォント本体はプロジェクトに埋め込みません。',
    discoverLocalFonts: 'インストール済みフォントを検索',
    localFonts: 'ローカルフォント',
    importLocalFont: '選択したフォントを追加',
  },
  templates: {
    heading: 'テンプレートとブランドキット',
    brand: 'ブランドキット',
    primary: 'プライマリー',
    secondary: 'セカンダリー',
    accent: 'アクセント',
    headingFont: '見出しフォント',
    bodyFont: '本文フォント',
    saveBrand: 'ブランドを保存',
    name: '名前',
    userTemplate: 'ユーザーテンプレート',
    importTemplate: 'テンプレートを読み込む',
    exportTemplate: '現在のデザインを保存',
    savedBrands: '保存済みブランド',
    noBrand: 'ブランドを適用しない',
    removeBrand: '選択中のブランドを削除',
  },
  data: {
    heading: '表とグラフ',
    csv: 'CSVデータ',
    chart: 'グラフ種類',
    table: '表',
    insertChart: 'グラフを追加',
    insertTable: '表を追加',
    updateChart: '選択中のグラフを更新',
    updateTable: '選択中の表を更新',
    addRow: '行を追加',
    removeRow: '最終行を削除',
    addColumn: '列を追加',
    removeColumn: '最終列を削除',
    cellBackground: '選択セルの背景',
    borderColor: '罫線色',
    borderStyle: '罫線スタイル',
    rowHeight: '選択行の高さ',
    columnWidth: '選択列の幅',
    invalid: 'CSV、行の高さ、列の幅を確認してください。',
  },
  motion: {
    heading: 'ページと要素のアニメーション',
    duration: '表示時間',
    transition: 'ページ遷移',
    preset: '要素アニメーション',
    preview: 'プレビュー再生',
    stop: '停止',
    previous: '前のページ',
    next: '次のページ',
    fullscreen: '全画面',
    close: '閉じる',
    loading: 'プレビューを準備中…',
  },
  export: {
    heading: 'デザインを書き出す',
    range: 'ページ範囲',
    active: '現在のページ',
    all: 'すべてのページ',
    selected: '選択したページ',
    selectedPages: '書き出すページ',
    dpi: 'DPI',
    bleed: '塗り足し',
    pdf: 'PDF',
    gif: 'GIF',
    video: '動画',
    png: 'PNG（ZIP）',
    export: '書き出す',
    cancel: 'キャンセル',
    progress: '書き出し中',
    cropMarks: 'トンボを付ける',
    estimatedSize: '推定ファイルサイズ',
  },
  status: {
    loading: '読み込んでいます…',
    empty: '一致する項目がありません。',
    localOnly: '素材、フォント、デザインは端末内で処理されます。',
    templateApplied: 'テンプレートを編集可能なレイヤーへ展開しました。',
    templateSkipped: '件の未対応要素をスキップしました。',
    fontMissing: 'フォント定義が見つかりません。',
    projectFontsMissing: '利用できないフォントを代替表示しています: ',
    brandSaved: 'をこの端末に保存しました。',
    brandSaveFailed: 'ブランドキットを保存できませんでした。',
    exportComplete: 'デザインを書き出しました。',
    exportCancelled: '書き出しをキャンセルしました。',
    exportFailed: 'デザインを書き出せませんでした。',
    previewStarted: 'アニメーションプレビューを開始しました。',
    previewStopped: 'アニメーションプレビューを停止しました。',
    libraryLoadFailed: '保存済みの素材とフォントを読み込めませんでした。',
    assetSaved: 'マイ素材へ安全に保存しました。',
    assetRemoved: 'マイ素材から削除しました。',
    assetFailed: 'マイ素材を更新できませんでした。',
    assetDropFailed: '素材をキャンバスへ安全に配置できませんでした。',
    pageOperationFailed: 'ページ操作を完了できませんでした。',
    fontSaved: 'ユーザーフォントをこの端末へ保存しました。',
    fontRemoved: 'ユーザーフォントを削除しました。',
    fontFailed: 'ユーザーフォントを更新できませんでした。',
    templateSaved: '現在のデザインをユーザーテンプレートとして保存しました。',
    templateImported: 'ユーザーテンプレートを読み込みました。',
    templateFailed: 'ユーザーテンプレートを処理できませんでした。',
    templateUndone: 'テンプレート適用前のデザインへ戻しました。',
    templateRedone: 'テンプレートをもう一度適用しました。',
  },
}

const EN: DesignStudioCopy = {
  title: 'Design tools',
  description:
    'Manage pages, assets, templates, charts, motion, and exports in one place.',
  tabs: {
    pages: 'Pages',
    elements: 'Elements',
    text: 'Text',
    templates: 'Templates',
    data: 'Data',
    motion: 'Animate',
    export: 'Export',
  },
  search: 'Search',
  add: 'Add',
  apply: 'Apply',
  pages: {
    heading: 'Design and pages',
    add: 'Add page',
    duplicate: 'Duplicate',
    remove: 'Delete',
    previous: 'Previous',
    next: 'Next',
    presets: 'Size presets',
    custom: 'Custom size',
    width: 'Width',
    height: 'Height',
    dpi: 'DPI',
    resize: 'Magic resize',
    anchor: 'Anchor',
    mode: 'Mode',
    fit: 'Fit',
    fill: 'Fill',
    stretch: 'Stretch',
    background: 'Page background',
    solid: 'Solid',
    gradient: 'Gradient',
    gradientAngle: 'Gradient angle',
    unit: 'Unit',
  },
  elements: {
    heading: 'Element library',
    group: 'Group',
    ungroup: 'Ungroup',
    clip: 'Place in frame',
    releaseClip: 'Release crop',
    mask: 'Mask from selection',
    disableMask: 'Disable mask',
    enableMask: 'Enable mask',
    removeMask: 'Remove mask',
    rasterizeMask: 'Rasterize mask',
    hint: 'Select two layers to group them or use a shape as an image frame.',
    myAssets: 'My assets',
    importAsset: 'Add asset',
    removeStored: 'Remove saved asset',
    userAssetsEmpty: 'No reusable assets have been added.',
    category: 'Category',
    allCategories: 'All',
    recent: 'Recently used',
    gridBoundary: 'Grid boundary',
    gridHorizontal: 'Left / right',
    gridVertical: 'Top / bottom',
    gridHint: 'Drag a boundary in the selected photo grid to resize its cells.',
  },
  text: {
    heading: 'Text and fonts',
    content: 'Text',
    horizontal: 'Horizontal',
    vertical: 'Vertical',
    auto: 'Auto width',
    wrap: 'Wrap',
    fixed: 'Fixed',
    font: 'Font',
    effect: 'Effect',
    layout: 'Layout',
    listStyle: 'List',
    listNone: 'None',
    listBullet: 'Bullets',
    listNumber: 'Numbered',
    importFont: 'Add font',
    removeFont: 'Remove font',
    fontLicense:
      'Only add local fonts you are licensed to use. Font bytes are never embedded in projects.',
    discoverLocalFonts: 'Find installed fonts',
    localFonts: 'Local fonts',
    importLocalFont: 'Add selected font',
  },
  templates: {
    heading: 'Templates and brand kit',
    brand: 'Brand kit',
    primary: 'Primary',
    secondary: 'Secondary',
    accent: 'Accent',
    headingFont: 'Heading font',
    bodyFont: 'Body font',
    saveBrand: 'Save brand',
    name: 'Name',
    userTemplate: 'User template',
    importTemplate: 'Import template',
    exportTemplate: 'Save current design',
    savedBrands: 'Saved brands',
    noBrand: 'No active brand',
    removeBrand: 'Remove selected brand',
  },
  data: {
    heading: 'Tables and charts',
    csv: 'CSV data',
    chart: 'Chart type',
    table: 'Table',
    insertChart: 'Insert chart',
    insertTable: 'Insert table',
    updateChart: 'Update selected chart',
    updateTable: 'Update selected table',
    addRow: 'Add row',
    removeRow: 'Remove last row',
    addColumn: 'Add column',
    removeColumn: 'Remove last column',
    cellBackground: 'Selected cell background',
    borderColor: 'Border color',
    borderStyle: 'Border style',
    rowHeight: 'Selected row height',
    columnWidth: 'Selected column width',
    invalid: 'Check the CSV, row height, and column width values.',
  },
  motion: {
    heading: 'Page and element animation',
    duration: 'Page duration',
    transition: 'Page transition',
    preset: 'Element animation',
    preview: 'Play preview',
    stop: 'Stop',
    previous: 'Previous page',
    next: 'Next page',
    fullscreen: 'Full screen',
    close: 'Close',
    loading: 'Preparing preview…',
  },
  export: {
    heading: 'Export design',
    range: 'Page range',
    active: 'Current page',
    all: 'All pages',
    selected: 'Selected pages',
    selectedPages: 'Pages to export',
    dpi: 'DPI',
    bleed: 'Bleed',
    pdf: 'PDF',
    gif: 'GIF',
    video: 'Video',
    png: 'PNG (ZIP)',
    export: 'Export',
    cancel: 'Cancel',
    progress: 'Exporting',
    cropMarks: 'Add crop marks',
    estimatedSize: 'Estimated file size',
  },
  status: {
    loading: 'Loading…',
    empty: 'No matching items.',
    localOnly: 'Assets, fonts, and designs are processed on this device.',
    templateApplied: 'Expanded the template into editable layers.',
    templateSkipped: ' unsupported template elements were skipped.',
    fontMissing: 'The selected font definition was not found.',
    projectFontsMissing: 'Fallback fonts are shown for unavailable families: ',
    brandSaved: ' was saved on this device.',
    brandSaveFailed: 'The brand kit could not be saved.',
    exportComplete: 'The design was exported.',
    exportCancelled: 'The export was cancelled.',
    exportFailed: 'The design could not be exported.',
    previewStarted: 'Animation preview started.',
    previewStopped: 'Animation preview stopped.',
    libraryLoadFailed: 'Saved assets and fonts could not be loaded.',
    assetSaved: 'The reusable asset was validated and saved locally.',
    assetRemoved: 'The reusable asset was removed.',
    assetFailed: 'The reusable asset library could not be updated.',
    assetDropFailed: 'The asset could not be placed safely on the canvas.',
    pageOperationFailed: 'The page operation could not be completed.',
    fontSaved: 'The user font was saved on this device.',
    fontRemoved: 'The user font was removed.',
    fontFailed: 'The user font library could not be updated.',
    templateSaved: 'The current design was saved as a user template.',
    templateImported: 'The user template was imported.',
    templateFailed: 'The user template could not be processed.',
    templateUndone: 'Restored the design from before the template was applied.',
    templateRedone: 'Applied the template again.',
  },
}

export const designStudioCopy = (locale: AppLocale): DesignStudioCopy =>
  locale === 'en' ? EN : JA
