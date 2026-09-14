# data/enriched-ai-tools.json — スキーマ

朝ルーチンが毎朝 1 ファイルを上書きする（過去分は git 履歴に残る）。検証ルールの実体は `scripts/enriched-schema.mjs` にあり、パイプライン（`generate-data.mjs`）とルーチンの自己チェック（`validate-enriched.mjs`）は同じ関数を使う。どちらも、コミット済みの Product Hunt スナップショット `data/product-hunt-daily.json` があれば読み込んで照合する（場所は環境変数 `PH_SNAPSHOT_PATH` で変更可）。

## 形は 2 種類

1. **通常の日**: `tools` にツールを並べる（本数はモード次第）
2. **休止の日**: `pickup` で使える新作が 2 本に満たない日。`skip` を書き、`tools` は書かない

```json
{ "date": "2026-09-15", "genre": "ai-tools-top5", "trial": 1, "skip": { "reason": "新作の候補が1本のため休止", "fresh_candidates": 1 } }
```

### 休止の日の扱い

- **スナップショットとの照合**: 当日向けのスナップショット（`forVideoDate` が `date` と同じ）で、新作の範囲に入る AI ツール（`isAI` または `inAiCategory`、公開日時から計算し直す）が **2 本以上あるのに休止なら検証エラー**（その朝のパイプラインは失敗して通知が行く）。スナップショットが無い・別の日向け・公開日時を持たない古い形式のときは照合できないので、休止は通るが警告を出す
- **黙って終わらない**: パイプラインは動画を作らずに正常終了するが、GitHub Actions に `::warning::` の注記を出し、ジョブの要約（`$GITHUB_STEP_SUMMARY`）に理由・ルーチンが数えた候補数・スナップショットの件数を書く
- **記録する**: 本番の実行では `performance-history.json` に休止日のエントリを残す（`videoId` などは null、`skip: { reason, fresh_candidates, snapshot_fresh_ai }`）。PDCA の中央値・合計、ハッシュタグやタイトルの学習、試行の開始日には使わない

## 本数と呼び方（モード）

| `source.mode` | 本数 | 並び | 画面・キャプションの呼び方 |
|---|---|---|---|
| `ranking`（Product Hunt 公式 API） | ちょうど 5 | dailyRank 順 | 「新作AIツール TOP5」。カードに Product Hunt の総合順位（例「総合9位」）を併記 |
| `pickup`（公式フィード） | 2〜5 | おすすめ順 | 「新作AIツール N選」。カードの番号は「1/3」表記。**順位を思わせる言葉はツール名を含めて使えない**（下の禁止事項） |

### ranking の順位の検証

- `source.ph_date` は、`date` の朝 07:30 JST 時点で最後に集計が確定した太平洋時間の日（`node scripts/fresh-since.mjs` が表示）と一致すること
- `tools[].ph_rank` は 1 以上の整数・重複なし・動画の並び順で昇順
- スナップショットに `source.ph_date` の API ランキング（`days[].source === "api"`）があれば、各ツールの `ph_rank` の投稿の URL が `ph_url` と一致すること（違えばエラー）。無ければ警告

## 新作の定義

`tools[].ph_published_at`（Product Hunt 上の公開日時）が、動画の日付 `date` の朝 07:30 JST の時点で進行中の太平洋時間の日の**前日 0:00（PT）以降**であること。朝の時点で必ず直近 48 時間以内（夏時間 39.5 時間・冬時間 38.5 時間以内）に収まる。範囲は `date` から決まるので、ルーチンと、後から走るパイプラインで判定がずれない。

```bash
node scripts/fresh-since.mjs 2026-09-15
# video date 2026-09-15: new launches = published at or after 2026-09-13T07:00:00.000Z (9/13 00:00 Pacific)
# ranking mode: source.ph_date must be 2026-09-13 (that day's final Product Hunt ranking)
```

- API（ranking）: `publishedAt` = `featuredAt`（公開された時刻）
- フィード（pickup）: `publishedAt` = Atom の `published`。投稿を作った時刻で、公開より後になることはないため、古いツールが紛れ込むことはない（逆に、何日も前に作られて今日公開されたツールは外れる）

## トップレベル

| キー | 型 | 必須 | 内容 |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | ○ | 動画を投稿する日（JST）。今日と一致しないとパイプラインが止まる |
| `genre` | `"ai-tools-top5"` | ○ | ジャンル試行の識別子 |
| `trial` | number | | 試行番号（1） |
| `skip` | `{ reason, fresh_candidates }` | 休止の日だけ | `reason` 4〜80 字、`fresh_candidates` は 0〜1。スナップショットと照合される |
| `source.mode` | `"ranking"` / `"pickup"` | ○ | 上の表 |
| `source.ph_date` | `YYYY-MM-DD` | ranking のとき ○ | ランキングの日付（太平洋時間）。上の「ranking の順位の検証」 |
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
| `ph_rank` | number | ranking のとき ○ | | Product Hunt の dailyRank（総合順位）。1 以上・重複なし・昇順 |
| `name` | string | ○ | 1〜40 | ツール名（原文）。重複不可（全角・半角の違いは同じ扱い） |
| `ph_url` | URL | ○ | | `https://www.producthunt.com/products/<slug>` または `/posts/<slug>`（クエリ文字列なし。スナップショットの `phUrl`）。YouTube 概要欄の出典リンクに使う |
| `ph_published_at` | ISO 8601 | ○ | | Product Hunt 上の公開日時（スナップショットの `publishedAt`）。新作の範囲外はエラー |
| `website` | https URL | ○ | 〜200 | 公式サイト。Product Hunt の URL・http・認証情報入りの URL は不可 |
| `tagline_en` | string | | | Product Hunt のタグライン（原文、記録用） |
| `description` | string | ○ | 6〜30 / 10〜24 | 一言（何ができるか） |
| `who` | string | ○ | 2〜18 / 3〜14 | 誰向け（「向け」は付けない） |
| `pricing` | enum | ○ | | `free`=無料 / `freemium`=無料プランあり / `trial`=無料トライアルあり / `paid`=有料 / `unknown`=料金は公式サイトで確認 |
| `pricing_note` | string | | 0〜18 | 画面の料金表示を上書きする（例「月$12〜」） |
| `narration` | string | ○ | 30〜65 / 40〜58 | 2 文（フック + 要点）。合計 300 字を超えるとエラー |
| `image_url` | https URL / null | | | ロゴ・スクリーンショット。取れなければ null |

## 文字のフィールドの禁止事項（自動マージ前提の安全策）

`name` / `description` / `who` / `pricing_note` / `narration` / `opening_narration` / `skip.reason` は、**NFKC 正規化（全角英数・全角記号・半角カナを通常の文字にそろえる）をしてから**判定し、次のどれかがあると検証エラーになる。

- URL（`https://` などのスキーム。全角の `ｈｔｔｐｓ：／／` も同じ）、`www.`（全角の `ｗｗｗ．` も同じ）
- ドメイン名: 「英数字.英字で始まる 2 文字以上」の形はすべて（`evil.shop`、`x.ai` など。`v2.10` や `1.5GB` は該当しない）。`evil[.]com` `evil(dot)com` のような書き換えも同じ。**`name` だけは製品名の `Node.js` `X.ai` のような形を許可**（URL と書き換え表記は不可）
- `@` で始まるメンション、`#` で始まるハッシュタグ
- 改行・タブなどの制御文字、ゼロ幅スペース・方向制御文字・BOM などの見えない文字（正規化前の値でも判定）

pickup モードでは加えて、**順位を思わせる言葉**が `name` / `description` / `who` / `pricing_note` / `narration` / `opening_narration` にあるとエラーになる（ranking モードでは name 以外に警告）: `TOP5` `Top-5` `トップ5`（半角カナも）`ランキング` `3位` `一位` `首位` `上位5` `ベスト5` `No.1`。`上位プラン` `トップページ` のように数字が続かないものは該当しない。

キャプション生成（`generate-caption.mjs`）でも、改行と見えない文字を念のため取り除く。

## パイプラインでの扱い

- `generate-data.mjs` が検証 → `output/trending-data.json`（`tools` / `meta` / ナレーション）を作る。休止の日は `output/skip.json`（理由・候補数・スナップショット照合の結果）を書き、`pipeline.mjs` は警告と要約を出し、本番なら `record-upload.mjs --skip` で休止日を記録して正常終了する
- `fetch-tool-images.mjs` が画像を探す: `image_url` → スナップショットの Product Hunt サムネイル（API モード）→ 公式サイトの og:image
  - 取得は https のみ。リダイレクトは最大 5 回で、毎回 https と公開アドレスを確認する（DNS の答えに 1 つでも非公開アドレスがあれば不可）。IPv4 の localhost・10.x・172.16〜31.x・192.168.x・169.254.x・100.64/10・テスト用アドレス、IPv6 の ::1・IPv4 射影/互換（`::ffff:7f00:1` `::7f00:1`）・64:ff9b::/32・2002::/16・2001::/32・2001:db8::/32・fc00::/7・fe80::/10・fec0::/10・マルチキャストを拒否
  - 接続は確認したアドレスに固定する（2 回目の DNS 解決をしないので、確認後に向き先を変えられない）
  - 本文は読み込みながら 5MB（HTML は 1MB）で打ち切る
  - PNG / JPEG / WebP / GIF で 120px 以上のものだけ使い、動く GIF は 1 コマ目を静止画にし、動く WebP は使わない。無ければ文字だけのカードにする
- YouTube 概要欄は 5000 バイトに収める。あふれそうなときは、使い方の呼びかけ → 誰向け・料金 → 公式サイト → 一言の順に削り、各ツールの `Product Hunt: <ph_url>` と「出典: Product Hunt」の行は必ず残す
- テンプレートの見本値（「一言」「誰向け」「任意」など）が残っている、などは検証で NG になる
- `record-upload.mjs` が投稿後に `performance-history.json` へ `genre` / `tools[]` / `source` / `discovery` を記録する（YouTube と Instagram のどちらか一方だけ成功した日も記録する）

## 検証用サンプル

- `data/samples/enriched-ai-tools.sample.json`: ranking（2026-09-13 のランキングから作成。料金・機能は公式サイトで 2026-09-14 に確認）
- `data/samples/enriched-ai-tools.pickup.sample.json`: pickup（3 本）
- `data/samples/enriched-ai-tools.skip.sample.json`: 休止の日

```bash
npm run dry-run   # DRY_RUN=1: ranking サンプルで動画とキャプションを作るだけ。投稿・記録はしない
```
