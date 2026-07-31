# ADR-007: 背景除去モデル境界とスクリプト実行の能力制限

- 状態: Accepted
- 日付: 2026-07-31

## 背景

背景除去はローカル推論を原則とするが、モデルの品質、配布サイズ、WASM速度は
モデルごとの差が大きい。モデルを初期bundleやService Workerのapp shellへ
含めると、機能を使わない利用者にも大きな転送が発生する。

スクリプトコンソールについて、Dedicated Workerには`document`は存在しない
一方、`fetch`、WebSocket、`importScripts`等の能力は残る。生JavaScriptを
Workerへ渡すだけではネットワーク遮断にならず、`eval`/`Function`を許可する
CSP緩和も採用できない。

## モデル候補の比較と採用結果

初期採用では、Web配布サイズ、用途、固定可能なONNX artifact、licenseを比較した。

| 候補     | 配布・license                                              | 強み                                                               | 初期採用の判断                                                                                                           |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| U2NetP   | 4,574,861 bytesのONNX、Apache-2.0                          | 軽量なsalient-object modelで、人物以外の主要被写体にも適用しやすい | immutable revisionとchecksumを固定でき、初回配布とWASM実行の予算を満たしたため採用                                       |
| MODNet   | portrait matting向け。upstreamの学習済みartifactは人物中心 | 髪や人物輪郭のmattingに適する                                      | compactな公式ONNX artifactを同じ配布条件で固定できず、商品・ロゴ等の一般被写体を既定対象にする要件とも合わないため見送り |
| RMBG-1.4 | quantized ONNXでも約44.4MB。独自のmodel license            | 一般的な背景除去で高品質を期待できる                               | U2NetPの約10倍の初回取得とlicense条件が今回の軽量・再配布境界に合わないため見送り                                        |

既定モデルはU2NetP `u2netp@7fc34de`とし、immutable revisionのURL、
4,574,861 bytes、SHA-256
`309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`
をdescriptorへ固定する。入力`input.1`、出力`1959`、320×320、Apache-2.0
として扱う。

固定download URL:
`https://huggingface.co/Heliosoph/u2net-onnx/resolve/7fc34deee10329bc039c10a73b98090d0c6f5c59/u2netp.onnx`

固定した実モデルとONNX Runtime WebのWASM backendを使う受け入れscriptで、
640×480 synthetic画像を約981ms、NASAのパブリックドメイン写真
（Eileen Collins、512×512）を約840msで推論した。mask長、前景/背景のdynamic
range、中央と外周の分離、非退化foreground比、10秒以内という自動判定を通過した。
同じ実モデルbytesをOPFS相当へcommitした後は、network callbackを呼ばずofflineで
再取得・推論できることも確認した。これは固定artifact、adapter、代表的な人物写真
のsmoke/性能検証であり、複数画像corpus、端末別WebGPU、髪・透明物の品質評価を
完了したことは意味しない。

## 背景除去の決定

- 推論器は`BackgroundSegmentationAdapter`境界とし、UI・Worker protocolから
  ONNX Runtime固有型を隔離する
- モデルが未導入でもテストと手動補正フローを検証できるよう、画像外周色との
  距離に基づく決定的fallbackを提供する。これはAI品質の代替とは表示しない
- モデルは利用者がサイズを確認して同意した後だけ取得する
- 実行同意は永続化せず、実行完了・cancel・UIの再open後は再度の明示同意を求める。検証済みモデルbytesだけをoffline利用のため永続cacheする
- descriptorへid、version、bytes、SHA-256を固定し、検証成功後にのみOPFSへ
  commitする
- cache済みモデルはネットワークなしで再利用できる。破損cacheは削除する
- ONNX Runtime、WASM、モデルはdynamic import/遅延assetとし、app shellの
  precache対象から除外する
- 既定UIは同意済みのjobだけをpinned descriptorとともに背景除去Workerへ送り、
  Worker対応環境ではWorker内loaderがその固定HTTPS URLを取得する
- Worker内loaderはContent-Length、実bytes、上限、SHA-256を検証し、成功後だけ
  OPFSへcommitする。cache hit時はnetworkなしで再利用する

ONNX Runtime Webは背景除去経路からdynamic importする。WebGPU APIがある場合は
WebGPU Execution Providerを試し、runtime importまたはsession作成に失敗した場合を
含めWASMへfallbackする。runtime chunkとWASM assetは初期entryとService Workerの
app shell precacheから除外する。

## スクリプト実行の決定

初期コンソールは生JavaScriptを評価しない。限定的なJavaScript風grammarを
自前parserで読み、次のwhitelistだけを直列化可能なコマンドへ変換する。

- `editor.resize(...)`
- `editor.applyFilter(...)`
- `editor.addText(...)`
- `editor.forEachLayer(layer => { ... })`

grammarはliteral、配列、object、`layer.id`/`layer.name`以外の識別子解決を
持たない。`fetch`、`document`、`window`、`globalThis`、Worker、
`constructor`、prototype access、import、loop、任意式を拒否する。
source length、文字列、collection、nest、command数へ上限を設ける。

parserの出力はP2 command dispatcherで再検証し、すべて成功した場合だけ
1 transactionとして適用する。parse途中またはcommand実行途中のDOM変更を
許可しない。将来完全なJavaScript互換が必要になった場合は、ブラウザー能力を
bindingしないQuickJS/WASM等を別ADRで評価する。

検証済みDSL sourceはorigin-scopedなrepositoryへ保存・再読込・削除できる。
macro登録時は生のcommand列へ展開せず、bounded sourceを持つ`runScript` command
として保存する。登録時、macro import時、実行時に同じparserとcommand validatorを
通し、古い保存データや改変されたmacroから能力制限を迂回できないようにする。

## セキュリティ検証

- model download前の同意、固定URL、bytes/hash不一致、破損cache、offline cache hit
- WebGPU不可またはsession失敗時のWASM fallback、初期bundle / app shellからの
  runtime asset分離
- `fetch`、`document`、`globalThis.fetch`、WebSocket、prototype accessの拒否
- 無限loopや式がgrammarへ入らないこと、command/source上限
- cancellation後またはdocument世代変更後のWorker結果を適用しないこと
- スクリプト全体がUndo 1回で戻り、失敗時は変更が残らないこと

## 実装追記

既定構成はpinned U2NetP descriptorとdownload URLを含むが、モデルbytesとONNX
Runtime実体は初期bundleへ含めない。`AdvancedBackgroundModel`はUIへid、表示名、
4,574,861 bytesを示し、明示同意後だけbackground Worker jobへdescriptorを渡す。
Worker対応環境ではWorkerがdownload、checksum、OPFS cache、ONNX adapterを所有し、
WebGPU→WASMの順にsessionを作る。Workerがない環境は同じloaderを呼び出し側で
遅延loadする。モデルがない場合または利用しない場合は、画像外周色に基づく
決定論fallbackを実行する。testや埋め込み構成では純粋な
`BackgroundSegmentationAdapter`を注入できる境界を維持する。

スクリプトUIは自前parserの出力だけを親へ渡し、生JavaScript、`eval`、
`Function`を実行する経路を持たない。parser出力をeditorへ適用する境界でも
commandを再検証し、atomic transactionへまとめる。保存済みDSLの実行とmacroへ
登録した`runScript`も同じ再検証経路を共有する。
