import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSkipEntry, upsertVideo, postedVideos, isSkipEntry } from "./history.mjs";
import {
  skipWarningCommand,
  skipSummaryMarkdown,
  reportSkip,
  escapeWorkflowData,
  escapeWorkflowProperty,
  precedingSkipStreak,
  skipStreakProblem,
  reportSkipStreak,
  SKIP_STREAK_LIMIT,
} from "./skip-report.mjs";
import { buildPostEntry } from "./record-upload.mjs";
import { alreadyPostedProblem } from "./assert-not-posted.mjs";
import { renderMarkdown, trialStatus, summarizeWindow } from "./pdca-summary.mjs";

const skip = { date: "2026-09-16", reason: "新作の候補が1本のため休止", fresh_candidates: 1, snapshot_fresh_ai: 1, snapshot_check: "consistent" };

test("a skip day is recorded as a history entry without a video", () => {
  const entry = buildSkipEntry({ date: skip.date, genre: "ai-tools-top5", trial: 1, skip });
  assert.deepEqual(entry.skip, { reason: "新作の候補が1本のため休止", fresh_candidates: 1, snapshot_fresh_ai: 1 });
  assert.equal(entry.videoId, null);
  assert.equal(entry.videoUrl, null);
  assert.equal(entry.instagram, null);
  assert.deepEqual(entry.tools, []);
  assert.deepEqual(entry.stats, { views: 0, likes: 0, comments: 0, updatedAt: null });
  assert.equal(isSkipEntry(entry), true);

  const unchecked = buildSkipEntry({ date: skip.date, genre: "ai-tools-top5", trial: 1, skip: { ...skip, snapshot_fresh_ai: null } });
  assert.equal(unchecked.skip.snapshot_fresh_ai, null);
});

test("upsertVideo replaces the same date and keeps 90 days", () => {
  const history = { schemaVersion: 1, videos: [{ date: "2026-05-01" }, { date: "2026-09-16", videoId: "old" }], optimizationLog: [] };
  const entry = buildSkipEntry({ date: "2026-09-16", genre: "ai-tools-top5", trial: 1, skip });
  const next = upsertVideo(history, entry, { now: new Date("2026-09-16T12:00:00Z") });
  assert.deepEqual(next.videos.map((v) => v.date), ["2026-09-16"]);
  assert.equal(next.videos[0].videoId, null);
  assert.deepEqual(next.optimizationLog, []);
  assert.deepEqual(postedVideos(next.videos), []);
});

test("a posted day on one platform only is still recorded", () => {
  const entry = buildPostEntry({
    date: "2026-09-15",
    uploadResult: null,
    igResult: { mediaId: "179" },
    trendingData: { tools: [{ name: "Resurf", slug: "resurf-2", phUrl: "https://www.producthunt.com/products/resurf-2", website: "https://resurf.so/", pricing: "freemium" }], meta: { mode: "pickup", sourceLabel: "Product Hunt の直近48時間の新着から厳選" } },
    captions: null,
    audioDurations: { opening: 3, "tool-1": 8 },
    enriched: { discovery: { method: "non-engineer" } },
  });
  assert.equal(entry.videoId, null);
  assert.equal(entry.instagram.mediaId, "179");
  assert.equal(entry.durationSeconds, 11);
  assert.equal(entry.genre, "ai-tools-top5");
});

test("skip days are counted but never measured, and do not start the trial", () => {
  const posted = (date, views, saved) => ({ date, genre: "ai-tools-top5", stats: { views: 3, updatedAt: "2026-09-20T00:00:00Z" }, instagram: { views, saved, shares: 0, reach: views }, tools: [{ name: `T${date}` }] });
  const skipEntry = buildSkipEntry({ date: "2026-09-15", genre: "ai-tools-top5", trial: 1, skip: { ...skip, date: "2026-09-15" } });
  const videos = [skipEntry, posted("2026-09-16", 100, 4), posted("2026-09-17", 60, 1)];

  const st = trialStatus(videos, { today: "2026-09-18" });
  assert.equal(st.startDate, "2026-09-16");

  const s = summarizeWindow(videos, { from: "2026-09-15", to: "2026-09-18" });
  assert.equal(s.posts, 2);
  assert.equal(s.skipped, 1);
  assert.equal(s.ig.viewsMedian, 80);
  assert.equal(s.ig.savedSum, 5);
  assert.equal(s.yt.n, 2);

  const md = renderMarkdown({ videos }, { today: "2026-09-18" });
  assert.match(md, /\| 2026-09-15 \| ai-tools-top5 \| — \| 休止（新作の候補が1本のため休止／新作の候補 1・スナップショットの新作AI 1） \|/);
});

test("the Actions warning escapes workflow-command characters and the summary lists counts", () => {
  assert.equal(escapeWorkflowData("a%b\r\nc"), "a%25b%0D%0Ac");
  assert.equal(escapeWorkflowProperty("t:1,2"), "t%3A1%2C2");
  const cmd = skipWarningCommand({ ...skip, reason: "候補1本: 100%休止" });
  assert.match(cmd, /^::warning title=新作AIツール 2026-09-16 は休止::/);
  assert.ok(cmd.includes("100%25"));
  assert.ok(!cmd.slice("::warning ".length).includes("\n"));

  const md = skipSummaryMarkdown(skip);
  assert.match(md, /### 新作AIツール: 2026-09-16 は休止（投稿なし）/);
  assert.match(md, /ルーチンが数えた新作の候補: 1 本/);
  assert.match(md, /スナップショットの新作 AI 件数: 1（照合済み）/);
  const unchecked = skipSummaryMarkdown({ ...skip, snapshot_check: "unchecked", snapshot_fresh_ai: null, snapshot_note: "no Product Hunt snapshot" });
  assert.match(unchecked, /スナップショットと照合できず: no Product Hunt snapshot/);
});

test("reportSkip prints the annotation and appends the job summary only inside Actions", () => {
  const logs = [];
  const appended = [];
  reportSkip(skip, { env: { GITHUB_STEP_SUMMARY: "/tmp/summary.md" }, log: (m) => logs.push(m), append: (path, text) => appended.push([path, text]) });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^::warning /);
  assert.equal(appended.length, 1);
  assert.equal(appended[0][0], "/tmp/summary.md");

  const local = [];
  reportSkip(skip, { env: {}, log: () => {}, append: (...args) => local.push(args) });
  assert.equal(local.length, 0);
});

// --- Two paused days in a row must fail the run ------------------------------
const skipOn = (date) => buildSkipEntry({ date, genre: "ai-tools-top5", trial: 1, skip: { ...skip, date } });
const postedOn = (date) => ({ date, genre: "ai-tools-top5", videoId: "v", instagram: { mediaId: "m" }, tools: [] });

test("precedingSkipStreak counts paused days back to the last post", () => {
  const videos = [postedOn("2026-09-12"), skipOn("2026-09-13"), skipOn("2026-09-14"), skipOn("2026-09-15")];
  assert.equal(precedingSkipStreak(videos, "2026-09-16"), 3);
  assert.equal(precedingSkipStreak([postedOn("2026-09-15")], "2026-09-16"), 0);
  // A day with no entry at all stops the count: that run never finished, so it
  // went red on its own.
  assert.equal(precedingSkipStreak([skipOn("2026-09-14")], "2026-09-16"), 0);
  assert.equal(precedingSkipStreak([], "2026-09-16"), 0);
});

test("one paused day stays a warning; the second one is an error", () => {
  assert.equal(SKIP_STREAK_LIMIT, 2);
  assert.equal(skipStreakProblem([postedOn("2026-09-15")], skip), null);

  const problem = skipStreakProblem([skipOn("2026-09-15")], skip);
  assert.ok(problem, "a second paused day must be reported");
  assert.equal(problem.streak, 2);
  assert.match(problem.command, /^::error title=/);
  assert.match(problem.command, /2 日連続で休止/);
  assert.match(problem.command, /fetch-product-hunt\.yml/);
  assert.match(problem.summary, /投稿ゼロ/);
});

test("reportSkipStreak writes the annotation and the job summary only when it fails", () => {
  const lines = [];
  const appended = [];
  const env = { GITHUB_STEP_SUMMARY: "/tmp/summary" };
  const log = (l) => lines.push(l);
  const append = (_f, body) => appended.push(body);

  assert.equal(reportSkipStreak([postedOn("2026-09-15")], skip, { env, log, append }), false);
  assert.deepEqual(lines, []);
  assert.deepEqual(appended, []);

  assert.equal(reportSkipStreak([skipOn("2026-09-15"), skipOn("2026-09-14")], skip, { env, log, append }), true);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /3 日連続で休止/);
  assert.equal(appended.length, 1);
});

// --- The recovery workflow must not post the same Reel twice -----------------
test("alreadyPostedProblem blocks a day that already has an Instagram media id", () => {
  const history = {
    videos: [
      { date: "2026-09-15", instagram: { mediaId: "1789" } },
      { date: "2026-09-16", instagram: null },
      { date: "2026-09-14", instagram: { mediaId: null } },
    ],
  };
  assert.match(alreadyPostedProblem(history, "20260915"), /already recorded as posted/);
  assert.match(alreadyPostedProblem(history, "20260915"), /force=true/);
  assert.equal(alreadyPostedProblem(history, "20260916"), null);
  assert.equal(alreadyPostedProblem(history, "20260914"), null);
  assert.equal(alreadyPostedProblem(history, "20260913"), null, "a day with no entry may be posted");
  assert.equal(alreadyPostedProblem(null, "20260915"), null, "an unreadable history must not block a recovery");
  assert.match(alreadyPostedProblem(history, "2026-09-15"), /YYYYMMDD/);
});
