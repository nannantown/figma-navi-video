# 朝ルーチンの入口 — まず今の型を確かめる

> このファイルが朝ルーチン（Claude Routine, 07:30 JST）の**入口**。クラウド側のルーチン設定は「main の `docs/routine-prompt.md` を読んで従う」だけにしてある。手順の本文は型ごとの別ファイルにあり、どちらを使うかは `data/content-format.json` の 1 か所で決まる。

1. `data/content-format.json` を読み、`"format"` の値を確かめる。
2. 値に合った手順書を**最初から最後まで**読み、その手順どおりに進める（このファイルに書かれていないことは、その手順書に従う）。

| `format` | 型 | 手順書 |
|---|---|---|
| `lesson` | ジャンル試行 #4「AI 仕事術」（2026-10-22 オーナー決定。仕事で AI を使いたい初心者向けの教育動画。毎朝 1 つ、困りごと → そのまま使える頼み方 → 答えの例 → 注意） | [routine-prompt-lesson.md](routine-prompt-lesson.md) |
| `news` | ジャンル試行 #3「AI ニュース 1 本解説」（2026-10-13 オーナー決定。2026-10-22 に #4 へ切り替えて休止中・戻せる） | [routine-prompt-news.md](routine-prompt-news.md) |
| `jev` | ジャンル試行 #2「Jev の毎朝ニュース」（2026-10-13 オーナーの停止指示で終了。休止中・戻せる） | [routine-prompt-jev.md](routine-prompt-jev.md) |
| `pickup` | ジャンル試行 #1「新作AIツール N選」（Product Hunt 公式フィード。2026-09-23 で休止中） | [routine-prompt-pickup.md](routine-prompt-pickup.md) |

- ファイルが無い・値がどれでもないときは、何も書かずに中止し、最終レポートにそう書く（08:15 の動画生成も同じ値で動くので、推測で選ぶと食い違う）
- 型の切り替え方・戻し方は [lesson-format.md](lesson-format.md) の「型の切り替え方・戻し方」
