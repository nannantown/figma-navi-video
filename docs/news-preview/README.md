# AI ニュース 1 本解説 — サンプルのプレビュー（2026-10-13）

`data/samples/ai-news-episodes.sample.json`（**架空**の Example AI の回。会社・製品・数字は作り物）を、本番と同じ Remotion の構成 `AiToolsTop5` で静止画にしたもの。メイあり（`MAY_CHARACTER=on` 相当）。

| ファイル | 中身 |
|---|---|
| `sample-frames.jpg` | 上段: オープニング / 1 枚目（flow の図）/ 2 枚目（steps の図と出典ラベル）。下段: 3 枚目（compare の図・円の金額）/ 4 枚目（図なし → 見出し＋本文の従来表示）/ エンディング（各 360×640） |
| `slide1-flow.png` | 1 枚目の原寸（1080×1920） |

作り方: 作業環境から音声合成（Edge TTS）の WebSocket が通らなかったため、`npm run dry-run:news` の動画は書き出せていない。代わりに `generate-data.mjs`（`CONTENT_FORMAT=news`）で本番と同じ `trending-data.json` を作り、音声は代表的な秒数（オープニング 2.8 秒・各スライド 8.5 秒・エンディング 4 秒）の無音ファイル、吹き出しの字幕は 3 文字ずつ均等に区切った仮のタイミングで `npx remotion still` した。**吹き出しの区切りが単語の途中で切れて見えるのは仮のタイミングのせい**で、本番は音声合成の単語区切り（`speechPages.ts`）で切る。

動画の見た目やサンプルの文面を変えたら撮り直す。
