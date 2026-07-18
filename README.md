# ARCHIVES Studio — Shopify Theme

Claude Design「Archives Storefront」を Shopify テーマ（Liquid, skeletonから自作）として
実装したファッションEC ショーケース。

- **ストア**: `mystudio-fashion-ec.myshopify.com`
- **デザイン正典**: `design-reference/`（元デザインHTML＋トークン）
- **実装スペック / スプリント計画**: `docs/spec.md`

## 構成

| ディレクトリ | 内容 |
|---|---|
| `layout/` | `theme.liquid`（共通レイアウト）, `password.liquid` |
| `sections/` | header/footer グループ、announcement-bar、header、footer、placeholder |
| `snippets/` | cart-drawer ほか |
| `assets/` | `archives.css`（トークン＋ベース＋コンポーネント）, `archives.js`（グローバル挙動） |
| `config/` | `settings_schema.json`, `settings_data.json` |
| `locales/` | `en.default.json`, `ja.json` |
| `templates/` | 各ページテンプレート（JSON/Liquid） |

## 開発

```bash
# ストアに接続してローカルプレビュー
shopify theme dev --store mystudio-fashion-ec.myshopify.com

# 未公開テーマとしてアップロード
shopify theme push --unpublished --store mystudio-fashion-ec.myshopify.com
```

Theme Check は Shopify MCP `validate_theme` で全ファイル検証済み。

## 進捗

- [x] S0 基盤（トークン / レイアウト / ヘッダー / フッター / カートドロワー / グローバルJS）
- [x] S1 ホーム（全10セクション）
- [x] S2 コレクション / PLP（チップ / フィルタ / ソート / product-card / list-collections）
- [x] S3 商品詳細 / PDP（ギャラリー/在庫バッジ/会員価格/バリアント比較UI/FBT/アコーディオン/セール価格）
- [x] S4 カート（Ajaxドロワー再描画 / 数量・削除 / 送料無料バー / クーポン / カートページ）
- [x] S5 ウィッシュリスト（localStorage / Products・Stylingsタブ / Add・Remove / バッジ）
- [x] S6 スタイリング（metaobject一覧＋詳細 / 使用商品タグ / ホーム接続 / wishlist stylings）
- [x] S7 ジャーナル / 記事（blog一覧＋記事詳細 / ホーム実接続 / 実記事3件）
- [ ] S8 About
- [x] S9 検索（予測サジェスト /search/suggest.json ＋ 検索結果ページ）
- [ ] S10 実データ接続 & 会員価格 & QA
