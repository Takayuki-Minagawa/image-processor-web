# Pixelweave Studio

Pixelweave Studioは、画像を外部サーバーへ送らず、ブラウザ内で編集するレイヤー対応の画像編集Webアプリです。Photoshop/GIMPの代表的な編集フローを、インストール不要のデスクトップ向けMVPとして実装しています。

## 主な機能

- PNG / JPEG / WebPのドラッグ&ドロップ、ファイル選択、クリップボード貼り付け
- 選択、移動、拡大縮小、回転、パン、ズーム、crop
- ブラシ、消しゴム、矩形、楕円、テキスト
- レイヤーの追加、複製、削除、名前変更、並べ替え、表示、ロック、透明度、基本ブレンド
- 明るさ、コントラスト、彩度、色相、ぼかし、グレースケール
- Undo / Redo、コピー / 切り取り / 貼り付け
- 編集可能な`.pwx.json`プロジェクト保存と再読込
- PNG / JPEG / WebP書き出し
- OPFS優先・localStorage fallbackの自動保存と復旧
- PWAインストール、オフライン起動

画像データはData URLとしてプロジェクトへ格納されます。自動保存もブラウザのオリジン専用領域に保存され、アプリからネットワーク送信しません。

## ローカル実行

Node.js 22.12以上を用意してください。

```bash
npm ci
npm run dev
```

表示されたローカルURLをブラウザで開きます。検証コマンドは次のとおりです。

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

`npm run test:e2e`はGitHub Pagesと同じ
`/image-processor-web/`サブパスで本番ビルドを生成し、Vite previewに対して
Playwrightを実行します。既存の`dist`を再利用するCIでは
`PLAYWRIGHT_SKIP_BUILD=true npm run test:e2e`を使用します。

コード品質の確認にはESLint（TypeScript / React Hooks）とPrettierを使用します。
`npm run format:check`は差分確認用、`npm run format`は明示的に全体を整形するときに
使用してください。

TypeScript 7はコンパイラCLIを`@typescript/native` aliasから提供し、APIを必要とする
typescript-eslint向けには`@typescript/typescript6`を`typescript` aliasとして
併設しています。`npm run build`の`tsc`はTypeScript 7を実行します。

## キーボードショートカット

| 操作                            | macOS                  | Windows / Linux     |
| ------------------------------- | ---------------------- | ------------------- |
| Undo / Redo                     | `⌘Z` / `⇧⌘Z`           | `Ctrl+Z` / `Ctrl+Y` |
| 保存                            | `⌘S`                   | `Ctrl+S`            |
| 開く                            | `⌘O`                   | `Ctrl+O`            |
| コピー / 切取 / 貼付            | `⌘C/X/V`               | `Ctrl+C/X/V`        |
| 選択 / ブラシ / 消しゴム / パン | `V` / `B` / `E` / `H`  | 同左                |
| ズームイン / アウト / 100%      | `+` / `-` / `0`        | 同左                |
| 選択を削除                      | `Delete` / `Backspace` | 同左                |
| ヘルプ                          | `?`                    | 同左                |

フォームへ入力中は編集用の1文字ショートカットを実行しません。

## GitHub Pages

`.github/workflows/pages.yml`は`main`へのpushまたは手動実行で、lint、単体テスト、
Vite本番ビルド、Pagesサブパス上のブラウザE2E、Pages配布を順に実行します。
E2Eが失敗した場合は成果物をアップロードせず、デプロイも開始しません。
リポジトリの **Settings → Pages → Build and deployment → Source** を
**GitHub Actions** に設定してください。

プロジェクトサイトのパスはビルド時に`GITHUB_REPOSITORY`から決まり、このリポジトリでは`/image-processor-web/`になります。ローカル開発では`/`を使用します。

PRでは`.github/workflows/ci.yml`がテストと本番ビルドを検証します。PRを`main`へマージした後、Pagesの本番デプロイが開始されます。

## 設計資料

- [初期調査・作業計画](./IMAGE_EDITOR_WORK_PLAN.md)
- [実装状況](./docs/IMPLEMENTATION_STATUS.md)
- [Architecture Decision Records](./docs/adr/)

## MVPの既知制限

- sRGB相当の8bit RGBAを対象とし、CMYK、ICC完全保持、16/32bit、RAWには未対応です。
- PSD / XCF / SVGは読み込みません。
- ラスターブラシはFabric.jsのパスオブジェクトとして保持します。Photoshop互換のブラシエンジンではありません。
- 消しゴムは選択レイヤーのマスクではなく、合成スタックを消去する専用ストロークレイヤーです。レイヤー順序で結果が変わります。
- 選択はレイヤー/オブジェクト単位です。ピクセル選択、投げ縄、magic wand、スポイトは後続フェーズです。
- 大画像のタイル化、WASM/WebGPUフィルター、レイヤーマスク、グループ、スマートオブジェクトは後続フェーズです。
- 自動保存はブラウザのサイトデータを消すと失われます。重要な編集はプロジェクトファイルへ明示保存してください。
- 高精度な編集UIはデスクトップ向けです。小画面では閲覧と簡易操作を優先します。

## ライセンス

アプリ本体のライセンスは現時点で未指定です。再利用条件を公開するときに、リポジトリ方針として明示してください。主要な実行時依存はReactとFabric.jsがMIT License、LucideがISC Licenseです。
