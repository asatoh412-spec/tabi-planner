# 旅行プランナー（段階0）

PWA。Vite + React + TypeScript、地図は Leaflet＋国土地理院タイル、保存は IndexedDB。

## 開発
npm install
npm run dev

## 本番ビルド
npm run build   # dist/ を Cloudflare Pages にアップロード

## 段階0で確認済み（2026-11-09）
- Places API (New)・Routes API・Claude API・楽天 空室検索API はブラウザから直接呼べる（CORS可）
- 国土地理院 住所検索API（msearch.gsi.go.jp）で住所→座標が取れる
