# 出力設定プリセット

更新日: 2026-10-28

## 操作と対象

通常の「書き出す」と、Studioの画像PDF設定に「出力設定プリセット」を追加した。開くと、現在の設定に名前を付けて新規保存、選択した設定の適用、名前と設定の上書き、削除ができる。選択するだけでは出力設定を変えず、「適用」で反映する。適用・保存は書き出しを開始しない。名前欄のEnterも画像書き出しのsubmitへ流さない。

| 対象      | 保存する値                                                           | 保存しない値                                                            |
| --------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 画像・SVG | PNG / JPEG / WebP / SVG形式、品質0.1〜1、倍率0.5 / 1 / 2             | SVGの文書全体／選択範囲、選択オブジェクト、原稿寸法、背景、名前、出力先 |
| 画像PDF   | DPI 72〜600、塗り足し0〜20mm、トンボ、可逆／JPEG圧縮、JPEG品質0.1〜1 | ページ範囲と選択ID、仕上がり寸法、原稿、ファイル名、出力先              |

画像とPDFのプリセット一覧は分けて表示する。同じ名前を両方へ付けることはできる。同じ種類の重複名は大文字小文字を区別せず拒否し、既存のプリセットを意図せず上書きしない。更新は選択済みIDへ行い、削除には名前を表示して確認する。GIF・動画・PNG ZIPは今回のプリセット対象外とする。

設定を適用しても現在の文書の選択・ページ構成・用紙サイズを変えない。PDFでは塗り足し0の場合はトンボを解除する。適用後は現在の文書に対して既存のサイズ・総画素・PDF preflight検証を行い、保存済み設定が大きすぎる場合も出力上限を迂回しない。SVGの倍率・品質、可逆PDFのJPEG品質等、形式により使用しない値は既存UIと同様に保持する。

初期値は画像PNG・品質0.92・1倍、PDF 300DPI・塗り足し0・トンボなし・可逆・JPEG品質0.94を維持する。最後に使ったプリセットを次回自動適用する動作は追加しない。

## ブラウザ内の保存

localStorageの `image-processor-web:export-presets:v1` に `version: 1` のJSONライブラリを保存する。画像・PDF合計50件、名前80文字、ライブラリ32KiBを上限とし、超過時に古い項目を自動削除しない。TypeScript型だけに依存せず、実行時に形式・有限数・範囲・ID・名前・重複を検証し、既知の設定フィールドだけをコピーする。

プロジェクトschemaや原稿のUndo履歴とは独立した、このブラウザ・同じorigin内の利用者設定である。原稿や出力データは保存しない。ブラウザデータの削除、プライベートモードの終了等で失われ得る。クラウド同期、他ブラウザへの移行、プリセットJSONの入出力は追加しない。

読み取り・書き込み拒否、quota超過、破損・未知versionのライブラリでは既存の保存bytesを上書きせず、タブ内メモリの一時保存へ切り替えて画面に知らせる。一時保存はダイアログを閉じて開いても継続するが、ページの再読み込みで今回の変更は失われる。保存できなかった更新・削除は、再読み込み後に元の永続データが再表示される場合がある。

更新時は同じタブ内の操作を直列化する。Web Locks対応時は既存の共通lock helperを使い、同じoriginのlock内で最新データを読み、変更を書き込む。削除済みIDへの古い更新は新規作成として復活させない。他タブのstorage eventは一覧の更新に使い、編集中の出力設定へ自動適用しない。Web Locks非対応では変更前の再読み取りまでを行い、別プロセス間の同時更新の完全な排他は保証しない。

## 検証境界

単体試験はruntime検証、上限・重複、破損・未知versionの保持、一時保存、並行保存、削除済みIDへの更新、明示適用、名前欄Enter、PDF設定の一括適用と範囲保持を対象とする。ブラウザ試験では名前付き保存・更新・削除・再読み込み、実際のPNG／PDF出力、サイズ上限、保存拒否、SVG選択範囲の保持を確認する。

Safari実機やWeb Locks非対応ブラウザの多タブ競合を実機で検証したことは意味しない。GitHub ActionsによるCIは実行せず、ローカルでformat・lint・型検査・単体試験・本番build・Playwrightを行い、最終main反映時にPages公開だけを実行する。

## 調査した一次資料

小さな設定JSONには既存ブラウザ保存APIと既存lock helperを採用し、新規依存やOPFS基盤を追加しなかった。

- [WHATWG Web Storage：共有データとロックの注意](https://html.spec.whatwg.org/multipage/webstorage.html#introduction)
- [WHATWG setItem：保存失敗時の処理](https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-setitem)
- [MDN Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [MDN storage event：更新元以外への通知](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event)
- [MDN Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [公式Web Platform Tests：quota超過時の確認](https://github.com/web-platform-tests/wpt/blob/master/webstorage/storage_local_setitem_quotaexceedederr.window.js)
