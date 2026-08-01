import type {
  AssetCatalogEntry,
  AssetLicenseMetadata,
  AssetPackManifest,
  AssetSafetyMetadata,
} from './types'

const PIXELWEAVE_LICENSE: AssetLicenseMetadata = {
  id: 'LicenseRef-Pixelweave-Original',
  name: 'Original Pixelweave geometry (not a third-party asset)',
}

const LUCIDE_LICENSE: AssetLicenseMetadata = {
  id: 'ISC',
  name: 'ISC License',
  sourceUrl: 'https://lucide.dev/license',
  attribution: 'Icon geometry adapted from Lucide.',
}

const PROCEDURAL_SAFETY: AssetSafetyMetadata = {
  origin: 'bundled',
  mediaType: 'application/x-pixelweave-shape+json',
  sanitizer: 'none-required',
  externalReferences: 'forbidden',
}

const SVG_SAFETY: AssetSafetyMetadata = {
  origin: 'bundled',
  mediaType: 'image/svg+xml',
  sanitizer: 'svg-sanitizer-v1',
  externalReferences: 'forbidden',
  maxBytes: 64 * 1024,
}

const GRID_SAFETY: AssetSafetyMetadata = {
  origin: 'bundled',
  mediaType: 'application/x-pixelweave-grid+json',
  sanitizer: 'none-required',
  externalReferences: 'forbidden',
}

export const BUILTIN_ASSET_CATALOG: readonly AssetCatalogEntry[] = [
  {
    id: 'shape-rounded-rectangle',
    packId: 'core-shapes',
    kind: 'shape',
    category: 'basic-shapes',
    name: { en: 'Rounded rectangle', ja: '角丸四角形' },
    tags: { en: 'box panel card rectangle', ja: '四角 ボックス カード' },
    license: PIXELWEAVE_LICENSE,
    safety: PROCEDURAL_SAFETY,
    order: 10,
  },
  {
    id: 'shape-polygon',
    packId: 'core-shapes',
    kind: 'shape',
    category: 'basic-shapes',
    name: { en: 'Polygon', ja: '多角形' },
    tags: { en: 'hexagon pentagon geometry', ja: '六角形 五角形 図形' },
    license: PIXELWEAVE_LICENSE,
    safety: PROCEDURAL_SAFETY,
    order: 20,
  },
  {
    id: 'shape-star',
    packId: 'core-shapes',
    kind: 'shape',
    category: 'basic-shapes',
    name: { en: 'Star', ja: '星' },
    tags: { en: 'favorite rating sparkle', ja: 'お気に入り 評価 キラキラ' },
    license: PIXELWEAVE_LICENSE,
    safety: PROCEDURAL_SAFETY,
    order: 30,
  },
  {
    id: 'shape-arrow',
    packId: 'core-shapes',
    kind: 'shape',
    category: 'arrows-lines',
    name: { en: 'Arrow', ja: '矢印' },
    tags: { en: 'direction next pointer', ja: '方向 次 ポインター' },
    license: PIXELWEAVE_LICENSE,
    safety: PROCEDURAL_SAFETY,
    order: 40,
  },
  {
    id: 'shape-speech-bubble',
    packId: 'core-shapes',
    kind: 'shape',
    category: 'basic-shapes',
    name: { en: 'Speech bubble', ja: '吹き出し' },
    tags: { en: 'chat message comment', ja: '会話 メッセージ コメント' },
    license: PIXELWEAVE_LICENSE,
    safety: PROCEDURAL_SAFETY,
    order: 50,
  },
  {
    id: 'shape-line',
    packId: 'core-shapes',
    kind: 'shape',
    category: 'arrows-lines',
    name: { en: 'Line', ja: '直線' },
    tags: { en: 'connector rule stroke', ja: '線 コネクター 罫線' },
    license: PIXELWEAVE_LICENSE,
    safety: PROCEDURAL_SAFETY,
    order: 60,
  },
  {
    id: 'shape-elbow-line',
    packId: 'core-shapes',
    kind: 'shape',
    category: 'arrows-lines',
    name: { en: 'Elbow connector', ja: 'エルボー線' },
    tags: {
      en: 'flowchart connector angled',
      ja: 'フローチャート 接続 折れ線',
    },
    license: PIXELWEAVE_LICENSE,
    safety: PROCEDURAL_SAFETY,
    order: 70,
  },
  {
    id: 'frame-circle',
    packId: 'core-layouts',
    kind: 'frame',
    category: 'frames',
    name: { en: 'Circle frame', ja: '円形フレーム' },
    tags: {
      en: 'photo crop portrait round',
      ja: '写真 切り抜き 丸 プロフィール',
    },
    license: PIXELWEAVE_LICENSE,
    safety: PROCEDURAL_SAFETY,
    order: 100,
  },
  {
    id: 'frame-rounded',
    packId: 'core-layouts',
    kind: 'frame',
    category: 'frames',
    name: { en: 'Rounded frame', ja: '角丸フレーム' },
    tags: { en: 'photo crop card', ja: '写真 切り抜き カード' },
    license: PIXELWEAVE_LICENSE,
    safety: PROCEDURAL_SAFETY,
    order: 110,
  },
  {
    id: 'grid-two-columns',
    packId: 'core-layouts',
    kind: 'grid',
    category: 'photo-grids',
    name: { en: 'Two columns', ja: '2分割グリッド' },
    tags: { en: 'photos split comparison', ja: '写真 二分割 比較' },
    license: PIXELWEAVE_LICENSE,
    safety: GRID_SAFETY,
    order: 120,
  },
  {
    id: 'grid-three-columns',
    packId: 'core-layouts',
    kind: 'grid',
    category: 'photo-grids',
    name: { en: 'Three columns', ja: '3分割グリッド' },
    tags: { en: 'photos triptych', ja: '写真 三分割' },
    license: PIXELWEAVE_LICENSE,
    safety: GRID_SAFETY,
    order: 130,
  },
  {
    id: 'grid-feature-left',
    packId: 'core-layouts',
    kind: 'grid',
    category: 'photo-grids',
    name: { en: 'Feature collage', ja: 'メイン写真コラージュ' },
    tags: {
      en: 'photos collage feature mosaic',
      ja: '写真 コラージュ モザイク',
    },
    license: PIXELWEAVE_LICENSE,
    safety: GRID_SAFETY,
    order: 140,
  },
  {
    id: 'icon-heart',
    packId: 'core-icons',
    kind: 'icon',
    category: 'symbols',
    name: { en: 'Heart', ja: 'ハート' },
    tags: { en: 'love favorite like', ja: '好き お気に入り いいね' },
    license: LUCIDE_LICENSE,
    safety: SVG_SAFETY,
    order: 200,
  },
  {
    id: 'icon-camera',
    packId: 'core-icons',
    kind: 'icon',
    category: 'media',
    name: { en: 'Camera', ja: 'カメラ' },
    tags: { en: 'photo image media', ja: '写真 画像 メディア' },
    license: LUCIDE_LICENSE,
    safety: SVG_SAFETY,
    order: 210,
  },
  {
    id: 'icon-sparkles',
    packId: 'core-icons',
    kind: 'icon',
    category: 'symbols',
    name: { en: 'Sparkles', ja: 'きらめき' },
    tags: { en: 'star shine magic', ja: '星 輝き キラキラ' },
    license: LUCIDE_LICENSE,
    safety: SVG_SAFETY,
    order: 220,
  },
] as const

export const BUILTIN_ASSET_PACK_MANIFESTS: readonly AssetPackManifest[] = [
  {
    id: 'core-shapes',
    assetCount: 7,
    load: () =>
      import('./packs/coreShapes').then((module) => module.CORE_SHAPES_PACK),
  },
  {
    id: 'core-layouts',
    assetCount: 5,
    load: () =>
      import('./packs/coreLayouts').then((module) => module.CORE_LAYOUTS_PACK),
  },
  {
    id: 'core-icons',
    assetCount: 3,
    load: () =>
      import('./packs/coreIcons').then((module) => module.CORE_ICONS_PACK),
  },
] as const
