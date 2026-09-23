# Jev dry-run previews

Made on 2026-09-23 from main ff740ba + the shorter ending (39 chars) with
`npm run dry-run:jev-intro` / `npm run dry-run:jev-usecase` (samples in `data/samples/`).

| File | What |
|---|---|
| `intro-captions.json` / `usecase-captions.json` | `output/captions.json` of each run |
| `intro-cover.jpg` / `usecase-cover.jpg` | `output/aitools-*-cover.jpg` of each run |
| `intro-frames.jpg` | intro video: opening, slides 1 / 2 / 4, ending (ffmpeg stills, 360×640 each) |
| `openings-and-usecase.jpg` | intro opening, usecase opening, usecase slide 3, usecase ending |

Narration seconds (local voice, `output/audio-durations.json`): ending 5.28 s in both runs;
the intro video is 47.0 s, the usecase one 43.9 s.

These go stale when the Jev copy or the video layout changes — rerun the two
dry-runs and replace them.
