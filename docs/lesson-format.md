# ジャンル試行 #4: AI 仕事術（初心者向けの教育動画）— 1 本の作り方・データ仕様・戻し方

> **オーナー決定（2026-10-22）**: 「なんかAI教育系にしたい、AIを使いこなしたい人への教育どうが」
>
> - 見る人 = **仕事で AI を使いたい初心者**（ChatGPT などを触り始めた会社員）。見たその日に真似できる使い方のコツを**毎朝 1 つ**
> - **YouTube も Instagram も切り替える**（ニュース型はやめる）。YouTube のチャンネル名・説明文は AI 全般なので変えない
> - Instagram は作り直す新しいアカウント **@ai_ground_school**（表示名「AI Ground｜仕事で使えるAI 毎朝1分」。2026-10-22 夕方のオーナー決定で @ai_ground_daily から変更）で出す。作り直しが済むまでは今の Instagram の設定のまま
> - **判断 = IG の保存数とフォロワー増を 2 週間ごとに見る**（YT は登録者の増加と views を別に見る。IG と YT は合算しない）
> - AI Trend Daily（GitHub トレンド）と重ねない。**GitHub のリポジトリは紹介しない**
> - 特定の有料プランを勧めない。誇大な言い方（「誰でも月◯万」「最強」「◯倍速」など）をしない
> - 見せ方は今の型を引き継ぐ: 上半分の図解・下のメイと吹き出し・円の概算
> - 朝ルーチン: [routine-prompt-lesson.md](routine-prompt-lesson.md)。見本: [lesson-preview/](lesson-preview/README.md)

## 1. 1 本の構成（4 枚・1 分以内）

| 枚 | 役割 | 画面の上半分（図） | 下のメイの吹き出し |
|---|---|---|---|
| 1 | **困りごと** — 見る人の「あるある」 | `compare`（前/後）・`steps`・`flow` のどれか | 困っている場面を 1〜2 文で |
| 2 | **そのまま使える頼み方** | **`prompt`**: AI の入力欄の形で、コピーして使える頼み方の文（12〜70 字）が 1 字ずつ打ち込まれ、送信ボタンが光る | どこを自分の仕事に書きかえるか |
| 3 | **答えの例** | **`answer`**: AI の答えの吹き出し（8〜60 字の一例） | どんな形で返ってくるか |
| 4 | **ひとこと注意** | `steps`（やる順）か `compare` | 確かめること・入れてはいけない情報 |

- オープニング: 大きな文字「LESSON」、ラベル「今日のAI仕事術」、見出し（その日の 1 本の名前）
- エンディング: 「毎朝ひとつ、仕事で使える / AI の頼み方」、ナレーション「今日の AI 仕事術でした。保存とフォローで、毎朝ひとつずつ。」（**CTA は保存とフォロー**）
- キャプション: タイトル【AI仕事術】見出し｜日付 #Shorts。本文の**いちばん上に「▼ そのまま使える頼み方（コピーして使えます）」と頼み方の文**（Instagram の「続きを読む」の前に見え、そのままコピーできる = 保存の理由になる）→ スライドの要点 → 注記「※AI の答えは一例で、聞くたびに少し変わります。数字・名前・日付は元の資料で確かめてください。会社の決まりで使えない情報は入れないでください。円の金額は概算です。」→（出典があれば出典）→ 締め → ハッシュタグ（IG `#AI活用 #ChatGPT #生成AI #仕事術 #業務効率化`、YT `#AI活用 #ChatGPT #仕事術 #Shorts`）
- メイ: リポジトリ変数 `MAY_CHARACTER` が `on` なら news / Jev と同じく出る

## 2. ネタの柱（8 本を順に回す）

`pillar` の値と `topic_key` の頭（`mail-polite-decline` など）。同じ柱が 2 日続くと検証が警告する。

| `pillar` | 柱 | 例 |
|---|---|---|
| `ask` | 頼み方の型 | 誰に・何を・どんな形で / 先に質問させる / 見本を見せる |
| `summary` | 要約 | 3 行で / 立場を決めて絞る / 新旧の違いだけ |
| `mail` | メール | 断り / やわらかく直す / 件名 |
| `sheet` | 表計算 | 式を日本語で聞く / 表記をそろえる / 式の意味を聞く |
| `slides` | 資料づくり | 目次から / 1 枚 1 メッセージ |
| `research` | 調べもの | 知らない言葉を例つきで / 比べる点を表に |
| `check` | 確かめ方 | 弱いところを聞き返す / 根拠の資料名を聞く / 誤字を見つける |
| `meeting` | 会議・議事録 | メモを 3 つに分ける / 30 分の議題 |

**選ばないもの**: GitHub・リポジトリ・プログラミングの話（AI Trend Daily と重なる。初心者向けでもない）、特定の有料プラン・課金の話、「稼げる」「副業」の話、特定の AI だけにある機能（どの AI でもそのまま使える頼み方にする。ChatGPT・Gemini・Claude・Copilot のどれに貼っても通じる文）、ニュース（新機能の発表など。この型は「使い方」）。

## 3. データ

### 台帳 `data/ai-lesson-episodes.json`

これまでに出した回をすべて持つ。朝ルーチンは末尾に今日の 1 回を**追記するだけ**（過去の回は書き換えない）。

```json
{
  "episodes": [
    {
      "date": "2026-10-23",
      "genre": "ai-lesson",
      "trial": 4,
      "kind": "lesson",
      "pillar": "ask",
      "topic_key": "ask-three-parts",
      "topic": "AIへの頼み方の基本の型",
      "headline": "頼むときは3つを書く",
      "hook": "AIの答えがいまいちなのは、頼み方のせいかも。",
      "slides": [
        { "heading": "ありきたりな答えになる", "body": "…", "narration": "…", "diagram": { "type": "compare", "items": [{ "note": "よくある頼み方", "label": "説明して" }, { "note": "伝わる頼み方", "label": "誰に・何を・形" }] } },
        { "heading": "そのまま使える頼み方", "body": "…", "narration": "…", "diagram": { "type": "prompt", "items": [{ "label": "社内の新人向けに、経費精算のやり方を、5つの手順の箇条書きで説明してください。" }] } },
        { "heading": "返ってくる答えの例", "body": "…", "narration": "…", "diagram": { "type": "answer", "items": [{ "label": "1. 領収書をもらう　2. 経費の申請画面を開く……" }] } },
        { "heading": "ひとこと注意", "body": "…", "narration": "…", "diagram": { "type": "steps", "items": [{ "label": "誰に向けて" }, { "label": "何を" }, { "label": "どんな形で" }] } }
      ],
      "sources": []
    }
  ]
}
```

### 常備ネタ帳 `data/ai-lesson-stock.json`

台帳と同じ形の回（`date`・`genre`・`trial`・`kind` を除く）を並べたもの。2026-10-22 時点で 21 本（3 週間分、8 本の柱を順に回す並び）。

- 朝ルーチンは、ふだんは `node scripts/jev.mjs next` の `stockNext`（まだ出していない最初の 1 本。前の日と柱が違うものが先）をそのまま今日の回にする
- **今日の回が main に無い・検証に通らない朝は、08:15 の動画生成（`scripts/generate-data.mjs`）がネタ帳の `stockNext` を自動で出す**（Actions に黄色い注記「予備のレッスンで投稿」）。ルーチンの原稿 PR が merge されないまま止まる日が多いので（[routine-merge-miss.md](routine-merge-miss.md)）、教育の型では空白日を作らない。予備で出した回は投稿の記録（`performance-history.json` の `jev.fallback: true`・`jev.topicKey`・`jev.prompt`）に残り、同じ回・同じ文例は二度と出ない
- 残りが 7 本以下になったら、朝ルーチンはネタ帳から取らずに**新しい回を自分で書く**（予備を残すため）。残りが 10 本を切ったら最終レポートに「ネタ帳の補充が必要」と書く。補充はネタ帳に足す PR（朝ルーチンの PR には混ぜない）で、`npm run validate:stock` が通ること
- ネタ帳に足すとき・直すときは `npm run validate:stock`（全部の回を 1 日 1 本ずつ出した想定で検証。ネタ帳の中の重複も見つかる）

### 検証（`node scripts/jev.mjs validate`。NG が 1 つでもあれば main に入れない）

| 何を | ルール |
|---|---|
| `date` / `genre` / `trial` / `kind` | 今日（JST）/ `"ai-lesson"` / `4` / `"lesson"`。日付は昇順で 1 日 1 回。やり直し（`redo_of`）は無い |
| `pillar` / `topic_key` | 上の 8 つのどれか / 英小文字とハイフン、柱の名前で始める（`mail-…`）。**シリーズ全体で 1 回だけ**（投稿の記録にあるキーも不可） |
| 文字数 | `topic` 4〜40 / `headline` 6〜24（過去回と同じ見出しは不可）/ `hook` 8〜40 / スライド `heading` 4〜18・`body` 8〜64・`narration` 30〜95（合計 300 字以内 = 60 秒未満） |
| スライド | **ちょうど 4 枚**。2 枚目の図は `prompt`、3 枚目は `answer`（どちらも `items` 1 つ・`label` だけ。`prompt` 12〜70 字、`answer` 8〜60 字）。1・4 枚目は `steps` / `flow` / `compare`（図が無い・壊れているときは警告だけで、見出し＋本文の表示になる） |
| **同じ文例を 2 回出さない** | 2 枚目の頼み方の文を、台帳のこれまでの回と投稿の記録（予備で出した回も）の全部と比べる。句読点・空白を除いた 2 文字ずつの重なり（Dice 係数）が **0.55 以上なら同じ文例として NG**（言い回しを少し変えただけのものも止まる。ネタ帳の 21 本どうしは最大 0.35） |
| 有料プラン | 「有料プラン」「有料版」「課金」「月額」「サブスク」「ChatGPT Plus」「〇〇 Pro / Max / Team / Advanced …」などは NG（画面・ナレーション・見出しのすべて） |
| 誇大な言い方 | 「誰でも」「月◯万」「稼げる・稼ぐ」「副業」「楽して」「爆速」「神ツール」「最強」「革命」「激変」「魔法の」「一瞬で」「裏技」「知らないと損」「◯倍速」などは NG |
| GitHub | 「GitHub」「リポジトリ」は NG（AI Trend Daily と重ねない） |
| 主張・金額 | news / Jev と同じ（性能の主張は名指し、ドル表記は NG・円の概算） |
| 出典 | 0〜4 件（`role` は `reference` だけ）。機能の説明に公式のヘルプなどを使ったときに書く。`research.checked` は任意 |
| 文字のフィールド | URL・@・#・改行・`<` `>`・ドル表記を入れない |

## 4. 型の切り替え方・戻し方

いずれも `data/content-format.json` の `"format"` を書き換える PR を、**07:30〜08:30 JST を避けて** main に入れる（朝ルーチンが古い型の原稿を書いた後に 08:15 の動画生成が新しい型で動くと、その日の動画が予備になるか止まる）。08:30〜翌 07:30 に入れれば翌朝から新しい型。

- **AI ニュース 1 本解説に戻す**: `"format": "news"`。台帳 `data/ai-news-episodes.json` の続きから（`node scripts/jev.mjs next --series=news`）。手順書は [routine-prompt-news.md](routine-prompt-news.md)
- **Jev 特集に戻す**: `"format": "jev"`（[news-format.md](news-format.md) の §4）
- **lesson に戻す**: `"format": "lesson"`。台帳とネタ帳は消さない（重複チェックに使う）
- どの切り替えでも、sns-hub の台帳（`docs/strategy/genre-experiment.md`）・この子リポの [genre-experiment.md](genre-experiment.md)・sns-hub の CLAUDE.md の表に、終了日と次の試行を書く

## 5. 確かめ方

```bash
npm run dry-run:lesson        # サンプルの回で動画だけ作る（投稿・コミットしない）
npm run validate:stock        # ネタ帳の全部の回
node scripts/jev.mjs validate --series=lesson --no-date-check --file=data/samples/ai-lesson-episodes.sample.json
node --test scripts/ai-lesson.test.mjs
```

Actions では `daily-video.yml` を手動実行し、`dry_run` に印を付け、`sample` で `lesson` を選ぶ（既定）。
