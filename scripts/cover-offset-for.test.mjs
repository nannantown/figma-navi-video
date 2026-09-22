import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDate, recordedOffsetMs } from "./cover-offset-for.mjs";

test("both date spellings the workflows use resolve to the same day", () => {
  assert.equal(normalizeDate("20260922"), "2026-09-22");
  assert.equal(normalizeDate("2026-09-22"), "2026-09-22");
  assert.equal(normalizeDate(" 2026-09-22 "), "2026-09-22");
  for (const bad of ["", null, undefined, "2026/09/22", "22-09-2026", "today"]) {
    assert.equal(normalizeDate(bad), null, `${JSON.stringify(bad)} must not be accepted`);
  }
});

test("the recorded offset is read back for the right day", () => {
  const history = {
    videos: [
      { date: "2026-09-21", coverOffsetMs: 5300 },
      { date: "2026-09-22", coverOffsetMs: 7033 },
    ],
  };
  assert.equal(recordedOffsetMs(history, "2026-09-22"), 7033);
  assert.equal(recordedOffsetMs(history, "2026-09-21"), 5300);
  assert.equal(recordedOffsetMs(history, "2026-09-20"), null);
});

test("an unusable recorded value counts as not recorded, never as frame 0", () => {
  // 0 would put the Reels cover on the first frame of the video — the
  // near-black fade-in. Anything that is not a positive integer must fall
  // through to the warned fallback instead.
  for (const bad of [0, -1, null, undefined, "5300", 5300.5, NaN]) {
    const history = { videos: [{ date: "2026-09-22", coverOffsetMs: bad }] };
    assert.equal(recordedOffsetMs(history, "2026-09-22"), null, `${JSON.stringify(bad)} must be refused`);
  }
});

test("a missing or empty history does not throw", () => {
  assert.equal(recordedOffsetMs(null, "2026-09-22"), null);
  assert.equal(recordedOffsetMs({}, "2026-09-22"), null);
  assert.equal(recordedOffsetMs({ videos: [] }, "2026-09-22"), null);
  assert.equal(recordedOffsetMs({ videos: [null] }, "2026-09-22"), null);
});

test("a skip day carries no offset, so recovery cannot pick one up from it", () => {
  // buildSkipEntry() never sets coverOffsetMs; a skip day has no video.
  const history = { videos: [{ date: "2026-09-19", skip: { reason: "too few new launches" } }] };
  assert.equal(recordedOffsetMs(history, "2026-09-19"), null);
});
