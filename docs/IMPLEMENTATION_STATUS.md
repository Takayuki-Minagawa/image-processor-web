# Pixelweave Studio 実装状況

更新日: 2026-08-01

Pixelweaveは、local-first画像編集MVPと`FEATURE_EXPANSION_WORK_PLAN.md`のP1〜P7を維持したまま、`CANVA_PARITY_WORK_PLAN.md`のC0〜C9に対応するデザイン制作基盤を追加した。

本書では、「純粋ロジック・schema・adapterが実装済み」であることと、「製品UIから受け入れ条件まで接続済み」であることを区別する。ここでのCanva parityは、端末内で複数ページのデザインを素材・テンプレートから組み立て、静止画・PDF・GIF・browser対応時の動画へ出力する制作機能を指す。クラウド同期、共有リンク、共同編集、生成AIは引き続き対象外である。

## 現在利用できるデザインフロー

1. 用途別presetまたはcustom寸法からデザインを作る。
2. pageを追加・複製・削除・並べ替え、pageごとに背景とdurationを設定する。
3. 図形、icon、frame、grid、text、template、chart、tableを通常レイヤーとして挿入する。
4. group、clip frame、selection由来のlayer mask、magic resizeを編集transactionとして適用する。
5. 日本語fontを遅延loadし、横書き・簡易縦書き、layout mode、text effectを使う。
6. projectをschema version 4の`.pwx.json`として保存し、v1〜v3を読み込む。
7. active / selected / all pageをPNG ZIP、raster PDF、timelineを反映したGIFへ書き出し、対応browserではnative video containerへ記録する。
8. 既存のフィルター、logo、macro、batch、選択、背景除去、安全なscript、PWA offline起動を併用する。

## PRレビュー後の堅牢化

PR #4のレビューで確認された保存・並行処理・実ブラウザ差分を次のように修正した。

- 旧rendererの長すぎるレイヤー名と制御文字はcanonical tree導出時に修復し、新規リネームは200文字上限に統一する。導出エラーも`ProjectFormatError`契約へ変換する。
- user asset / font、brand kit、autosaveのread-modify-writeをWeb Locks対応にし、OPFS indexを正常に読めない状態では空indexで上書きしない。
- 素材DnDは`DataTransfer`をdropイベント内で同期取得する。実ブラウザPlaywrightでcatalogからCanvasへのdropを検証する。
- magic resize / cropは通常レイヤーだけでなく、absolute clip frame、layer mask clip、mask RLE本体を同じ文書座標変換へ追従させる。
- page restoreはCanvas復元成功後にpage一覧とactive IDを公開し、復元中のpreview同期・exportを抑止する。
- autosave前の全文書検証は、project組み立てと永続化境界の2回へ削減する。page切替・並べ替えは検証済みpageを再検証せず、変更pageだけを検証する。
- atomic操作はengine単位で直列化し、先行rollbackが後続の成功済み変更を巻き戻さない。GIFは4096語の可変幅LZWへ変更し、export cancelは遅延resultより優先する。
- CSV / table / chartの文字数上限をmodelとimportで一致させ、外部表計算へ渡す文字列のformula prefixを無害化する。外部JSONは再帰深度128で拒否する。

## C0〜C9対応表

| Phase                | 実装済み                                                                                                                                                                                                                                                                                                                                                                                                            | 現在の境界・残作業                                                                                                                                                                                      | 状態           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| C0 基盤              | `App.tsx`をlazy shellへ縮小し、editor runtime、Design Studio、content pack、media処理を別chunk化。design copyをnamespace化し、hardcoded日本語検査を`npm run lint`へ統合。content-addressed `CompactHistory`と4K×20 layer×100操作benchmarkを追加                                                                                                                                                                     | 画面stateの多くは大きな`EditorApplication.tsx`に残り、store / reducerへの集約と`fabricEngine.ts`の責務分割は未完了。[Issue #5](https://github.com/Takayuki-Minagawa/image-processor-web/issues/5)で追跡 | 主要基盤対応   |
| C1 layer構造         | recursiveなcanonical layer treeをFabric payloadから導出し、3階層超のgroup保存・復元、⌘G / ⇧⌘G、折りたたみ・indent付きlayer panel、clip frame、8bit layer maskの作成・有効切替・削除・rasterizeを実装。これらのmask操作をStudioへ接続し、clipとmaskの同時保持、animation wipe、PNG / SVG経路を検証                                                                                                                   | group間drag、frame内画像だけを操作する専用mode、maskへ直接白・黒を描くbrush編集UIは未接続                                                                                                               | 主要フロー対応 |
| C2 design document   | schema v3で複数page / layer tree / background、v4でtimelineを追加。presetとcustom px/mm+DPI、新規design、page追加・複製・削除・並べ替え・thumbnail付き切替、9 anchor magic resize、背景、active / selected / all exportを実装。content-addressedな文書checkpointによりpage構造・template・timelineを含むglobal Undoを1操作単位で復元し、OPFS autosaveはmanifest＋page blobのcopy-on-writeで変更pageだけをcommitする | 10 page×4Kの空page切替はPlaywrightで1秒未満を継続検証。大容量rasterを各pageに持つ端末別のI/O性能はreleaseごとに実機確認                                                                                 | 主要フロー対応 |
| C3 素材              | 日英検索・category・最近使用catalog、3 deferred pack、図形7・frame 2・grid 3・Lucide icon 3、manifest / license / SVG安全検証を実装。strict typed payloadでpanelからcanvasへdrag & dropでき、rasterをclip frameまたはgrid cellへcover配置する。grid境界dragは最小cell幅を保ち、内部画像clip・保存復元・書き出しへ追従する。OPFS優先・容量制限・Web Locks対応の「マイ素材」の追加・再利用・一覧・削除UIも接続        | 初期catalogは15件で「数百件」規模には未到達。illustration、frame形状、grid patternの拡充はpayload pack単位で継続する                                                                                    | 主要フロー対応 |
| C4 text / font       | Latin 4 family、日本語Noto 2 family、system fontを共通registry化。Notoをunicode-rangeで遅延loadしinstall shellから除外。license確認付きuser fontをOPFSへ保存し`FontFace`で読み込み、一覧・適用・削除UIを接続。対応browserではLocal Font Accessも選択可能。欠落family warning、3 layout mode、簡易縦書き、箇条書き・番号list、4 effectを実装                                                                         | text objectごとの明示的なuser font source IDと見出しstyle presetは未接続。縦書きは禁則・縦中横を含む完全な日本語組版ではない                                                                            | 主要フロー対応 |
| C5 template / brand  | 6 deferred pack・計36 templateを全件検索表示し、複数pageを通常layerへ展開。適用全体をdocument checkpoint 1回でUndo可能。検証付き`.pwxtemplate.json`の完全project import / export、OPFS優先brand kit保存・選択・削除、templateへの色・font適用を実装                                                                                                                                                                 | user templateはfile import / exportで、端末内template libraryは持たない。brand logo参照の編集UIと新規作成dialog内のtemplate browserは未接続                                                             | 主要フロー対応 |
| C6 table / chart     | bounded CSV / TSV parser、immutable table model、bar / horizontal bar / line / pie / doughnut chart model、renderer非依存vector layoutを実装。semantic modelをFabric custom propertyへ保存し、CSV mini table、行列追加・削除、cell背景、罫線、行高・列幅、chart種別・data・paletteを再編集して安全なSVGへ再描画する。Undo / Redo、保存・再読込、SVG出力を検証                                                       | cell結合、複合chart、散布図、cell内rich textは初期対象外                                                                                                                                                | 主要フロー対応 |
| C7 export            | active / selected / all pageのPNG ZIP、PDF 1.7 raster writer、pageごとのMedia / Bleed / Trim box、任意crop mark、GIF89a、RGB332 raster、4096語LZW、概算file size、進捗・cancelを実装。mm pageは物理仕上がり寸法を保持し、DPIはraster密度だけを変更する。異なる寸法のpageも1 PDF内で独立geometryを保持し、PDF / GIFは共通Worker client経由でencode                                                                   | PDFはraster RGB/JPEGで、bleed領域は白。Preview / Acrobat /主要browserでの手動互換確認はchecklistに従ってreleaseごとに記録                                                                               | 主要フロー対応 |
| C8 animation / video | schema v4 timeline、enter / emphasis / exit、9 effect、4 easing、page transition、relative start、純粋evaluatorを実装。preview / GIF / video frameは同じpresentation timelineとpage-local時刻を使用。native `MediaRecorder`のMP4 / WebMとGIF fallbackを接続                                                                                                                                                         | native container・codec対応はbrowser依存。決定論的なWebCodecs encoder / muxer、audio、high-frame-rate exportは未実装。GIF / videoは最大480px・最大120 frameのbounded preview品質                        | 主要フロー対応 |
| C9 mobile            | handset / tabletでbottom tool rail、inspector bottom sheet、fullscreen modal、44px targetをapp shellへ統合。two-pointer pinch / panとlong pressをFabric viewportへ配線。390px phone / 1024px tabletのPlaywrightとaxe scenarioを追加                                                                                                                                                                                 | iPhone / iPad実機、Safari touch、VoiceOverでの確認は未記録                                                                                                                                              | 主要フロー対応 |

## project schema version 4

`.pwx.json`のcurrent schemaはversion 4である。

| Version | 正本に追加した内容                                                       | 読み込み時の扱い                      |
| ------- | ------------------------------------------------------------------------ | ------------------------------------- |
| v1      | rootの単一Canvas                                                         | 既定`editorState`を補い、1 pageへ移行 |
| v2      | guide、snap tolerance、selection maskを持つ`editorState`                 | 1 pageへ移行                          |
| v3      | `pages[]`、`activePageId`、layer tree、clip、layer mask、page background | 構造を維持してv4へ移行                |
| v4      | page timelineと要素animation                                             | current形式                           |

各`ProjectPage`は、pixel寸法、Fabric renderer payload、renderer非依存editor state、layer tree、背景、任意の物理仕上がり寸法（mm＋作成時DPI）、timeline / thumbnailを所有する。canonical layer treeはFabric由来treeとID・順序・階層・clip・maskを照合し、矛盾するfileを復元前に拒否する。実行時には旧single-canvas API向けにactive pageの`canvasSize`、`fabricCanvas`、`editorState` aliasを持つが、serializerはaliasを出力せず、active payloadを二重保存しない。

外部入力は、page 100件、layer node 2,000件 / page、group深さ32、mask payload、thumbnail、timeline、embedded image、JSON keyをrenderer復元前に検証する。未知versionは推測せず拒否する。

設計判断は[ADR-009](./adr/0009-layer-tree-clipping.md)、[ADR-010](./adr/0010-multipage-document.md)、[ADR-013](./adr/0013-animation-and-encoding.md)に記録した。

## 履歴と自動保存

履歴の公開APIはsnapshot方式を維持し、大きなData URLだけを`CompactHistory`でcontent address化する。4K相当、20 layer、100操作の保守的見積もりは、素朴な複製で約8 GiB、同一assetをinternした場合は約80 MiBと構造snapshotになる。詳細は[ADR-003](./adr/0003-history.md)に記録した。

複数pageでは100件上限の`DesignDocumentCheckpoint`を正規履歴とし、canvas編集、page追加・複製・削除・並べ替え、template適用、timeline変更を同じUndo / Redo経路へ積む。`CompactHistory`が全pageのData URLをcontent address化するため、文書checkpoint間で同じ大容量assetを複製しない。page切替そのものは編集ではないためcurrent checkpointのactive pageだけを置換する。

自動保存は編集をqueue化し、active pageを同期してからOPFSへ保存する。OPFSではmanifestとpage別blobを使い、同一内容のpageは既存blobを再利用して変更pageだけをcopy-on-writeでcommitする。manifest commit後に旧blobを回収するため、途中失敗時も直前世代を復元できる。旧単一file autosaveは読み込み互換を維持し、OPFSが利用できない場合は完全なproject JSONをlocalStorageへfallbackする。

## 素材、template、font、license

素材・templateはcatalog metadataをentry chunkへ、payloadをdynamic import packへ分ける。検索ではpayloadをloadせず、選択したpackだけを検証・cacheする。組み込みSVGも必ず既存sanitizerを通し、外部参照を許可しない。詳細は[ADR-011](./adr/0011-assets-and-templates.md)に記録した。

同梱fontとiconのlicense、source、loading方針は[LICENSES](./LICENSES.md)を正本とする。Noto Sans JP / Serif JPはsame-originの遅延chunkで、WOFF2をService Worker install shellへ含めず、利用後にruntime cacheする。user font binaryはproject / templateへ埋め込まずreference-onlyとする。user assetの再利用原本は端末内に置く方針だが、designへ挿入した検証済みraster / SVGは自己完結性のためFabric payloadへ含まれ得る。詳細は[ADR-012](./adr/0012-fonts-and-licensing.md)に記録した。

## animationと書き出し

timeline evaluatorはrendererとwall clockから独立し、任意時刻のpage / element stateを決定論的に返す。transition overlap時もactive pageは最大2枚となる。preview、GIF、videoは同じpresentation timelineでpage transitionを評価し、同じpage-local時刻をFabricの要素animation評価へ渡す。

PDFは1 page 1 raster XObjectのPDF 1.7で、物理boxと任意crop markを保持する。GIFはfull-canvas indexed GIF89aで、UIはRGB332固定palette、最長辺480px、最大120 frameに制限する。videoはCanvas streamをbrowserの`MediaRecorder`へ渡し、native MP4 / WebM containerが利用できなければ同じframe列をGIFへfallbackする。WebCodecsのcodec / muxer capability modelは将来の決定論的pipeline用であり、現在のvideo記録とは別境界である。

release前のviewer / browser確認は[PDF / GIF / video書き出し互換確認手順](./EXPORT_COMPATIBILITY_CHECKLIST.md)を使う。

## 既存P1〜P7の維持

Canva parity追加前の機能拡張も維持する。

| Phase | 維持している主な機能                                                            |
| ----- | ------------------------------------------------------------------------------- |
| P1    | SVG入出力とsanitizer、装飾text、整列・分布、guide、snap                         |
| P2    | 検証済みoperation command、macro記録・保存・atomic replay                       |
| P3    | batch-safe Worker pipeline、folder / ZIP、icon preset                           |
| P4    | 14 filter registry、preview、preset、adjustment layer、CPU / WebGL fallback     |
| P5    | palette、配色調和、20 logo template、seed生成、編集可能logo layer               |
| P6    | lossless 8bit selection mask、flood fill / lasso、feather・形態演算、選択filter |
| P7    | 同意付きpinned U2NetP、SHA-256、OPFS cache、WebGPU -> WASM、安全なscript DSL    |

selection maskは[ADR-006](./adr/0006-selection-mask.md)、背景modelとscriptは[ADR-007](./adr/0007-background-model-and-script-security.md)、macroとWorkerは[ADR-008](./adr/0008-automation-and-worker-pipeline.md)を参照する。

## local-firstと安全境界

- 画像、project、素材、font、template、brand kit、macro、scriptを既定で外部送信しない
- SVGは組み込み・user経路ともscript、event属性、埋め込みHTML、危険CSS、外部resourceを除去または拒否する
- user font bytesと未検証のuser asset原本をtemplate / brand kitへ埋め込まない。designへ挿入済み画像のFabric payloadはproject上限で検証する
- 背景modelは固定descriptor、表示された取得size、明示同意、SHA-256検証なしにdownloadしない
- ONNX Runtime、日本語font、素材、template、media encoderをentry bundleから分離する
- strict CSP、GitHub Pages subpath、PWA offline shellを維持する
- cloud同期、共有link、共同編集、生成AIは別ADRと明示opt-inなしに追加しない

## 自動検証とrelease gate

純粋model、validator、adapter、encoderにはVitestを置き、既存ユーザーフローはPlaywright、axe、golden screenshotで検証する。C0〜C9で追加した主な自動検証対象は次の通り。

- v1 / v2 / v3 -> v4 migration、alias非出力、複数page操作
- layer tree、group、clip、layer mask、Fabric snapshot round trip
- size preset、mm変換、magic resize、page background
- deferred asset / template pack、全15素材・36template、SVG sanitizer
- OPFS / localStorage fallback付きuser asset / font repository、font registry、Noto deferred loader、license確認と`FontFace`
- brand kit repository、user template envelope、CSV / TSV、table / chart modelとSVG
- timeline schedule / evaluator、project timeline adapter
- PDF box / xref / JPEG / crop mark、GIF palette / timing / LZW、Worker client cancel / progress、MediaRecorder選択
- responsive layout、pinch / pan、long press、phone / tablet Playwright、axe
- history benchmarkと、asset / template / mediaの独立chunkを検査するbundle budget

最終PRでは次をquality gateとして実行し、結果をPR本文へ記録する。

```sh
npm run format:check
npm run lint
node scripts/check-i18n-hardcoded.mjs
npm test
npm run build
npm run test:e2e
```

PDF / GIF / video viewer、mobile実機、10 page×4K切替性能は自動testだけで完結しないため、実施した結果だけを手動checklistまたはPRへ記録する。

## 意図的な対象外と次の判断ゲート

- cloud同期、共有、共同編集、生成AI
- PSD / XCF / OpenRaster、ICC / CMYK / 16bit、vector PDF
- 完全な日本語組版、font embedding、text objectごとのuser font source ID
- 決定論的なWebCodecs MP4 / WebM encoder・muxer、audio、high-frame-rate video
- layer treeのgroup間drag、layer mask brush editor、frame内部だけを直接操作する専用mode
- 端末内user template browser、brand logo管理UI
- mobile実機・assistive technology確認と10 page×4K実機性能記録

これらは既存データ形式やlocal-first境界を暗黙に広げず、性能計測、互換性、権限、配布sizeを確認した上で別ADRまたは次期計画として扱う。
