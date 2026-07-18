# ARCHIVES Studio — Shopify Theme 実装スペック

Claude Design「Archives Storefront.dc.html」を Shopify テーマ（Liquid, skeletonから自作）として
忠実実装するためのマスタースペック。サブエージェント（designer / generator / evaluator）はこの
ファイルと `design-reference/` を正典として参照する。

## 正典（Source of Truth）
- `design-reference/Archives-Storefront.html` — 全ビューの元デザイン（SPA形式・`sc-for`/`sc-if`/`{{ }}`）
- `design-reference/tokens/*.css` — デザイントークン（colors/typography/spacing/motion）
- 配色: 白 `#FFFFFF` / オフホワイト `#F9F9F8` / チャコール `#111111` / ヘアライン境界 `#E5E5E5`
- 書体: Archivo（display/UI）+ IBM Plex Mono（label/SKU）。uppercase・ワイドトラッキングが署名。
- グリッド: 1px ヘアライン罫線グリッド（KITH/Union系）。角丸ほぼ無し。ホバーで画像スロースケール。

## デザイン→Shopify マッピング原則
- `sc-for list="{{ x }}"` → Liquid `{% for %}`（実データ）または section blocks（静的）
- `sc-if value="{{ x }}"` → Liquid `{% if %}`
- `{{ placeholder }}` → Liquid オブジェクト/section settings
- SPAのクライアントルーター → Shopify のテンプレート分割（各ビュー = テンプレート）
- カート状態共有 → Shopify Ajax Cart API（`/cart.js`）+ theme.js
- 会員価格 → 顧客タグ `member` + variant/product metafield（表示出し分け）
- ウィッシュリスト → localStorage（アプリ無し、商品/スタイリング両対応）

## テンプレート対応表
| ビュー | テンプレート | セクション |
|---|---|---|
| TOP | `templates/index.json` | hero, category-tiles, featured-collection, ranking, staff-styling, brand-intro, styling-hints, journal, instagram, pillars |
| コレクション/PLP | `templates/collection.json` | main-collection（チップ/フィルタ/並替/カード） |
| PDP | `templates/product.json` | main-product（ギャラリー/在庫バッジ/会員/バリエーション/FBT/アコーディオン/レビュー） |
| カート | `templates/cart.json` | main-cart |
| ジャーナル | `templates/blog.json` | main-blog |
| 記事 | `templates/article.json` | main-article |
| スタイリング一覧 | `templates/page.styling.json` | styling-list |
| スタイリング詳細 | metaobject / `page.styling-detail` | styling-detail |
| About | `templates/page.about.json` | about-hero, about-chapters, about-stats, about-timeline, about-materials, about-values, about-cta |
| ウィッシュリスト | `templates/page.wishlist.json` | wishlist |
| 検索 | `templates/search.json` | main-search |
| 共通 | `layout/theme.liquid` | announcement-bar, header, footer, snippets/cart-drawer |

## スプリント計画
- **S0 基盤**: トークンCSS資産、theme.liquid、告知バー、ヘッダー（ナビ/ドロップダウン/検索/モバイル
  メニュー/wishlist・cartバッジ）、フッター（4カラム/ニュースレター/コピーライト）、カートドロワーの器
  （送料無料バー/クーポン/小計）、グローバルJS（検索トグル・モバイルメニュー・カートドロワー・
  wishlist localStorage・Ajaxカート土台）、config/locales、git初期化+GitHub push、未公開テーマpush。
- **S1 ホーム**: index の全セクションを静的（section settings/blocks）で実装。
- **S2 コレクション/PLP**: 商品カードsnippet、カテゴリチップ、フィルタ（価格/サイズ/カラー/タグ）、
  並替、Quick add、wishlistトグル。
- **S3 PDP**: ギャラリー、在庫連動バッジ、会員セグメント切替、バリエーション比較（在庫行CLSなし）、
  FBT横スクロール、数量、レビュー星、再入荷通知、詳細アコーディオン、関連商品。
- **S4 カート**: ドロワー＆カートページをAjaxで機能化。送料無料プログレスバー、クーポン
  （WINTER10=10%OFF / ARCHIVE5=5%OFF）、数量/削除/小計。
- **S5 ウィッシュリスト**: localStorage商品/スタイリング、タブ切替、ヘッダーバッジ。
- **S6 スタイリング**: 一覧＋詳細（使用商品タグ付き）。静的→後でmetaobject。
- **S7 ジャーナル/記事**: blog + article。
- **S8 About**: スクロール駆動（animation-timeline: view()）章立て、@supportsフォールバック。
- **S9 検索**: 予測検索/検索結果。
- **S10 実データ接続 & 会員価格metafield & レスポンシブQA & 仕上げ**。

## 受け入れ基準（全スプリント共通）
- `mcp__shopify-dev-mcp__validate_theme`（Theme Check）でエラー0。
- 各ブレークポイント（≤1000 / ≤760 / ≤560px）でレイアウト崩れなし。
- デザイントークンのみ使用（ハードコード色/サイズを新規に増やさない）。
- evaluator が Playwright でプレビューURLを操作し、当該スプリント機能の動作を確認。

## 持ち越し課題（Known issues）
- **[S4で対応] quick-add後のカートドロワーがサーバー初期描画のまま**: `archives.js` の `bindQuickAdd()` は `/cart/add.js` 後にバッジ更新＋ドロワー開のみで、ドロワー本文（明細/小計/送料バー）を再描画しない。S4で cart-drawer をセクション化し Section Rendering API（`?sections=`）で再取得・差し替える。
- チップリンク先コレクション（`/collections/apparel` 等）は未作成のため404。実コレクション作成はマーチャンダイジング側タスク（S10 or 手動）。
- ストアには Shopify サンプル商品13点が存在（スノーボード等）。S3 PDP はこの実商品で検証可能。最終的なブランド商材への差し替えはS10/手動。

## 反映フロー
- git: `main` へ直接コミットせず feature ブランチ→PR（CLAUDE.md準拠）。初回のみ scaffold を main に。
- Shopify: `shopify theme push --unpublished`（未公開）。公開はユーザー手動。
- ストア: `mystudio-fashion-ec.myshopify.com` / GitHub: `github.com/Hiroto-Terai/mystudio-fashon-ec`
