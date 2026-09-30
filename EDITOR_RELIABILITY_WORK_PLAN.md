# 編集操作・書き出し・PWA改善計画

作成日: 2026-09-30 / 作業ブランチ: `codex/editor-reliability-export`

## 調査と範囲

既存コード、README、GitHub Issue #5を確認。EditorApplicationとFabricEditorEngineに責務が集中しているため、今回触れる書き出しと入力判定から分離する。Issue #5全体の完了とはせず、文書状態/store、広範な翻訳、動画能力判定などは残課題として維持する。

参照: [Issue #5](https://github.com/Takayuki-Minagawa/image-processor-web/issues/5)、[Photopeaのキー移動](https://www.photopea.com/learn/index.php?page=layer-manipulation)、[Canvas toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)、[ClipboardItem](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem)、[Fabric export memory issue](https://github.com/fabricjs/fabric.js/issues/7924)、[Cache quota](https://developer.chrome.com/docs/workbox/understanding-storage-quota)。

## 実施項目

- [x] 書き出しの寸法検証・エンコード責務を分離し、Blob出力とMIME検証、失敗時のviewport復元を実装する。
- [x] 書き出しUIを独立コンポーネントへ分離し、PNGクリップボードコピー、非対応・拒否時の案内、日英表示を追加する。
- [x] ショートカット判定を分離し、矢印1px/Shift+矢印10px、全選択、複製を実装する。入力中・IME・モーダル・プレゼン中の背面変更を防ぐ。
- [x] Service Workerのキャッシュ読み書き失敗とネットワーク応答を切り離し、障害時も正常な応答を利用する。
- [x] npm audit対象の修正版を適用し、README・実装状況を更新する。
- [ ] format、lint、型検査、全ユニット、ビルド、PagesサブパスのブラウザE2Eで検証する。
- [ ] PRを作成・添付し、ローカルサブエージェントの独立レビューと修正・再レビューを完了する。
- [ ] マージ・pushし、最終GitHub Pagesデプロイと公開ページを確認する。
- [ ] 完了済み作業計画Markdownと今回の不要ブランチを削除し、mainの同期・clean状態を確認する。

GitHub AI agentsは使用しない。Actionsの扱いの確認まではローカルのみで検証し、回答がない場合もPR CIを実行せず最後のPages公開のみActionsを利用する。

## 検証記録

- format / lint / 全764単体テスト / 型検査 / build成功。
- 新書き出しE2E 5件成功。修正後の全49件を実行中。
- 既存の詳細フィルター画像比較1件はmacOSとUbuntuのフォント差。変更前origin/mainでも同じ350×238対350×243、4453画素の差が再現。閾値とgoldenを変更せず、最終PagesのUbuntu実行で確認する。
- npm auditの指摘は0件。
