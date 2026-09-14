# data/enriched-ai-tools.json — スキーマ

朝ルーチンが毎朝 1 ファイルを上書きする（過去分は git 履歴に残る）。検証ルールの実体は `scripts/enriched-schema.mjs` にあり、パイプライン（`generate-data.mjs`）とルーチンの自己チェック（`validate-enriched.mjs`）は同じ関数を使う。

## 形は 2 種類

1. **通常の日**: `tools` にツールを並べる（本数はモード次第）
2. **休止の日**: `pickup` で使える新作が 2 本に満たない日。`skip` を書き、`tools` は書かない。パイプラインはエラーにせず、動画を作らずに終わる

```json
{ "date": "2026-09-15", "genre": "ai-tools-top5", "trial": 1, "skip": { "reason": "新作の候補が1本のため休止", "fresh_candidates": 1 } }
```

## 本数と呼び方（モード）

| `source.mode` | 本数 | 並び | 画面・キャプションの呼び方 |
|---|---|---|---|
| `ranking`（Product Hunt 公式 API） | ちょうど 5 | dailyRank 順 | 「新作AIツール TOP5」。カードに Product Hunt の総合順位（例「総合9位」）を併記 |
| `pickup`（公式フィード） | 2〜5 | おすすめ順 | 「新作AIツール N選」。カードの番号は「1/3」表記。**TOP・トップ・ランキング・◯位 は使わない**（検証エラー） |

## 新作の定義

`tools[].ph_published_at`（Product Hunt 上の公開日時）が、動画の日付 `date` の朝 07:30 JST の時点で進行中の太平洋時間の日の**前日 0:00（PT）以降**であること。朝の時点で必ず直近 48 時間以内（夏時間 39.5 時間・冬時間 38.5 時間以内）に収まる。範囲は `date` から決まるので、ルーチンと、後から走るパイプラインで判定がずれない。

```bash
node scripts/fresh-since.mjs 2026-09-15
# video date 2026-09-15: new launches = published at or after 2026-09-13T07:00:00.000Z (9/13 00:00 Pacific)
```

- API（ranking）: `publishedAt` = `featuredAt`（公開された時刻）
- フィード（pickup）: `publishedAt` = Atom の `published`。投稿を作った時刻で、公開より後になることはないため、古いツールが紛れ込むことはない（逆に、何日も前に作られて今日公開されたツールは外れる）

## トップレベル

| キー | 型 | 必須 | 内容 |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | ○ | 動画を投稿する日（JST）。今日と一致しないとパイプラインが止まる |
| `genre` | `"ai-tools-top5"` | ○ | ジャンル試行の識別子 |
| `trial` | number | | 試行番号（1） |
| `skip` | `{ reason, fresh_candidates }` | 休止の日だけ | `reason` 4〜80 字、`fresh_candidates` は 0〜1 |
| `source.mode` | `"ranking"` / `"pickup"` | ○ | 上の表 |
| `source.ph_date` | `YYYY-MM-DD` | ranking のとき ○ | ランキングの日付（太平洋時間） |
| `source.snapshot_fetched_at` | ISO 8601 | | 使ったスナップショットの `fetchedAt` |
| `discovery.method` | string | ○ | `rank-pure` / `non-engineer` / `free-first` / `job-theme` / `creator-theme` / `dev-theme`（docs/strategy.md） |
| `discovery.description` | string | | どう選んだかの一行説明 |
| `discovery.sources` | string[] | ○ | 見たページの URL（1 件以上） |
| `discovery.query` / `freshness_hours` | | | 検索語 / 公開からの経過時間 |
| `opening_narration` | string | | 30 字以内。省略時は ranking「新作AIツール、トップ5を紹介します。」/ pickup「新作AIツールをNつ紹介します。」。短くしてもオープニングは 3 秒以上表示する |
| `tools` | object[] | 通常の日 ○ | 本数は上の表。配列の順 = 動画の順 |

## tools[]

| キー | 型 | 必須 | 文字数（エラー / 目安） | 内容 |
|---|---|---|---|---|
| `rank` | number | ○ | | 1 からの動画の並び順。配列の位置と一致させる |
| `ph_rank` | number | ranking のとき ○ | | Product Hunt の dailyRank（総合順位） |
| `name` | string | ○ | 1〜40 | ツール名（原文）。5 件の中で重複不可 |
| `ph_url` | URL | ○ | | `https://www.producthunt.com/products/<slug>` または `/posts/<slug>`（クエリ文字列なし。スナップショットの `phUrl`）。YouTube 概要欄の出典リンクに使う |
| `ph_published_at` | ISO 8601 | ○ | | Product Hunt 上の公開日時（スナップショットの `publishedAt`）。新作の範囲外はエラー |
| `website` | https URL | ○ | | 公式サイト。Product Hunt の URL・http・認証情報入りの URL は不可 |
| `tagline_en` | string | | | Product Hunt のタグライン（原文、記録用） |
| `description` | string | ○ | 6〜30 / 10〜24 | 一言（何ができるか） |
| `who` | string | ○ | 2〜18 / 3〜14 | 誰向け（「向け」は付けない） |
| `pricing` | enum | ○ | | `free`=無料 / `freemium`=無料プランあり / `trial`=無料トライアルあり / `paid`=有料 / `unknown`=料金は公式サイトで確認 |
| `pricing_note` | string | | 0〜18 | 画面の料金表示を上書きする（例「月$12〜」） |
| `narration` | string | ○ | 30〜65 / 40〜58 | 2 文（フック + 要点）。合計 300 字を超えるとエラー |
| `image_url` | https URL / null | | | ロゴ・スクリーンショット。取れなければ null |

## 文字のフィールドの禁止事項（自動マージ前提の安全策）

`name` / `description` / `who` / `pricing_note` / `narration` / `opening_narration` / `skip.reason` には、次のどれかがあると検証エラーになる。

- URL（`https://` などのスキーム、`www.`）
- ドメイン名（`example.com` など。`name` だけはツール名に含まれる場合があるので可）
- `@` で始まるメンション、`#` で始まるハッシュタグ（全角の ＠・＃ も含む）
- 改行・タブなどの制御文字
- ゼロ幅スペース・方向制御文字・BOM などの見えない文字

キャプション生成（`generate-caption.mjs`）でも、改行と見えない文字を念のため取り除く。

## パイプラインでの扱い

- `generate-data.mjs` が検証 → `output/trending-data.json`（`tools` / `meta` / ナレーション）を作る。休止の日は `output/skip.json` を書き、`pipeline.mjs` はそこで正常終了する
- `fetch-tool-images.mjs` が画像を探す: `image_url` → スナップショットの Product Hunt サムネイル（API モード）→ 公式サイトの og:image。取得は https のみで、リダイレクト先も https かつ公開アドレス（localhost・10.x・172.16〜31.x・192.168.x・169.254.x・::1 などは不可）、本文は読み込みながら 5MB（HTML は 1MB）で打ち切る。PNG / JPEG / WebP / GIF で 120px 以上のものだけ使い、動く GIF は 1 コマ目を静止画にし、動く WebP は使わない。無ければ文字だけのカードにする
- テンプレートの見本値（「一言」「誰向け」「任意」など）が残っている、などは検証で NG になる
- `record-upload.mjs` が投稿後に `performance-history.json` へ `genre` / `tools[]` / `source` / `discovery` を記録する（YouTube と Instagram のどちらか一方だけ成功した日も記録する）

## 検証用サンプル

- `data/samples/enriched-ai-tools.sample.json`: ranking（2026-09-13 のランキングから作成。料金・機能は公式サイトで 2026-09-14 に確認）
- `data/samples/enriched-ai-tools.pickup.sample.json`: pickup（3 本）

```bash
npm run dry-run   # DRY_RUN=1: ranking サンプルで動画とキャプションを作るだけ。投稿・記録はしない
```
