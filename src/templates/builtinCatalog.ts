import type {
  DesignTemplateCatalogEntry,
  DesignTemplatePackManifest,
} from './registry'

interface CatalogItem {
  id: string
  name: string
  localizedName: string
  tags: readonly string[]
}

interface CatalogGroup {
  packId: string
  category: string
  width: number
  height: number
  pageCount: number
  items: readonly CatalogItem[]
}

const GROUPS: readonly CatalogGroup[] = [
  {
    packId: 'templates-social',
    category: 'social',
    width: 1080,
    height: 1080,
    pageCount: 1,
    items: [
      {
        id: 'social-bold',
        name: 'Bold Social Post',
        localizedName: 'ボールドSNS投稿',
        tags: ['social media', 'SNS 投稿', 'bold ボールド'],
      },
      {
        id: 'social-minimal',
        name: 'Minimal Social Post',
        localizedName: 'ミニマルSNS投稿',
        tags: ['social media', 'SNS 投稿', 'minimal シンプル'],
      },
      {
        id: 'social-gradient',
        name: 'Gradient Social Post',
        localizedName: 'グラデーションSNS投稿',
        tags: ['social media', 'SNS 投稿', 'gradient グラデーション'],
      },
      {
        id: 'social-photo-frame',
        name: 'Photo Frame Post',
        localizedName: '写真フレーム投稿',
        tags: ['social media photo', 'SNS 写真 フレーム'],
      },
      {
        id: 'social-quote',
        name: 'Quote Card',
        localizedName: '引用カード',
        tags: ['social quote', 'SNS 引用 メッセージ'],
      },
      {
        id: 'social-announcement',
        name: 'Announcement Post',
        localizedName: 'お知らせ投稿',
        tags: ['social announcement', 'SNS お知らせ 告知'],
      },
    ],
  },
  {
    packId: 'templates-thumbnails',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    pageCount: 1,
    items: [
      {
        id: 'thumbnail-focus',
        name: 'Focus Thumbnail',
        localizedName: '注目サムネイル',
        tags: ['video youtube', '動画 YouTube サムネイル 注目'],
      },
      {
        id: 'thumbnail-versus',
        name: 'Versus Thumbnail',
        localizedName: '比較サムネイル',
        tags: ['video comparison', '動画 比較 対決'],
      },
      {
        id: 'thumbnail-tutorial',
        name: 'Tutorial Thumbnail',
        localizedName: '解説サムネイル',
        tags: ['video tutorial how-to', '動画 解説 ハウツー'],
      },
      {
        id: 'thumbnail-review',
        name: 'Review Thumbnail',
        localizedName: 'レビューサムネイル',
        tags: ['video review rating', '動画 レビュー 評価'],
      },
      {
        id: 'thumbnail-live',
        name: 'Live Stream Thumbnail',
        localizedName: 'ライブ配信サムネイル',
        tags: ['video live stream', '動画 ライブ 配信'],
      },
      {
        id: 'thumbnail-list',
        name: 'List Thumbnail',
        localizedName: 'ランキングサムネイル',
        tags: ['video list ranking', '動画 リスト ランキング'],
      },
    ],
  },
  {
    packId: 'templates-banners',
    category: 'banner',
    width: 1500,
    height: 500,
    pageCount: 1,
    items: [
      {
        id: 'banner-sale',
        name: 'Sale Banner',
        localizedName: 'セールバナー',
        tags: ['web sale promotion', 'ウェブ セール 販促 バナー'],
      },
      {
        id: 'banner-event',
        name: 'Event Banner',
        localizedName: 'イベントバナー',
        tags: ['web event', 'ウェブ イベント 告知 バナー'],
      },
      {
        id: 'banner-product',
        name: 'Product Banner',
        localizedName: '商品バナー',
        tags: ['web product commerce', 'ウェブ 商品 EC バナー'],
      },
      {
        id: 'banner-newsletter',
        name: 'Newsletter Banner',
        localizedName: 'ニュースレターバナー',
        tags: ['web email newsletter', 'ウェブ メール ニュースレター'],
      },
      {
        id: 'banner-webinar',
        name: 'Webinar Banner',
        localizedName: 'ウェビナーバナー',
        tags: ['web webinar seminar', 'ウェブ ウェビナー セミナー'],
      },
      {
        id: 'banner-launch',
        name: 'Launch Banner',
        localizedName: '新商品バナー',
        tags: ['web launch new', 'ウェブ 新商品 リリース'],
      },
    ],
  },
  {
    packId: 'templates-business-cards',
    category: 'business-card',
    width: 1050,
    height: 600,
    pageCount: 2,
    items: [
      {
        id: 'business-card-modern',
        name: 'Modern Business Card',
        localizedName: 'モダン名刺',
        tags: ['business identity', 'ビジネス 名刺 モダン'],
      },
      {
        id: 'business-card-classic',
        name: 'Classic Business Card',
        localizedName: 'クラシック名刺',
        tags: ['business identity', 'ビジネス 名刺 クラシック'],
      },
      {
        id: 'business-card-minimal',
        name: 'Minimal Business Card',
        localizedName: 'ミニマル名刺',
        tags: ['business identity', 'ビジネス 名刺 シンプル'],
      },
      {
        id: 'business-card-bold',
        name: 'Bold Business Card',
        localizedName: 'ボールド名刺',
        tags: ['business identity', 'ビジネス 名刺 ボールド'],
      },
      {
        id: 'business-card-creative',
        name: 'Creative Business Card',
        localizedName: 'クリエイティブ名刺',
        tags: ['business creator', 'ビジネス 名刺 クリエイティブ'],
      },
      {
        id: 'business-card-color-block',
        name: 'Color Block Business Card',
        localizedName: 'カラーブロック名刺',
        tags: ['business color', 'ビジネス 名刺 カラーブロック'],
      },
    ],
  },
  {
    packId: 'templates-flyers',
    category: 'flyer',
    width: 1240,
    height: 1754,
    pageCount: 1,
    items: [
      {
        id: 'flyer-editorial',
        name: 'Editorial Flyer',
        localizedName: 'エディトリアルチラシ',
        tags: ['print editorial', '印刷 A4 チラシ 編集'],
      },
      {
        id: 'flyer-event',
        name: 'Event Flyer',
        localizedName: 'イベントチラシ',
        tags: ['print event', '印刷 A4 チラシ イベント'],
      },
      {
        id: 'flyer-sale',
        name: 'Sale Flyer',
        localizedName: 'セールチラシ',
        tags: ['print sale', '印刷 A4 チラシ セール'],
      },
      {
        id: 'flyer-restaurant',
        name: 'Restaurant Flyer',
        localizedName: 'レストランチラシ',
        tags: ['print food menu', '印刷 A4 飲食 メニュー'],
      },
      {
        id: 'flyer-workshop',
        name: 'Workshop Flyer',
        localizedName: 'ワークショップチラシ',
        tags: ['print class workshop', '印刷 A4 講座 ワークショップ'],
      },
      {
        id: 'flyer-real-estate',
        name: 'Real Estate Flyer',
        localizedName: '不動産チラシ',
        tags: ['print property real estate', '印刷 A4 不動産 物件'],
      },
    ],
  },
  {
    packId: 'templates-presentations',
    category: 'presentation',
    width: 1920,
    height: 1080,
    pageCount: 3,
    items: [
      {
        id: 'presentation-clean',
        name: 'Clean Presentation',
        localizedName: 'クリーンプレゼンテーション',
        tags: ['slides deck clean', 'スライド プレゼン シンプル'],
      },
      {
        id: 'presentation-pitch',
        name: 'Pitch Deck',
        localizedName: 'ピッチデッキ',
        tags: ['slides startup pitch', 'スライド プレゼン ピッチ'],
      },
      {
        id: 'presentation-report',
        name: 'Report Presentation',
        localizedName: '報告プレゼンテーション',
        tags: ['slides report data', 'スライド プレゼン 報告 資料'],
      },
      {
        id: 'presentation-portfolio',
        name: 'Portfolio Presentation',
        localizedName: 'ポートフォリオプレゼンテーション',
        tags: ['slides portfolio creative', 'スライド 作品 ポートフォリオ'],
      },
      {
        id: 'presentation-lesson',
        name: 'Lesson Presentation',
        localizedName: '授業プレゼンテーション',
        tags: ['slides education lesson', 'スライド 授業 教育'],
      },
      {
        id: 'presentation-product',
        name: 'Product Presentation',
        localizedName: '商品プレゼンテーション',
        tags: ['slides product launch', 'スライド 商品 紹介'],
      },
    ],
  },
] as const

export const BUILTIN_DESIGN_TEMPLATE_CATALOG: readonly DesignTemplateCatalogEntry[] =
  GROUPS.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      packId: group.packId,
      category: group.category,
      width: group.width,
      height: group.height,
      pageCount: group.pageCount,
    })),
  )

export const BUILTIN_DESIGN_TEMPLATE_PACK_MANIFESTS: readonly DesignTemplatePackManifest[] =
  [
    {
      id: 'templates-social',
      templateCount: 6,
      load: () =>
        import('./packs/social').then((module) => module.SOCIAL_TEMPLATE_PACK),
    },
    {
      id: 'templates-thumbnails',
      templateCount: 6,
      load: () =>
        import('./packs/thumbnails').then(
          (module) => module.THUMBNAIL_TEMPLATE_PACK,
        ),
    },
    {
      id: 'templates-banners',
      templateCount: 6,
      load: () =>
        import('./packs/banners').then((module) => module.BANNER_TEMPLATE_PACK),
    },
    {
      id: 'templates-business-cards',
      templateCount: 6,
      load: () =>
        import('./packs/businessCards').then(
          (module) => module.BUSINESS_CARD_TEMPLATE_PACK,
        ),
    },
    {
      id: 'templates-flyers',
      templateCount: 6,
      load: () =>
        import('./packs/flyers').then((module) => module.FLYER_TEMPLATE_PACK),
    },
    {
      id: 'templates-presentations',
      templateCount: 6,
      load: () =>
        import('./packs/presentations').then(
          (module) => module.PRESENTATION_TEMPLATE_PACK,
        ),
    },
  ]
