# SVG原寸入力の仕様と検証境界

更新日: 2026-10-28

## 操作と保存

「開く」からSVGを選択し、サイズを確認して新規ドキュメントを作成、または現在の文書へ1ページを追加する。画像追加、ドラッグ＆ドロップ、貼り付け、内部素材の利用は従来どおりキャンバスへ収まる素材配置であり、ページ寸法を変更しない。

原寸入力は図形の原点と余白を維持し、編集可能なベクターレイヤーとして取り込む。背景は透明で、画像化やPDF由来メタデータの付与は行わない。アウトライン化された文字は図形であり、文字列としての編集はできない。Fabricが対応しない効果・CSS・フォント等の完全な表示再現は保証しない。高度なselector、CSS transform-origin、子要素の百分率指定、filterや外部フォント等はブラウザのSVG表示と異なる場合がある。

文書は既存schema v4で保存する。物理単位のSVGは`physicalSize`にmmと`sourceDpi: 96`を保持し、pxのみのSVGはpixel文書とする。元SVGのXMLはプロジェクトへ保存せず、変換後のFabricオブジェクトを保存する。

## 寸法の確定

ルートの`width`・`height`を読み、inline styleの同名指定があれば優先する。対応する絶対単位は単位なし・px・in・cm・mm・Q・pt・pcで、大文字小文字を区別しない。CSSの固定比率 `1in = 96px = 25.4mm = 72pt` を使い、PDFのpointベースの読込DPIとは分ける。

両辺が絶対寸法ならその値を使う。一方の寸法が未指定または相対値なら、有効なviewBoxの縦横比から補完する。両辺が確定しない場合はviewBox幅高を候補とする。いずれも推定と明示して確認チェックを必須にし、元の物理寸法が確定したと表示しない。有効なviewBoxもない場合は拒否する。

ルートviewportは小数を保持して図形へ適用し、編集Canvasの寸法だけ整数へ丸める（最小1px）。元のmmは丸めない。物理寸法は既存schemaの最小0.01mm以上を要求する。CSSによる寸法指定はルートinline styleのwidth・heightを対象とする。selectorを使ったstyle要素内のサイズ指定、min／max制約、inline-size・block-size・aspect-ratio等はCSS cascadeを誤解釈しないため拒否し、ルート属性またはinline styleへの絶対寸法指定を案内する。

viewBoxのmin-x/min-y、`preserveAspectRatio`の`none`、9通りの位置合わせ、`meet`／`slice`から、SVG仕様の変換行列を求める。Fabric 7.4.0にはscale=1の場合に余白の位置合わせを省略する挙動があるため、ルートviewBoxを行列へ確定し、既存ルートtransformの後に合成してからFabricへ渡す。人工のg要素を挿入せず、原稿のgセレクタが補助要素へ作用して色・透明度・位置を変えることを避ける。ルート属性／inline transformは数値によるSVG変換構文に対応する。ルートへ適用されるstyle要素内のtransformや、解釈が曖昧な指定は明示エラーとする。原寸モードは素材配置の82%縮小と中央寄せを行わず、単一図形でも複数図形でも元の座標を保つ。ページ外の描画は既存の文書clipで制限する。

## 安全性と取消

既存のSVG sanitizerを必ず通す。DTD・entity、script・event属性、外部参照、埋め込みHTML、危険CSSを拒否または除去し、削除があれば画面に通知する。SVGは5 MiB、要素数10,000、属性128 KiB、viewportは1辺8,192px・64MP以下を上限とする。埋込画像とuse展開にも既存上限を適用する。

一時Canvas上で全オブジェクトを準備し、プロジェクトの100ページ・serialize後100MB上限を確認してから確定する。準備失敗・取消時は現在の文書を変更しない。一時Canvasと中断した読込オブジェクトは解放する。確定開始後は遅い取消より確定完了を優先する。

PDFと共通の確定処理を使う。新規文書は未保存編集を確認し、保存先・履歴を初期化する。ページ追加は1操作でUndo / Redoできる。古い自動保存世代を無効化し、新しい文書の保存へ古いsnapshotが混入しないようにする。

## 検証

2026-10-28、macOS / Node.js 22.18.0 / Chromium 151.0.7922.34で、format・lint・TypeScript・単体試験133ファイル964件・本番Pages build・Playwright全73件が成功した。SVG専用5件には、原稿のgセレクタが人工要素へ作用しないことの画素検証も含む。デスクトップと390×844の画面で取込・取消ボタンを目視し、狭い画面で推定確認から取込・取消まで実操作した。

独立サブエージェントレビューで、人工gによるCSS干渉、root変換の優先順位とFabricのセレクタ照合差を修正し、別エージェントの再レビューで未解決のP1/P2指摘がないことを確認した。推定した物理寸法の表示も確度が分かる文言へ修正した。

寸法・変換の単体試験では、絶対単位、inline style、片側寸法、viewBoxのみ、相対寸法、負の原点、位置合わせ・meet／slice／none、丸め、安全化と上限を扱う。engine／adapterでは単一・複数図形の座標、透明背景、保存再読込、取消と資源解放、従来配置を扱う。

ブラウザ試験では人工SVGのmmとpx、負のviewBox原点と余白のPNG画素、保存再読込、追加のUndo / Redo、推定確認、不正入力・取消・置換拒否、従来の画像追加・drop・pasteを確認する。Safari実機やIllustrator／Inkscape等の多様な実ファイルでの完全互換は未検証である。

GitHub Actionsは最終main反映後のPages build・deployだけを使い、format・lint・単体試験・TypeScript・build・Playwrightはローカルで実行する。

## 調査した一次資料

- [W3C CSS Values: absolute lengths](https://www.w3.org/TR/css-values-4/#absolute-lengths)
- [W3C SVG 2: viewport transform](https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform)
- [W3C SVG 2: intrinsic sizing](https://www.w3.org/TR/SVG2/coords.html#IntrinsicSizing)
- [Fabric 7.4.0 applyViewboxTransform](https://github.com/fabricjs/fabric.js/blob/v740/src/parser/applyViewboxTransform.ts)
- [Fabric 7.4.0 groupSVGElements](https://github.com/fabricjs/fabric.js/blob/v740/src/util/misc/groupSVGElements.ts)

依存は追加せず、既存Fabric 7.4.0とDOMParserを利用する。SVGのベクター保持と、別途実装済みの画像PDF出力は別機能であり、ベクターPDF出力への対応を意味しない。
