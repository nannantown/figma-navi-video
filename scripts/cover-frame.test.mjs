import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COVER_FRAMES_INTO_CARD,
  MIN_OPENING_FRAMES,
  coverFrame,
  coverOffsetMs,
  firstToolFrames,
  openingFrames,
} from "./cover-frame.mjs";

/** The one property that matters: the cover is inside the FIRST TOOL CARD. */
function assertInsideFirstCard(durations, label) {
  const start = openingFrames(durations);
  const end = start + firstToolFrames(durations);
  const f = coverFrame(durations);
  assert.ok(f >= start, `${label}: cover frame ${f} is before the first card (${start})`);
  assert.ok(f < end, `${label}: cover frame ${f} is past the first card (${end})`);
}

test("the cover lands inside the first tool card across realistic durations", () => {
  for (const opening of [0.8, 2.0, 2.8, 3.5, 5.0]) {
    for (const tool1 of [4.0, 6.5, 8.5, 12.0]) {
      const d = { opening, "tool-1": tool1, "tool-2": 8, ending: 4 };
      assertInsideFirstCard(d, `opening=${opening} tool-1=${tool1}`);
    }
  }
});

test("a very short first card still keeps the cover inside it", () => {
  const d = { opening: 2.8, "tool-1": 1.0, ending: 4 };
  assertInsideFirstCard(d, "1 s narration");
  // 1 s -> 30+15 = 45 frames, shorter than the 60-frame offset: midpoint.
  assert.equal(coverFrame(d), openingFrames(d) + 22);
});

test("the opening floor is honoured so a tiny hook cannot pull the cover forward", () => {
  const d = { opening: 0.5, "tool-1": 8.5, ending: 4 };
  assert.equal(openingFrames(d), MIN_OPENING_FRAMES);
  assert.equal(coverFrame(d), MIN_OPENING_FRAMES + COVER_FRAMES_INTO_CARD);
});

test("no opening audio means the first card starts at frame 0", () => {
  const d = { "tool-1": 8.5, ending: 4 };
  assert.equal(openingFrames(d), 0);
  assert.equal(coverFrame(d), COVER_FRAMES_INTO_CARD);
});

test("the cover is never the brand-constant opening title card", () => {
  // Regression guard for the 2026-09-22 owner report: frame 60 / 2000 ms used
  // to sit in the opening, so every day's grid tile looked identical.
  const d = { opening: 2.8, "tool-1": 8.5, ending: 4 };
  assert.ok(coverFrame(d) >= openingFrames(d));
  assert.ok(coverOffsetMs(d) > 2000);
  assert.equal(coverOffsetMs(d), Math.round((coverFrame(d) / 30) * 1000));
});
