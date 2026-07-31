# ADR-006: ドキュメント座標の不変8bit選択マスク

- 状態: Accepted
- 日付: 2026-07-31

## 背景

Fabric.jsの選択はオブジェクト単位であり、なげなわ、自動選択、フェザー、
フィルターの部分適用に必要なピクセル選択を表現できない。Fabricの
`clipPath`を選択の正本にすると、画像ローカル座標への変換、複数レイヤーの
合成結果、8bitフェザーの保持がレンダラー実装へ依存する。

また、最大64MPのマスクは非圧縮で64MBになる。既存の100件JSON
スナップショットへ可変`Uint8Array`を複製すると、履歴が数GBになり得る。

## 決定

ドキュメントごとに幅・高さがキャンバスと一致する8bitアルファマスクを1枚
持つ。マスクはドキュメント座標を正本とし、公開境界では常に防御的コピーを
行う不変値として扱う。

- 0は未選択、255は完全選択、中間値はフェザー境界とする
- 追加は`max`、除外は飽和減算、交差は`min`で合成する
- なげなわはeven-odd polygon rasterization、自動選択は許容値付きの連結
  flood fillとする
- ぼかし、拡張、縮小、flood fillはWorkerで実行できる純粋演算にする
- 保存用codecは署名、寸法、encodingを持ち、rawとRLEの短い方を選ぶ
- decode前にencoded bytesとdecoded pixelsの両方へ上限を適用する

フィルターの部分適用は、Fabricオブジェクトごとの`clipPath`ではなく、
オフスクリーン合成結果とドキュメントマスクから選択範囲だけを持つoverlayを
作る方式とする。基本調整とP4の14種のregistry filterは専用WorkerへRGBAとmaskを
Transferし、overlayを返す。基本調整UIでは進捗・cancelも管理する。Workerがない
環境は同じ純粋CPU演算へfallbackする。マーチングアンツはStudio previewとメイン
編集キャンバスでphaseを進める表示専用overlayとし、保存・画像書き出しへ含めない。

対話的な描画では、stroke作成時点のマスクからFabric `clipPath`を生成し、その
strokeだけへ固定する。これにより、後から選択範囲を変更しても既存のブラシ・
消しゴムstrokeの見た目は変化しない。選択範囲の削除は元画像を破壊せず、
`destination-out`とmask clipを持つ直列化可能なpixel-deleteレイヤーとして
追加する。

## 履歴と保存への影響

プロジェクト形式にはFabric JSONの内部propertyではなく、検証可能なtop-level
selection payloadとして追加する。旧schemaは空の選択マスクへmigrateする。

現在のsnapshotは、raw/RLEの短い方を選んだbinary payloadをBase64文字列として
保持する。マスクが変わらない編集では不変のpayload文字列を再利用し、マスク変更時
だけ新しいpayloadを生成する。履歴件数は100件へ制限する。4K maskを連続して変更
するworkflowのmemoryが問題になる場合は、content hash共有、copy-on-write tile、
圧縮checkpoint + mask commandの順に追加評価する。

## 却下した案

- Fabric `clipPath`のみを正本にする: 8bit境界と合成後フィルターを表現しにくい
- 1bit bitmap: フェザーと背景除去結果の手直しに不足する
- 可変Canvas/ImageDataを履歴で共有する: 過去snapshotが暗黙に書き換わる

## 検証条件

- codecの破損・truncation・巨大寸法をallocation前に拒否する
- add/subtract/intersect、反転、拡張縮小、フェザーを決定的unit testで検証する
- 4096×4096 flood fill中にmain threadのlong taskを発生させない
- 保存、復旧、Undo/Redo後も8bit値がlosslessで一致する

## 実装追記

schema version 2の`editorState.selectionMask`へ、寸法とBase64 payloadを保存する。
payload内部は署名`PWM1`を持つbinary codecで、rawとRLEの短い方を選ぶ。JSON上の
`encoding: "rle-base64"`はproject envelopeの識別子であり、内部payloadが常に
RLEであることを意味しない。

Editorは選択マスクをproject round tripと点滅するマーチングアンツoverlayへ
統合した。Studio UIはpointerで描くなげなわ、自動選択、4合成mode、反転、
拡張・縮小、フェザー、解除を純粋mask API経由で操作する。

選択範囲は、ブラシ・消しゴムstrokeのclip、Undo可能なpixel-deleteレイヤー、
基本調整とP4 registry filterのWorker overlayへ接続した。選択mask、clip、
pixel-deleteは限定したeditor propertyだけを保存し、project再読込とUndo/Redoで
復元する。レイヤーごとに独立した永続maskを持つ方式は本ADRの対象外とする。
