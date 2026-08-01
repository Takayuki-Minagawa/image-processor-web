# PDF / GIF / video書き出し互換確認手順

更新日: 2026-08-01

この手順は、unit testで確認できないviewer / browser差をrelease前に確認するためのもの。結果は実施日、commit、OS、appを含めて記録する。未記入欄は未確認を意味し、自動testの合格や手動確認済みを示すものではない。[ADR-013](./adr/0013-animation-and-encoding.md)の互換確認を補完する。

## 1. 共通準備

1. production buildを生成し、同じbuildを各browserから開く。
2. 次を含む3ページの確認用projectを作る。
   - 1ページ目: 日本語・Latin text、細線、gradient、写真、enter animation
   - 2ページ目: 半透明object、clip frame、layer mask、chart / table、emphasis animation
   - 3ページ目: page background、端まで届く図形、exit animation
3. PDF比較用はA4縦、300 DPI、bleed 3 mmを基準にし、追加で異なる寸法・向きのpageを混在させたfileも用意する。
4. GIF / video比較用はdurationを1,000 / 1,500 / 2,000 msにし、1 -> 2をfade、2 -> 3をslide transitionにする。各ページに大きな連番も置く。
5. 次の情報を記録する。

| 項目                      | 記録値 |
| ------------------------- | ------ |
| 実施日                    |        |
| commit                    |        |
| OS / version              |        |
| export元browser / version |        |
| page寸法・DPI・bleed      |        |
| 確認者                    |        |

## 2. PDF

### 書き出し

1. Studioの書き出しからPDF、全ページ、300 DPI、bleed 3 mm、crop markありを選ぶ。
2. progressが0から完了まで単調に進み、1 fileだけdownloadされることを確認する。
3. selected pageだけのPDFを出力し、選択したpageがproject順・指定枚数になることを確認する。
4. 別の実行を途中でcancelし、downloadが始まらず、editorを継続操作できることを確認する。

### viewer互換

次のappで同じfileを開く。

- macOS Preview
- Chrome内蔵PDF viewer
- Adobe Acrobat Reader

各viewerで次を確認する。

- 修復・破損warningなしに開く
- page数と順序がprojectに一致する
- pageごとの向きと仕上がり比率が正しく、異なる寸法が先頭pageへ引き伸ばされない
- 日本語・Latin text、gradient、写真、半透明、clip、mask、chart、tableが欠けない
- 400%表示でもpageの一部が消えず、画像全体が1枚のrasterとして表示される
- 透明領域が白へflattenされる
- crop markがtrim cornerの外側にあり、仕上がり内容へ重ならない
- print dialogの「実際のサイズ / 100%」で意図した物理寸法になる
- 保存し直さず閉じ、再度開いて同じ結果になる

可能ならPopplerの`pdfinfo -box output.pdf`でも確認する。

- `Pages`がpage数と一致する
- A4縦、bleed 3 mmならMediaBox / BleedBoxは概ね216 x 303 mm
- TrimBoxは概ね210 x 297 mm
- point換算の丸めを考慮し、許容差は0.2 mmとする

現在の仕様では、bleed領域は白で、trim画像をその内側へ配置する。crop markを有効にするとtrim cornerの外側へ線を描くが、画像をbleed端まで引き延ばす処理は行わない。crop markなしでも`TrimBox` metadataは存在する。mmで作成したpageは保存済みの物理仕上がり寸法を維持し、書き出しDPIはraster解像度だけを変更する。異なるpage寸法を1 PDFへ混在させた場合も、各pageが独立した`MediaBox` / `TrimBox`を持つ。

## 3. GIF

### 書き出し

1. Studioの書き出しからGIF、全ページを選ぶ。
2. progressがtimeline raster化とWorker encodeの両区間で進むことを確認する。
3. 別の実行を途中でcancelし、不完全fileがdownloadされないことを確認する。

### browser互換

次で同じGIFを開く。

- Chrome
- Safari
- Firefox
- macOS Quick LookまたはPreviewのframe一覧

各環境で次を確認する。

- page連番が1 -> 2 -> 3の順に表示される
- fade / slide transitionとenter / emphasis / exit animationがpreviewと同じ方向・順序になる
- 少なくとも2周loopし、途中で停止しない
- presentation全体の長さがpage durationとtransition overlapから計算した値に概ね一致する。frame間隔は約150 msなので、目視確認の許容差は1 frameとする
- Canvas全体がframeごとに更新され、前frameの残像がない
- 縦横比が崩れず、最長辺が480px以下である
- 透明領域が白へflattenされる
- RGB332の256色へ量子化するため写真のbandingは許容されるが、完全な色化けやpalette index errorがない
- fileを閉じて再度開いても同じ順序・loopになる

現在のStudio GIFは、previewと同じpresentation timelineを約150 ms間隔でsampleし、最大120 frameへ制限する。短いanimationがsample間へ入る場合や長いpresentationでframe上限に達する場合は、previewより動きが粗くなる。

## 4. video

### 書き出しとfallback

1. Studioの書き出しからvideo、全ページを選ぶ。
2. download名とMIME typeを記録する。browserがnative containerを提供する場合はMP4またはWebM、提供しない場合はGIFになる。
3. progressがframe raster化と実時間recordingの両区間で進むことを確認する。
4. 別の実行を途中でcancelし、不完全fileがdownloadされないことを確認する。

### 再生互換

出力したbrowserに対応するappで確認する。MP4はQuickTime Player / Chrome / Safari、WebMはChrome / Firefoxを最低対象とする。

- file extension、reported MIME、実containerが一致する
- 修復warningなしに開き、最後まで再生できる
- page順序、transition、要素animationがpreviewおよび同時生成条件のGIFと一致する
- 音声trackがないこと、縦横比が正しいこと、最長辺が480px以下であることを確認する
- 再生時間の誤差がframe 1枚分とMediaRecorder起動・停止の小さな余白に収まる

videoはCanvas streamと`MediaRecorder`を使うため、codec、container、frame pacingはbrowser依存である。決定論的なWebCodecs muxerの互換試験ではなく、各release対象browserのnative出力試験として記録する。

## 5. 合否記録

| 対象  | app / version        | 開く | page / frame | 寸法・時間 | 見た目 | cancel | 結果・備考 |
| ----- | -------------------- | ---- | ------------ | ---------- | ------ | ------ | ---------- |
| PDF   | Preview              |      |              |            |        |        |            |
| PDF   | Chrome               |      |              |            |        |        |            |
| PDF   | Acrobat Reader       |      |              |            |        |        |            |
| GIF   | Chrome               |      |              |            |        |        |            |
| GIF   | Safari               |      |              |            |        |        |            |
| GIF   | Firefox              |      |              |            |        |        |            |
| GIF   | Quick Look / Preview |      |              |            |        |        |            |
| Video | native output app    |      |              |            |        |        |            |

次のいずれかがあればrelease blockerとする。

- viewerがfileを開けない、またはrepair warningを出す
- page / frameが欠ける、順序が変わる
- PDFのMediaBox / TrimBoxが指定寸法から許容差を超える
- GIFのdelay、loop、palette indexが不正
- videoのextension / MIME / containerが一致しない、または途中で再生不能になる
- cancel後にfileがdownloadされる、または次のexportが開始できない
- projectまたはpreview上で見えるobjectが書き出しから欠落する
