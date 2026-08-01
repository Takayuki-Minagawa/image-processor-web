# ADR-003: 上限付きスナップショット履歴

- 状態: Superseded（content-addressed compact snapshotへ移行）
- 日付: 2026-07-30

## 決定

最初のMVPではドキュメントJSONのスナップショットを最大100件保持する。同一内容を抑止し、Undo後の新操作でRedo分岐を破棄する。ブラシやスライダーの高頻度イベントはUI側で集約する。

## 理由

Command+tile差分は大画像に有効だが、最初から導入すると描画機能ごとの逆操作設計が必要になる。JSONスナップショットなら動作の正しさと保存形式を早期検証できる。

## 移行条件

4K画像、20レイヤー、100操作で履歴メモリが性能予算を超える場合、定期チェックポイント+Command+copy-on-write tileへ移行する。

## 2026-08-01 再計測と決定

`npm run benchmark:history`で移行条件を再現した。4K相当の埋め込み画像を20レイヤー、100操作の各snapshotへそのまま保持すると、保守的な4 MiB/レイヤー見積もりでも約8 GiBになる。一方、操作間で不変のData URLをcontent-addressed assetとして1度だけ保持すれば、同じ条件を約80 MiBと軽量な構造差分に抑えられる。

この結果から、履歴APIとUndo単位はsnapshot方式のまま維持し、実体は`CompactHistory`へ移行する。大きなData URLを同期的にinternし、履歴読み出し時にhydrateするため、既存の復元境界は変えない。C2の複数ページでは全pageとactive page IDを持つ文書checkpointを100件上限で保持するが、非active pageを含む同一Data URLはcontent addressにより履歴全体で1回だけ保持する。これによりpage追加・削除・並べ替え、template適用、timeline変更もcanvas編集と同じUndo / Redoへ統合する。

Command+copy-on-write tileへの全面移行は、画像内容そのものが連続的に変化してcontent-addressingの効果が低いケースで、再度性能予算を超えた場合の次段階とする。
