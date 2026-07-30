# MVP実装状況

更新日: 2026-07-31

初期計画のPhase 1〜3から、GitHub Pagesで試せる最初の製品スライスを実装した。Phase 4のうちCI、入力制限、アクセシビリティの基礎、依存監査を含め、タイルレンダラーや全ブラウザの実機試験は後続課題として明示する。計画上の未完了項目は`IMAGE_EDITOR_WORK_PLAN.md`のtask listへ反映済みである。

## 完了した製品フロー

1. 新しいキャンバスを作る、または端末から画像を開く。
2. レイヤー、図形、テキスト、ブラシ、消しゴムで編集する。
3. レイヤー属性と画像フィルターを調整する。
4. Undo / Redoと自動保存で作業を保護する。
5. 編集可能なプロジェクトを保存するか、PNG / JPEG / WebPへ書き出す。
6. PWAとしてオフライン起動する。

## 計画との対応

| 領域       | 実装                                                                                                                     | 次の判断ゲート                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| アプリ基盤 | React、TypeScript、Vite、DOM UI、エラー境界                                                                              | 大規模状態管理は利用状況を見て判断         |
| 描画       | Fabric.js 7 adapter、Canvas2D/WebGL filter backend                                                                       | 4K/20層ベンチマーク後にタイル/PixiJSを判断 |
| 履歴       | 上限100件のスナップショット、操作種別ごとのトランザクション、Undo直前flush                                               | 画素量増加時にCommand+tile diffへ移行      |
| 保存       | version 1 JSON、Data URL内包、runtime validation                                                                         | ZIPコンテナは実測サイズと互換要件で判断    |
| 復旧       | OPFS優先、localStorage fallback、世代・revision管理で新しい編集を優先する直列自動保存                                    | Command journalと複数候補一覧              |
| 配布       | 原子的precache PWA、GitHub Pages Actions、PR CI、非同期編集gateと更新前flush                                             | CSP/COOP/COEPはWASM導入時に再評価          |
| 品質       | unit 81件、Pages本番サブパスPlaywright 16シナリオ、axe critical/serious 0件、Prettier、ESLint、strict build              | Safari/Firefox実機、golden画像、性能回帰   |
| 安全性     | magic byteとデコード前寸法検証、8,192px/64MP、埋込画像合計128MP、100MB project、500 objects、保存/復元共通validator、CSP | fuzz corpusとWorker timeout                |

## 意図的に後続へ残す項目

- タイル差分、dirty region、LRU GPUキャッシュ
- Worker/OffscreenCanvasによる重いフィルターとエンコード
- ピクセル選択、投げ縄、magic wand、スポイト、feather、レイヤーマスク
- グループ、Adjustment Layer、Smart Object
- PSD/XCF/OpenRaster、ICC/CMYK/16bit
- VoiceOver/NVDAを用いた実機監査と全対象ブラウザE2E

これらは「動作する最小編集製品」を複雑化させるため未完了を隠さず、`IMAGE_EDITOR_WORK_PLAN.md`のPhase 4以降に沿って段階的に進める。

## 2026-07-31 第一回レビュー対応

- 修飾キー付きショートカット、非同期cut、モバイルメニュー、PWA更新失敗時の操作ロックを修正
- プロジェクト名変更時の全snapshot生成、レイヤー名取得の反復走査、画像の重複デコードを削減
- 画像上限、Data URL、寸法照合を共通モジュールへ集約し、UIエラーを日本語化
- Blob URL解放、離脱警告、貼り付け位置、履歴の循環参照比較、Service Workerのscopeを堅牢化
- ESLint / PrettierとPages本番サブパスE2EをCI・デプロイ前の必須ゲートへ追加

## 2026-07-31 再レビュー対応

- Fabric.js 7の中心原点を左上原点へ正規化し、図形・テキスト・画像・描画path・復元objectの実bboxで配置を検証
- 復元を検証、off-canvas準備、適用の3段階に分離し、検証・enliven失敗を完全なno-opに変更
- 適用途中の復元失敗ではsnapshot、選択、viewportをrollbackし、準備済みFabricリソースも安全に解放
- ブラシ／消しゴム選択中のUndo属性破損、非同期copy/cut/cloneのdispose・clear・lock競合、失敗cutのclipboard破壊を修正
- 自動保存の同期検証例外を直列queueへ統合し、未処理rejectionを防止。保存・復元の制限エラーへ安定codeと具体的な日本語表示を追加
- PWA更新中の離脱警告競合、stale worker再利用、復旧前の未保存確認、Modalのfocus trap・Escape・フォーカス復帰を修正
- 画像ヘッダーの宣言寸法をData URL化前に検証し、未使用の二重デコード経路を削除
- 復元・画像読込・複製／貼り付けの成功／失敗／破棄競合でFabricリソースの所有権を整理し、置換済みobject・画像・cloneを解放
- プロジェクト復元に失敗した場合は、現在のキャンバスだけでなく保留中の履歴・自動保存も維持

## 2026-07-31 検証記録

- `npm test`: 81 tests passed
- `npm run test:e2e`: Chromium 16 scenarios passed
- `npm run format:check`: passed
- `npm run lint`: passed
- axe-core: critical / serious violations 0
- `npm run build`: strict TypeScript + Vite production build passed
- GitHub Pages相当の`/image-processor-web/`配下でService Worker制御と全build assetのprecacheを確認
- ネットワークを切った状態で本番プレビューを再読込し、アプリシェル起動を確認
- 2世代のService Workerで更新通知、更新前自動保存、旧app cache削除、他project cache保持を確認
- `npm audit --audit-level=moderate`: 0 vulnerabilities
