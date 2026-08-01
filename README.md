# Pixelweave Studio

Pixelweave Studioは、編集対象の画像データをブラウザ内で処理する、レイヤー対応の画像編集・デザインWebアプリです。Photoshop/GIMPの代表的な編集フローに加え、複数ページ、素材、テンプレート、図表、アニメーション、ロゴ制作、マクロ、バッチ変換、ピクセル選択をインストール不要で実装しています。背景除去だけは、利用者が明示同意した場合にモデルを外部から取得します。画像本体をその取得先へ送信することはありません。詳細は[背景除去モデル](#背景除去モデル)を参照してください。

## 主な機能

- PNG / JPEG / WebP / SVGのドラッグ&ドロップ、ファイル選択、クリップボード貼り付け
- 選択、移動、拡大縮小、回転、パン、ズーム、crop、整列、等間隔分布、ルーラーからドラッグできるガイド、スナップ
- ブラシ、消しゴム、矩形、楕円、テキスト、縁取り、グラデーション、シャドウ、字間・行間、円弧テキスト
- レイヤーの追加、複製、削除、名前変更、並べ替え、表示、ロック、透明度、基本ブレンド、調整レイヤー、入れ子グループ、クリッピングフレーム、8bitレイヤーマスク
- 基本調整に加え、シャープ、エンボス、ノイズ、ピクセレート、セピア、反転、レベル、トーンカーブ、ホワイトバランス、ビネット、グラデーションマップ、デュオトーン、ハーフトーン、グリッチ
- 自動選択、なげなわ、追加・除外・交差、反転、フェザー、拡張・縮小を扱う8bit選択マスク
- canvas編集とページ構造・テンプレート・タイムラインを横断するUndo / Redo、コピー / 切り取り / 貼り付け、操作コマンド、マクロ記録・パラメータ付き再生
- Workerによる複数画像・入力フォルダのリサイズ、形式変換、フィルター、透かし、キャンセル、進捗表示
- フォルダへの直接出力またはZIP fallback、favicon / PWA / Apple Touch / OGPのアイコンプリセット
- 配色抽出と補色・類似色・トライアド・モノクロマティック配色、20種類のロゴテンプレート
- 用途別サイズ、複数ページ、背景、マジックリサイズ、36種類のデザインテンプレート、ブランドキット
- 遅延読み込み素材、端末内のマイ素材、canvasへの素材drag & drop、画像clip frame、画像drop・境界調整対応の写真grid
- 日本語フォント、ユーザーフォント、縦書き、箇条書き、テキストエフェクト
- 再編集可能な表と5種類のグラフ、CSV / TSV貼り付け
- 要素アニメーション、ページ遷移、プレゼンテーションプレビュー
- 限定コマンドだけを実行する`eval`なしのスクリプトDSL、端末内への保存、`runScript`マクロ登録
- 編集可能なschema version 4の`.pwx.json`プロジェクト保存と、version 1〜3プロジェクトの自動移行
- PNG / JPEG / WebP / SVG、複数ページPNG ZIP、mm物理寸法・DPI・bleed・crop mark・混在ページ寸法対応PDF、GIF、対応ブラウザでのMP4 / WebM書き出し
- OPFSのページ差分保存・旧形式復旧・localStorage fallbackを備えた自動保存
- PWAインストール、オフライン起動

## 表示と言語

- 保存済みの設定がない場合は、日本語・ダークモードで起動します。トップバーの言語切替で、基本操作、ダイアログ、簡易マニュアルを英語表示に切り替えられます。専門的な拡張ツールや遅延読み込みパネルには、日本語の表記が残る場合があります。
- テーマ切替でライトモードとダークモードを選べます。言語とテーマの選択は、このサイトのブラウザ保存領域に記憶されます。保存領域を利用できない場合や値が不正な場合は、日本語・ダークモードで起動します。
- トップバーの **使い方** / **Manual**（本のアイコン）を開くと、現在の言語で **簡易マニュアル** / **Quick guide** を表示します。画像を開く・編集する・プロジェクトを保存する・画像を書き出す、という基本の流れを確認できます。`?` はキーボードショートカット一覧を開きます。

画像データはData URLとしてプロジェクトへ格納されます。通常の編集、自動保存、マクロ、スクリプトの処理では、画像、プロジェクト、マクロ、スクリプトをアプリから外部サーバーへ送信しません。これらとモデルcacheはブラウザのオリジン専用領域へ保存されます。背景除去モデルの取得はこの扱いの例外で、明示同意後にのみ行われます。

## 拡張ツールと安全境界

上部の **Studio** から、デザイン、ロゴ生成、自動化・バッチ、選択・背景・スクリプトを開きます。デザインタブではページ、素材、テキスト、テンプレート、図表、アニメーション、複数ページ出力をまとめて操作できます。

- SVGはFabric.jsへ渡す前にサニタイズし、`script`、イベント属性、`foreignObject`、外部参照、危険なCSS、過大な要素数・寸法を拒否または除去します。SVG書き出し時のラスターレイヤーはData URLとして埋め込まれます。
- マクロは検証済みコマンドだけを`.pwxmacro.json`へ保存します。再生は成功時にUndo 1回分として確定し、失敗またはキャンセル時は再生前のsnapshotへ戻します。
- バッチWorkerで実行できるのは`resizeImage`、`applyFilter`、`addWatermark`など、`batchSafe`と定義したコマンドだけです。ポインター位置や現在の選択に依存する操作は受け付けません。
- スクリプトは生のJavaScriptではありません。`editor.resize`、`editor.applyFilter`、`editor.addText`、`editor.forEachLayer`だけを解釈する上限付きDSLで、`eval` / `Function`を使わず、`fetch`、DOM、Worker、import、prototype access、任意loopを拒否します。
- ロゴ生成は20種類の検証済みJSONテンプレートを使います。デザイン用の同梱フォントと端末フォントを共通レジストリで扱い、利用できないfamilyはfallback表示します。ユーザーフォントbytesはプロジェクトへ埋め込みません。

### 背景除去モデル

背景除去には、immutable revisionへ固定した[U²-Net Portable（U2NetP、Apache-2.0）](https://huggingface.co/Heliosoph/u2net-onnx/blob/7fc34deee10329bc039c10a73b98090d0c6f5c59/u2netp.onnx)を採用しています。モデル本体は初期bundleやService Workerのapp shellへ含めず、画面にモデル名と4,574,861 bytesの取得サイズを表示し、利用者がチェックボックスで明示同意した後にだけ固定HTTPS URLから取得します。画像をモデル配布元へ送信することはありません。

descriptorにはversion、bytes、SHA-256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`を固定しています。取得時は宣言サイズと実サイズを制限し、checksum検証に成功したbytesだけをOPFSへcommitします。次回はoffline cacheを再利用します。ONNX Runtime Webも背景除去経路から遅延loadし、WebGPUを利用できる場合はWebGPU Execution Providerを試し、失敗時を含めWASMへfallbackします。runtime assetも初期bundleの実行経路とService Worker precacheから分離しています。

実行同意は保存せず、背景除去を実行するたびにチェックが必要です。取得・検証済みのモデルcacheだけをオフライン再利用のため保持し、背景除去パネルから削除できます。固定モデルを使ったWASM受け入れ検証では、640×480のsynthetic画像を約981msで処理しました。さらに[scikit-imageが配布するNASAのパブリックドメイン写真](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut)（Eileen Collins、512×512、検証ファイルSHA-256 `88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`）を約840msで処理し、maskの前景/背景分離と10秒以内の基準を満たしました。同じ実モデルbytesをOPFS相当のcacheへ保存した後、network callbackを一度も呼ばずにoffline推論できることも検証しています。端末、ブラウザー、画像内容によって実行時間と品質は変わります。

モデルがない場合は、画像外周色から前景を推定する決定論的なローカルfallbackを使用します。これは配線、選択マスクによる手直し、テストのための機能であり、AIモデルと同等の切り抜き品質を保証するものではありません。

## プロジェクト形式

現在の保存形式は`.pwx.json` schema version 4です。ドキュメントは複数ページを持ち、各ページにpixel寸法、任意のmm仕上がり寸法と作成時DPI、Fabric.js payload、canonicalレイヤーツリー、背景、ガイド、スナップ許容距離、lossless符号化した8bit選択・レイヤーマスク、任意のアニメーションtimelineを保存します。canonicalレイヤーツリーとrenderer payloadが矛盾するfileは、canvas復元前に拒否します。

version 1・2の単一Canvasは1ページのドキュメントへ、version 3の複数ページは静止timelineを補ってversion 4へ移行します。次回保存時はversion 4になります。serializerは互換aliasを重複出力しません。未知version、寸法不一致、過大な画像・レイヤー・マスク・timelineは、現在のドキュメントを変更せず明示エラーにします。

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

取得済みの固定モデルについて、bytes、SHA-256、OPFS offline再利用、WASM推論時間、synthetic mask品質を再検証する場合は、モデルファイルへのパスを渡します。任意の代表画像も渡すと、実画像のmask分離、非退化、10秒以内を追加検証します。

```bash
npm run verify:background-model -- /path/to/u2netp.onnx
npm run verify:background-model -- /path/to/u2netp.onnx /path/to/representative.png
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

| 操作                            | macOS                  | Windows / Linux           |
| ------------------------------- | ---------------------- | ------------------------- |
| Undo / Redo                     | `⌘Z` / `⇧⌘Z`           | `Ctrl+Z` / `Ctrl+Y`       |
| 保存                            | `⌘S`                   | `Ctrl+S`                  |
| 開く                            | `⌘O`                   | `Ctrl+O`                  |
| コピー / 切取 / 貼付            | `⌘C/X/V`               | `Ctrl+C/X/V`              |
| グループ化 / 解除               | `⌘G` / `⇧⌘G`           | `Ctrl+G` / `Shift+Ctrl+G` |
| 選択 / ブラシ / 消しゴム / パン | `V` / `B` / `E` / `H`  | 同左                      |
| ズームイン / アウト / 100%      | `+` / `-` / `0`        | 同左                      |
| 選択を削除                      | `Delete` / `Backspace` | 同左                      |
| ヘルプ                          | `?`                    | 同左                      |

フォームへ入力中は編集用の1文字ショートカットを実行しません。

## GitHub Pages

このリポジトリにはGitHub Pages配布用の`.github/workflows/pages.yml`が含まれています。`main`へのpushまたは手動実行時に、lint、単体テスト、Vite本番ビルド、Pagesサブパス上のブラウザE2E、Pages配布を順に実行します。E2Eが失敗した場合は成果物をアップロードせず、デプロイも開始しません。

初回はリポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定してください。その後、`main`へのpush、または **Actions** からの手動実行で配布を開始できます。公開URLは所有者名とリポジトリ名により決まり、通常は`https://<owner>.github.io/<repository>/`です。実際に公開されたかどうかと正確なURLは、成功したActions実行の`github-pages`環境に表示されるdeployment URLで確認してください。このREADMEだけでは公開済みを示しません。

プロジェクトサイトのbase pathはビルド時に`GITHUB_REPOSITORY`から決まります。このリポジトリ名でビルドする場合は`/image-processor-web/`、ローカル開発では`/`です。favicon、manifest、PWAアイコンは`./`相対パスで参照するため、プロジェクトサイトのサブパスでも同じ配布先を解決します。

PRでは`.github/workflows/ci.yml`がテストと本番ビルドを検証します。PRを`main`へマージした後、Pagesの本番デプロイが開始されます。

## 設計資料

- [初期調査・作業計画](./IMAGE_EDITOR_WORK_PLAN.md)
- [機能拡張作業計画](./FEATURE_EXPANSION_WORK_PLAN.md)
- [Canva parity作業計画](./CANVA_PARITY_WORK_PLAN.md)
- [実装状況](./docs/IMPLEMENTATION_STATUS.md)
- [Architecture Decision Records](./docs/adr/)

## 既知の制限

- sRGB相当の8bit RGBAを対象とし、CMYK、ICC完全保持、16/32bit、RAWには未対応です。
- PSD / XCF / OpenRasterは読み込みません。SVGは安全化できる要素だけを対象とし、アニメーション、外部参照、埋め込みHTMLは保持しません。
- ラスターブラシはFabric.jsのパスオブジェクトとして保持します。Photoshop互換のブラシエンジンではありません。
- 消しゴムは選択レイヤーのマスクではなく、合成スタックを消去する専用ストロークレイヤーです。レイヤー順序で結果が変わります。
- ピクセル選択はドキュメント単位の8bitマスクです。ブラシと消しゴムはstroke作成時のマスクでclipされ、選択範囲の削除はUndo可能なpixel-deleteレイヤーとして保持されます。選択範囲からレイヤーマスクを作成・切替・削除・ラスタライズできますが、マスクへ白黒を直接描く専用UIは未対応です。
- 調整レイヤーとレイヤーグループは保存・再編集・表示切替に対応しますが、Photoshop互換のAdjustment LayerやSmart Objectではありません。
- カスタムフィルターはWebGL shaderを優先し、WebGL不可・非対応環境では決定論的CPU処理へfallbackします。大画像のタイル化、dirty region、WASM SIMD専用kernel、GPU tile cacheは未対応です。
- 背景除去モデルbytesは初期配布へ同梱せず、明示同意後に遅延取得します。モデルなしのfallbackは、被写体と背景の色が近い画像、髪、半透明物体で精度が低下します。U2NetPも専用mattingモデルではないため、細い髪や半透明境界は選択ツールでの手直しが必要な場合があります。
- スクリプトコンソールは安全なDSLであり、任意のJavaScriptやGIMP Script-Fu互換ではありません。
- 自動保存はブラウザのサイトデータを消すと失われます。重要な編集はプロジェクトファイルへ明示保存してください。
- スマートフォン・タブレットでは下部ツールレール、インスペクターのボトムシート、全画面Studio、ピンチ・パン・長押しを提供します。実機Safari、VoiceOver、複雑な大規模プロジェクトは継続検証対象です。

## ライセンス

アプリ本体のライセンスは現時点で未指定です。再利用条件を公開するときに、リポジトリ方針として明示してください。主要な実行時依存はReact、Fabric.js、ONNX Runtime WebがMIT License、LucideがISC Licenseです。明示同意後に取得するU2NetPモデルはApache-2.0です。

同梱フォントは[Inter](https://github.com/rsms/inter)、[Space Grotesk](https://github.com/floriankarsten/space-grotesk)、[Bitter](https://github.com/solmatas/Bitter)、[Manrope](https://github.com/sharanda/manrope)、Noto Sans JP、Noto Serif JPで、いずれもSIL Open Font License 1.1です。variable版を同梱して自己ホストし、日本語fontはunicode-range単位で遅延読み込みするため、フォント配信元へ接続しません。詳細は[ライセンス一覧](./docs/LICENSES.md)を参照してください。
