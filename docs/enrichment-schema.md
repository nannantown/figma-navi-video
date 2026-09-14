# data/enriched-ai-tools.json — スキーマ

朝ルーチンが毎朝 1 ファイルを上書きする（過去分は git 履歴に残る）。検証ルールの実体は `scripts/enriched-schema.mjs` にあり、パイプライン（`generate-data.mjs`）とルーチンの自己チェック（`validate-enriched.mjs`）は同じ関数を使う。

## トップレベル

| キー | 型 | 必須 | 内容 |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | ○ | 動画を投稿する日（JST）。今日と一致しないとパイプラインが止まる |
| `genre` | `"ai-tools-top5"` | ○ | ジャンル試行の識別子 |
| `trial` | number | | 試行番号（1） |
| `source.mode` | `"ranking"` / `"pickup"` | ○ | `ranking` = Product Hunt 公式 API の確定ランキング順、`pickup` = 新着からの厳選（投票順ではない） |
| `source.ph_date` | `YYYY-MM-DD` | ranking のとき ○ | ランキングの日付（米国太平洋時間） |
| `source.snapshot_fetched_at` | ISO 8601 | | 使ったスナップショットの `fetchedAt` |
| `discovery.method` | string | ○ | `rank-pure` / `non-engineer` / `free-first` / `job-theme` / `creator-theme` / `dev-theme`（docs/strategy.md） |
| `discovery.description` | string | | どう選んだかの一行説明 |
| `discovery.sources` | string[] | ○ | 見たページの URL（1 件以上） |
| `discovery.query` / `freshness_hours` | | | 検索語 / 公開からの経過時間 |
| `opening_narration` | string | | 30 字以内。省略時は「新作AIツール、トップ5を紹介します。」 |
| `tools` | object[] | ○ | **ちょうど 5 件**。配列の順 = 動画の順 |

## tools[]

| キー | 型 | 必須 | 文字数（エラー / 目安） | 内容 |
|---|---|---|---|---|
| `rank` | number | ○ | | 1〜5。配列の位置と一致させる |
| `ph_rank` | number | ranking のとき ○ | | Product Hunt の dailyRank |
| `name` | string | ○ | 1〜40 | ツール名（原文）。5 件の中で重複不可 |
| `ph_url` | URL | ○ | | `https://www.producthunt.com/products/<slug>` |
| `website` | https URL | ○ | | 公式サイト（Product Hunt のリダイレクト URL は不可） |
| `tagline_en` | string | | | Product Hunt のタグライン（原文、記録用） |
| `description` | string | ○ | 6〜30 / 10〜24 | 一言（何ができるか） |
| `who` | string | ○ | 2〜18 / 3〜14 | 誰向け（「向け」は付けない） |
| `pricing` | enum | ○ | | `free`=無料 / `freemium`=無料プランあり / `trial`=無料トライアルあり / `paid`=有料 / `unknown`=料金は公式サイトで確認 |
| `pricing_note` | string | | 0〜18 | 画面の料金表示を上書きする（例「月$12〜」） |
| `narration` | string | ○ | 30〜65 / 40〜58 | 2 文（フック + 要点）。5 件合計 300 字を超えるとエラー |
| `image_url` | https URL / null | | | ロゴ・スクリーンショット。取れなければ null |

## パイプラインでの扱い

- `generate-data.mjs` が検証 → `output/trending-data.json`（`tools` / `meta` / ナレーション）を作る
- `fetch-tool-images.mjs` が画像を探す: `image_url` → スナップショットの Product Hunt サムネイル（API モード）→ 公式サイトの og:image。PNG / JPEG / WebP / GIF で 120px 以上のものだけ使い、無ければ文字だけのカードにする
- `record-upload.mjs` が投稿後に `performance-history.json` へ `genre` / `tools[]` / `source` / `discovery` を記録する

## 検証用サンプル

`data/samples/enriched-ai-tools.sample.json`（2026-09-13 のランキングから作成。料金・機能は公式サイトで 2026-09-14 に確認）。

```bash
npm run dry-run   # DRY_RUN=1: サンプルで動画とキャプションを作るだけ。投稿・記録はしない
```
