# data/enriched-ai-tools.json — スキーマ

朝ルーチンが毎朝 1 ファイルを上書きする（過去分は git 履歴に残る）。検証ルールの実体は `scripts/enriched-schema.mjs` にあり、パイプライン（`generate-data.mjs`）とルーチンの自己チェック（`validate-enriched.mjs`）は同じ関数を使う。どちらも、コミット済みの Product Hunt スナップショット `data/product-hunt-daily.json` があれば読み込んで照合する（場所は環境変数 `PH_SNAPSHOT_PATH` で変更可）。ルーチンは main の最新版で、パイプラインは原稿をマージしたコミットに入っている版で照合する（後から届いた更新で失敗しないため。下の「パイプラインでの扱い」）。

## 形は 2 種類

1. **通常の日**: `tools` にツールを並べる（pickup で 2〜5 本）
2. **休止の日**: 使える新作が 2 本に満たない日。`skip` を書き、`tools` は書かない

```json
{
  "date": "2026-09-15", "genre": "ai-tools-top5", "trial": 1,
  "skip": {
    "reason": "使える新作の候補が1本のため休止",
    "fresh_candidates": 1,
    "excluded": [{ "ph_url": "https://www.producthunt.com/products/example", "reason": "invite-only", "note": "招待制" }]
  }
}
```

### 休止の日の扱い

- **スナップショットとの照合**: 当日向けのスナップショット（`forVideoDate` が `date` と同じ）で、新作の範囲に入る AI ツール（`isAI` または `inAiCategory`、`publishedAt` / `listedAfter` から計算し直す）のうち、`skip.excluded` に書かれていないものが **2 本以上あるのに休止なら検証エラー**（その朝のパイプラインは失敗して通知が行く）。エラーには残っている候補の名前が出る。スナップショットが無い・別の日向け・公開日時を持たない古い形式のときは照合できないので、休止は通るが警告を出す
- **`skip.excluded`**: 選定ルールで外した候補（配列、60 件まで）。各要素は `ph_url`（Product Hunt の `/products/` か `/posts/` の URL）・`reason`（`recent` 直近 30 日に紹介済み / `ng` NG パターン（名前が順位・票数を思わせるものを含む）/ `no-site` 公式サイトなし / `invite-only` 招待制 / `not-ai` AI カテゴリ外のキーワード一致）・`note`（任意、40 字以内、文字のフィールドと同じ禁止事項）。`not-ai` を AI カテゴリの投稿（`inAiCategory: true`）に使うとエラー、`recent` なのに履歴の直近 30 日に無いと警告
- **黙って終わらない**: パイプラインは動画を作らずに正常終了するが、GitHub Actions に `::warning::` の注記を出し、ジョブの要約（`$GITHUB_STEP_SUMMARY`）に理由・ルーチンが数えた候補数・スナップショットの件数を書く
- **記録する**: 本番の実行では `performance-history.json` に休止日のエントリを残す（`videoId` などは null、`skip: { reason, fresh_candidates, snapshot_fresh_ai }`）。PDCA の中央値・合計、ハッシュタグやタイトルの学習、試行の開始日には使わない

## 本数と呼び方（モード）

| `source.mode` | 本数 | 並び | 画面・キャプションの呼び方 |
|---|---|---|---|
| `pickup`（公式フィード。**2026-09-15 以降はこれだけ**） | 2〜5（使える新作が 5 本以上なら 5） | おすすめ順 | 「新作AIツール N選」。カードの番号は「1/5」表記、出典行は「Product Hunt 新着」。**順位を思わせる言葉はツール名を含めて使えない**（下の禁止事項） |
| `ranking`（Product Hunt 公式 API。**使わない**） | ちょうど 5 | dailyRank 順 | 「新作AIツール TOP5」。カードに Product Hunt の総合順位を併記。**検証で無効**（`validate-enriched.mjs` と `generate-data.mjs` は環境変数 `PH_ALLOW_RANKING=1` のときだけ受け付け、ワークフローはこれを設定しない。参考用の `npm run dry-run:ranking` だけが設定する）。データを書き換えるだけでは順位の表示に戻らない |

### ranking の順位の検証（API を使う場合だけ。現在は使わない）

- `source.ph_date` は、`date` の朝 07:30 JST 時点で最後に集計が確定した太平洋時間の日（`node scripts/fresh-since.mjs` が表示）と一致すること
- `tools[].ph_rank` は 1 以上の整数・重複なし・動画の並び順で昇順
- **ranking には確定ランキングが必要**: 当日向けのスナップショット（`forVideoDate` が `date`）に、`source.ph_date` の API ランキング（`days[].source === "api"` かつ `status === "final"`）が無ければエラー（スナップショットが無い・別の日向け・フィードだけ・集計中の日しか無い、のどれでも）。その日は pickup にする
- 各ツールについて、確定ランキングの `ph_rank` 番目の投稿の URL が `ph_url` と一致し、その投稿の公開日時（スナップショットの `publishedAt`）が新作の範囲に入っていること

### pickup の照合

- 当日向けのスナップショットがあるとき、各ツールの `ph_url` がスナップショットに載っていること（無ければエラー）と、スナップショットの `publishedAt` か `listedAfter` で新作の範囲に入っていること（範囲外はエラー）。`ph_published_at` / `ph_listed_after` がスナップショットと違うだけなら警告。同じ製品 URL の投稿が複数ある（再ローンチ）ときは、新作の範囲に入る投稿と照合する
- **名前**: `name` はスナップショットの投稿の名前と、意味のある語（`AI` `by` `for` などを除く）が 1 つ以上重なること（`Cognition's SWE-2` → `Cognition SWE-2` は可、別の名前への言い換えはエラー）。スナップショットの名前そのものが順位・票数を思わせる投稿はエラー（除外する。名前を変えて使わない）
- スナップショットが無い・別の日向けのときは照合できないので警告（ルーチンが公式フィードから直接選んだ日）。**この日は `ph_listed_after` を書けない**（`null` 以外はエラー。掲載の記録はスナップショットにしか無い）
- `ph_listed_after` が `date` の朝 07:30 JST より後の時刻ならエラー
- **30 日以内の再掲**: `data/performance-history.json` の直近 30 日（`date` の当日を除く。同じ日の再実行は再掲にならない）に同じ `ph_url` の紹介があるとエラー。履歴が読めないときはこの照合を飛ばす

## 新作の定義

Product Hunt で公開（ローンチ）されたのが、動画の日付 `date` の朝 07:30 JST の時点で進行中の太平洋時間の日の**前日 0:00（PT）以降**であること。朝の時点で必ず直近 48 時間以内（夏時間 39.5 時間・冬時間 38.5 時間以内）に収まる。範囲は `date` から決まるので、ルーチンと、後から走るパイプラインで判定がずれない。公開の時刻そのものはフィードに無いので、公開より後になることのない次の 2 つの時刻の**どちらか**が範囲内なら新作とみなす（`scripts/pacific-time.mjs` の `isNewLaunch`）。

```bash
node scripts/fresh-since.mjs 2026-09-15
# video date 2026-09-15: new launches = launched at or after 2026-09-13T07:00:00.000Z (9/13 00:00 Pacific)
#   a snapshot post counts when publishedAt or listedAfter is at or after this time (its fresh flag)
```

- `ph_published_at`（スナップショットの `publishedAt`）: フィードでは Atom の `published` = **投稿を作った時刻**。公開より後になることはないが、公開の数週間〜数か月前のことが多い（2026-09-15 の実測: Voiskey は 8/31 作成・9/15 公開）。API を使う場合は `featuredAt`（公開の時刻）
- `ph_listed_after`（スナップショットの `listedAfter`）: **この時刻に取った完全なスナップショットにはまだ載っていなかった**という記録。フィードは直近数日の公開分を新しい日から並べ、公開された投稿だけが載るので、その後に公開されたことが分かる。`fetch-product-hunt.mjs` が前回のスナップショット（`listing`）から引き継ぐ。記録が始まる前から載っていた投稿や、フィードから直接読んだ日は `null`
  - 「完全」= AI カテゴリと一般の両方のフィードが 20 件以上取れ、AI カテゴリにだけある投稿が 10 件以上ある（カテゴリの指定が効いていた）取得。そうでない取得では記録の基準（`listing.lastCompleteAt`）を進めないので、取りこぼした投稿が次の取得で新作に見えることはない
  - `listedAfter` が付くのは、記録にすでにある投稿より**上に**新しく出た投稿だけ（フィードは新しい公開日から並ぶ）。下のほうに初めて出た投稿や、記録にある投稿が 1 件も無いフィード（記録のやり直し・ID の形式変更）の投稿には付けない
  - 記録は最後に載ってから 10 日で消える
  - スナップショットの `listingHealth` に記録の状態（`registry`: carried / started / restarted、`thisFetch`: complete / partial、`hoursSinceComplete`、付けた件数、`alerts` / `warnings`）が入る。`alerts` があるとき `fetch-product-hunt.yml` はスナップショットを保存したあとで失敗し、通知が行く

## トップレベル

| キー | 型 | 必須 | 内容 |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | ○ | 動画を投稿する日（JST）。今日と一致しないとパイプラインが止まる |
| `genre` | `"ai-tools-top5"` | ○ | ジャンル試行の識別子 |
| `trial` | number | | 試行番号（1） |
| `skip` | `{ reason, fresh_candidates, excluded? }` | 休止の日だけ | `reason` 4〜80 字、`fresh_candidates` は 0〜1、`excluded` は外した候補と理由。スナップショットと照合される |
| `source.mode` | `"pickup"`（`"ranking"` は使わない） | ○ | 上の表 |
| `source.ph_date` | `YYYY-MM-DD` | ranking のときだけ | ランキングの日付（太平洋時間）。上の「ranking の順位の検証」 |
| `source.snapshot_fetched_at` | ISO 8601 | | 使ったスナップショットの `fetchedAt` |
| `discovery.method` | string | ○ | `rank-pure` / `non-engineer` / `free-first` / `job-theme` / `creator-theme` / `dev-theme`（docs/strategy.md） |
| `discovery.description` | string | | どう選んだかの一行説明 |
| `discovery.sources` | string[] | ○ | 見たページの URL（1 件以上） |
| `discovery.query` / `freshness_hours` | | | 検索語 / 公開からの経過時間 |
| `opening_narration` | string | | 30 字以内。省略時は「新作AIツールをNつ紹介します。」（ranking の場合は「新作AIツール、トップ5を紹介します。」）。短くしてもオープニングは 3 秒以上表示する。pickup で本数（「5つ」「3選」「三つ」など）を言う場合は `tools` の本数と一致しないとエラー |
| `tools` | object[] | 通常の日 ○ | 本数は上の表。配列の順 = 動画の順 |

## tools[]

| キー | 型 | 必須 | 文字数（エラー / 目安） | 内容 |
|---|---|---|---|---|
| `rank` | number | ○ | | 1 からの動画の並び順。配列の位置と一致させる |
| `ph_rank` | number | ranking のとき ○ | | Product Hunt の dailyRank（総合順位）。1 以上・重複なし・昇順 |
| `name` | string | ○ | 1〜40 | ツール名（原文 = スナップショットの名前）。重複不可（全角・半角の違いは同じ扱い）。上の「pickup の照合」で名前も照合する |
| `ph_url` | URL | ○ | | `https://www.producthunt.com/products/<slug>` または `/posts/<slug>`（クエリ文字列なし。スナップショットの `phUrl`）。YouTube 概要欄の出典リンクに使う |
| `ph_published_at` | ISO 8601 | ○ | | スナップショットの `publishedAt`（フィードでは投稿を作った時刻）。`ph_listed_after` と合わせて新作の範囲外ならエラー |
| `ph_listed_after` | ISO 8601 / null | | | スナップショットの `listedAfter`（この時刻の取得ではまだ載っていなかった）。`ph_published_at` が範囲外でも、これが範囲内なら新作。スナップショットの値をそのまま写す |
| `website` | https URL | ○ | 〜200 | 公式サイト（カードとキャプションに「公式 ドメイン」と出る）。Product Hunt の URL・http・認証情報入り・ポート付き・クエリ（`?ref=…`）や `#…` 付き・IP アドレス・punycode（`xn--`）の URL、短縮 URL（bit.ly など）・チャットの招待（discord.gg、t.me など）・フォーム（forms.gle、docs.google.com など）・リンクまとめのプロフィールページ（linktr.ee/名前 など）は不可。ホストが `discovery.sources` のどれにも無いと警告 |
| `tagline_en` | string | | | Product Hunt のタグライン（原文、記録用） |
| `description` | string | ○ | 6〜30 / 10〜24 | 一言（何ができるか） |
| `who` | string | ○ | 2〜18 / 3〜14 | 誰向け（「向け」は付けない。付けると警告が出て、表示では取り除く） |
| `pricing` | enum | ○ | | `free`=無料 / `freemium`=無料プランあり / `trial`=無料トライアルあり / `paid`=有料 / `unknown`=料金は公式サイトで確認 |
| `pricing_note` | string | | 0〜18 | 画面の料金表示を上書きする（例「月$12〜」） |
| `narration` | string | ○ | 30〜65 / 40〜58 | 2 文（フック + 要点）。合計 300 字を超えるとエラー |
| `image_url` | https URL / null | | | ロゴ・スクリーンショット。取れなければ null |

## 文字のフィールドの禁止事項（自動マージ前提の安全策）

`name` / `description` / `who` / `pricing_note` / `narration` / `opening_narration` / `skip.reason` / `skip.excluded[].note` は、**NFKC 正規化（全角英数・全角記号・半角カナを通常の文字にそろえる）をしてから**判定し、次のどれかがあると検証エラーになる。

- URL（`https://` などのスキーム。全角の `ｈｔｔｐｓ：／／` も同じ）、`www.`（全角の `ｗｗｗ．` も同じ）
- ドメイン名: 「英数字.英字で始まる 2 文字以上」の形はすべて（`evil.shop`、`x.ai` など。`v2.10` や `1.5GB` は該当しない）。句点（`evil。com`）・英字以外のラベル（`お名前.com`）・IP アドレス、`evil[.]com` `evil(dot)com` `evil dot com` `evil . com` のような書き換えも同じ（`Unity .NET` のように大文字の技術名は該当しない）。実在のトップレベルドメインにならない技術名（`.js` `.ts` `.jsx` `.tsx` `.mjs` `.cjs` `.NET` で終わる形: `Next.js` `ASP.NET`）は**どのフィールドでも可**。**`name` だけは、そのほかの技術名（`.py` `.rs` `.sh` `.md` などで終わる形）と、公式サイト `website` と同じドメインの製品名（`website` が `https://cal.com/` なら `Cal.com`）も許可**。それ以外のドメインを含む名前、URL、書き換え表記は不可
- `@` で始まるメンション、`#` で始まるハッシュタグ
- 改行・タブなどの制御文字、ゼロ幅スペース・方向制御文字・BOM などの見えない文字（正規化前の値でも判定）
- （`name` 以外）反応を求める文と指示文: かぎ括弧や引用符の直後の「と / って + コメント・DM・返信・メッセージ・送」（「『AI』とコメントして」）、「前の / 上記の / これまでの / 以前の + 指示・命令・プロンプト + を無視 / 忘れ」、`ignore previous instructions` の形。「Slack と Teams のメッセージを要約」のように引用符が無いものは該当しない

pickup モードでは加えて、**順位を思わせる言葉**と **Product Hunt の票数・受賞・人気の主張**が `name` / `description` / `who` / `pricing_note` / `narration` / `opening_narration` にあるとエラーになる（使わない ranking モードでは順位の言葉だけ、name 以外に警告）:

- 順位: `TOP5` `Top-5` `Top:5` `トップ5` `トップ・5`（半角カナ・全角も）`ランキング` `RANKING` `rank 1` `3位` `一位` `首位` `上位5` `ベスト5` `Best 5` `No.1` `ナンバーワン` `ナンバー1`。`上位プラン` `トップページ` のように数字が続かないもの、`デスクトップ3台` `Laptop 4 GB` `三位一体` `位置` `No 2FA` は該当しない
- 票数・受賞・人気: `500票` `1,200 upvotes` `300 votes` `票数` `得票` `投票数` `Product of the Day`（Week / Month / Year も）`Golden Kitty` `ランクイン` `トップに輝く` `トップを獲得` `一番人気` `いちばん人気` `top-rated` `most upvoted`、`Product Hunt`（`プロダクトハント`）のすぐ後の `話題` `人気` `注目` `高評価` `絶賛` `受賞` `首位` `トップ` `急上昇` `票`。`投票をまとめるツール` `人気のSlackと連携` `Product Huntの新着` は該当しない

キャプション生成（`generate-caption.mjs`）でも、改行と見えない文字を念のため取り除く。

## パイプラインでの扱い

- `generate-data.mjs` が検証 → `output/trending-data.json`（`tools` / `meta` / ナレーション）を作る。休止の日は `output/skip.json`（理由・候補数・スナップショット照合の結果）を書き、`pipeline.mjs` は警告と要約を出し、本番なら `record-upload.mjs --skip` で休止日を記録して正常終了する
  - 照合に使うスナップショットは、`data/enriched-ai-tools.json` を最後に変えたコミット（ルーチンの squash merge）に入っている版（`scripts/snapshot.mjs` の `loadSnapshotForRun`）。ルーチンのあと 08:15 までに `fetch-product-hunt.yml` が新しい版をコミットしても、それでは照合しない（候補が増えて休止が矛盾に見える、pickup の候補がフィードから消える、といった誤った失敗を防ぐ）
  - そのコミットがスナップショットも変えていたら、1 つ前の版を使う（ルーチンは取得データを編集しない）
  - `PH_SNAPSHOT_PATH` か `ENRICHED_PATH` を指定したとき（ドライラン・検証モード）、履歴が浅くてそのコミットが見えないとき（`daily-video.yml` は `fetch-depth: 50`）、原稿に未コミットの変更があるときは作業ツリーの版を使い、ログに `NOTE` を出す
- `fetch-tool-images.mjs` が画像を探す: `image_url` → スナップショットの Product Hunt サムネイル（API モードだけ。フィードには無い）→ 公式サイトの og:image
  - 取得は https のみ。リダイレクトは最大 5 回で、毎回 https と公開アドレスを確認する（DNS の答えに 1 つでも非公開アドレスがあれば不可）。IPv4 の localhost・10.x・172.16〜31.x・192.168.x・169.254.x・100.64/10・テスト用アドレスを拒否。IPv6 はグローバルユニキャスト 2000::/3 以外をすべて拒否（::1、IPv4 射影/互換/変換 `::ffff:7f00:1` `::7f00:1` `::ffff:0:7f00:1`、64:ff9b::/96・64:ff9b:1::/48、fc00::/7、fe80::/10、fec0::/10、マルチキャストなど）し、その中でも 2001::/23（Teredo を含む）・2001:db8::/32・2002::/16・3fff::/20 を拒否（IANA IPv6 Special-Purpose Address Registry に基づく）
  - 接続は確認したアドレスに固定する（2 回目の DNS 解決をしないので、確認後に向き先を変えられない）
  - 本文は読み込みながら 5MB（HTML は 1MB）で打ち切る
  - 時間の上限: DNS 解決 1 回・リクエスト 1 回はそれぞれ最大 12 秒（少しずつ送り続けるサーバーでも経過時間で打ち切る）、1 ツールあたり 30 秒、画像の手順全体で 90 秒。`pipeline.mjs` は念のため 150 秒で手順ごと止め、文字だけのカードで続行する
  - PNG / JPEG / WebP / GIF で 120px 以上のものだけ使い、動く GIF は 1 コマ目を静止画にし、動く WebP は使わない。無ければ文字だけのカードにする
- YouTube 概要欄は 5000 バイトに収める。あふれそうなときは、使い方の呼びかけ → 誰向け・料金 → 公式サイト → 一言の順に削り、各ツールの `Product Hunt: <ph_url>` と「出典: Product Hunt」の行は必ず残す
- テンプレートの見本値（「一言」「誰向け」「任意」など）が残っている、などは検証で NG になる
- `record-upload.mjs` が投稿後に `performance-history.json` へ `genre` / `tools[]` / `source` / `discovery` を記録する（YouTube と Instagram のどちらか一方だけ成功した日も記録する）

## 検証用サンプル

- `data/samples/enriched-ai-tools.pickup.sample.json`: pickup（5 本、2026-09-14 向け。9/13 に公開された AI ツール。料金・機能は公式サイトで 2026-09-14 に確認）
- `data/samples/product-hunt-daily.pickup.sample.json`: pickup サンプルの照合用スナップショット（公式フィードの形。post の値は 2026-09-15 に実際のフィードから取ったもので、作成日時が古くても `listedAfter` で新作になる例と、新作でない例を含む）
- `data/samples/enriched-ai-tools.skip.sample.json`: 休止の日
- `data/samples/product-hunt-daily.skip.sample.json`: 休止サンプルの照合用（新作の AI 系が 1 本だけ）
- `data/samples/enriched-ai-tools.sample.json` と `data/samples/product-hunt-daily.sample.json`: 旧 ranking の形（API を使わない決定のため参考用）

```bash
npm run dry-run          # DRY_RUN=1: pickup サンプルで動画とキャプションを作るだけ。投稿・記録はしない（performance-history.json も書き換えない）
npm run dry-run:skip     # 休止サンプル: 動画を作らず、警告と要約だけ出して終わる
npm run dry-run:ranking  # 旧 ranking サンプル（参考用）
```

`daily-video.yml` の検証モード（`dry_run` にチェック、または main 以外のブランチ）は、pickup サンプルと照合用スナップショットで動かす。
