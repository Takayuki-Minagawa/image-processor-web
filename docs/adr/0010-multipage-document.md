# ADR-010: 複数ページドキュメント、履歴、自動保存

- 状態: Accepted
- 日付: 2026-08-01

## 背景

単一の`canvasSize`、Fabric.js payload、`editorState`をrootへ持つ従来形式は、「画像を1枚開いて編集する」用途には十分だった。一方、C2のデザイン制作では、用途別サイズ、複数ページ、ページ背景、マジックリサイズ、全ページ書き出しを同じプロジェクトで扱う必要がある。

すべてのページを同時にFabric.js Canvasへ復元すると、4K画像を含む文書でDOM、GPU、履歴の使用量がページ数に比例する。逆に、単純にroot snapshotを履歴へ100件積むと、非アクティブページの同じData URLまで操作ごとに複製される。

また、既存の保存、自動保存、履歴、編集UIはrootの単一キャンバスを前提としていたため、移行期間中も既存APIを壊さない境界が必要だった。

## 決定

`.pwx.json`の正本を`Document -> pages[] -> layerTree`の3層構造とし、Fabric.js Canvasはアクティブページ1枚だけを所有する。

### ページの正本

各`ProjectPage`は次を所有する。

- 安定したIDと表示名
- `canvasSize`
- Fabric.js renderer payload
- renderer非依存の`editorState`と`layerTree`
- 透明、単色、gradient、画像のページ背景
- 任意のtimelineとthumbnail

rootは`pages`と`activePageId`を持つ。ページ数は1〜100件に制限し、ID重複、存在しないactive page、危険なthumbnail、復元不能なinactive pageも読み込み時に拒否する。

実行時の`ProjectDocument.canvasSize`、`fabricCanvas`、`editorState`は既存コード向けのactive-page aliasとして残す。公式serializerはaliasを出力せず、4K payloadをrootとpageへ二重保存しない。

### 単一Canvasと同期点

非アクティブページは検証済みのsnapshotと任意のthumbnailとして保持する。ページ切替、自動保存、プロジェクト保存、全ページ書き出しの前に、現在のCanvasを`activePageId`のpage recordへ同期する。その後、移動先のsnapshotだけを同じCanvasへ復元する。

ページ追加、複製、削除、並べ替え、active page変更、背景変更、timeline変更、書き出しscopeの解決はrendererに依存しない純粋操作として提供する。最後の1ページは削除できない。

### 履歴

Undo / Redoの正本は、全ページとactive page IDを持つ`DesignDocumentCheckpoint`とする。canvas編集、ページ追加・複製・削除・並べ替え、template適用、背景・timeline変更を同じ履歴へ積み、1回のユーザー操作を1 checkpointとして復元する。ページ切替だけは編集ではないため履歴を増やさず、current checkpointのactive page IDと切替前に同期したsnapshotを置換する。

snapshot APIは維持し、内部を[ADR-003](./0003-history.md)の`CompactHistory`へ置き換える。大きなData URLをcontent addressで1度だけinternし、全ページcheckpoint間でも同じassetを共有する。4K相当の画像を20レイヤー、100操作へ素朴に複製する約8 GiBの見積もりを、約80 MiBの共有assetと構造snapshotへ抑える。Fabricのpage-local履歴は編集coalescingの判定に残すが、公開Undo / Redoは文書checkpointだけを操作する。

### サイズ、背景、マジックリサイズ

用途別プリセットはpxまたはmmで定義し、mmはDPIを指定してpixelへ変換する。DPIは36〜2,400の範囲で検証し、pageにはpixel寸法に加えてmm仕上がり寸法と作成時DPIを保持する。これにより印刷PDFのDPIを変更しても物理寸法を変えず、raster密度だけを再計算できる。組み込みはSNS投稿、YouTubeサムネイル、16:9プレゼン、A4縦横、名刺、Webバナーを含む。

マジックリサイズは9方向anchorと`proportional` / `stretch` / `none`のscale modeから純粋な変換planを作る。renderer adapterはplanを1 transactionで適用し、既定では全objectを新しいCanvas内へ収める。テキストfont sizeとstroke widthもscale対象にする。

背景は通常レイヤーと分けてpage recordへ保存する。透明、単色、linear/radial gradient、同梱または埋め込み画像を検証し、Fabric adapterがCanvas描画へ反映する。

### スキーマ移行

- v1 / v2はrootの単一キャンバスを`page-1`へ移行する
- v3は複数ページ、レイヤーツリー、背景を導入した形式として読み込む
- v4はv3 pageへ任意のtimelineを追加する。timelineがないpageの静止画出力は変えない
- 読み込み後のメモリ上表現と次回保存は常にcurrent schema v4とする
- 未知versionは推測せず拒否する

### 自動保存

`BrowserAutosaveRepository`はOPFS上でmanifestとページ別JSON blobを管理する。保存時は直前manifestが参照する同じIDのpage内容と比較し、同一pageは既存blobを再利用し、変更pageだけを新しい一意名のblobへ書く。全blobのcommit後にmanifestを閉じて新世代へ切り替え、その後で参照されなくなった旧blobをbest-effortで回収する。manifest commitより前に失敗した場合は新blobを参照しないため、直前のautosaveが読み込める。

旧来の単一JSON autosaveはそのまま読み込み、次回のOPFS保存でpage-delta形式へ移行する。custom codecを注入したrepositoryは内容を安全に分割できないため従来の単一file contractを維持する。OPFSが利用できない場合は完全なproject JSONをlocalStorageへfallbackし、両方が存在する場合は`updatedAt`が新しい方を復元する。clearはmanifest、参照page、回収待ちpage、localStorageをまとめて削除する。

## 影響

- 複数ページでもFabric.js Canvas、selection、GPU resourceは1ページ分に限定できる
- v1 / v2の利用者は明示的な変換操作なしに1ページ文書として継続できる
- 保存ファイルにactive pageの大容量payloadを二重に含めない
- page構造・template・timelineを含むglobal Undoを1操作単位で提供できる
- inactive pageも保存・書き出し前に完全検証するため、破損を後のページ切替まで先送りしない
- OPFSへの書き込み量は変更pageに比例し、旧単一file autosaveも継続復元できる

## 却下した案

- ページごとにFabric.js Canvasを常駐させる: DOM、GPU、event listener、画像resourceがページ数に比例する
- rootの旧フィールドと`pages[]`の両方を保存する: active pageの正本が二つになり、payloadも二重化する
- 素朴な文書全体deep copyを各Undoへ保持する: inactive pageと大容量Data URLが操作ごとに複製されるため、content-addressingなしでは採用しない
- ページ切替後も1本のpage-local履歴だけを継続する: ページ構造操作を復元できず、template適用のatomic Undoも保証できない
- page blobをin-place更新してからmanifestを書く: 途中失敗で直前世代まで壊すため、copy-on-writeの一意名blobを使う

## 検証条件

- page追加・複製・削除・並べ替え・active変更・書き出しscopeを純粋ロジックで検証する
- v1 / v2を1ページへ、v3を静止状態を変えずv4へ移行できることを検証する
- serializerがruntime aliasを出力せず、active payloadを1回だけ保存することを検証する
- ページ切替前の編集が元pageへ同期され、切替先のsnapshotだけが復元されることを検証する
- pageごとの背景、timeline、thumbnail、layer treeが保存→再読込で一致することを検証する
- mm pageの仕上がり寸法・作成時DPIが保存→再読込で一致し、pixel寸法との矛盾を拒否する
- canvas編集とpage追加・複製・削除・並べ替え・template適用・timeline変更が文書履歴からUndo / Redoできることを検証する
- page切替が履歴件数を増やさず、切替前のcurrent snapshotを失わないことを検証する
- OPFS saveで未変更pageのblobを再利用し、変更pageだけを書き、旧単一fileのloadと全fileのclearが機能することを検証する
- 4K相当・20レイヤー・100操作の履歴benchmarkを継続し、shared asset量と構造量を記録する
- 10ページ規模で切替、serialize、OPFS commitの時間を計測し、ページ差分ADRの再検討条件を監視する
