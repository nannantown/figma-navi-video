import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COVER_FRAMES_INTO_CARD,
  ENDING_EXTRA_FRAMES,
  FALLBACK_OFFSET_MS,
  FPS,
  MIN_OPENING_FRAMES,
  PADDING_FRAMES,
  coverFrame,
  coverOffsetMs,
  firstToolFrames,
  openingFrames,
} from "./cover-frame.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  // 1 s -> 30+15 = 45 frames, shorter than the 60-frame offset: last frame of
  // the card (44), which is still past the 42-frame point where the card's
  // last element finishes fading in.
  assert.equal(coverFrame(d), openingFrames(d) + 44);
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

test("a missing tool-1 duration uses the same 8 s fallback as the composition", () => {
  // calculateFrameDurations() floors the tool count at 1 and renders a card of
  // (8 s + padding); the cover has to stay on that card, not fall back to the
  // opening title card this whole change exists to get away from.
  const d = { opening: 2.8, ending: 4 };
  assert.equal(firstToolFrames(d), Math.ceil(8 * 30) + 15);
  assertInsideFirstCard(d, "missing tool-1");
  assert.ok(coverFrame(d) > openingFrames(d));
});

test("the cover is never the brand-constant opening title card", () => {
  // Regression guard for the 2026-09-22 owner report: frame 60 / 2000 ms used
  // to sit in the opening, so every day's grid tile looked identical.
  // Asserted against numbers worked out by hand, not against this module's own
  // openingFrames() — a self-comparison could never fail.
  const d = { opening: 2.8, "tool-1": 8.5, ending: 4 };
  assert.equal(openingFrames(d), 99); // ceil(2.8*30)+15 = 99, above the 90 floor
  assert.equal(coverFrame(d), 159); // 99 + 60, i.e. 2 s into card 1
  assert.equal(coverOffsetMs(d), 5300);
  assert.ok(coverFrame(d) > 60, "the old cover frame was 60 — inside the opening");
  assert.ok(coverOffsetMs(d) > 2000, "the old thumb_offset was 2000 ms");
});

// The frame arithmetic is mirrored, not shared: src/data.ts drives the actual
// composition and is TypeScript, this module drives the cover and is ESM.
// Comments saying "keep in sync" do not fail a build, so read the constants out
// of src/data.ts and compare. Raising MIN_OPENING there without raising it here
// would move the video and leave the cover behind — back inside the title card.
test("the frame constants match the ones the composition actually uses", () => {
  const src = readFileSync(join(rootDir, "src/data.ts"), "utf-8");
  const constant = (name) => {
    const m = src.match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)`));
    assert.ok(m, `could not find ${name} in src/data.ts — did it get renamed?`);
    return Number(m[1]);
  };
  assert.equal(constant("FPS"), FPS);
  assert.equal(constant("PADDING"), PADDING_FRAMES);
  assert.equal(constant("ENDING_EXTRA"), ENDING_EXTRA_FRAMES);
  assert.equal(constant("MIN_OPENING"), MIN_OPENING_FRAMES);
  // src/data.ts:203 falls back to 8 s for a missing tool duration.
  assert.match(src, /\|\|\s*8\)\s*\*\s*FPS/);
});

test("the recovery fallback lands on the first card, not the title card", () => {
  assert.equal(FALLBACK_OFFSET_MS, 5000); // (90 + 60) / 30 * 1000
  // Same card as the daily run when the opening sits on its floor.
  const onFloor = { opening: 2.5, "tool-1": 8.5, ending: 4 };
  assert.equal(openingFrames(onFloor), MIN_OPENING_FRAMES);
  assert.equal(coverOffsetMs(onFloor), FALLBACK_OFFSET_MS);
  // Still inside card 1 for a longer opening.
  const longer = { opening: 3.5, "tool-1": 8.5, ending: 4 };
  const startMs = (openingFrames(longer) / FPS) * 1000;
  const endMs = ((openingFrames(longer) + firstToolFrames(longer)) / FPS) * 1000;
  assert.ok(FALLBACK_OFFSET_MS > startMs && FALLBACK_OFFSET_MS < endMs);
});
