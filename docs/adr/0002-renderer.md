# ADR-002: MVPレンダラーにFabric.js 7を採用

- 状態: Accepted
- 日付: 2026-07-30

## 決定

Fabric.js 7をレンダラーアダプターの実装に採用する。Reactの状態とFabric Canvasを直接混在させず、`FabricEditorEngine`を境界にする。

## 理由

Fabric.jsは選択、変形、テキスト、図形、ブラシ、画像フィルター、重なり順、JSONシリアライズを提供し、編集フローを短期間で検証できる。MIT Licenseで継続更新されている。

PixiJS/WebGPUは大画像・多数レイヤーの計測でFabric.jsが性能予算を満たさない場合の候補とする。WebGPUをMVPの必須条件にはしない。

## 影響

Canvasは永続データの公開APIにせず、バージョン付きプロジェクトが正本になる。Fabric固有JSONはversion 1形式のレンダラーペイロードとして隔離する。
