# 機能拡張実装状況

更新日: 2026-07-31

初期計画のPhase 1〜4で完成したlocal-first画像編集MVPを維持したまま、`FEATURE_EXPANSION_WORK_PLAN.md`のP1〜P7を実装した。機能拡張は、レンダラーに依存しない純粋ロジック、境界を検証するunit/component test、Fabric.js editorへのadapter、Studio UIに分けている。

背景除去にはimmutable revisionへ固定したU2NetPを採用した。モデルbytesは初期bundleへ同梱せず、取得サイズを示して明示同意を得た後にだけ背景除去経路が固定URLから遅延取得する。Worker対応環境ではdownload、cache、推論を背景除去Workerが所有する。SHA-256検証済みbytesをOPFSへcacheし、ONNX Runtime WebはWebGPUを優先してWASMへfallbackする。ロゴ用フォント資産は同梱せず、端末のsystem fontへfallbackする。

## 完了した製品フロー

1. PNG / JPEG / WebP / 安全化したSVGを開くか、新しいキャンバスを作る。
2. レイヤー、図形、装飾テキスト、ブラシ、消しゴム、整列、ルーラーからドラッグするガイド、スナップで編集する。
3. 実画像プレビューを確認しながら拡張フィルターを画像または再編集可能な調整レイヤーとして適用する。
4. 名称、タグライン、配色からロゴ候補を生成し、編集可能なレイヤー群として挿入する。
5. 操作をコマンドとして記録し、パラメータ付きマクロとして保存・再生する。
6. batch-safeなマクロで複数画像をWorker処理し、フォルダまたはZIPへ書き出す。現在の画像からアイコン一式も生成できる。
7. 自動選択、なげなわ、フェザー、拡張・縮小で8bit選択マスクを編集する。
8. 明示同意で有効にする背景モデルまたは決定論fallbackで背景を透過し、安全なスクリプトDSLから限定コマンドを実行する。
9. Undo / Redo、自動保存、schema version 2プロジェクト保存、PWAのoffline起動で作業を保護する。

## 機能拡張計画との対応

| フェーズ | 実装                                                                                                                                                                                                                                         | 境界・制約                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| P1       | SVG入出力、SVG sanitizer、テキストの縁取り・グラデーション・シャドウ・字間・行間・円弧配置、整列・分布、ドラッグ作成できるガイド、スナップ                                                                                                   | SVGのscript、イベント属性、外部参照、埋め込みHTML、危険なCSS、過大入力をFabric.js到達前に除去または拒否                         |
| P2       | 直列化可能な操作コマンド、semantic target、dispatcher、マクロ記録、パラメータ解決、`.pwxmacro.json`、local repository、atomic replay                                                                                                         | 既存snapshot履歴を維持。再生中は中間履歴を抑止し、成功時に1件commit、失敗・キャンセル時に完全rollback                           |
| P3       | decode → command → encode Worker、Transferable、進捗・キャンセル、複数ファイルcontroller、直接フォルダ出力、ZIP fallback、アイコンプリセット                                                                                                 | WorkerはDOMとeditor stateを所有せず、事前検証済みのbatch-safeコマンドだけを実行                                                 |
| P4       | 14種の追加フィルターregistry、実画像preview、version付きpreset companion schema、custom WebGL shader、決定論的CPU kernel、再編集可能な調整レイヤー、ラスタライズ                                                                             | P2 recipeとversioning・validation原則を共有するが、nested filter parameterを型付きで保つため`.pwxmacro.json`とは分離する        |
| P5       | 画像パレット抽出、4種の配色調和、検証付きtemplate schema、20種類の組み込みtemplate、seed付き候補生成、レイアウト・配色・フォントのlock、編集可能レイヤーへの展開                                                                             | 生成AIと外部通信は不使用。フォントファイルは同梱せず、端末のインストール済みfontとgeneric familyを使用                          |
| P6       | 不変8bit選択マスク、raw/RLE lossless codec、replace/add/subtract/intersect、反転、フェザー、拡張・縮小、polygon rasterize、flood fill、Worker protocol、マーチングアンツ、ブラシ/消しゴムclip、pixel-delete、選択フィルターWorker、Studio UI | マスクはドキュメント座標の正本。サイズとdecoded pixelsをallocation前に検証し、公開境界では防御的コピー                          |
| P7       | pinned U2NetP descriptor、明示同意、固定URL取得、SHA-256、OPFS cache、ONNX Runtime Web遅延load、WebGPU→WASM、背景除去Worker、決定論fallback、saved DSL scripts、`runScript` macro、Studio UI                                                 | モデルbytesとruntimeは初期bundle / app shellへ含めない。DSLはwhitelist以外のglobal、network、DOM、import、prototype、loopを拒否 |

## プロジェクトschema version 2

`.pwx.json`の正本をschema version 2へ更新した。Fabric.js payloadとは別の`editorState`に、次のrenderer-independent stateを保存する。

- ドキュメント座標のガイド
- 1〜100pxのスナップ許容距離
- 幅・高さを持つ8bit選択マスクのlossless Base64 payload

version 1は読み込み互換を維持する。runtime validation後、空のガイド、既定値8px、選択マスクなしを補い、メモリ上でversion 2へ移行する。次の明示保存・自動保存ではversion 2を書き出す。未知version、キャンバス外のガイド、寸法不一致・過大・破損したmask payloadは、現在のeditorを変更する前に拒否する。

Fabric由来のSVGグループ、ロゴ、調整レイヤーは限定したeditor propertyだけをFabric JSONへ保存する。ガイドと選択マスクをFabric objectや`clipPath`へ埋め込まないため、永続形式の検証と将来のrenderer移行を独立させている。

## 自動化とWorker

操作コマンドは`resizeCanvas`、`resizeImage`、`applyFilter`、`addText`、`addWatermark`、`runScript`を型とruntime validatorの両方で定義する。object idへ直接依存せず、document、active image、topmost image、layer name、同じ再生内のcommand resultをsemantic targetとして参照する。

各コマンドは`recordable`、`batchSafe`、`pointerDependent`の能力metadataを持つ。現在のバッチ経路は`resizeImage`、基本`applyFilter`、`addWatermark`だけを許可し、`resizeCanvas`、通常の`addText`、`runScript`、将来のポインター依存操作を全入力のdecode前に拒否する。

マクロは最大件数、文字列長、パラメータ型、寸法、色、対象を検証する。未知・不正コマンドはdiagnostic付きで隔離し、既知の安全なコマンドだけを保持する。atomic replayは次の順序を固定する。

1. パラメータをすべて解決・検証する。
2. 再生前snapshotを取得する。
3. 履歴記録を抑止してコマンドを順番に実行する。
4. 全件成功時だけ最終状態をUndo 1回分としてcommitする。
5. 例外またはキャンセル時は再生前snapshotをrestoreする。

Worker境界、atomic replay、batch-safe制約の詳細は[ADR-008](./adr/0008-automation-and-worker-pipeline.md)に記録した。

## バッチ・ZIP・アイコン

画像パイプラインはPNG / JPEG / WebPのmagic byte、宣言寸法、decode後寸法、50MB入力、8,192px / 64MP上限を検証する。入力`ArrayBuffer`、処理結果、ZIP entryはTransferableとしてWorkerへ移し、job idごとに進捗とcancelを管理する。

File System Access APIが利用できる場合は、利用者が選んだフォルダへ安全化したファイル名で直接保存する。API自体がない場合はZIPへfallbackする。利用者がpermissionを拒否した場合は、意図を尊重して自動fallbackしない。

ZIPは外部依存なしのZIP32 stored形式で決定論的に生成する。CRC32計算とcopyをchunk化してWorker event loopへ制御を返すため、大きなarchiveでもキャンセルを観測できる。ZIP32の件数・4GiB上限、重複名、path traversal、control characterを事前に拒否する。

組み込みアイコンpresetはfavicon 16/32/48、PWA 192/512、Apple Touch 180、OGP 1200×630の7種類で、検証済みのユーザーpresetも端末内へ保存できる。

## フィルターと調整レイヤー

追加filter registryは、シャープ、エンボス、ノイズ、ピクセレート、セピア、反転、レベル、トーンカーブ、ホワイトバランス、ビネット、グラデーションマップ、デュオトーン、ハーフトーン、グリッチの14種類を扱う。filter idごとのparameter schema、既定値、上限、preset import時の未知filter warningを一箇所で管理する。

同じregistry contractに対するCPU kernelを用意し、alphaを保持する純粋なRGBA変換としてunit testできるようにした。custom filterはWebGL shaderを優先し、WebGL不可時は同じ純粋CPU処理へfallbackする。パラメータUIは現在のdocumentを縮小したbefore/after previewをWorkerで生成し、変更のdebounce、cancel、世代番号で古い結果を破棄する。

調整レイヤーはscalar設定またはexactな`FilterOperation[]`を限定propertyへ保存する。下位にある可視レイヤーの合成結果をdocument順にWorker処理してderived cacheを再構築し、下位レイヤー変更への追従、表示切替、保存・復元後の再編集、通常画像へのラスタライズに対応する。

基本調整と14種のregistry filterをピクセル選択へ適用するときは、ドキュメントRGBAと8bitマスクを専用WorkerへTransferし、マスクalphaを持つoverlay画像を返す。基本調整UIは進捗とキャンセルもclient境界で管理し、選択外の元画像は変更しない。Workerがない環境では同じ純粋CPU演算へfallbackする。

## ロゴ生成

中央値分割による主要色抽出と、補色・類似色・トライアド・モノクロマティックの配色生成を実装した。ロゴtemplateはversion、寸法、要素数、座標、slot、色、font、重複idをruntime validationし、不正なtemplateだけを隔離する。

20種類の組み込みtemplateとseed付き組み合わせ生成から、既定で12件以上の候補を表示する。選択候補のレイアウト、配色、fontを個別に固定して再生成し、決定した候補は通常の図形・テキストレイヤーとして編集・SVG/画像書き出しへ渡せる。

フォントassetは同梱していない。font pairはCSS family候補だけを持ち、端末にない場合は`system-ui`、`sans-serif`、`serif`へfallbackする。このため、候補preview、Fabric canvas、batch透かしの字形・文字幅はOSとインストール済みfontで変わり得る。

## 選択・背景除去・スクリプト

選択マスクは0を未選択、255を完全選択、中間値をフェザーとして保持する。自動選択は許容値付き4近傍flood fill、なげなわはeven-odd polygon rasterizationを使う。replace/add/subtract/intersect、反転、フェザー、拡張・縮小を純粋演算とWorker protocolの両方で提供する。マーチングアンツはStudio previewとメイン編集キャンバスの表示専用overlayで点滅し、保存画像には含めない。

ブラシと消しゴムは、stroke完了時ではなくstroke作成時に存在した選択マスクからclipを構築する。選択範囲の削除は元レイヤーのpixelを破壊せず、`destination-out`とmask clipを持つ直列化可能なpixel-deleteレイヤーとして追加するため、保存とUndo/Redoの対象になる。基本調整と14種の追加フィルターの選択範囲適用は専用Workerで行う。

背景除去は`BackgroundSegmentationAdapter`にRGBAを渡し、0〜1または0〜255のmaskを8bit選択マスクへ正規化する。既定descriptorはU2NetP `u2netp@7fc34de`、4,574,861 bytes、Apache-2.0、SHA-256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`で、immutable revisionのHTTPS URLを持つ。UIはモデル名・取得サイズ、明示同意、進捗、キャンセル、モデル失敗時fallbackを表示する。

同意済みjobだけがdescriptorを背景除去Workerへ渡す。実行同意は永続化せず、実行完了・cancel・Studio再openのたびに解除する。Worker内loaderはURL、Content-Length、実bytes、上限、SHA-256を検証し、成功後だけOPFSへcommitする。Workerがない環境は同じ同意・checksum・OPFS境界を持つ遅延loaderを呼び出し側で使う。ONNX Runtime Webは背景除去経路で遅延loadし、WebGPU sessionを試した後にWASMへfallbackする。モデルbytesとruntime assetは初期bundle / Service Worker app shellへ含めない。モデルなしまたはload失敗時は、画像外周色との差から前景alphaを作る決定論fallbackを使用できる。これはAI matting品質の代替ではない。

スクリプトはJavaScript風の構文を持つが評価はしない。自前parserが`editor.resize`、`editor.applyFilter`、`editor.addText`、`editor.forEachLayer`を直列化可能なcommandへ変換し、source、command、nest、文字列、collectionの上限を適用する。`fetch`、`document`、`window`、`globalThis`、Worker、WebSocket、import、constructor、prototype access、任意式、任意loopはgrammarに存在しない。検証済みsourceは端末内repositoryへ保存・再読込・削除でき、macroへ登録すると`runScript` commandとしてimport時、登録時、実行時に再parseされる。スクリプト全体はmacroと同じatomic transactionになる。

選択マスクの設計は[ADR-006](./adr/0006-selection-mask.md)、背景モデルとスクリプトの安全境界は[ADR-007](./adr/0007-background-model-and-script-security.md)に記録した。

## ローカルファーストと配布

- 画像、プロジェクト、マクロ、スクリプトを外部サーバーへ送信しない。
- 自動保存、マクロ、ユーザーpreset、取得・検証済みモデルcacheはorigin-scoped storageへ保存する。モデル実行への同意は保存しない。
- SVGの外部resource参照を除去し、SVG importを暗黙のnetwork入口にしない。
- 背景モデルはpinned descriptorと明示同意なしにloadしない。モデル取得以外の画像編集データは外部へ送信しない。
- ONNX Runtime、モデルbytes、font assetを初期bundleとService Worker app shellへ含めない。
- PWA更新前に保留中編集をflushし、GitHub Pagesのsubpathとoffline shellを維持する。

## 意図的な制約と次の判断ゲート

- tile renderer、dirty region、LRU GPU cache、4K/20層の複合調整レイヤー性能回帰
- PSD / XCF / OpenRaster、ICC / CMYK / 16bit、レイヤーgroup、Smart Object
- 複数実画像corpusによるhair / 半透明境界の品質評価、実機WebGPU性能、VoiceOver / NVDA、Safari / Firefox実機

モデルbytesの初期配布除外、system font fallback、安全なDSL、batch-safe制約は欠落ではなく、local-firstと能力制限を守るための意図的な製品境界である。任意JavaScript互換が必要になった場合は、既存境界を緩めず別ADRで判断する。

## 2026-07-31 MVPレビュー対応

- 修飾キー付きショートカット、非同期cut、モバイルメニュー、PWA更新失敗時の操作ロックを修正
- Fabric.js 7の中心原点を左上原点へ正規化し、復元を検証・準備・適用へ分離
- 保存・復元・画像入力の上限とruntime validation、rollback、Fabric resourceの所有権を強化
- 自動保存queue、更新前flush、離脱警告、Modal focus管理、Service Worker scopeを堅牢化
- ESLint / Prettier、Pages本番subpath E2E、axe監査をCI・deploy前の必須gateへ追加

## 2026-07-31 機能拡張の検証範囲

- project v1 → v2 migration、editorState validation、選択maskのround trip
- SVG sanitizer、整列・分布、guide・snap、Fabric import/export・restore
- command validation、parameter解決、macro import、記録、atomic replay・rollback
- batch image pipeline、Worker protocol/client、cancel、folder/ZIP出力、icon preset
- filter registry、preset、全14種CPU kernel、調整レイヤー
- palette抽出、配色、20 template validation、seed生成、Logo Generator component
- 選択mask、codec、合成・形態演算、polygon/flood fill、Worker
- pinned U2NetP metadata、model consent/cache/checksum、ONNX adapter、WebGPU→WASM fallback、segmentation/fallback、背景Worker、saved script repository、`runScript` macro
- Studio各panelのaccessibility、成功・失敗・キャンセル経路
- 固定モデル実体に対する`npm run verify:background-model -- /path/to/u2netp.onnx [/path/to/representative.png]`で、4,574,861 bytes、SHA-256、OPFS offline cache hit、640×480 synthetic画像（約981ms）とNASAの実写真512×512（約840ms）のWASM推論、前景・背景mask閾値を検証
- Pages本番subpathのPlaywrightで、50画像Worker batchのlong-task 200ms以内・ZIP 50件、filter macro round tripとUndo、logo→7 icon寸法、magic-wand→feather→filter→Undo/Redo、主要Studio panelのaxe、ロゴと実フィルター結果のgolden screenshotを検証
- `npm test`、`npm run format:check`、`npm run lint`、`npm run build`を最終品質gateとする
