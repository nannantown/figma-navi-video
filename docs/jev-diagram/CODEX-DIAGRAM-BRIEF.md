# Brief for Codex: diagram references for the top half of the daily Jev video (1080x1920)

You make THREE reference pictures with your built-in image generation tool. Claude will rebuild them in code
(Remotion) and fill them every morning from short data, so they must be realistic, buildable screens — flat
shapes, boxes, arrows, number circles — not posters, no illustrations inside the diagram, no photos.

## What the owner said (2026-10-06)
"In the Jev video May (the character) is at the bottom and the title and text are at the top. Can the top be more
like a diagram, easier to understand? May already talks and has a speech bubble. If the top is text too, there is
too much to read. Explain things in order so the viewer gets it at a glance."

So: TOP = a picture that shows the ORDER (step 1 → 2 → 3, input → output, before / after). BOTTOM = May's words.
The diagram uses only a few short words (2–8 Japanese characters per box). It must not repeat the bubble's sentence.

## Input
- `/tmp/jev-diagram-current.png` — today's screen (1080x1920). Keep everything below y 850 exactly as it is
  (May, her speech bubble, the dashed "IG/YT UI" safe-area outlines). Keep the colours: background #0b0b14
  (dark navy), accent purple #8B7CFF → #C9C2FF, white text, the yellow badge style (#FBBF24) for "whose claim".
  Keep the pill "…・10/6" at the top left and the counter "2/4" at the top right.

## The top half to draw (only y 200 .. 850, x 120 .. 960)
- pill + counter row (as now), then a SHORT heading (white, bold gothic, about 56 px — clearly smaller than today's
  heading; it must not dominate), then the diagram fills the rest. Small grey source line at the bottom (as now).
- Fonts: bold gothic / sans-serif only (Noto Sans JP look). NO Mincho, NO serif.
- Text in the diagram at least 36 px; numbers in circles; arrows clearly show the direction.
- Few words. No paragraph text anywhere in the top half.

### Picture 1 — `diagram-steps.png` (使用例回, numbered steps, vertical)
pill "Jev の使い道・10/6", counter "2/4", heading "目次をたどって選ぶ".
Diagram: three numbered steps top to bottom, joined by down arrows:
① 資料を木に整理  ↓  ② 章を選ぶ  ↓  ③ ページを選ぶ
The current step can be highlighted (purple fill), the others outlined.
Bubble text (bottom, unchanged style): "まず資料を、章とページの木の形に"

### Picture 2 — `diagram-flow.png` (説明回, input → Jev → output, horizontal)
pill "Jev って何？・10/7", counter "3/4", heading "答えは「型」で返す".
Diagram: three boxes left to right with right arrows: [質問] → [Jev] → [選択肢＋確信度].
Small grey labels above or under the boxes: 入力 / 選ぶ / 出力. The middle box (Jev) is the accent (purple).
Bubble text: "Jevは文章を書きません"

### Picture 3 — `diagram-compare.png` (説明回, two columns compared)
pill "Jev って何？・10/4", counter "4/4", heading "速さの数字を比べる".
Diagram: two columns side by side. Left column title "TypeSafe" with big "40〜200倍" ; right column title
"第三者の測定" with big "1〜6倍ほど". A yellow badge under the diagram: "TypeSafe の発表".
Bubble text: "実際に測ると差は小さめです"

## Output
- Save the three files in THIS folder as 1080x1920 PNG (resize if the generator gives another size; do not crop content).
- Reply with, per picture: the y range of heading and diagram, box sizes (x, y, w, h), font sizes, colours, arrow style.
Do not edit any other file.
