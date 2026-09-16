import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSkipEntry, upsertVideo, postedVideos, isSkipEntry, mergeVideoEntry } from "./history.mjs";
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
import { buildPostEntry, resolveRecordDate } from "./record-upload.mjs";
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

// --- The Instagram recovery run must not erase the day's YouTube record ------
const postedDay = (date) => ({
  date,
  genre: "ai-tools-top5",
  trial: 1,
  videoId: "yt-123",
  videoUrl: "https://youtu.be/yt-123",
  title: "【新作AIツール5選】…",
  projects: ["Resurf", "Visiby"],
  tools: [{ name: "Resurf", slug: "resurf" }],
  discovery: { method: "product-hunt-feed" },
  durationSeconds: 49,
  stats: { views: 120, likes: 3, comments: 0, updatedAt: "2026-09-17T00:00:00Z" },
  instagram: null,
});

test("a recovery record keeps the YouTube id, the stats and the tools of that day", () => {
  // What the recovery run produces: it only downloaded the video, so no upload result.
  const recovery = buildPostEntry({
    date: "2026-09-17",
    uploadResult: null,
    igResult: { mediaId: "ig-789" },
    trendingData: { tools: [], meta: null },
    captions: null,
    audioDurations: null,
    enriched: null,
  });
  assert.equal(recovery.videoId, null, "the recovery run genuinely has no video id");

  const history = { schemaVersion: 1, videos: [postedDay("2026-09-17")], optimizationLog: [] };
  const after = upsertVideo(history, recovery, { merge: true, now: new Date("2026-09-17T12:00:00Z") });
  const entry = after.videos.find((v) => v.date === "2026-09-17");

  assert.equal(entry.videoId, "yt-123", "the YouTube id must survive");
  assert.equal(entry.videoUrl, "https://youtu.be/yt-123");
  assert.deepEqual(entry.stats, { views: 120, likes: 3, comments: 0, updatedAt: "2026-09-17T00:00:00Z" });
  assert.deepEqual(entry.projects, ["Resurf", "Visiby"]);
  assert.deepEqual(entry.discovery, { method: "product-hunt-feed" });
  assert.equal(entry.durationSeconds, 49);
  assert.equal(entry.title, "【新作AIツール5選】…");
  assert.equal(entry.instagram.mediaId, "ig-789", "and the recovered media id is written");
  assert.equal(after.videos.length, 1);
});

test("merging never trades a real value for an empty one, and clears a paused day", () => {
  const existing = { ...postedDay("2026-09-17"), instagram: { mediaId: "ig-1", views: 10 } };
  const merged = mergeVideoEntry(existing, { date: "2026-09-17", videoId: null, instagram: null, stats: { views: 0, likes: 0, comments: 0, updatedAt: null } });
  assert.equal(merged.videoId, "yt-123");
  assert.equal(merged.instagram.mediaId, "ig-1");
  assert.equal(merged.stats.views, 120);

  const paused = buildSkipEntry({ date: "2026-09-17", genre: "ai-tools-top5", trial: 1, skip: { ...skip, date: "2026-09-17" } });
  const posted = mergeVideoEntry(paused, { date: "2026-09-17", videoId: "yt-9", instagram: { mediaId: "ig-9" } });
  assert.equal(posted.skip, undefined, "a day that posted is not a paused day");
  assert.equal(posted.videoId, "yt-9");

  // Without merge the day is replaced, which is what the daily run wants.
  const replaced = upsertVideo({ videos: [postedDay("2026-09-17")] }, { date: "2026-09-17", videoId: null }, { now: new Date("2026-09-17T12:00:00Z") });
  assert.equal(replaced.videos[0].videoId, null);
});

test("resolveRecordDate takes the day from --date or RECORD_DATE, and refuses junk", () => {
  const now = new Date("2026-09-17T09:00:00+09:00");
  assert.equal(resolveRecordDate({ argv: ["node", "x"], env: {}, now }), "2026-09-17");
  assert.equal(resolveRecordDate({ argv: ["node", "x", "--date=2026-09-15"], env: {}, now }), "2026-09-15");
  assert.equal(resolveRecordDate({ argv: ["node", "x", "--date=20260915"], env: {}, now }), "2026-09-15");
  assert.equal(resolveRecordDate({ argv: ["node", "x"], env: { RECORD_DATE: "20260914" }, now }), "2026-09-14");
  assert.equal(resolveRecordDate({ argv: ["node", "x"], env: { RECORD_DATE: "" }, now }), "2026-09-17");
  // The workflow's input wins over the environment default.
  assert.equal(resolveRecordDate({ argv: ["node", "x", "--date=2026-09-13"], env: { RECORD_DATE: "20260914" }, now }), "2026-09-13");
  assert.throws(() => resolveRecordDate({ argv: ["node", "x", "--date=yesterday"], env: {}, now }), /YYYY-MM-DD/);
  assert.throws(() => resolveRecordDate({ argv: ["node", "x"], env: { RECORD_DATE: "2026/09/14" }, now }), /YYYY-MM-DD/);
});

test("an acknowledged stretch of paused days warns instead of failing, and expires", () => {
  const videos = [skipOn("2026-09-15"), skipOn("2026-09-14")];
  const lines = [];
  const log = (l) => lines.push(l);

  // Without the acknowledgement the run fails.
  assert.equal(reportSkipStreak(videos, skip, { env: {}, log, append: () => {} }), true);
  assert.match(lines.at(-1), /^::error title=/);

  // Acknowledged: a warning, and the run stays green.
  assert.equal(
    reportSkipStreak(videos, skip, { env: { ALLOW_SKIP_STREAK_UNTIL: "2026-09-30" }, log, append: () => {} }),
    false
  );
  assert.match(lines.at(-1), /^::warning title=/);
  assert.match(lines.at(-1), /承知済み/);

  // Expired: back to failing.
  assert.equal(
    reportSkipStreak(videos, skip, { env: { ALLOW_SKIP_STREAK_UNTIL: "2026-09-15" }, log, append: () => {} }),
    true
  );
  // Junk in the variable must not disable the guard.
  assert.equal(reportSkipStreak(videos, skip, { env: { ALLOW_SKIP_STREAK_UNTIL: "forever" }, log, append: () => {} }), true);
});

test("an acknowledgement further than a fortnight ahead is ignored", () => {
  const videos = [skipOn("2026-09-15")];
  const lines = [];
  const log = (l) => lines.push(l);

  // 14 days ahead is still accepted.
  assert.equal(
    reportSkipStreak(videos, skip, { env: { ALLOW_SKIP_STREAK_UNTIL: "2026-09-30" }, log, append: () => {} }),
    false
  );
  // 15 days is not: a far-future date would hide a stopped fetch for good.
  assert.equal(
    reportSkipStreak(videos, skip, { env: { ALLOW_SKIP_STREAK_UNTIL: "2026-10-01" }, log, append: () => {} }),
    true
  );
  assert.match(lines.at(-1), /ALLOW_SKIP_STREAK_UNTIL=2026-10-01 は 14 日より先なので無視/);
  assert.equal(
    reportSkipStreak(videos, skip, { env: { ALLOW_SKIP_STREAK_UNTIL: "2099-12-31" }, log, append: () => {} }),
    true
  );
});

test("a date that does not exist is refused", () => {
  const now = new Date("2026-09-17T09:00:00+09:00");
  for (const bad of ["2026-13-45", "20261345", "2026-02-30", "20260230"]) {
    assert.throws(() => resolveRecordDate({ argv: ["node", "x", `--date=${bad}`], env: {}, now }), /existing day/, bad);
  }
  // Leap day 2028 exists; 2027 does not have one.
  assert.equal(resolveRecordDate({ argv: ["node", "x", "--date=2028-02-29"], env: {}, now }), "2028-02-29");
  assert.throws(() => resolveRecordDate({ argv: ["node", "x", "--date=2027-02-29"], env: {}, now }), /existing day/);
});
