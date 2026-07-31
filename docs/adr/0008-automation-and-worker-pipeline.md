# ADR-008: 検証済みコマンドによるatomic replayとWorkerパイプライン

- 状態: Accepted
- 日付: 2026-07-31

## 背景

MVPの履歴はドキュメントsnapshotを正本とし、「何を行ったか」は保持しない。マクロ、スクリプト、複数画像のバッチ処理を追加するには、UI eventやFabric object idに依存せず、保存・検証・再生できる操作表現が必要になる。

ただし、履歴を全面的にCommand patternへ置き換えると、既存操作すべての逆操作、画像resourceの所有権、古いprojectとの互換性を同時に再設計することになる。また、画面上で実行できる操作をそのままWorkerへ送ると、選択object、DOM、pointer座標、font計測等の暗黙状態が再現できず、入力ごとに結果が変わる。

長いマクロの各commandを個別のUndo単位にすると、途中失敗時に部分変更が残り、利用者が元へ戻すために複数回Undoする必要がある。Workerでのdecode、filter、encode、ZIP生成はmain threadを塞がない一方、job cancellation、stale response、Transferableの所有権を明示しなければならない。

## 決定

既存のsnapshot履歴を正本として維持し、その上にrenderer-neutralな操作コマンド層を追加する。マクロ再生とスクリプト適用はatomic transactionとし、バッチWorkerは能力metadataで許可されたcommandだけを実行する。

### コマンド層

初期command setを次に限定する。

- `resizeCanvas`
- `resizeImage`
- `applyFilter`
- `addText`
- `addWatermark`
- `runScript`

各commandはJSONへ直列化できる値だけで構成し、discriminated unionとruntime validatorを同じ境界に置く。寸法、数値範囲、色、文字列長、command数、余分なpropertyを実行前に検証する。

Fabric object idは保存可能な公開APIにしない。対象はdocument、active image、topmost image、layer name、同一再生中の`commandId`結果というsemantic targetで表す。`commandId`から実行結果への対応はreplayごとの一時mapであり、projectやmacroへrenderer固有idを固定しない。

`CommandDispatcher`は実行器と記録observerを分離する。実行originを`user`、`replay`、`system`で区別し、recorderは`user`操作だけを記録する。replayを再記録して自己増殖するmacroは作らない。

各command typeには次の能力metadataを持たせる。

- `recordable`: user操作をmacroへ記録できる
- `batchSafe`: 独立した1枚の入力画像だけで決定的に実行できる
- `pointerDependent`: pointer、selection、viewport等の対話状態が必要

初期batch-safe setは`resizeImage`、`applyFilter`、`addWatermark`とする。`resizeCanvas`、通常の`addText`、`runScript`はeditor文脈またはatomic script adapterに依存するためbatch不可とする。`applyFilter`のtargetは未指定、document、active image、topmost imageを独立入力画像全体として解釈し、layer nameとcommand resultは拒否する。

### マクロ形式とatomic replay

マクロはversion付き`.pwxmacro.json`として、app id、app version、metadata、parameter定義、command列を保存する。parameter参照は名前付きのscalarに限定し、再生前に型、必須値、範囲、choicesをすべて解決する。未知・不正commandはdiagnosticを返して隔離し、既知commandの実行へ任意の値を通さない。

再生adapterは次の契約を持つ。

1. `captureSnapshot()`で再生前の完全なeditor stateを取得する。
2. `withoutHistory()`で中間commandの履歴commitを抑止する。
3. commandを順番に実行し、AbortSignalとresult aliasを同じcontextで引き回す。
4. 全件成功時だけ`commit()`を1回呼び、再生全体をUndo 1回分にする。
5. command失敗またはcancel時は`restoreSnapshot()`で再生前状態へ戻す。

rollback自体に失敗した場合は、元の実行errorとrollback errorの両方を保持して呼び出し側へ返す。途中結果を成功としてcommitしない。

### フィルタプリセットとの関係

P4のフィルタプリセットは、P2のレシピと同じ「version付きJSON、runtime
validation、未知項目の隔離、端末内repository」という保存境界へ相乗りする。ただし、
`.pwxmacro.json`そのものには格納しない。P2の公開`applyFilter` commandはバッチでも
安全な基本調整をscalar値で表す一方、P4のregistry operationは曲線点列、色、seed等の
nested parameterを持つためである。これを`runScript`文字列へ変換すると型情報と
diagnostic位置が失われ、基本commandを無制限のparameter objectへ広げるとWorkerの
能力境界も曖昧になる。

そこでP4は、同じvalidation原則を持つversion 1のcompanion schema
`FilterPreset`としてfilter operation列を保存する。適用時はregistry validatorを
再実行し、未知filterだけを警告付きで隔離する。将来P2へregistry operation専用の
command typeを追加し、editorとbatchの両adapterで同じ能力metadataを定義できた時点で、
`.pwxmacro.json`への統合migrationを再検討する。

### Worker境界

画像バッチはmain threadとDedicated Workerの間に、version可能なmessage protocol相当のrequest / response型を置く。Workerが担当するのは次だけとする。

1. 検証済みPNG / JPEG / WebP bufferのdecode
2. batch-safe command列の直列適用
3. PNG / JPEG / WebPへのencode
4. ZIP32 stored archiveの生成

main threadはfile picker、permission、directory handle、download、React state、macro選択を所有する。WorkerはDOM、Fabric Canvas、現在の選択、project保存、network取得を所有しない。

入力と出力の`ArrayBuffer`はTransferableとして移し、同じ大容量bufferを両threadにcopyしない。requestには一意なjob idを付け、progress、result、error、cancelをjob idで対応させる。AbortSignalを受けたclientはcancel messageを送り、pending promiseを`AbortError`でsettleする。settle済みまたは未知job idのresponseは適用しない。

ZIPのCRC計算とcopyはchunk間でevent loopへ制御を返し、cancel messageを観測できるようにする。directory出力はmain threadで逐次実行し、File System Access APIが存在しない場合だけZIPへfallbackする。利用者によるpermission拒否を自動fallbackで上書きしない。

選択マスクと背景除去は同じ原則で別Worker protocolを持つ。選択・選択フィルターWorkerへ渡すのはbounded RGBA / mask bufferと純粋parameterだけで、network能力を持たせない。

背景除去Workerはこの原則の限定例外である。main threadはモデル名・取得サイズを表示し、利用者の明示同意を得たjobだけに`consentGranted`、pinned descriptor、ONNX入出力optionを含める。既定UIは利用者やmacroによる任意URL入力を公開せず、appが固定したversion、4,574,861 bytes、SHA-256、immutable HTTPS URLを渡す。Worker内loaderはdescriptorをruntime validationし、downloadのContent-Length・実bytes・上限・checksumを確認して、成功後だけOPFSへcommitする。ONNX Runtime WebはWorkerから遅延loadし、WebGPU sessionを優先してWASMへfallbackする。

この構成により、Worker対応環境では同意UIとjob発行はmain thread、モデルnetwork・cache・推論は背景除去Worker、画像編集stateの適用は再びmain threadという所有権になる。cache hitではnetworkを使わない。モデルなしの決定論fallbackも同じWorkerで実行する。Workerがない環境、test、埋め込み構成の直列化できないadapterは、同じ同意・cache境界または純粋segmentation APIを呼び出し側で実行できる。

### スクリプトとの関係

スクリプトparserは[ADR-007](./0007-background-model-and-script-security.md)の能力制限に従い、生JavaScriptを実行せず、whitelist済みcommandだけを生成する。parser出力もcommand dispatcher / adapter境界で再検証し、macroと同じatomic transactionへ渡す。

したがって、UI、macro import、scriptの3経路は実行入口が異なっても、command validation、target解決、history commit、rollbackの規則を共有する。

## batch-safe判定規則

commandは次のすべてを満たす場合だけバッチへ渡せる。

1. 既知のschemaとparameter範囲を満たす。
2. `COMMAND_CAPABILITIES[type].batchSafe`が`true`である。
3. 未解決parameterを含まない。
4. pointer、viewport、現在の複数selection、Fabric object idへ依存しない。
5. 対象が独立入力画像または同じjob内の明示結果に解決できる。
6. decode前にcommand列全体の検証が完了する。

途中まで処理してからunsafe commandをskipしない。1件でも不適合ならjob全体を開始前に拒否し、診断をUIへ返す。

## 影響

- snapshot履歴と既存project互換性を保ちながら、操作の記録・共有が可能になる
- macroまたはscript全体を1回のUndoで戻せ、失敗時に部分変更が残らない
- 同じbatch-safe commandをeditor adapterとWorker adapterで共有できる
- WorkerからDOM、selection、network、storageを切り離し、local-firstの監査範囲を狭くできる
- 新しいcommand typeを追加するときは、validator、executor、能力metadata、atomic replay test、必要ならWorker実装を同時に追加する必要がある
- Transfer後のbufferは送信側で再利用できないため、所有権をclient APIで明確にする必要がある
- Font描画等、実行環境のresourceに依存する処理はbatch-safeでも端末間のpixel完全一致を保証しない

## 却下した案

- snapshot履歴を直ちにCommand履歴へ全面移行する: 既存編集の逆操作とresource lifetimeを同時に変更し、機能拡張の範囲を超える
- UI eventを記録してDOMから再生する: focus、layout、selection、pointer位置に依存し、保存可能な契約にならない
- macroの各commandを個別のUndo単位にする: 途中失敗で部分変更が残り、再生を1操作として扱えない
- P4のnested filter operationを`runScript`文字列としてmacroへ保存する: 型付きparameterとfilter単位のdiagnosticを失い、import時の安全境界が弱くなる
- unknown / unsafe commandをWorker内で黙ってskipする: ファイルごとに異なる部分成功を生み、期待結果を検証できない
- WorkerへFabric Canvas全体、または利用者・macroが指定した任意model URLを渡す: DOMに近い状態や無制限network能力が漏れ、同意・cache・再現性の境界が曖昧になる。既定背景Workerへ渡すのはapp側で固定したdescriptorだけとする
- 生JavaScriptをWorkerで実行する: Workerにもnetwork能力があり、`eval`禁止CSPとlocal-firstを満たさない

## 検証条件

- commandごとの正常値、境界値、余分なproperty、未知typeをruntime testする
- parameter未解決、重複command id、unknown commandのdiagnosticを検証する
- recorderがuser originだけを記録し、replayを再記録しないことを検証する
- 複数command成功時のcommitが1回で、途中失敗・cancel時にsnapshotが一致することを検証する
- batch-safe commandだけがdecodeへ進み、unsafe commandは入力bufferを消費する前に拒否されることを検証する
- Transferable、progress、cancel、duplicate job id、late / unknown response、Worker errorをclient testする
- ZIPのCRC、entry名、重複、path traversal、件数・size上限、chunk間cancelを検証する
- background model loaderが同意前に呼ばれず、cancelまたは古いdocument世代の結果を適用しないことを検証する
- background Workerがpinned descriptorだけを取得し、bytes/hash不一致をOPFSへcommitせず、cache hitではnetworkを使わないことを検証する
- ONNX Runtime WebのWebGPU import/session失敗時にWASMへfallbackし、runtime assetを初期entryとService Worker app shellへ含めないことを検証する
