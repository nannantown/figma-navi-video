# Brief for Codex: layout reference for 先輩のメイ in the daily vertical video (1080x1920)

You make ONE layout reference picture with your image generation tool. Claude will then rebuild it in code
(Remotion). So it must be a realistic, buildable screen — not a poster.

## What the owner said (2026-10-01, after seeing `current-frame.png`)
"The character is on the left and the text on the right. Make the subtitles properly easy to read, put the
character more in the middle and bigger, and make it feel like she is the one talking."

## Inputs (in this folder / repo)
- `current-frame.png` — today's screen (1080x1920). Keep its colours, fonts (bold gothic / sans-serif, NO Mincho/serif),
  the pill "Jev って何？・10/1", the page counter "2/4", the heading, the body text with the purple left bar, the yellow
  badge "TypeSafe の発表", the small source line.
- `../../../assets/brand/may-2026-09-30/a-senpai/motion/point_closed.png` — 先輩のメイ (the character). Use this exact
  character and art style (same face, short black bob, orange earring, cream cardigan, black top). Do not redesign her.

## The screen to draw (1080x1920, dark navy background #0b0b14, same as now)
1. Top part (y 220 .. ~860): the slide content, a little more compact than now: pill + counter, heading
   "何を比べた数字か" (big, white), body "同社が用意した課題で、判断1回分の応答時間を比べたもの。0.07〜0.5秒で返すと説明。"
   (white, purple left bar), yellow badge, small grey source line "出典: TypeSafe AI・LiteLLM ほか".
2. 先輩のメイ: centred horizontally (or very slightly off-centre), clearly bigger than now — about 2x the current size,
   shown from the head down to about the waist, the bottom of her body softly fading into the background.
   Her face must be clearly visible on a phone.
3. Subtitle = what she is saying right now: a speech bubble attached to her (a tail pointing to her mouth), so the
   viewer understands the subtitle is her voice. Text in the bubble: "同社自身も実際の効果として" — one or two short lines,
   large (about 44-48 px bold), every character the same full colour (no greyed-out characters), on a solid,
   high-contrast bubble (e.g. white bubble with near-black text, or dark bubble with white text and a clear border).
   The bubble must not cover her face and must not overlap the slide content.
4. Platform safe areas (Instagram Reels / YouTube Shorts UI is drawn on top of our video):
   - right 140 px (x > 940) from y 900 down: like / comment / share buttons — keep the bubble and her face out of it
   - bottom 340 px (y > 1580): caption / username — nothing important there (her body may fade out into it)
   - top 220 px: platform header — nothing important
   Draw these areas as thin dashed outlines labelled "IG/YT UI" so the layout can be checked.

## Output
- Save as `layout-ref.png` in this folder, 1080x1920 (resize if the generator gives another size; do not crop content).
- Optionally `layout-ref-b.png`: a second variant (e.g. bubble on the other side, or her placed lower), same rules.
- Reply with: where you put her (approx. x, y, width, height of her box in 1080x1920 px), where the bubble is
  (x, y, w, h, tail position), the bubble style (colours, font size), and the y range of the slide content.
Do not edit any other file.
