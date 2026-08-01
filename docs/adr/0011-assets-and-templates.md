# ADR-011: 素材・テンプレートの遅延配布と検証境界

- 状態: Accepted
- 日付: 2026-08-01

## 背景

C3の素材とC5のデザインテンプレートは、検索一覧では多数の項目を即座に見せつつ、実際に使われないSVG、layout、複数ページtemplateを初期bundleへ含めない必要がある。素材には第三者ライセンスと危険なSVGの問題があり、テンプレートには未知要素、過大座標、外部asset参照、重複IDの問題がある。

組み込みresourceだから安全であると仮定すると、catalog更新時にscriptや外部参照を混入させてもrendererへ到達する。逆に、検索のたびに全payloadを読み込んで検証すると、C0で維持すると決めたentry bundle予算を守れない。

また、ユーザー素材、ユーザーテンプレート、ブランドlogoは端末内で再利用できる必要がある。再利用catalogやtemplate定義へ未検証binaryを直接埋め込むと、一覧の肥大、意図しない再配布、decode前allocationの問題を生む。一方、挿入後のprojectを単独で再現するには、検証済み画像をrenderer payloadへ含める既存形式との整合も必要になる。

## 決定

素材とテンプレートは「軽量catalog metadata」と「遅延読み込みpayload pack」に分割する。検索はcatalogだけで完了し、挿入対象が決まったときだけ対応packをdynamic importして、manifestとpayloadを再検証する。

### 素材pack

素材schema version 1は、次のkindを扱う。

- procedural shape
- SVG icon / illustration
- clip frame
- photo grid

catalog entryは一意ID、pack ID、日英名称・tag、category、license、safety metadataを持つ。pack manifestはID、件数、loaderを持ち、読み込み後にschema version、pack ID、件数、重複・未知asset、catalog kindとpayload typeの一致を検証する。

procedural shapeはbounded geometryへ変換できること、gridは最大64 cell、正規化座標、重複のないcell IDを検証する。SVGは組み込み・ユーザー提供を区別せず、遅延読み込みした既存sanitizerを必ず通す。script、event handler、埋め込みHTML、危険なCSS、外部resource参照は許可しない。

初期組み込みcatalogは3 pack、計15素材とする。

- `core-shapes`: 図形・線7件
- `core-layouts`: フレーム2件、grid 3件
- `core-icons`: Lucide由来icon 3件

素材数を増やすときもcatalogだけをentry chunkへ置き、payloadはcategoryまたはpack単位のchunkを維持する。

### ユーザー素材

ユーザー素材metadataはschema version 1、一意ID、名称、ファイル名、MIME、byte数、寸法、SHA-256、時刻、safety metadataを持つ。1件64 MiB、各辺16,384pxを上限とする。SVGはsanitizer、rasterは既存decoderの検証を通す。

再利用ライブラリの原本binaryはorigin-scoped storageへ置き、templateとbrand kitにはasset referenceだけを保存する。assetをdesignへ挿入した後は、既存projectの自己完結性を維持するため、sanitized SVG geometryまたは検証済みraster Data URLがFabric renderer payloadへmaterializeされ得る。このpayloadもembedded image上限とproject validatorの対象とし、catalog metadataへ無制限binary fieldを追加しない。

`BrowserUserAssetRepository`はこの契約に従い、OPFSを優先し、制限付きlocalStorageへfallbackする。保存時にMIME / extension / signature / SVG safety / 寸法 / SHA-256を照合し、Studioの「マイ素材」から追加・再利用・一覧・削除できる。最近使用とdrag & dropはUI concernとして分離し、boundedなasset ID payloadだけを受け付ける。raster dropは通常配置に加え、clip frameまたはgrid cellへcover配置できる。grid境界変更は正規化layoutへ適用し、cell内容のclipと保存metadataを同時に更新する。

### 組み込みデザインテンプレート

組み込みデザインtemplate schemaはversion 1とし、文書寸法、複数page、page background、通常編集へ展開できる次の要素を持つ。

- text
- shape
- asset reference / brand logo reference
- image placeholder

色とfontは固定値またはbrand roleを参照できる。templateは最大50ページ、1ページ500要素、各辺16,384px、全ページ合計512 Mi pixel相当へ制限する。

template root、寸法、pageは厳格に検証する。要素単位の未知kind、不正要素、重複IDはdiagnosticを残して安全にskipし、同じtemplate内の既知要素は利用できる。template collectionでは、1件のroot-level failureが他templateの読み込みを止めない。

組み込みtemplateはSNS投稿、動画thumbnail、banner、名刺、A4 flyer、presentationの6 pack、各6件、計36件とする。catalog検索は日英metadataだけで行い、選択したcategoryのpackだけを読み込む。manifestの件数と、各templateのID、寸法、page数がcatalogに一致しなければpack全体を拒否する。

適用時はtemplateを特別なrenderer objectとして保持せず、通常の編集可能なtext、shape、image placeholder、asset layerへ1 transactionで展開する。未解決asset referenceは警告として返し、任意URLを取得しない。

### ユーザーテンプレートfile

`.pwxtemplate.json`は、`appId`、file kind、envelope schema version、canonical schema-v4 projectを持つ独立envelopeとして保存する。runtime active-page aliasを除いた全page、renderer payload、layer tree、background、timelineを保持するため、現在のdesignを完全な編集状態で再利用できる。読み込み時はenvelopeの未知fieldとversionを拒否し、nested projectを通常のproject validatorで検証・移行してからeditorへ渡す。

これは、未知elementをwarning skipできる組み込みtemplate schemaとは別の境界である。user templateはfile import / exportを提供するが、端末内catalogへの保存・一覧は行わない。

### ブランドキット

ブランドキットはversion付きJSONとして、最大20 palette、heading / subheading / body font reference、最大20 logo asset referenceを持つ。色、font、logo roleをtemplate適用前に通常値へ解決する。保存はOPFSを優先し、利用できない場合はlocalStorageへfallbackする。

ブランドlogoも素材ID参照であり、binaryをブランドキットやtemplateへ複製しない。配布resourceとライセンスの一覧は[ADR-012](./0012-fonts-and-licensing.md)および[LICENSES](../LICENSES.md)を正本とする。

## 影響

- 検索一覧を表示してもSVG parser、素材payload、template payloadを初期chunkへ引き込まない
- catalog、manifest、payloadの三者不一致を挿入前に検出できる
- 組み込みSVGにもユーザーSVGと同じsanitizerを適用し、安全性を配布元の信頼へ依存しない
- templateは適用後に通常レイヤーとなり、既存のUndo、保存、書き出しを再利用できる
- 未知template要素をskipできるが、root versionや寸法上限の不一致はtemplate全体を拒否する
- ユーザーasset byte repositoryは端末内再利用を提供する。ユーザーテンプレートはfile単位で、端末内一覧管理は別途必要になる
- designへmaterializeしたrasterはprojectのFabric payloadへ含まれ得るため、project sizeは挿入素材に比例する

## 却下した案

- 全素材・templateを1つのbundleへ含める: 初回loadとPWA install shellがresource数に比例する
- 検索時に全packを読み込む: payload分離の利点がなくなる
- 組み込みSVGだけsanitizerを省略する: catalog更新を安全境界の外に置いてしまう
- 任意のFabric.js JSONをtemplateとして保存する: renderer依存、上限、未知property、外部参照を検証できない
- 未知template要素が1件あれば全templateを破棄する: 新旧version間の部分互換を失う
- 未検証のユーザー素材binaryをcatalogや`.pwxtemplate.json`へ埋め込む: 一覧の肥大と意図しない再配布を招く。designへ挿入済みの検証済み画像をself-containedなFabric payloadへmaterializeする既存経路は維持する

## 検証条件

- catalog検索がpayload loaderを呼ばず、選択packだけを1回load・cacheすることを検証する
- catalog / manifestの件数、ID、kind、template寸法・page数の不一致を拒否する
- 全組み込み15素材を検証し、SVG 3件がsanitizer後も描画可能で外部参照を含まないことを確認する
- 全組み込み36templateを読み込み、warningなし、category 6種、各page 5要素以上を検証する
- unknown / invalid / duplicate template elementがwarning付きでskipされ、既知要素が残ることを検証する
- templateのページ数、要素数、寸法、合計面積上限を検証する
- ブランドroleの色・font・logoが解決され、不足logoはwarningになることを検証する
- user template envelopeがcanonical projectをexact round tripし、未知field、未知version、過大・不正nested projectを拒否する
- user asset repositoryがOPFS / fallbackの保存・一覧・取得・削除、hash不一致、容量上限を検証する
- catalog / user assetのdrag payloadが未知ID・過大入力を拒否し、frame / grid dropとgrid境界変更が保存復元・書き出し後もclipを維持することを検証する
- asset / template chunkがentry bundle予算へ含まれないことをbuild gateで確認する
- script入りSVGを組み込み・ユーザー経路の両方で拒否または無害化する
