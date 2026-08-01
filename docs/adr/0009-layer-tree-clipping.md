# ADR-009: レンダラー非依存のレイヤーツリーとマスク境界

- 状態: Accepted
- 日付: 2026-08-01

## 背景

従来のプロジェクトは、Fabric.jsのトップレベルobject配列を実質的なレイヤー順として扱っていた。この構成では、グループの入れ子、別レイヤーを参照するクリッピング、レイヤーごとの8bitマスクを永続化すると、Fabric.js固有の座標系、`Group`、`clipPath`へプロジェクト形式が直接依存する。

Canva同等機能計画のC1では、グループ、フレーム、レイヤーマスクをC2のページ、C3の素材、C5のテンプレートから共通利用する必要がある。また、外部から読み込んだ`.pwx.json`に循環参照、過大なマスク、重複IDが含まれていても、Fabric.js objectを生成する前に拒否できなければならない。

## 決定

ページごとの`ProjectLayerTree`をレイヤー構造の正本とし、Fabric.js JSONは描画・復元用payloadに限定する。両者は安定した`editorId`で対応付け、renderer adapterが相互変換を担当する。

### ツリーモデル

ツリーは次の2種類のnodeから構成する。

- `layer`: 通常レイヤー。`layerType`と、任意の`clip`、`mask`を持つ
- `group`: 子node配列を持つ。通常レイヤーと同じく、名前、表示、ロック、不透明度を持つ

すべてのnodeは安全な一意IDを持つ。公開操作は不変データとして実装し、グループ化、グループ解除、移動、clip設定、mask設定のたびにツリー全体を再検証する。グループ化できるのは同じ親の兄弟nodeだけとし、nodeを自身の子孫へ移す操作は拒否する。

外部入力には次の上限を適用する。

- 1ページ最大2,000 node
- 最大32階層
- レイヤー名最大200文字
- IDは先頭英数字、以降は英数字と`._:-`、最大128文字
- レイヤーマスクのBase64文字列は1件・1ページ合計とも最大128 MiB文字

### クリッピング

クリッピングは、画像を含む`layer`側の`ProjectClipReference`から、フレームとして使う別のleaf layer IDを参照する。参照には`cover` / `contain` / `fill`、正規化した位置、scale、rotationを保存する。

読み込み時に、参照先の存在、leaf nodeであること、自己参照でないこと、clip参照の連鎖に循環がないことを検証する。Fabric adapterはこの参照を絶対座標の`clipPath`へ変換し、限定property `editorClipFrameId`と`editorClipSettings`を保存する。後者にfit、正規化位置、scale、rotationを保持するため、renderer snapshotだけを通る復元でもcanonical値を失わない。切り抜き解除時は埋め込んだフレームを通常objectへ戻せるようにする。

### レイヤーマスク

レイヤーマスクは既存の`SelectionMask`と同じlossless `rle-base64` codecを使う。payloadのほか、有効/無効、反転、不透明度、文書座標offsetを保存する。読み込み時にはBase64の長さだけでなく、decode結果の寸法とallocation上限も検証する。

Fabric adapterは`editorLayerMask`、`editorLayerMaskEnabled`、`editorLayerMaskSettings`を限定propertyとして保持する。settingsには反転、不透明度、offsetを保存する。選択範囲からの作成、表示切替、削除、pixelへのrasterizeを通常の編集transactionへ載せる。clip frameとlayer maskを併用する場合はframeを外側、maskを内側の`clipPath`として合成し、片方の切替・解除で他方を失わない。選択マスクとレイヤーマスクはcodecを共有するが、前者は現在の編集選択、後者はレイヤーに属する永続データであり、所有権は分ける。

### スキーマと移行

レイヤーツリーは複数ページと同時にschema version 3で導入し、schema version 4ではその構造を変えず、ページtimelineだけを追加した。

- v1 / v2の単一キャンバスは1ページへ移行し、renderer payloadからleaf treeを導出する
- renderer objectに安全なIDがない場合は、衝突しないIDを補う
- v3の`pages[].layerTree`はそのままv4へ移行する
- 未知version、重複ID、循環clip、破損・過大maskはrenderer復元前に拒否する

旧C1試作形式との読み込み互換のため、`pages[].layerTree`がない場合だけ`editorState.layerTree`を参照し、それもない場合はrenderer payloadから導出する。明示されたcanonical treeがある場合は、rendererから再導出したtreeとID、順序、階層、layer type、clip、maskの全フィールドを照合し、矛盾を復元前に拒否する。canonicalの表示属性と限定propertyをrenderer JSONへ投影してもう一度再導出・照合するため、EditorApplicationがFabric snapshotだけを保持しても正本性を維持する。新規保存では必ず`pages[].layerTree`を正本とする。

## 影響

- ページ、素材、テンプレートがFabric.jsの内部構造を知らずにグループ・フレーム・マスクを表現できる
- ツリー操作と不正入力をDOMなしのunit testで検証できる
- Fabric.jsを将来置き換えても、プロジェクト上のID、階層、clip、maskの意味を維持できる
- renderer payloadとツリーの同期はadapterの責務となり、新しいobject種別を追加するときは両方のround trip testが必要になる
- schema-v4 treeとrendererの矛盾を黙って受理せず、存在しないanimation対象や保存し直した際のcanonical情報消失を防ぐ
- renderer payloadからの自動導出はFabric groupを再帰的に辿り、embedded clip frameとmaskをcanonical nodeへ正規化する。payload自体に存在しない親子関係は推測しない

## 却下した案

- Fabric.js JSONだけをレイヤー構造の正本にする: renderer固有の座標系と直列化仕様が公開形式へ漏れる
- group IDの配列だけを`editorState`へ追加する: 入れ子順、親子関係、表示・ロック・不透明度を一貫して表せない
- `clipPath` objectをそのまま永続参照にする: 循環、共有、座標変換をrenderer外で検証できない
- レイヤーマスクをPNG Data URLだけで保存する: 8bit値の完全なround tripとselection codecの上限検証を再利用できない
- 不正参照を黙って解除して読み込む: 見た目が変わった状態で成功し、保存し直すと元データを失う

## 検証条件

- 3階層以上のgroupを作成・解除・移動し、保存→再読込でID、順序、属性、見た目が一致する
- node上限、深さ、名前、重複ID、自己・循環clip、存在しないframeを拒否する
- selection maskから作ったレイヤーマスクの有効/無効・削除・保存round tripを検証する
- 破損、寸法不一致、過大なmask payloadをFabric.js復元前に拒否する
- nested Fabric group、clip作成・解除、layer mask操作をadapter testで検証する
- clip frameとlayer maskの併用、mask切替、mask rasterize、animation wipe、PNG / SVG出力を検証する
- 非既定のclip位置・scale・rotationとmask反転・不透明度・offsetがproject → engine restore → snapshot → project saveで完全に一致することを検証する
- v1 / v2のflat payloadが1ページのleaf treeへ移行し、次回保存でcurrent schemaになることを検証する
