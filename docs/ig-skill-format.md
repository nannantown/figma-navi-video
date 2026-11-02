# 試行 #5: AI 仕事術を instagram-agent-skill-ja の手順で作る（見せ方だけ・14 日）

> **オーナーの言葉（2026-11-02）**: 「ya-a11y / instagram-agent-skill-ja AI Groundの伸びが良くないのでこのgithubのskillをつかってこのアカウントだけ実験的にこのリポジトリーのやつをもとに運用してみることってできるかな。」
> 窓口の 3 つの確認への答え: ① **見せ方だけ変える**（ネタ「AI 仕事術」と柱 8 本はそのまま）② **YouTube も同じ動画のまま一緒に変わってよい** ③ **今すぐ始め、初回投稿から 14 日で判定**。

## 1. 何を変えて、何を変えないか

| 変える（スキルの手順） | 変えない |
|---|---|
| **つかみ（フック）**: 1 本につき、`hooks.json` の 26 の型から**違う型で 3 案**（話す 1 行 `say` + 最初の画面の文字 `text`）を書き、`hookscore.py` で採点。**50 点以上**の案を使う（ふつうは 1 位）。`say` = `reel.hook`（声）、`text` = `reel.title`（最初のコマの大きな文字） | ネタ（AI 仕事術）・柱 8 本の順番・1 日 1 本・08:15 の投稿 |
| **秒割り**: 声に出す全部の行を `beats.py` に通し、フックの秒・全体の秒・注意の数を記録（声の速さは測った値 1 秒 5.1 かな） | 参考リール型の見た目（`lessonLook: "reel"`）・手順の場面・保存の場面・59 秒の上限 |
| **キャプション**: 1 行目を `craft.captionLead`（30 字まで。「…続きを読む」の前に見える行）に、まん中の「・見出し：本文」の箇条書きを `craft.captionBody`（短い段落 1〜3 つ）に置き換え、`caption.py` で検査（「直す」= FIX は出さない） | 2 行目からの「▼ そのまま使える頼み方」とコピーできる頼み方の文・注記（※AI の答えは一例…）・締め（保存とフォロー）・ハッシュタグ 5 つ・YouTube のタイトル |
| **AI っぽさ消し**: 台本とキャプションを `detect.py` で採点（`humanize.py --report` で決まり文句を探して手で直す） | 有料プランを勧めない・誇大表現なし・GitHub を扱わない・実体験を語らない・同じネタ/文例を 2 回出さない・社外秘の注意（検証は今までどおり全部かかる） |
| | YT のチャンネル名と説明文・IG のプロフィール（`/ig-profile` は採点と書き直し案まで。変えるのはオーナー） |

YouTube は同じ動画・同じキャプション（説明文の 1 行目と段落も同じに変わる）。

## 2. 道具とデータ

- スキル: `.claude/skills/ig-reel` / `ig-caption` / `ig-human` / `ig-profile`（[README](../.claude/skills/README.md)。MIT、ya-a11y/instagram-agent-skill-ja のコミット `0e7ac86`）。Python 3 の標準機能だけ・ネットなし・無料
- 話し方の設定: [ig-voice.md](ig-voice.md)（スキルが読む voice.md の正本）
- まとめて採点する: `node scripts/ig-craft.mjs --stock=<topic_key>` / `--date=YYYY-MM-DD`（台帳の回）。`--write` で点数をその回の `craft.scores` に書く。選んだフックが 50 点未満か、キャプションの判定が「直す」なら終了コード 1

その回の JSON（台帳 `data/ai-lesson-episodes.json` もネタ帳 `data/ai-lesson-stock.json` も同じ形）に `craft` を足す:

```json
"craft": {
  "hooks": [
    { "type": "そのままの質問", "say": "「この返信、きつくない？」と思ったら、5つの手順です。", "text": "その返信、きつい？" },
    { "type": "「やめて」命令", "say": "返信のきつさを、自分だけで直すのはやめましょう。5つの手順です。", "text": "一人で直さない" },
    { "type": "「〜なら見て」", "say": "返信がきつく見えるなら、5つの手順でやわらかく直せます。", "text": "返信をやわらかく" }
  ],
  "captionLead": "きつく読まれる返信を、中身はそのままでやわらかく",
  "captionBody": ["急いで書いた返信。…", "コツは、…"],
  "keywords": ["返信メール", "言い方"],
  "scores": { "tool": "instagram-agent-skill-ja@0e7ac86", "hook": { "type": "…", "score": 71.6, "verdict": "STRONG", "say": "…" }, "hooks": [ … ], "seconds": { "hook": 4.8, "total": 46.8 }, "beatFlags": 8, "caption": { "verdict": "REVIEW", "firstLine": 24, "issues": [ … ] }, "human": { "script": 71, "caption": 55.2 } }
}
```

| 欄 | 決まり（`node scripts/jev.mjs validate` が見る。`craft` がある回だけ） |
|---|---|
| `hooks` | ちょうど 3 案、`type` は 3 つとも違う（`hooks.json` の型の名前）。**`reel.hook` と `reel.title` は、選んだ案の `say` と `text` と同じ**（`reel.hook` の「Nつ」・10〜40 字、`reel.title` の 2〜11 字の決まりもそのまま） |
| `captionLead` | 8〜30 字。有料プラン・誇大表現・GitHub・URL・#・@・改行・ドルは NG |
| `captionBody` | 任意。短い段落 1〜3 つ（各 10〜90 字）。無ければ今までどおりの箇条書き。同じ NG |
| `keywords` | 任意。検索されそうな言葉 0〜3 個（`caption.py --keywords`。キャプションに入っている言葉にする） |
| `scores` | `ig-craft.mjs --write` が書く。手で書かない。言い回しを直したら書き直す |

`craft` が無い回は、今までどおりの作り方で出る（キャプションの 1 行目は「見出し（M/D）」）。

## 3. 記録（14 日の判定で使う）

投稿の記録 `data/performance-history.json` の各回の `jev.craft` に、その回の点数が残る（`tool` / `hookType` / `hookScore` / `hookSeconds` / `caption` / `humanScript` / `humanCaption`。`scripts/jev.mjs` の `craftRecord`）。**`jev.craft` がある回 = この作り方で出た回**。ネタ帳から出た日（`jev.fallback: true`）も同じく残る。

```bash
# この作り方で出た回と点数、IG の保存数・IG views・YT views
jq -r '.videos[] | select(.genre=="ai-lesson") | [.date, .jev.topicKey, (.jev.craft.hookScore // "-"), (.jev.craft.hookType // "旧"), (.instagram.saved // "-"), (.instagram.views // "-"), (.stats.views // "-")] | @tsv' data/performance-history.json
```

## 4. いつから・どう判定するか

- **S = この変更が main に入った翌朝の 08:15 の投稿日**（統合は 07:30〜09:30 JST を避ける）。2026-11-02 の夕方〜夜に入れば **S = 2026-11-03**、判定日 **S + 14 = 2026-11-17**。統合が遅れたら、`jev.craft` が最初に記録された日を S と読み替える
- **判定はオーナー**: S〜S+13 の 14 日の **IG の保存数（合計）と IG のフォロワー増**を、直前の 14 日（S−14〜S−1 = 2026-10-20〜11-02。#4 の今の作り方の投稿は 10-25〜11-02 の 9 本なので 1 本あたりの平均も並べる）と並べる。YT は登録者の増加と views を別に添える（合算しない）。フックの点数と保存数の並びは参考
- 試行 #4（AI 仕事術、S = 2026-10-25）は S−1 で終わり、11-08 に予定していた #4 の判定はこの試行に引き継ぐ（sns-hub の台帳 `docs/strategy/genre-experiment.md`）。データの `trial` は `4` のまま（シリーズの番号。検証が使う）で、この試行の回は `jev.craft` で見分ける

## 5. ネタ帳（2026-11-02 に作り直し）

- まだ出していない 11 本（`mail-soften-reply` 〜 `sheet-explain-formula`）のフック・最初の画面の文字・キャプションをこの手順で作り直し、4 本（`slides-speaker-notes` / `research-list-questions` / `meeting-expected-questions` / `summary-mail-timeline`）を足した。**15 本 = 2026-11-03〜11-17 の分**。頼み方の文・スライドの中身・手順は元のまま（新しい 4 本は新しく書いた）
- 作り直す前の採点（参考）: 今までのつかみ「〇〇は、5つの手順です。」の形は 46 点前後（弱い）。作り直した 15 本の選んだフックは 51.7〜85.2 点
- 朝ルーチンの原稿 PR は 10/27 から merge されずに止まっていて（[routine-merge-miss.md](routine-merge-miss.md)）、毎朝ネタ帳の回が出ている。だから**ネタ帳そのものをこの作り方にした**（朝ルーチンが merge できても、ネタ帳の回を写すので同じ中身になる）
- 11-17 より後の分は、朝ルーチンが新しく書くか（`stockLeft` 7 以下の日）、ネタ帳を足す PR が要る（足す回も `craft` つきで。`npm run validate:stock` と `node --test scripts/ig-craft.test.mjs`）

## 6. 分かっている限界

- キャプションの AI っぽさの点数（36〜64）は、全回同じの注記・締め・ハッシュタグ 5 つと頼み方の文が大半を占めるので上がりにくい。日ごとの比較に使う
- フックの秒数は、場面の間を含めて測った速さで換算した値（実際の声だけより長めに出る）。`beats.py` の「3 秒を超える」の注意はこのため多めに出る
- `caption.py` の「お願いは1つ」の注意は、締めの「保存とフォロー」（オーナーの決まり）で出る。直さない
- `/ig-profile` の採点は、今のプロフィールの文（画面の写し）が要る。worker はログインしないので、今回はしていない。やるときはオーナーがプロフィールの写しを渡し、採点と書き直し案だけを出す（変えるのはオーナー）

## 7. 戻し方

- **見せ方だけ前に戻す**: ネタ帳の各回の `craft` を消す PR（`jq '.lessons |= map(del(.craft))' data/ai-lesson-stock.json`）。キャプションは今までの形に戻る。`reel.hook` / `reel.title` を元の言い回しに戻すなら、このカードの前のコミットのネタ帳から写す
- スキルのフォルダと `scripts/ig-craft.mjs` は残してよい（`craft` の無い回には何もしない）
- どちらも 07:30〜09:30 JST を避けて main に入れる。sns-hub の台帳と CLAUDE.md の表に終了日を書く
