# MVP実装状況

更新日: 2026-07-30

初期計画のPhase 1〜3から、GitHub Pagesで試せる最初の製品スライスを実装した。Phase 4のうちCI、入力制限、アクセシビリティの基礎、依存監査を含め、タイルレンダラーや全ブラウザの実機試験は後続課題として明示する。計画上の未完了項目は`IMAGE_EDITOR_WORK_PLAN.md`のtask listへ反映済みである。

## 完了した製品フロー

1. 新しいキャンバスを作る、または端末から画像を開く。
2. レイヤー、図形、テキスト、ブラシ、消しゴムで編集する。
3. レイヤー属性と画像フィルターを調整する。
4. Undo / Redoと自動保存で作業を保護する。
5. 編集可能なプロジェクトを保存するか、PNG / JPEG / WebPへ書き出す。
6. PWAとしてオフライン起動する。

## 計画との対応

| 領域 | 実装 | 次の判断ゲート |
|---|---|---|
| アプリ基盤 | React、TypeScript、Vite、DOM UI、エラー境界 | 大規模状態管理は利用状況を見て判断 |
| 描画 | Fabric.js 7 adapter、Canvas2D/WebGL filter backend | 4K/20層ベンチマーク後にタイル/PixiJSを判断 |
| 履歴 | 上限100件のスナップショット、操作種別ごとのトランザクション、Undo直前flush | 画素量増加時にCommand+tile diffへ移行 |
| 保存 | version 1 JSON、Data URL内包、runtime validation | ZIPコンテナは実測サイズと互換要件で判断 |
| 復旧 | OPFS優先、localStorage fallback、世代・revision管理で新しい編集を優先する直列自動保存 | Command journalと複数候補一覧 |
| 配布 | 原子的precache PWA、GitHub Pages Actions、PR CI、非同期編集gateと更新前flush | CSP/COOP/COEPはWASM導入時に再評価 |
| 品質 | unit 49件、Playwright 9シナリオ、axe critical/serious 0件、strict build | Safari/Firefox実機、golden画像、性能回帰 |
| 安全性 | magic byteとデコード前寸法検証、8,192px/64MP、埋込画像合計128MP、100MB project、500 objects、保存/復元共通validator、CSP | fuzz corpusとWorker timeout |

## 意図的に後続へ残す項目

- タイル差分、dirty region、LRU GPUキャッシュ
- Worker/OffscreenCanvasによる重いフィルターとエンコード
- ピクセル選択、投げ縄、magic wand、スポイト、feather、レイヤーマスク
- グループ、Adjustment Layer、Smart Object
- PSD/XCF/OpenRaster、ICC/CMYK/16bit
- VoiceOver/NVDAを用いた実機監査と全対象ブラウザE2E

これらは「動作する最小編集製品」を複雑化させるため未完了を隠さず、`IMAGE_EDITOR_WORK_PLAN.md`のPhase 4以降に沿って段階的に進める。

## 2026-07-30 検証記録

- `npm test`: 49 tests passed
- `npm run test:e2e`: Chromium 9 scenarios passed
- axe-core: critical / serious violations 0
- `npm run build`: strict TypeScript + Vite production build passed
- GitHub Pages相当の`/image-processor-web/`配下でService Worker制御と全build assetのprecacheを確認
- ネットワークを切った状態で本番プレビューを再読込し、アプリシェル起動を確認
- 2世代のService Workerで更新通知、更新前自動保存、旧app cache削除、他project cache保持を確認
- `npm audit --audit-level=moderate`: 0 vulnerabilities
