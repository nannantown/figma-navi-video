# Jev 動画の上半分を図解にする（2026-10-06 オーナー依頼）

オーナー: 「上も文字だと、吹き出しと合わせて読む量が多い。図解みたいに、順序立てて分かりやすく」。
上 = 図で見せる、下 = メイが言葉で話す、に役割を分けた。

| ファイル | 中身 |
|---|---|
| `CODEX-DIAGRAM-BRIEF.md` | Codex への指示書（`codex exec -m gpt-5.5`、入力は当時の画面 `../may-preview/layout/layout-ref.png`） |
| `diagram-steps.jpg` / `diagram-flow.jpg` / `diagram-compare.jpg` | Codex が描いた参考画像（手順 / 流れ / 比べる）。1080×1920 |
| `codex-last.txt` | Codex の寸法メモ |

コードでの再現は `src/components/JevDiagram.tsx`（`JevSlideCard.tsx` が `diagram` のあるスライドで本文の代わりに描く）。
データは朝ルーチンが書く `slides[].diagram`（`docs/routine-prompt-jev.md` / `docs/jev-format.md`）、検証は `scripts/jev.mjs` の `diagramProblems`。
図が無い・壊れた日は警告だけ出して、そのスライドは従来の見出し＋本文で描く（投稿は止まらない）。

見本から変えた点: 手順の図は「今の手順」の光る位置がナレーションの進みに合わせて 1→2→3 と動く（毎朝の動画では話す順番が図の順番）。
光る箱の色は白文字が読めるよう見本より濃い紫（`#5B4BE0 → #8B7CFF`）。比べる図は右の列が強調（見てほしい方を右に）。
