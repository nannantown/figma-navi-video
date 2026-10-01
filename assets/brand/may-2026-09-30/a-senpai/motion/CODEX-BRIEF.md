# Brief for Codex: animation parts for 先輩のメイ (May, the senpai guide)

You are the illustrator. Claude only writes the video code; it will NOT touch or redraw your pixels.
Reference art (same person, same style — keep her identical): ../codex-main.png and ../codex-expressions.png
(short black bob, dark brown eyes, orange round earring on her left ear, cream open cardigan, black dress, flat anime style, thin dark outline).

## What to make
4 poses, each as 4 registered variants = 16 PNG files, in this folder:

| pose id   | look |
|-----------|------|
| explain   | like codex-main.png: one hand raised palm-up beside her, friendly, presenting something |
| surprise  | like the middle of codex-expressions.png: both fists near her chest, eyes a bit wider |
| nod       | like the right of codex-expressions.png: arms relaxed, head slightly tilted, soft smile (agreeing) |
| point     | one index finger pointing UP-and-to-her-side (toward text above her), confident smile |

Variants per pose (file names `<pose>_<variant>.png`):
- `closed` — mouth closed (gentle closed smile), eyes open
- `half`   — mouth half open (talking)
- `open`   — mouth open (talking, like codex-main.png's open smile; for surprise a round "o")
- `blink`  — eyes closed (happy closed-eye arcs or simple closed lids), mouth closed

## Hard technical rules (the video code depends on them)
1. Every file: 1024 x 1536 PNG, **transparent background** (no cream, no shadow, no frame), waist-up framing,
   character centered horizontally, top of hair about 60 px from the top, body cut off at the bottom edge.
   All 16 files use the SAME scale and position (her head size and the bottom crop line match across poses).
2. Within one pose, the 4 variants must be **pixel-identical except inside the mouth box and the eye box**.
   Recommended way: generate the `closed` image first, then make the other variants by editing it, and finally
   composite only the mouth region / eye region of the edit back onto the `closed` image (ImageMagick `magick` is installed;
   Python Pillow is NOT installed). Verify with `magick compare -metric AE` outside the boxes = 0.
3. Clean alpha: no cream halo around the hair / outline (check on a dark background too).
4. No text, no logo, no Mincho/serif lettering anywhere.
5. Write `parts.json` here: `{ "<pose>": { "mouth": [x, y, w, h], "eyes": [x, y, w, h] }, ... }` in pixels of the 1024x1536 canvas
   — the boxes that differ between variants.
6. Also write `contact-sheet.png` (all 16 on a mid-grey background, labelled) so a human can review them.

When done, reply with a short list of the files and anything you could not meet.
