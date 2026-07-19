# 楽天アフィリエイト自動化ツール — Claude Code 引き継ぎ指示書

このドキュメントを Cursor の Claude Code に丸ごと貼り付けてください。
プロジェクトの全体像・設計意図・要望仕様・既存インフラを引き継いだ状態で開発を続行できます。

---

## 0. あなた（Claude Code）への依頼

`index.html` を土台とした「楽天アフィリエイト自動化ツール」の開発を引き継ぎます。
このファイルは既に①〜⑤の全機能が実装済みの完成度の高い土台です。以下を順に進めてください。

1. まずプロジェクト構成を整える（下記「推奨フォルダ構成」）
2. ローカルで動作確認できる状態にする
3. GitHub Pages へデプロイして URL でアクセスできるようにする
4. 以降、私（ユーザー）の指示で修正・機能追加

**重要**: いきなり全部を書き換えないこと。既存の `index.html` は動作確認済みの土台です。修正は差分で、必要な箇所だけ行ってください。

---

## 1. このツールが何をするか

X（旧Twitter）での楽天アフィリエイト投稿を、リサーチから予約まで半自動化する単一ページのWebツール。
5ステップをタブUIで切り替えて使う。

| ステップ | 機能 | 使うAPI |
|---|---|---|
| ①リサーチ | 楽天アフィリンク付き投稿を「いいね数」で絞って発掘。楽天/Amazon区別可 | SocialData API |
| ②商品判定 | 楽天商品を検索し、条件（レビュー200+/在庫あり/3000円以下）を⭕️❌自動判定 | 楽天商品検索API |
| ③投稿文生成 | AIで投稿文を生成（通常10+超バズ5+第三者5+ズラし5）。投稿選択でリプ案内文も自動生成 | Claude API |
| ④画像選定 | 楽天商品画像を高解像度で表示、2〜3枚選択 | （楽天APIのデータ流用） |
| ⑤予約 | メイン（画像+本文）+リプ（案内+アフィリンク+#ad）を組み立て、日時指定で予約 | Typefully API |

### 投稿の構成（絶対に守る仕様）
```
【メインポスト】
  画像2〜3枚
  ＋ 投稿文（本文）

【リプ欄（メインへの返信）】
  案内リプ
  ＋ アフィリエイトリンク
  ＋ 半角スペース + #ad   ← ステマ規制対応。必ず付ける
```

---

## 2. 既存インフラ（重要・変更不可の前提）

### Cloudflare Worker（APIプロキシ）
- URL: `https://x-api-proxy.tamura-0528-2938.workers.dev`
- 役割: APIキーを隠して各APIに中継する。フロント（index.html）はキーを持たず、全リクエストをこのWorker経由で送る。
- 実装済みエンドポイント（POST）:
  - `/claude` — Claude API中継（`x-api-key`ヘッダー or env.CLAUDE_API_KEY）
  - `/search-tweets` — SocialData検索（env.SOCIAL_DATA_API_KEY）
  - `/rakuten-search` — 楽天商品検索（下記詳細）
  - `/typefully-draft` — Typefully下書き作成（env.TYPEFULLY_API_KEY or リクエストのapiKey）
  - 他: `/tweet` `/thread` `/gemini-image` `/get-user` `/get-trends` `/web-search` `/fetch-news`
- Worker本体のコードは `worker.js`（このプロジェクトに同梱）。編集する場合はCloudflareダッシュボードの Edit code に貼るか、wranglerでデプロイ。

### 楽天APIの重要な注意点（ハマりどころ）
- エンドポイント: `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401`（2026年新基盤。旧app.rakuten.co.jpは廃止済み）
- 認証: `applicationId` + `accessKey`（両方必須）+ `affiliateId`
- **403対策**: 楽天新基盤はリクエストに `Origin` ヘッダーが無いと `REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING` で403になる。
  Worker側で `Origin: https://tamura-0528-2938.workers.dev`（登録済みドメイン）を必ず付ける。**Refererではなく Origin が正解**（検証済み）。
- キーはWorkerのSecretに登録済み: `RAKUTEN_APP_ID` / `RAKUTEN_ACCESS_KEY` / `RAKUTEN_AFFILIATE_ID`
- レスポンスの主要フィールド: `itemName` `itemPrice` `reviewCount` `reviewAverage` `availability`(1=在庫あり) `mediumImageUrls` `affiliateUrl` `itemCode` `shopName` `catchcopy`
- 画像の高解像度化: `mediumImageUrls` は `?_ex=128x128`。URLを `?_ex=500x500` 等に置換して高解像度取得。

### 短縮URL（a.r10.to）について
- 楽天は `a.r10.to` を自動生成する公開APIを提供していない。
- 現状の実装: 長いアフィリンク（`hb.afl.rakuten.co.jp/...`）を出力し、「楽天で短縮URL作成」への導線＋手動貼り替え欄を用意。
- もし将来的に短縮を自動化するなら、汎用短縮API（TinyURL等）を使う案がある。ただしドメインは楽天由来でなくなる。

### Typefully API
- エンドポイント: `POST https://api.typefully.com/v1/drafts/`
- 認証ヘッダー: `X-API-KEY: Bearer {APIキー}`
- 主要パラメータ: `content`（本文。`\n\n\n\n` 4連続改行でスレッド=リプ区切り）, `schedule-date`（ISO8601）, `threadify`
- APIキーはユーザーがTypefully有料プランの設定→APIから取得済み。ツールの設定欄 or Workerのenv.TYPEFULLY_API_KEYに保持。

---

## 3. 推奨フォルダ構成

```
rakuten-tool/
├─ index.html          ← ツール本体（同梱ファイルをそのまま配置）
├─ worker.js           ← Cloudflare Worker（参考用。デプロイはCloudflare側）
├─ README.md           ← 使い方メモ（任意で作成）
└─ CLAUDE_CODE_引き継ぎ指示書.md  ← このファイル
```

GitHub Pages で公開するので、`index.html` がルートにあれば良い。ビルド不要（素のHTML/CSS/JS一体型）。

---

## 4. index.html の実装メモ（把握しておくこと）

- 単一HTMLファイル。外部ライブラリ依存なし（フレームワーク不使用）。
- 状態は `state` オブジェクトで管理。設定・プロンプト・投稿済み商品リストは `localStorage` に保存。
  - `rk_worker` / `rk_claude` / `rk_typefully` / `rk_prompt` / `rk_posted`
- 投稿生成プロンプトは `DEFAULT_PROMPT` 定数が初期値。画面のテキストエリアで編集・保存可能（ユーザー要望）。
  現在は「共感型・感情ドリブン」プロンプトが入っており、**出力はJSON形式**（通常版/超バズ/第三者目線/ズラし型）を要求している。
- リプ案内文は `REPLY_PROMPT` で別途生成。
- ③の生成モデルは Opus 4.8 / Sonnet 5 を選択可（デフォルトOpus。フォーマット遵守が重要なのでOpus推奨）。
- 規約ガードレール: 投稿済み商品の `itemCode` を記録し、②の商品カードに「投稿済み」警告を表示。

### デザイン
- 楽天ブランドカラー（赤 #bf0000）ベース、白背景、ゴールドアクセント、LINEグリーンのCTA。
- レスポンシブ対応済み。モバイルでも使える。

---

## 5. 最初にやってほしいこと（具体的タスク）

1. `index.html` をブラウザで開ける状態にし、ローカルで動作確認
   （②で「マグカップ」検索 → ⭕️❌判定が出れば楽天API連携OK）
2. Git初期化 → GitHubリポジトリ作成 → push
3. GitHub Pages を有効化して公開URLを取得
   - Settings → Pages → Source: main / root
   - 数分後 `https://{ユーザー名}.github.io/rakuten-tool/` でアクセス可能に
4. 公開URLで全ステップが動くか確認

### 動作確認チェックリスト
- [ ] ②商品検索が動く（楽天API 200が返る）
- [ ] 条件判定の⭕️❌が正しく表示される
- [ ] ③投稿文生成が動く（Claude APIが返る、JSON解析成功）
- [ ] 投稿選択でリプ案内文が生成される
- [ ] ④画像が高解像度で表示・選択できる
- [ ] ⑤プレビューが正しく組み上がる（メイン＋リプ＋#ad）
- [ ] Typefully予約が成功する（要APIキー）

---

## 6. 既知の未確定・改善余地（ユーザーと相談しながら）

- 短縮URL自動化（現状は手動導線）。ニーズがあれば汎用短縮APIの組み込みを検討。
- ①リサーチのSocialDataクエリは `min_faves:` とドメイン絞り込みを使用。実データで精度調整の余地あり。
- Typefullyの画像添付: API経由での画像添付は制約があるため、現状メイン画像はプレビュー表示のみ。
  実際の画像添付方法（Typefully側の仕様）は要検証。必要なら画像URLを本文に含める等の代替を検討。
- 投稿頻度・重複の規約ガードレールは最小実装。運用しながら強化可。

---

## 7. ユーザーの運用コンテキスト（参考）

- Mac（iMac、ユーザー名 miplan）、Homebrew/Git/wrangler 利用可。
- 普段の作業ディレクトリ: `/Users/miplan/Desktop/01_クロードコード/`
- デプロイ経験: Vercel（Cloudflare Pages含む）、Cloudflare Worker（wrangler）
- GitHub Pages でも Vercel でもデプロイ可能。今回はGitHub Pages想定だが、ユーザーが使い慣れたVercelでも良い。

---

以上。まず `index.html` の動作確認 → GitHub公開 の順で進め、詰まったら該当箇所をユーザーに確認してください。
