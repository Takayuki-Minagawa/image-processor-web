# ADR-012: フォント配布、ユーザーフォント、ライセンス

- 状態: Accepted
- 日付: 2026-08-01

## 背景

C4では、既存のLatin向け4 familyに日本語font、ユーザーfont、text style、縦書きを追加する。日本語fontはunicode coverageが大きく、すべてを初期bundleやPWA install shellへ含めると、fontを使わない利用者にも大きなdownloadを強いる。

外部font CDNを使えば初期配布を小さくできるが、編集内容に含まれる文字列や利用時刻を第三者へ送る可能性があり、offline・local-first方針にも反する。ユーザーfontをprojectへ埋め込む方式は別端末での再現性を上げる一方、意図しない再配布とファイル肥大を招く。

さらに、font load完了前にFabric.jsがtext幅を計測すると、同じprojectでもfallback glyphの幅でlayoutが確定する。fontの存在確認、fallback、読み込み完了待ちをUIごとに実装せず、共通registryへ集約する必要がある。

## 決定

同梱、system、user fontを1つの`FontRegistry`で扱い、family definition、対応script、weight、style、fallback、source、license、遅延loaderを共通化する。

### 同梱font

次の6 familyをFontsource packageから自己ホストし、SIL Open Font License 1.1のまま配布する。

- Inter
- Space Grotesk
- Bitter
- Manrope
- Noto Sans JP
- Noto Serif JP

Latin 4 familyは既存ロゴ機能との互換を維持する。Noto 2 familyはunicode-range分割されたvariable font CSSをfamilyごとのdynamic importの後ろへ置く。外部CDNは使用せず、Viteが生成したsame-origin resourceだけを読み込む。

NotoのWOFF2はService Workerのinstall-time precacheから除外する。最初に選択されたときだけ取得し、Service Workerのsame-origin runtime cacheへ保存するため、2回目以降と取得済みresourceのoffline利用を可能にする。ONNX Runtimeと同様、遅延resourceが失敗してもapp shellのinstall自体は失敗させない。

registryはloader promiseをfamily単位でcacheし、`document.fonts.load()`へweight、style、sample textを渡してlayout確定前に待つ。読み込み失敗は例外でeditor全体を止めず、`available: false`と失敗requestを返し、定義済みfallback stackで描画する。

### ユーザーfont

ユーザーfont metadata schema version 1は、WOFF2 / TTF / OTF、最大32 MiB、family、表示名、weight range、style、SHA-256、追加日時、fallback、ライセンス確認を記録する。`BrowserUserFontRepository`はbinaryをOPFSへ置き、利用できない環境では小さい上限を持つlocalStorageへfallbackする。project / templateへbinaryは埋め込まず、font参照を保存する場合も`family`、`fallback`、任意の`sourceId`だけにする。

repositoryはextensionとformat、font signature、byte length、SHA-256、保存後のbytesを照合する。起動時と追加直後にmetadataとbytesを取得し、`FontFace`へexact bytesを渡して`document.fonts`へ登録する。Studioは明示的なlicense確認後だけfile pickerを有効にし、保存済みfontの一覧・適用・削除を提供する。projectを開くときは保持された`fontFamily`を同梱・保存済み・端末fontと照合し、不足familyをwarning表示する。reference自体はfallbackへ書き換えない。

Local Font Access APIは必須経路にしない。対応browserではlicense確認後に`queryLocalFonts()`から選択したfont bytesを同じ検証・repository経路へ渡す。非対応またはpermission拒否時はgeneric system familyと明示的なfont file追加を安定した境界とする。

### テキスト機能との境界

text objectは`auto` / `wrap` / `fixed`のlayout modeと、横書き・縦書きの意図を限定propertyとして保存する。現在の縦書きはgraphemeを1行ずつ配置するportableな実装であり、禁則、縦中横、約物回転を含む完全な日本語組版ではない。

neon、splice、background、echo等のeffect presetは、通常のfill、stroke、shadowへ展開する。preset IDを外部font resourceの取得入口にせず、font loadとtext effectを独立させる。

### ライセンス記録

配布するfontとiconのfamily / package / source / license / loading policyは[LICENSES](../LICENSES.md)に集約する。package内のlicense fileを保持し、第三者resourceを追加するときはcatalog metadataと同文書を同時に更新する。

ユーザーfont・素材の利用許諾は利用者の責任とし、追加時に確認済みであることをmetadataへ記録する。Pixelweaveはユーザーbinaryを外部送信せず、project/templateへの再配布もしない。

## 影響

- 日本語fontを選択しない利用者のinstall shellと初期entryを小さく保てる
- font選択UI、ロゴ、template適用が同じfamily ID、fallback、load結果を利用できる
- same-origin resourceだけを使うため、第三者font serverへの編集情報漏えいを避けられる
- project単体ではユーザーfontのglyphを同梱しないため、別端末ではfallback表示になる可能性がある
- 縦書きの基本表示は提供できるが、出版品質の日本語組版は別スコープとなる
- ユーザーfontのrepository、一覧・追加・削除、任意のLocal Font Access取り込み、欠落family warningを利用できる。通常text objectへの明示的なsource ID保存は別途必要になる

## 却下した案

- Google Fonts等のCDNから取得する: local-first、offline、CSP、privacyの境界を弱める
- Noto全subsetをinstall shellへ含める: PWA installと更新のdownloadが大きくなる
- font選択後もloadを待たずにtextを作る: fallbackの字幅でlayoutが固定される
- ユーザーfont binaryを`.pwx.json`へ埋め込む: 意図しない再配布と巨大projectを生む
- fontがない場合にfamily referenceをfallbackへ書き換える: 元fontが戻っても復元できず、保存によって意図を失う
- Local Font Access APIだけをユーザーfont経路にする: browser対応とpermissionに依存し、file importより移植性が低い

## 検証条件

- registryがID、family、script、weight、style、fallback、重複を検証する
- Noto loaderが選択前に実行されず、同じfamilyの並行loadが1 promiseへ集約されることを検証する
- `document.fonts.load()`成功・失敗の両方で正しい`available`とfallback結果を返すことを検証する
- Noto WOFF2がentry chunkとService Worker install shellに含まれず、same-origin runtime cache対象になることをbuildで確認する
- user metadataのformat、32 MiB上限、SHA-256形式、weight range、license確認を検証する
- repositoryのsignature / hash / capacity、OPFSとfallbackの保存・一覧・取得・削除を検証する
- `FontFace`へ渡すbytesの長さ不一致を拒否し、登録成功をcomponent-independent testで確認する
- project font referenceにbinaryが含まれず、欠落時もfamily / sourceIdがround tripで保持されることを検証する
- 縦書き、layout mode、effect presetが保存→再読込とPNG / SVG書き出しで保持されることを確認する
- [LICENSES](../LICENSES.md)のpackage、source、license linkを配布resource更新時に監査する
