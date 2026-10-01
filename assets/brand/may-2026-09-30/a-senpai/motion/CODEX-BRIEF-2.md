# Brief 2 for Codex: redraw the mouth / blink variants of ONE pose (the pose name is given in your prompt)

Round 1 problem (please fix): the `half` / `open` / `blink` files were made by pasting flat shapes with ImageMagick,
not drawn. On a 1080x1920 video it shows: a darker skin-coloured oval around the mouth, the old closed-smile line still
visible under the open mouth, and the "closed eyes" arcs landed on the eyebrows while the open eyes stayed visible.
The owner's rule: the artwork is drawn by Codex's image generation — not by shapes.

## Do this for your pose `<pose>` only
Input: `<pose>_base.png` in this folder (1024x1536, transparent background). Keep it as the master. Do not change any other pose's files.
1. With your **image generation tool, editing `<pose>_base.png`** (pass it as the reference image), draw 3 edits of the same picture:
   - mouth half open (talking, small natural opening, same lips style as the reference art ../codex-main.png)
   - mouth open (talking, like the open smile in ../codex-main.png; for `surprise` a round "o")
   - both eyes closed (a natural blink: both upper lids down, lashes as curved lines, eyebrows unchanged, mouth = gentle closed smile)
   Ask for: identical character, pose, framing, colours and line style; ONLY the mouth (or only the eyes) changes; transparent background.
2. Register: each edit must line up with the base (same size 1024x1536, same position). If the generator moved or rescaled the
   picture, align it to the base first (e.g. `magick compare`/subimage search on the face, then shift).
3. Composite: take ONLY a soft-edged (feathered ~12 px) region around the mouth (or around both eyes) from the aligned edit and
   put it on top of `<pose>_base.png`. Everything outside that region stays the base's pixels. The edge must be invisible —
   no colour step, no halo, no double lines. Check at 2x zoom on a mid-grey background.
4. Overwrite: `<pose>_closed.png` (= exact copy of the base), `<pose>_half.png`, `<pose>_open.png`, `<pose>_blink.png`.
5. Write `<pose>.parts.json` = `{ "mouth": [x, y, w, h], "eyes": [x, y, w, h] }` (other poses run in parallel, so do NOT edit `parts.json` itself): the
   rectangle that contains every pixel that differs from the base (verify outside = 0 with `magick compare -metric AE`).
6. Write `<pose>-faces.png`: the face area (crop around head) of closed / half / open / blink side by side at 2x, mid-grey background.

If the image tool refuses or errors on editing, try again with a smaller instruction; if it still fails, stop and say so — do not
fall back to drawing shapes. Reply with what you made and anything you could not meet.
