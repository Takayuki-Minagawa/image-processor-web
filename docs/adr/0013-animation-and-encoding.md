# ADR-013: アニメーション評価とメディアエンコード境界

- 状態: Accepted
- 日付: 2026-08-01

## 背景

C7 / C8では、複数ページをPDFとGIFへ書き出し、ページ遷移と要素animationを同じtimelineからpreview・動画frame生成へ使う必要がある。animationを`requestAnimationFrame`内でFabric.js objectへ直接書き込むだけでは、任意時刻の再現、frame単位のexport、unit test、別rendererへの移行ができない。

WebCodecsは対応browserでもcodec、profile、container muxerが別々の能力である。`VideoEncoder`が存在するだけでMP4出力可能と判断すると、H.264 chunkをcontainerへ格納できず、拡張子だけMP4の壊れたfileを生成する。現在の製品経路はWebCodecsを出力可否の根拠にせず、browserがcontainerまで生成する`MediaRecorder`を利用する。

PDFとGIFの生成は大容量bufferを扱うため、進捗、cancel、main threadへの制御返却を共通化する必要がある。一方、最初から高機能PDF library、動画muxer、GIF quantizerを常時bundleすると、entry予算と監査範囲が大きくなる。

## 決定

永続timeline、renderer非依存の純粋evaluator、browser raster adapter、container encoder、Worker protocolを分離する。

### schema version 4 timeline

animationは`pages[].timeline`としてschema version 4で追加する。timelineを省略したpageは従来と同じ静止pageである。

各pageはduration、次pageへのtransition、layer IDごとのanimation列を持つ。要素animationは次を表す。

- phase: `enter` / `emphasis` / `exit`
- effect: fade、上下左右slide、zoom、左右wipe、pulse
- start: page開始基準、または直前clip終了基準
- duration、delay、easing、任意の移動距離

transitionはnone、fade、左右slideを扱う。animationは存在するlayer IDだけを参照し、ID重複、page duration外のclip、1 layer 100件超、24時間超のtimelineを拒否する。

project adapterは、永続形式のlayer ID -> animation mapを、evaluatorのflat clip列へ変換する。逆変換でもID、順序、start規則を保持する。

### 純粋evaluator

evaluatorは任意の時刻から、active page、page opacity / translate、各要素のvisibility、opacity、translate、scale、wipe進捗を計算する。DOM、Fabric.js、wall clockを参照しない。

page transitionは隣接pageの時間をoverlapさせる。1 pageのincomingとoutgoing transition合計がpage durationを超える入力を拒否し、同時active pageを最大2枚に制限する。previewとframe exportは同じresolved timelineと時刻を使い、表示用renderer adapterだけを差し替える。

### PDF

PDF coreは依存なしのPDF 1.7を生成し、各pageをfull-page raster XObjectとして配置する。物理寸法はmmから72 point/inchへ変換し、次のboxを明示する。

- `MediaBox`: bleedを含むpage全体
- `BleedBox`: media全体
- `TrimBox`: 四辺のbleedを除いた仕上がり範囲

JPEG pageは`DCTDecode`のまま保持し、test用RGB pageは非圧縮DeviceRGBとして格納する。browser adapterはtrim画像を白いbleed領域の内側へ配置し、指定時はtrim cornerの外側へcrop markを描画する。vector objectやtextはraster化される。mm pageはprojectに保持した仕上がり寸法を使い、書き出しDPIはraster密度だけを変える。複数ページPDFはpageごとに独立geometryを持つため、異なる寸法・向きを同じfileへ混在できる。

### GIF

GIF coreはGIF89aのfull-canvas indexed frame列を生成する。2〜256色palette、1〜65,535 frame、最大65,535px四方、10ms単位のdelay、loop count、任意のtransparent indexを検証する。

初期encoderは、clear codeでcode幅を固定する決定論的なbaseline LZWとする。browser adapterはRGB332の固定256色paletteへ量子化する。UIはpresentation timelineを約150ms間隔、最大120 frameでsampleし、各pageを最長辺480px以下へ縮小してalphaを白へ合成する。page transition時は同時activeな最大2 pageを同じrasterへ合成する。高品質palette生成、差分frame、最適化LZWは同じ入力contractの後続実装とする。

### Worker、進捗、cancel

PDF / GIFは共通のversion可能なjob境界を持つ。requestは`run` / `cancel`、responseは`progress` / `result` / `cancelled` / `error`とし、job IDで対応付ける。同じIDの再実行は旧jobをcancelし、settle済みjobの結果を適用しない。

encoderはpage/frame/chunk間でevent loopへ制御を返し、`AbortSignal`を観測する。Worker handlerはPDFとGIFをDOMから切り離して実行できる。Canvasへのpage raster化はbrowser adapterの責務で、Workerへ渡す前にbounded rasterまたはindexed frameへ変換する。

### native video、WebCodecsとfallback

current product pathは、GIFと同じcomposited frame Data URLをCanvasへ描き、`captureStream()`をbrowserの`MediaRecorder`へ渡す。`MediaRecorder.isTypeSupported()`でMP4/H.264、WebM/VP9、WebM/VP8の順にnative containerを選ぶ。利用可能な候補または`captureStream()`がなければ、同じframe列をGIFへ送る。videoのcodec・container・実時間記録品質はbrowser実装に依存し、対応formatを固定表示しない。

将来の決定論的WebCodecs pipelineの能力判定は次をすべて確認する。

1. `VideoEncoder`と`VideoFrame`が存在する
2. H.264、VP9、VP8の対象設定が`isConfigSupported`を返す
3. 対応codec用のMP4またはWebM muxerが実装・登録されている

WebCodecs経路でMP4希望時はMP4 -> WebM -> GIF、WebM希望時はWebM -> GIFの順にfallbackする。現在はWebCodecs muxerとencoded-video pipelineを同梱しない。`MediaRecorder`がnative containerを提供するbrowserではMP4またはWebMを生成できるが、全browserで保証するanimated containerはGIFである。WebCodecs capability probeをMP4 / WebM実装済みの表示に使わない。

## 現在の統合境界

schema v4、timeline validator、純粋evaluator、project adapter、実時間preview、PDF / GIF core、browser raster helper、Worker client / handler、native `MediaRecorder` adapter、WebCodecs capability probeを実装した。

Preview、GIF、videoは同じpresentation timelineでpage transitionを評価し、同じpage-local時刻で要素animationを評価する。PDF / GIFのencodeは共通Worker clientへ接続し、raster化とnative video記録はDOM / Canvasを必要とするためmain thread adapterに留める。MP4 / WebMはbrowserがnative `MediaRecorder` containerを提供した場合だけ生成し、そうでなければGIFへfallbackする。

## 影響

- 同じtimelineとcomposited frameをpreview、GIF、native videoで共有できる
- 任意時刻のanimation結果をDOMなしで決定論的にtestできる
- PDF / GIF coreをWorkerへ移してもUI request形式を維持できる
- PDFは広いviewer互換を優先する代わりに、vector編集性、ICC / CMYK、trim画像のbleed端までの引き延ばしを持たない
- GIFは必ず利用できるfallbackだが、RGB332、baseline LZW、bounded resolution / frame countのため写真品質と動きの滑らかさに限界がある
- native videoのformatをbrowserに委ね、WebCodecsだけでなくmuxerを確認するため、MP4 / WebM対応を過大表示しない

## 却下した案

- Fabric.js objectへanimation状態を累積適用する: 時刻のseek、frame再生成、unit testが不安定になる
- previewとexportで別のeffect実装を持つ: 同じtimelineでも見た目が一致しない
- `VideoEncoder`の存在だけでMP4を有効化する: container化できないencoded chunkを出力する
- GIF fallbackを外部CDN encoderへ送る: local-firstとofflineを満たさない
- 初期版から重いPDF / GIF / muxer libraryをentry bundleへ含める: 使用しない利用者の初期loadと監査範囲を増やす
- `TrimBox`だけをcrop markとして扱う: viewer metadataと描画されたmarkは別機能なので、選択時だけrasterへ実線を描く

## 検証条件

- relative start、easing、各effect、enter / emphasis / exitを時刻境界のunit testで検証する
- transition overlapでactive pageが最大2枚となり、不正durationを拒否することを検証する
- schema v3の静止pageがv4へ移行して出力を変えず、timeline round tripが一致することを検証する
- PDF header、xref、page count、pageごとのMedia / Bleed / Trim box、mm物理寸法とDPIの分離、混在page寸法、JPEG stream、crop mark geometry、cancel、progressを検証する
- GIF89a header、palette、frame delay、loop、transparent index、LZW decode、cancel、progressを検証する
- Workerの重複job ID、late result、cancel、errorを検証する
- native `MediaRecorder` MIME選択とunsupported時のGIF fallbackを検証する
- WebCodecsはcodec supportあり・muxerなしをunsupportedとし、MP4 -> WebM -> GIFのfallback順を検証する
- 実viewer / browserでのPDF・GIF・video互換は[書き出し互換確認手順](../EXPORT_COMPATIBILITY_CHECKLIST.md)に従って記録する
- Preview / GIF / videoの同一時刻でpage transitionと要素animationが一致することをE2Eまたはgolden frameで継続確認する
