import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDate, recordedOffsetMs } from "./cover-offset-for.mjs";
import { buildPostEntry } from "./record-upload.mjs";
import { coverOffsetMs } from "./cover-frame.mjs";

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

// The round trip that must hold for a recovery post to reproduce the daily
// run's cover: what record-upload writes is what cover-offset-for reads.
test("a recorded day round-trips the offset the daily run actually used", () => {
  const audioDurations = { opening: 4.51, "tool-1": 8.5, "tool-2": 8.5, ending: 4 };
  const trendingData = { tools: [{ name: "A" }, { name: "B" }], meta: { mode: "pickup", sourceLabel: "x" } };
  const entry = buildPostEntry({
    date: "2026-09-22",
    uploadResult: { videoId: "v1" },
    igResult: null,
    trendingData,
    captions: null,
    audioDurations,
    enriched: null,
  });
  // 4.51 s opening is past the fallback's safe edge, so this is exactly the
  // day the constant would have got wrong.
  assert.equal(entry.coverOffsetMs, coverOffsetMs(audioDurations, 2));
  assert.equal(entry.coverOffsetMs, 7033);
  assert.equal(recordedOffsetMs({ videos: [entry] }, "2026-09-22"), 7033);
});

test("a day with no tools recorded records no offset instead of throwing", () => {
  const entry = buildPostEntry({
    date: "2026-09-22",
    uploadResult: { videoId: "v1" },
    igResult: null,
    trendingData: { tools: [] },
    captions: null,
    audioDurations: { opening: 2.8, "tool-1": 8.5, ending: 4 },
    enriched: null,
  });
  assert.equal(entry.coverOffsetMs, null);
});

test("a skip day carries no offset, so recovery cannot pick one up from it", () => {
  // buildSkipEntry() never sets coverOffsetMs; a skip day has no video.
  const history = { videos: [{ date: "2026-09-19", skip: { reason: "too few new launches" } }] };
  assert.equal(recordedOffsetMs(history, "2026-09-19"), null);
});
