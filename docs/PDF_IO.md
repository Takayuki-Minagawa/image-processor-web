# PDF入出力の仕様と検証境界

更新日: 2026-10-28  
調査開始時のmain: `b32ba2b82ab88148bdbc706a2bf35fc6a2645b68`

## 採用した範囲

P0は「PDFの選択ページを原寸の背景画像として開き、既存の文字・図形・画像を重ね、画像PDFとして出力する」フローとする。既存のFabric編集、複数ページ、物理寸法、文書transaction、Undo / Redo、自動保存を再利用する。PDFの文字置換、OCR、任意PDFから編集可能SVGへの復元は含めない。

P1候補からは、出力ページ数・仕上がりmm・DPI・画像化の説明・背景の取込DPI超過を確認する軽量preflightだけを追加した。SVG原寸での新規作成は後続の[SVG原寸入力](./SVG_IMPORT.md)で対応した。名前付き出力設定は[出力設定プリセット](./OUTPUT_PRESETS.md)で対応した。原稿との比較は[参照PDFとの比較](./PDF_COMPARISON.md)で対応した。ベクター／ハイブリッドPDF試作は次段階とする。PDF要素分解のP2は別の採否判断を要し、今回の依存へMuPDF、OCR、外部サービスは追加しない。

## 読込エンジンと配布

`pdfjs-dist` **6.4.299**を完全なバージョン指定とlockfileで固定する。公開Display APIの`getDocument`、`getPage`、`getViewport`、`render`、`cleanup`、`destroy`を使い、core内部のoperatorや削除済みSVGバックエンドには依存しない。API / workerとも同じpackageのlegacy buildを使い、Node要件は22.13以上とする。

PDF原本は`File.arrayBuffer()`のbytesから読み込む。workerはViteがemitする同一配布元のURLを使い、CMap・標準フォント・WASM・ICCは`pdfjs/6.4.299/`以下へ同梱する。GitHub Pagesの`BASE_URL`からURLを解決し、CDNの最新版やPDFに指定された配布先へ切り替えない。これらのPDF資産はService Workerのprecache対象であり、オフライン利用にはアプリと資産の取得・cache完了が必要である。PDF解析コード自体は取込時に遅延loadする。

PDF.js本体はApache-2.0だが、同梱CMap・フォント・WASM・ICCのライセンスは異なる。元の`LICENSE` / `LICENSE_*`を資産と共に保持する。LiberationフォントのGPL v2とフォント埋込例外も含め、[LICENSES](./LICENSES.md#pdfjs-and-its-rendering-resources)を正本とする。

## ページ寸法と描画

`page.getViewport({ scale: 1 })`の幅・高さを表示後の物理pointとして扱う。このviewportは可視領域（CropBoxとMediaBoxの関係）、原点、ページ回転、UserUnitを反映済みである。UserUnitを再乗算したり、90度回転で幅・高さを再交換したりしない。

```text
widthMm  = viewport.width  × 25.4 / 72
heightMm = viewport.height × 25.4 / 72
widthPx  = round(viewport.width  × dpi / 72)
heightPx = round(viewport.height × dpi / 72)
```

描画には`page.getViewport({ scale: dpi / 72 })`を使う。mmは実数で保持し、丸めはCanvasのpixel境界だけで行う。各ページの`physicalSize`に表示後のmmと読込DPIを設定することで、出力DPIを変えても仕上がり用紙寸法は変わらない。元からpixelのみの文書は従来どおりpixel寸法と出力DPIからmmを求める。

ダイアログでは現在確認しているページの低解像度サムネイルだけを生成する。ページ番号、寸法、向きを確認し、現在ページの選択切替または`1, 3-5`形式の範囲入力で対象を決める。読込DPIは72 / 150 / 300から選び、初期値は150とする。選択ページの高解像度描画は1ページずつ行い、全ページの描画・検証が済んでから文書へ確定する。

## 上限と失敗時の扱い

次の値は保守的な実装上限であり、M4 Max・36 GBの実測性能から求めた上限ではない。MPの上限計算は`1024 × 1024` pixel単位である。上限を超えたときにDPIを下げたりページを除外したりせず、説明を表示して停止する。

| 対象                         | 上限                                                |
| ---------------------------- | --------------------------------------------------- |
| PDF原本                      | 50 MiB                                              |
| 原文書の総ページ数           | 1,000                                               |
| 1回の選択ページ数            | 20（追加後の文書は既存上限100ページ）               |
| 入力・出力Canvasの1辺        | 8,192 px                                            |
| 取込1ページ                  | 32 MP                                               |
| 取込選択合計                 | 64 MP                                               |
| 取込PNG Data URL             | 選択合計75 × 1024 × 1024文字                        |
| 画像PDF出力                  | 100ページ、72〜600 DPI、塗り足し0〜20 mm、合計64 MP |
| 出力で保持する圧縮画像データ | 合計128 MiB                                         |

取込画面のメモリ見積もりは、選択総画素数に1pixelあたり24 bytes（RGBA画像6枚分）を掛けた概算である。実際のピークメモリ、GPU使用量、ブラウザのstorage quotaを保証しない。出力側は全ページの圧縮bytesと最終PDF組立分も保持するため、総画素と圧縮bytesの両方を制限する。

空・破損PDF、ページ数・寸法・選択上限超過、描画失敗を区別する。パスワードを要求するPDFには入力UIを設けず、対応外として案内する。XFAは`enableXfa: false`に加え、metadataの存在情報から明示的に拒否する。`stopAtErrors: true`と`maxImageSize`を併用し、採用版で過大な埋込画像がエラーになることを確認している。

注釈・フォームはPDF.jsの描画対象となる保存済み外観を含めるが、対話的なフォームやDOM注釈レイヤーは作らない。保存外観のないフォームや特殊な注釈の再現は保証しない。PDFのJavaScriptを実行するviewer機能を組み込まず、外部リンク・添付を自動で開かない。

取消はrender taskを止め、処理中のPDFPageProxy、Canvas、document / workerを解放する。読込結果の確定は既存の文書transactionへ接続し、失敗・取消時は元の文書・履歴を保持する。新規文書への置換は未保存編集を確認して履歴を初期化する。ページ追加は既存の文書履歴へ1操作として記録し、Undo / Redoできる。

## 保存と情報の境界

schema v4の任意`editorState.pdfImport`に、`kind: rasterized-pdf`、原ページ番号、取込時のmm、回転、DPIを記録する。編集後の物理寸法とは別に、取込時点の由来として保持する。schema番号は変更せず、validatorで型・値を検査し、v1〜v4読込と未知version拒否を維持する。

背景PNGはプロジェクトの画像として保存するが、元PDF bytesと元ファイル名は保存しない。履歴の画像は既存のcontent-addressed保存を利用する。PDF原本の再描画が必要なときは原本を再選択する。自動保存の容量不足は既存のエラー表示と手動保存案内を使う。

`.pwx.json`は再編集用データであり、非表示レイヤー、元画像、マスク、履歴等に情報が残り得る。crop、白塗り、画像PDF出力を機密情報の完全削除と表示しない。リンク・しおり・タグ・フォーム・添付・電子署名の有効性は出力PDFへ引き継がない。

## 画像PDFの圧縮選択

既存のPDF 1.7 writerとMediaBox / TrimBox / BleedBox、混在寸法、トンボを維持した。PNGファイルをそのままPDFへ格納する方式ではなく、白へ合成した8bit RGB画素を画像XObjectとして埋め込む。

| 方式         | 実装と用途                                                                                    | 制約                                                                               |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 可逆（既定） | RGBの短い帯を`CompressionStream('deflate')`でzlib圧縮し、`/FlateDecode`で格納。線画・文字向け | 元画素を保持するが、ラスタライズで失われた細部は復元しない。写真では大きくなり得る |
| JPEG         | CanvasのJPEG符号化で品質10〜100を指定し、`/DCTDecode`で格納。写真向け                         | 非可逆で細線や文字周辺にノイズが出る場合がある                                     |

Flateは単体試験で展開後のRGB全画素一致を確認でき、既存writerを保ったまま追加依存なしで導入できるため採用した。JPEGは小さい写真PDFを作る選択肢として維持する。ライブラリ間の実機速度・圧縮率比較は実施していない。可逆圧縮に必要な`CompressionStream`がない環境では明示エラーにし、JPEGを案内する。

全ページを画像化すること、透明部分が白になること、出力ページ数とmm寸法をUIに表示する。異なるページ寸法は警告だけで拒否しない。背景の取込DPIが分かるページだけ出力DPI超過を警告し、native図形へ架空の解像度警告は出さない。150 DPIで取り込んだ背景を300 DPIで出力しても、元PDFの細部は復元されない。

## 検証記録と残る確認

2026-10-28、macOS 26.6.2 / Node.js 22.18.0 / Chromium 151.0.7922.34で、format・lint・TypeScript・Vitest 129ファイル881件・本番build・PagesサブパスのPlaywright 68件が成功した。PDF専用E2Eは3件で、混在2ページの入力→可逆画像PDF→再取込のRGBA全画素が一致した。全処理の初回ロード後、通信遮断下で別PDFの取込・ページ追加・プロジェクト保存を確認した。本番依存のnpm auditは既知の脆弱性0件。GitHub Actionsの自動CIは使わず、マージ前にローカルでformat・lint・Vitest・build・PagesサブパスのPlaywrightを実行する。手動CI workflowは残し、mainへのpush後のPages workflowはbuildとdeployだけを実行する。ローカル試験成功、Actions build成功、公開版への反映は別々に確認する。

既存の詳細フィルター画面比較は、未変更mainでもmacOSのシステムフォント差を再現した。現行actualと未変更main actualのPNGが完全一致したため、main由来のmacOS専用baselineを追加した。既存OSのbaselineと比較閾値は変更していない。

自動試験の対象は以下とする。

- CropBox原点、90 / 180 / 270度、UserUnit、混在寸法とpixel丸め。
- 原本・選択・寸法・総画素・圧縮bytes上限、暗号化・破損・XFA、取消・失敗時の文書保持。
- PDF由来metadataの保存・再読込・autosave・Undo / Redo、旧v1〜v4と未知version拒否。
- Flate展開後の画素一致、白合成、JPEG品質、取消、ページbox / xref、出力前の寸法・制約表示。
- 実ブラウザでのPDF読込・書き出し、Pagesサブパスでのworker / 資産取得、原本送信のない処理とオフライン再利用。

macOS Preview、Safari実機、日本語埋込フォントを含む多様な実PDF、M4 Max・36 GBでの代表的な少数ページの時間・ピークメモリ測定は未実施である。これらを自動試験の成功から推定しない。手動互換確認は[書き出し確認手順](./EXPORT_COMPATIBILITY_CHECKLIST.md)へ実施環境と結果を記録する。寸法はTrimBox誤差0.1 mm以内、描画pixelは丸め後の期待値を基準とし、異なるエンジン間の完全画素一致は要求しない。

## 調査した一次資料

- [PDF.js Display API / PDFPageProxy](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)
- [PDF.js 6.4.299の公式ソース](https://github.com/mozilla/pdf.js/tree/v6.4.299)
- [PDF.js FAQのページ描画とメモリ方針](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)
- [修正済みPDF.jsのセキュリティ勧告](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq)（CVE-2024-4367、4.2.67で修正）
- [WHATWG Compression Standard](https://compression.spec.whatwg.org/)（`deflate`はRFC1950 zlib形式）
- [WebKitのCompression Streams実装資料](https://docs.webkit.org/Deep%20Dive/Modules/CompressionStreams.html)
