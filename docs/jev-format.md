# ジャンル試行 #2: Jev の毎朝ニュース — シリーズ計画・データ仕様・戻し方

> **オーナー決定（2026-09-23）**: 「jev について調べてそれらの投稿をストップするまで続けよう。毎朝新鮮な情報を調べてだして」。
> **オーナー追加指示（2026-09-23）**: 最初は誰も Jev を知らないので、いきなりニュースを流さない。**第1段階「Jev とは何か」→ 第2段階「こんなふうに使える」→ 第3段階「毎朝の新情報（無い日は解説）」**の順に出す。
>
> - 終了条件: **オーナーの停止指示**（14 日ごとの判定はしない。PDCA は IG views 中央値・IG 保存数・IG フォロワー増で読む。YT views は別に見る）
> - 試行 #1（新作AIツール N選）は「オーナー決定により 2026-09-23 で終了、判定なし」
> - 朝ルーチンの手順: [routine-prompt-jev.md](routine-prompt-jev.md)。戦略と台帳: [strategy.md](strategy.md) / [genre-experiment.md](genre-experiment.md)

## 1. Jev の基本情報（2026-09-23 に一次情報で確認）

| 事実 | 出典 |
|---|---|
| 開発は TypeSafe AI（米サンフランシスコ）。2024 年創業（公式ページには創業年の記載なし。heise・Wikipedia・GitHub org の作成日 2024-05-28 と一致） | https://typesafe.ai/ ・ https://www.heise.de/en/news/AI-model-Jev-to-make-machines-decide-faster-11457071.html |
| CEO Diogo Almeida は InstructGPT 論文（arXiv 2203.02155）の共著者。共同創業者は Erik Gafni（CTO）、Sasha Sheng（COO） | https://arxiv.org/abs/2203.02155 ・ https://typesafe.ai/team |
| 2026-09-15 にアーリーアクセスで公開。同日に DCVC 主導の 4,000 万ドルのシード調達を発表（Business Wire。本文は 403 で未読、Yahoo Finance の転載で確認） | https://typesafe.ai/blog/introducing-system-one-models-and-jev ・ https://finance.yahoo.com/technology/ai/articles/typesafe-ai-emerges-stealth-40m-190000776.html |
| LLM ではない「System One」型。文章を生成せず、型付きの値（Choice / Score など）と確率・確信度を 1 回で返す。使うのはソフトウェア | 公式ブログ・https://docs.typesafe.ai/llms.txt |
| 用途: 公式は分類・振り分け・抽出、ゲーム（Doom・Wikiracing のデモ）。「ロボット・シミュレーション」は公式には無く、MindStudio（第三者）が運転シミュ・ドローンのデモとして紹介 | 公式ブログ・https://www.mindstudio.ai/blog/jev-system-one-model-launch |
| **会社の主張**: LLM より 40〜200 倍速い（トップページは「193.6x faster」）、最大 444.6 倍安い（自社評価 evals.typesafe.ai）、「数学的にハルシネーションも型エラーも起こさない」 | 公式ブログ・https://evals.typesafe.ai/ |
| 料金: 入力 100 万トークン $0.042、出力無料（独立した料金ページは無く、トップページとブログに記載） | 公式ブログ・https://typesafe.ai/ |
| **第三者の測定**: LiteLLM（09-20）は振り分けで Haiku 4.5 比 5.43 倍速・費用 96% 減。Cherry Creek News（09-21）のまとめでは実測 1.16〜6 倍、フィッシング判定では Haiku に劣る結果も。The Register（09-16）は「0%」は実測ではなく、型は守っても誤った選択肢は返し得ると指摘 | https://docs.litellm.ai/blog/jev-auto-router-benchmark ・ https://thecherrycreeknews.com/jev-typesafe-benchmark-checked-explainer-wave-cherry_creek/ ・ https://www.theregister.com/ai-and-ml/2026/09/16/typesafe-ai-debuts-model-for-machines-that-plays-doom/5296711 |

**TypeSafe のものではない紛らわしいサイト**（出典にしない。検証でも弾く）: jevtypesafeai.com / jevfast.com / jevbooks.com。
**毎朝見る公式の場所**: https://typesafe.ai/ ・公式ブログ・ https://docs.typesafe.ai/llms.txt ・ https://docs.typesafe.ai/models.md ・ SDK 変更履歴（https://docs.typesafe.ai/sdk/python/changelog.md 、 https://docs.typesafe.ai/sdk/javascript/changelog.md ）・ https://evals.typesafe.ai/ ・ https://github.com/typesafe-ai ・ X https://x.com/typesafeai （ログインなしで見られる範囲だけ）。

## 2. シリーズ計画（回の一覧）

### 第1段階「Jev とは何か」— 6 回、この順番で固定

| 回 | topic_key | テーマ | 必ず入れること |
|---|---|---|---|
| 1-1 | `intro-what-is-jev` | Jev って何？ 誰が作った、どんな AI か | 9/15 公開、TypeSafe AI、CEO が InstructGPT 論文の共著者 |
| 1-2 | `intro-no-text` | 文章を書かない AI — 答えを「型」と確信度で返す | 選択肢・数値＋確信度、使うのは人ではなくソフト |
| 1-3 | `intro-vs-llm` | ChatGPT のような LLM と何が違う？ 得意と不得意 | 向く仕事（分類・振り分け）と向かない仕事（文章づくり） |
| 1-4 | `intro-speed-claim` | 「速い」と言う理由 — TypeSafe の主張と第三者の測定 | 40〜200 倍は **TypeSafe によると**。第三者の測定（数倍）を併記 |
| 1-5 | `intro-cost-claim` | 料金のしくみ — 入力 100 万トークン $0.042 を計算してみる | 身近な単位での計算例。「最大 444 倍安い」は **TypeSafe によると** |
| 1-6 | `intro-no-hallucination-claim` | 「ハルシネーションしない」の意味と限界 | 型は守られても選択を間違えることはある（The Register の指摘） |

### 第2段階「こんなふうに使える」— 使用例を 5 回（最低 3 回）

実例 1 つにつき 1 回。**実例の出典（ポスト・ブログ・記事の URL と公開日）を必ず data に残す**（`role: "usecase"`）。同じ実例（同じ URL）は 2 回使えない。
集め先は**無料で見られる公開情報だけ**: X の公開ポスト（ログインなしで見られるもの・検索エンジン経由）、開発者ブログ、GitHub、Hacker News / Reddit、テック記事。**X の有料 API は使わない**（使わないと集まらない状況になったら、その日は解説回にしてレポートに書き、オーナーに相談する）。

2026-09-23 時点の候補（ルーチンは当日に一次情報を開いて確かめてから使う）:

| 候補 | 出典 |
|---|---|
| AI の振り分け係（ルーター）— LiteLLM の比較 | https://docs.litellm.ai/blog/jev-auto-router-benchmark （09-20） |
| エージェントの部品にする — LangChain のハーネス | https://www.langchain.com/blog/building-a-harness-with-jev （09-17） |
| ゲームの AI（Doom・Wikiracing のデモ） | 公式ブログ（09-15） |
| 運転シミュ・ドローン・Minecraft のデモ | https://www.mindstudio.ai/blog/jev-system-one-model-launch （09-18） |
| アプリの判断を速くした開発者の声（Vercel で 5〜18 倍速い、など） | https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/ （09-18） |
| 苦手な例: フィッシング判定で Haiku に劣った測定 | https://thecherrycreeknews.com/jev-typesafe-benchmark-checked-explainer-wave-cherry_creek/ （09-21） |

### 第3段階「毎朝の新情報」— オーナーの停止指示まで

- **新情報の回（`kind: "news"`）**: 前回の Jev 投稿の日以降に公開された情報（公式ブログ・X・ドキュメント・料金・変更履歴、主要テック媒体、開発者の実例や評判）から、まだ出していないものを 1 つ。
- **解説回（`kind: "explainer"`）**: 新しい情報が無い日。作り話はせず、既出の事実の掘り下げ（仕組み、LLM との違い、使いどころ、料金の計算例、開発者の試用例など）。**なぜ新情報が無かったか**を `research.no_news_reason` に書く。解説のネタ（`topic_key`）も過去回と重ねない。

### 段階を切り替える条件（`node scripts/jev.mjs next` がそのまま出す）

| いまの状態 | 次の回 |
|---|---|
| 第1段階の 6 テーマのうち未投稿がある | 第1段階の**次のテーマ**（順番固定） |
| 第1段階が全部済み、使用例の回が 5 回未満 | 第2段階の次の回 |
| 使用例の回が 3 回以上 5 回未満で、**その日に未使用の使用例が見つからなかった** | 第3段階へ進んでよい（`research.stage2_exhausted_reason` に理由を書く）。一度第3段階に入ったら戻らない |
| 使用例の回が 5 回に達した | 第3段階 |

この条件は `scripts/jev.mjs` の検証（`validateEpisodes`）が機械的に確かめる。順番を飛ばした回・回数（`stage_episode`）の数え間違い・理由のない早期移行は、朝ルーチンの検証でも 08:15 の動画生成でもエラーになる。予定では 1-1 が 2026-09-24（main 統合がその朝のルーチンに間に合った場合）、第1段階が 6 日、第2段階が 5 日で、第3段階は 10 月上旬から。

## 3. データ仕様 — `data/jev-episodes.json`

これまでに出した回をすべて持つ**台帳**。朝ルーチンは末尾に今日の 1 回を**追記するだけ**（過去の回は書き換えない）。重複チェックはこの台帳に対して行う。

```json
{
  "episodes": [
    {
      "date": "2026-09-24",
      "genre": "jev-news",
      "trial": 2,
      "stage": 1,
      "stage_episode": 1,
      "kind": "intro",
      "topic_key": "intro-what-is-jev",
      "topic": "Jev とは何か・誰が作ったか",
      "headline": "文章を書かないAI「Jev」とは",
      "hook": "ChatGPTとは別物の新しいAI、Jevを知っていますか？",
      "slides": [
        { "heading": "…", "body": "…", "narration": "…" },
        { "heading": "速さは会社の主張", "body": "…40〜200倍…", "claim_source": "TypeSafe の発表", "narration": "TypeSafeによると、…" }
      ],
      "sources": [
        { "url": "https://…", "title": "ページの題名", "outlet": "TechCrunch", "published_at": "2026-09-18", "role": "reference", "official": false }
      ],
      "research": { "checked": ["https://…"], "no_news_reason": "（解説回だけ）", "stage2_exhausted_reason": "（使用例 3 回以上で第3段階へ早く進む日だけ）", "note": "" }
    }
  ]
}
```

| フィールド | ルール |
|---|---|
| `stage` / `stage_episode` / `kind` | 段階（1〜3）、その段階の何回目か、種類（第1段階 `intro`、第2段階 `usecase`、第3段階 `news` か `explainer`）。`node scripts/jev.mjs next` の出力どおりに書く |
| `topic_key` | 英小文字とハイフン。**シリーズ全体で 1 回だけ**。第1段階は上の表の値 |
| `headline` | 6〜24 字。画面・タイトルに出る。過去回と同じ見出しは不可。**速度・料金の倍率や「ハルシネーションしない」は見出しに入れない** |
| `hook` | 8〜40 字。冒頭のナレーション |
| `slides` | 3〜4 枚。`heading` 4〜18 字 / `body` 8〜64 字 / `narration` 30〜95 字（合計 300 字以内 = 60 秒未満） |
| `claim_source` | 画面の文字に会社の主張（倍率・「間違えない」など）があるスライドに必須。画面に黄色のラベルで出る（例「TypeSafe の発表」「LiteLLM の検証」） |
| `sources` | 1〜8 件。`role`: その日の新情報 = `news`、その日の使用例 = `usecase`、裏付け = `reference`。**`news` と `usecase` の URL はシリーズ全体で 1 回だけ**（www・`?…`・`#…`・末尾の `/`・twitter.com / x.com の違いは同じ URL とみなす）。`reference` は再掲してよい。`published_at` は `YYYY-MM-DD`（日付の無い参考ページだけ `null` 可）。`official: true` は TypeSafe 自身のサイト（typesafe.ai とそのサブドメイン、github.com/typesafe-ai、x.com/typesafeai、LinkedIn の会社ページ）だけ |
| `research.checked` | その日に見た URL（1〜30 件） |

**会社の主張のルール**（検証で機械的に確かめる）: ナレーション・冒頭で「〜倍」「ハルシネーション」「型エラー」「数学的」「間違えない」などを含む文は、**同じ文の中に**「TypeSafe によると」「〜の検証では」「〜と発表」「〜と説明しています」などの**誰の話か**を入れる。キャプションには毎回「※速度・料金・精度の数字や『ハルシネーションしない』は、断りのない限り開発元 TypeSafe AI の発表です」が入り、出典の URL と公開日が並ぶ。

## 4. 仕組み（どこが切り替わるか）

| 場所 | Jev 型のとき |
|---|---|
| `data/content-format.json` | `"format": "jev"`（切り替えスイッチ。これ 1 か所） |
| `docs/routine-prompt.md` | スイッチを読んで [routine-prompt-jev.md](routine-prompt-jev.md) に進む（pickup なら [routine-prompt-pickup.md](routine-prompt-pickup.md)） |
| `scripts/generate-data.mjs` | 台帳の今日の回を検証し、`output/trending-data.json` を作る（`scripts/jev.mjs`） |
| 動画 | 同じ枠（オープニング → カード → エンディング）。カードが `JevSlideCard` に変わる。IG のカバーは 1 枚目のカード（日替わりの見出し）になる — 「IG サムネイルを日ごとに変える」カードのカバー位置の計算（1 枚目のカードの中）がそのまま効く |
| キャプション | `scripts/jev.mjs` の `buildJevCaptions`（タイトル【Jev入門】【Jev活用例】【Jev最新】【Jev解説】、出典一覧、主張の注記、ハッシュタグ） |
| 記録 | `performance-history.json` に `genre: "jev-news"` / `trial: 2` と `jev`（段階・回・種類・話題・出典）。IG のフォロワー数を毎日 `account.igFollowers` に記録（`fetch-stats.mjs`） |
| Product Hunt の取得（`fetch-product-hunt.yml`） | **止めていない**（1 日 3 回の取得と記録は続く）。pickup に戻した日にすぐ「新作」の判定ができるようにするため。止めたいときは `gh workflow disable fetch-product-hunt.yml --repo nannantown/figma-navi-video` |

## 5. pickup 型（新作AIツール N選）への戻し方

1. `data/content-format.json` の `"format"` を `"pickup"` にする PR を出して main に入れる（**朝 7:30〜8:30 の間は避ける**）。これだけで、翌朝のルーチンは [routine-prompt-pickup.md](routine-prompt-pickup.md) に従い、08:15 の動画生成は `data/enriched-ai-tools.json` を読む。
2. `fetch-product-hunt.yml` を止めていた場合は `gh workflow enable fetch-product-hunt.yml --repo nannantown/figma-navi-video`（翌朝の分の判定には、前日 14:43 の取得が要る）。
3. 台帳（[genre-experiment.md](genre-experiment.md) と sns-hub の `docs/strategy/genre-experiment.md`）に、試行 #2 の終了日と次の試行を書く。`data/jev-episodes.json` は消さない（再開したときの重複チェックに使う）。
4. 確認: `CONTENT_FORMAT=pickup npm run dry-run`、または Actions の `daily-video.yml` を `dry_run: true`・`sample: pickup` で手動実行。

Jev に戻すときは逆（`"format": "jev"`）。台帳は続きから再開する（`node scripts/jev.mjs next`）。

## 6. 検証のしかた

```bash
npm run dry-run:jev-intro     # 説明回（第1段階 1 回目）のサンプルで動画だけ作る
npm run dry-run:jev-usecase   # 使用例回（第2段階 1 回目）のサンプル
node scripts/jev.mjs validate --no-date-check --file=data/samples/jev-episodes.usecase.sample.json
```

Actions では `daily-video.yml` を手動実行し、`dry_run` に印を付け、`sample` で `jev-intro` / `jev-usecase` / `pickup` を選ぶ（投稿もコミットもしない。main 以外のブランチでは印が無くても検証扱い）。

## 7. IG プロフィール文・YT チャンネル説明文の差し替え案（反映はオーナー）

### Instagram プロフィール（150 字以内）

```
AIモデル「Jev」の最新情報を毎朝1分で。
ChatGPTとは違う“文章を書かないAI”を、
仕組み→使い道→毎日のニュースの順にやさしく解説。
数字は出典つき・会社の主張は主張として紹介します。
保存してあとで見返してね。
```

### YouTube チャンネル説明文（HAL- AI情報カフェ。名前は変えない）

```
毎朝、AIモデル「Jev」の最新情報を1分のショート動画でお届けします。

Jev は、米TypeSafe AIが2026年9月に公開した新しいタイプのAIです。ChatGPTのように文章を書くのではなく、ソフトウェアのために「答え」と「確信度」を返します。

このチャンネルでは
・Jev とは何か（仕組み・LLMとの違い・料金）
・実際の使い道（開発者の実例）
・毎朝の新しい発表やニュース
を、エンジニアでなくても分かる言葉で紹介します。

速度・料金・精度の数字は、開発元の発表か第三者の検証かを必ず明記し、出典のURLを概要欄に載せています。
```
