# ADR-004: version 1自己完結JSON形式

- 状態: Accepted
- 日付: 2026-07-30

## 決定

プロジェクトは`.pwx.json`とし、アプリ識別子、schema version、キャンバス寸法、Fabric JSON、メタデータ、更新日時を保存する。読み込んだ画像はData URLとして内包し、外部URLへ依存しない。

## 理由

単一ファイルはデバッグ、runtime validation、GitHub Pages上のダウンロード/再読込が容易で、MVPのround tripを早く検証できる。

## 影響

大画像ではファイルがBase64分だけ増える。複数アセットやタイルが必要になった時点でZIPコンテナへschema migrationする。未知versionは黙って破壊せず明示エラーにする。
