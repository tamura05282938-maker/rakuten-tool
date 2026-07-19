# 楽天アフィリエイト自動化ツール

X（旧Twitter）での楽天アフィリエイト投稿を、リサーチから予約まで半自動化する単一ページのWebツール。

## 使い方

`index.html` をブラウザで開くだけで動作します（ビルド不要）。

1. ①リサーチ：楽天アフィリンク付き投稿をいいね数で絞って発掘
2. ②商品判定：楽天商品を検索し、条件（レビュー数・価格・在庫）で⭕️❌自動判定
3. ③投稿文生成：AIで投稿文を生成
4. ④画像選定：楽天商品画像を高解像度で選択
5. ⑤予約：Typefullyで投稿を予約

画面右上の「⚙️ 設定」から Worker エンドポイント・Claude APIキー・Typefully APIキーを設定できます。

## 構成

- `index.html` — ツール本体（単一HTML・外部ライブラリ依存なし）
- `worker.js` — Cloudflare Worker（APIプロキシ。デプロイは Cloudflare 側で `wrangler deploy` を使用）

詳細は [CLAUDE_CODE_引き継ぎ指示書.md](CLAUDE_CODE_引き継ぎ指示書.md) を参照してください。
