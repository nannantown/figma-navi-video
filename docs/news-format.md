# ジャンル試行 #3: AI ニュース 1 本解説 — データ仕様・話題の選び方・戻し方

> **2026-10-22 オーナー決定でジャンル試行 #4「AI 仕事術」（初心者向けの教育動画）へ切り替え、この型は休止**（仕組み・台帳 `data/ai-news-episodes.json` は残す。`"format": "news"` で戻せる）。今の型は [lesson-format.md](lesson-format.md)。以下は休止中の記録。

> **オーナー決定（2026-10-13）**: 「jev関係の投稿をやめて、やっぱり AIのジェネラルなニュースにしようか。」
>
> - 1 本 = **その日いちばん大きい AI ニュース 1 つを、順を追って説明する**（N選の並べ型ではない）
> - 見せ方は Jev 特集から引き継ぐ: 上半分の図解（2026-10-09 から入った図解の仕組み）、金額は円の概算（キャプションに「円の金額は概算です」、ドル表記は検証で止める）、下のキャラクター（先輩のメイ）と吹き出し
> - IG / YT のプロフィール文・チャンネル説明文は変えない（もともと AI 全般のまま）
> - **AI Trend Daily（GitHub トレンド TOP5）と話題を重ねない**。IG 版 @ai_trend_daily_ は一切変更しない
> - Jev 特集（試行 #2）は**オーナーの停止指示で終了**（= 試行 #2 の終了条件）。仕組みは休止で残し、戻せる
> - 終了条件・判定: 14 日ごとの判定はしない（Jev と同じく PDCA は IG views 中央値・IG 保存数・IG フォロワー増、YT views は別に見る）。オーナーは切り替え後の朝の動画を IG / YT で見て「AI 全般のニュース 1 本を、図解で順を追って分かりやすく説明しているか」で判断する
> - 朝ルーチンの手順: [routine-prompt-news.md](routine-prompt-news.md)。プレビュー: [news-preview/](news-preview/README.md)

## 1. 仕組み（どこが切り替わるか）

Jev 特集の仕組み（`scripts/jev.mjs`）に「シリーズ」を 1 つ足しただけで、検証・図解・円の検査・キャプション・メイ・投稿記録はそのまま共通。違いは `scripts/jev.mjs` の `SERIES.news` にまとまっている。

| 場所 | news 型のとき |
|---|---|
| `data/content-format.json` | `"format": "news"`（切り替えスイッチ。これ 1 か所） |
| `docs/routine-prompt.md` | スイッチを読んで [routine-prompt-news.md](routine-prompt-news.md) に進む |
| 台帳 | `data/ai-news-episodes.json`（Jev の `data/jev-episodes.json` とは別。Jev の台帳は消さない） |
| `scripts/generate-data.mjs` / `assert-data-date.mjs` / `deliver-jev.mjs` | スイッチに合わせて news の台帳を読む（`node scripts/jev.mjs …` も同じ。`--series=jev|news` で明示もできる） |
| 動画 | Jev と同じ枠（オープニング → スライド → エンディング）とスライドのカード（`JevSlideCard`）。オープニングの大きな文字は `NEWS`、ラベルは「今日のAIニュース」、ヘッダーは「今日のAIニュース・10/14」。`trending-data.json` の `meta.mode` は Jev と同じ `"jev"`（= 1 つの話題をスライドで説明するカードの型の名前）、`meta.genre` が `"ai-news"` |
| キャプション | タイトル【今日のAIニュース】見出し｜日付 #Shorts。本文 = 見出し・スライドの要点・注記「※性能・速度・料金などの数字は、断りのない限り各社の発表です（第三者の検証は出典を明記）。円の金額は概算です。」・出典（媒体・公開日・URL）・締めの一文・ハッシュタグ（`#Jev` は付かない） |
| 記録 | `performance-history.json` に `genre: "ai-news"` / `trial: 3`、`titleTemplate: "ai-news"`、話題と出典は `jev` 欄（欄の名前は Jev 時代のまま共通） |
| メイ | リポジトリ変数 `MAY_CHARACTER` が `on` なら Jev と同じく出る |
| Jev の X 取得（`fetch-jev-x.yml`） | **自動で止まる**: このワークフローは main の `content-format` が `jev` の日だけ取得・コミットする（それ以外の日は何もせず緑で終わる）。cron の起動そのものも止めたいときは `gh workflow disable fetch-jev-x.yml --repo nannantown/figma-navi-video`（オーナー / 司令塔の操作）。X のログイン情報（Secrets `TWITTER_AUTH_TOKEN` / `TWITTER_CT0`）は Jev に戻す日まで残してよい（使われない）。完全にやめるなら 2 つの Secrets を削除 |
| Product Hunt の取得（`fetch-product-hunt.yml`） | 止めていない（pickup 型に戻す日のため。Jev のときと同じ扱い） |

**切り替えを main に入れる時間帯**: **07:30〜08:30 JST は避ける**（朝ルーチンが古い型の原稿を書いた後に 08:15 の動画生成が新しい型で動くと、その日は投稿されない）。**08:30 以降〜翌 07:30 まで**に入れれば、翌朝からそのまま新しい型になる。

## 2. 話題の選び方（会社が決めたこと）

- **出どころ**: 主な AI 企業の公式発表（OpenAI、Anthropic、Google / Google DeepMind、Meta、Microsoft、Apple、Amazon、NVIDIA、Mistral AI、xAI、日本の会社）と、無料で読めるテック媒体（Reuters、The Verge、TechCrunch、Ars Technica、Engadget、ITmedia、Impress Watch など）。WebSearch で直近 2 日を見る。有料 API・有料記事・ログインが要るページは使わない
- **いちばん大きい = 次の順で重い**: ①新しい（主役の出典が 3 日以内。48 時間以内を優先）②影響が大きい（一般の人が使う AI、仕事・暮らしが変わる話、日本で使える話）③複数の大手が報じている ④1 分で順を追って説明できる
- **AI Trend Daily と重ねない確認**: 毎朝、公開ファイル https://raw.githubusercontent.com/nannantown/github-trending-video/main/data/performance-history.json の直近 7 日の `projects`（紹介した GitHub のリポジトリ）を読み、そのリポジトリが主題の話は選ばない。加えて GitHub のページは主役の出典にできない（検証）
- **いちばん大きい話が使用済み**なら次に大きい新しい話を選ぶ（小さい話でも投稿しないよりよい。日付の条件は緩めない）
- **書き方**: 要点は自分の言葉で。記事の文を訳して写さない。引用は短く「」で、誰の言葉かを添える
- **選ばない**: GitHub のリポジトリ・GitHub トレンドの話題（AI Trend Daily と重なる）、噂・リーク・未発表、株価・投資額だけの話、有料記事でしか読めない話、これまでの回と同じ出来事
- **事実確認**: 主役の出典（`role: "news"`）は会社の公式発表かそれを最初に報じた記事。もう 1 つ別のサイトで同じ事実を確かめる。数字・日付・料金は出典に書いてあるものだけ。会社の主張（倍率・最速・精度など）は「〇〇によると」と名指しで書く

## 3. データ仕様 — `data/ai-news-episodes.json`

これまでに出した回をすべて持つ**台帳**。朝ルーチンは末尾に今日の 1 回を**追記するだけ**（過去の回は書き換えない）。重複チェックはこの台帳と `performance-history.json` に対して行う。

```json
{
  "episodes": [
    {
      "date": "2026-10-14",
      "genre": "ai-news",
      "trial": 3,
      "kind": "news",
      "topic_key": "openai-gpt6-release",
      "topic": "OpenAI が新しいモデルを公開",
      "headline": "6〜24 字の見出し",
      "hook": "8〜40 字の冒頭の一言",
      "slides": [
        { "heading": "何が発表された？", "body": "…", "narration": "…", "diagram": { "type": "flow", "items": [{ "note": "入力", "label": "質問" }, { "note": "AI", "label": "GPT-6" }, { "note": "出力", "label": "答え" }] } },
        { "heading": "どれくらい速い？", "body": "…", "claim_source": "OpenAI の発表", "narration": "OpenAI によると、…" }
      ],
      "sources": [
        { "url": "https://…", "title": "ページの題名", "outlet": "OpenAI", "published_at": "2026-10-13", "role": "news", "official": true },
        { "url": "https://…", "title": "ページの題名", "outlet": "The Verge", "published_at": "2026-10-13", "role": "reference", "official": false }
      ],
      "research": { "checked": ["https://…"], "note": "" }
    }
  ]
}
```

| フィールド | ルール（検証 `node scripts/jev.mjs validate` で機械的に確かめる） |
|---|---|
| `date` / `genre` / `trial` / `kind` | 今日（JST）/ `"ai-news"` / `3` / `"news"`。`stage`・`stage_episode` は無い。日付は昇順で 1 日 1 回 |
| `topic_key` | 英小文字とハイフン（`会社-中身-出来事` の 3 区切り以上、`会社`・`中身` はハイフンなしの 1 語。例 `openai-gpt6-release`）。**シリーズ全体で 1 回だけ**（投稿の記録にあるキーも不可）。**先頭 2 区切り（`会社-中身`）が直近 7 日の回と同じなら同じ話として NG**（別の媒体・別の slug・言い換えた見出しで同じ話を出さないため） |
| `follow_up_of`（続報だけ） | 直近 7 日の同じ `会社-中身` の回の日付。`research.new_fact`（前の回に無い新しい事実を 1 文、8〜120 字）とセットで必須。先頭 2 区切りが違う回は指せない |
| `headline` | 6〜24 字。過去回と同じ見出しは不可。主張（倍率・最速など）は入れない |
| `hook` | 8〜40 字。冒頭のナレーション。主張があれば名指し |
| `slides` | 3〜4 枚、順を追って（何が起きた → どう動く → いつ・いくら・誰が → 注意）。`heading` 4〜18 字 / `body` 8〜64 字 / `narration` 30〜95 字（合計 300 字以内 = 60 秒未満） |
| `diagram` | Jev と同じ（`steps` / `flow` / `compare`、文字数の上限、主張には `claim_source`）。**図が無い・壊れたスライドは従来の見出し＋本文で描く**（警告だけ、投稿は止まらない） |
| `claim_source` | 画面の文字に主張があるスライドに必須（例「OpenAI の発表」）。主張として数える言い回しは Jev の分（倍率・最速・精度◯%・「間違えない」など）に、一般ニュースでよく出る「〇〇を上回る」「〜を超える性能」「〜より高性能」「最高水準」「世界初」「業界初」「史上最〜」「最大級」「最強」「人間並み」「博士レベル」「1位」「首位」「No.1」「SOTA」を足したもの（Jev 側の「数学的」は「数学的な保証」「数学的に正しい」などの形だけ）。ナレーションでは同じ文に「OpenAI によると」「Meta社によると」と名指しする |
| `sources` | 1〜8 件・**2 サイト以上**（同じサイトのサブドメインと GitHub は 1 つに数えない）・**`official: false`（独立した媒体）が 1 件以上**。開けないページ（有料の壁・ログイン）は使わない。`role: "news"` が 1 件以上で、その公開日が**今日から 3 日以内**。**出典の URL はどの役割でもシリーズ全体で 1 回だけ**（過去の回の台帳と投稿記録の両方と照合。www・追跡用クエリ・`#`・末尾 `/` の違いは同じ URL）。**GitHub（github.com・github.io・githubusercontent.com）は `news` にできない**（AI Trend Daily と重ねない。`reference` なら可）。`role: "usecase"` は使わない。`official` は true / false（その会社自身の発表なら true） |
| `research.checked` | その日に見た URL（1〜30 件。円の換算に使った為替のページも） |
| `redo_of` | **使えない**（1 日遅れのニュースは古い。前日が出なかった日も今日のニュースを書く） |

文字のフィールド（topic・headline・hook・スライド・図・claim_source）には URL・@・#・改行・`<` `>`・ドル表記を入れない（検証で NG）。

## 4. 型の切り替え方・戻し方

いずれも `data/content-format.json` の `"format"` を書き換える PR を、**07:30〜08:30 JST を避けて** main に入れる。翌朝のルーチンと 08:15 の動画生成がそのまま新しい型で動く。

- **Jev 特集に戻す**: `"format": "jev"`。台帳 `data/jev-episodes.json` の続きから再開する（`node scripts/jev.mjs next --series=jev`）。X の取得は `jev` の日に自動で再開する（`gh workflow disable` していたら `gh workflow enable fetch-jev-x.yml --repo nannantown/figma-navi-video`。Secrets を消していたら登録し直す）
- **新作AIツール N選に戻す**: `"format": "pickup"`。手順は [jev-format.md](jev-format.md) の §5
- **news に戻す**: `"format": "news"`。台帳 `data/ai-news-episodes.json` は消さない（重複チェックに使う）
- どの切り替えでも、sns-hub の台帳（`docs/strategy/genre-experiment.md`）・この子リポの [genre-experiment.md](genre-experiment.md)・sns-hub の CLAUDE.md の表に、終了日と次の試行を書く

## 5. 検証のしかた

```bash
npm run dry-run:news   # サンプル（架空の Example AI の回）で動画だけ作る。投稿もコミットもしない
node scripts/jev.mjs validate --no-date-check --file=data/samples/ai-news-episodes.sample.json --series=news
node --test scripts/ai-news.test.mjs
```

Actions では `daily-video.yml` を手動実行し、`dry_run` に印を付け、`sample` で `news` を選ぶ（既定）。
