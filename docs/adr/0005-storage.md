# ADR-005: OPFS優先・localStorage fallback

- 状態: Accepted
- 日付: 2026-07-30

## 決定

自動保存はOrigin Private File Systemを優先し、未対応または失敗時はlocalStorageへfallbackする。明示保存は常にダウンロードを提供する。

## 理由

OPFSは大きなBlobを扱いやすく、localStorageは互換性が高い。どちらもサイトデータ消去の対象なので、唯一の正本にはしない。

## 影響

容量不足と利用不可は編集自体を止めず、状態メッセージで伝える。将来は保存世代、quota表示、File System Access APIによる直接保存を追加する。
