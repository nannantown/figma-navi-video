# 先輩のメイ — animation parts (all artwork by Codex, 2026-10-01)

Made by Codex CLI 0.139 (`-m gpt-5.5`, built-in image generation), from the reference art `../codex-main.png` / `../codex-expressions.png`.
Claude did not draw or retouch anything here; `scripts/may-assets.mjs` only resizes these into `public/may/` and derives
`<pose>_eyes.png` (the blink picture kept only where it differs from `closed`).

| file | what | how Codex made it |
|---|---|---|
| `<pose>_closed.png` (explain / surprise / nod / point) | the pose, mouth closed — the master picture | image generation from the reference art (round 1, `CODEX-BRIEF.md`). Was also saved as `<pose>_base.png`; that copy is dropped because it is byte-identical |
| `<pose>_half.png`, `<pose>_open.png` | mouth half open / open | image-generation edit of `closed`, face region composited back onto `closed` (round 2, `CODEX-BRIEF-2.md`) |
| `<pose>_blink.png` | eyes closed | same as above; `surprise_blink.png` redone once after review (the open eye showed through) |
| `<pose>.parts.json`, `parts.json` | rectangles that differ from `closed` | Codex, measured with `magick compare` |
| `<pose>-faces.png`, `contact-sheet.png` | review sheets (faces at 2x / all 16) | face sheets: Codex. `contact-sheet.png`: Claude stacked Codex's four face sheets (montage only), all resized to 1600 px wide |
| `codex-last-*.txt` | Codex's own final report per pose | — |

Round 1's mouth / blink pictures were shapes pasted with ImageMagick and were rejected (not kept).
