import { test } from "node:test";
import assert from "node:assert/strict";
import {
  median,
  addDays,
  summarizeWindow,
  trialStatus,
  judgeIg,
  judgeYt,
  renderMarkdown,
} from "./pdca-summary.mjs";

const video = (date, { genre, ig, yt, tools } = {}) => ({
  date,
  ...(genre ? { genre } : {}),
  stats: yt === undefined ? { views: 0, updatedAt: null } : { views: yt, updatedAt: "2026-09-20T00:00:00Z" },
  instagram: ig === undefined ? null : ig,
  tools,
});

test("median matches the jq definition (even length averages the middle pair)", () => {
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("summarizeWindow excludes rows without IG views or YT updatedAt", () => {
  const videos = [
    video("2026-09-15", { ig: { views: 100, saved: 3, shares: 1, reach: 80 }, yt: 4 }),
    video("2026-09-16", { ig: { views: null, saved: null } }), // insights pending
    video("2026-09-17", { ig: { views: 20, saved: 0, shares: 0, reach: 10 }, yt: 2 }),
    video("2026-09-30", { ig: { views: 999, saved: 99 }, yt: 999 }), // outside window
  ];
  const s = summarizeWindow(videos, { from: "2026-09-15", to: "2026-09-28" });
  assert.equal(s.posts, 3);
  assert.deepEqual(s.ig, { n: 2, viewsMedian: 60, savedSum: 3, sharesSum: 1, reachMedian: 45 });
  assert.deepEqual(s.yt, { n: 2, viewsMedian: 3 });
});

test("trialStatus starts at the first genre entry and judges on day 15", () => {
  const videos = [video("2026-09-14", { ig: { views: 5, saved: 0 }, yt: 1 })];
  for (let i = 0; i < 14; i++) {
    videos.push(video(addDays("2026-09-16", i), { genre: "ai-tools-top5", ig: { views: 60 + i, saved: 1 }, yt: 3 }));
  }
  const mid = trialStatus(videos, { today: "2026-09-20" });
  assert.equal(mid.startDate, "2026-09-16");
  assert.equal(mid.judgmentDate, "2026-09-30");
  assert.equal(mid.dayN, 5);
  assert.equal(mid.verdict, null);

  const judged = trialStatus(videos, { today: "2026-09-30" });
  assert.equal(judged.summary.ig.n, 14);
  assert.equal(judged.summary.ig.savedSum, 14);
  assert.deepEqual(judged.verdict, { ig: "続行", yt: "配信死亡" });
  assert.equal(judged.isJudgmentDay, true);
  assert.equal(judged.judgedCycle, 1);
  assert.equal(judged.judgmentDate, "2026-10-14"); // the next one
  assert.equal(`${judged.summary.from}..${judged.summary.to}`, "2026-09-16..2026-09-29");
});

test("a missed judgment stays due for two more mornings, then the next 14-day cycle runs", () => {
  const videos = [];
  for (let i = 0; i < 40; i++) {
    videos.push(video(addDays("2026-09-18", i), { genre: "ai-tools-top5", ig: { views: 30, saved: 0 }, yt: 1 }));
  }
  const onTime = trialStatus(videos, { today: "2026-10-02" }); // start 09-18
  assert.equal(onTime.isJudgmentDay, true);
  assert.equal(onTime.judgmentLate, false);
  assert.equal(`${onTime.summary.from}..${onTime.summary.to}`, "2026-09-18..2026-10-01");

  // A missed morning must not skip the cycle: the judgment stays due, and it
  // reads exactly the same 14 days as it would have on its own day.
  for (const late of ["2026-10-03", "2026-10-04"]) {
    const st = trialStatus(videos, { today: late });
    assert.equal(st.isJudgmentDay, true, late);
    assert.equal(st.judgmentLate, true, late);
    assert.equal(st.judgedCycle, 1, late);
    assert.equal(st.judgmentDate, "2026-10-16", late);
    assert.deepEqual(st.verdict, onTime.verdict, late);
    assert.equal(`${st.summary.from}..${st.summary.to}`, "2026-09-18..2026-10-01", late);
  }

  const dayAfter = trialStatus(videos, { today: "2026-10-05" }); // grace window is over
  assert.equal(dayAfter.verdict, null);
  assert.equal(dayAfter.cycle, 2);
  assert.equal(dayAfter.dayInCycle, 4);
  assert.equal(dayAfter.judgmentDate, "2026-10-16");
  // Same as docs/genre-experiment.md: max(start, today − 13)..today on non-judgment days.
  assert.equal(`${dayAfter.summary.from}..${dayAfter.summary.to}`, "2026-09-22..2026-10-05");

  const second = trialStatus(videos, { today: "2026-10-16" });
  assert.equal(second.isJudgmentDay, true);
  assert.equal(second.judgedCycle, 2);
  assert.equal(`${second.summary.from}..${second.summary.to}`, "2026-10-02..2026-10-15");
  assert.equal(second.summary.ig.n, 14);
  assert.notEqual(second.verdict, null);
});

test("before the first post the planned start date is used", () => {
  const st = trialStatus([video("2026-09-13", { ig: { views: 5, saved: 0 } })], { today: "2026-09-14", plannedStart: "2026-09-15" });
  assert.equal(st.started, false);
  assert.equal(st.startDate, "2026-09-15");
  assert.equal(st.judgmentDate, "2026-09-29");
  assert.equal(st.dayN, 0);
});

test("thresholds: n < 7 is on hold; IG needs views median or saves", () => {
  assert.equal(judgeIg({ n: 6, viewsMedian: 0, savedSum: 0 }), "判定保留（データ不足）");
  assert.equal(judgeIg({ n: 14, viewsMedian: 9, savedSum: 4 }), "配信死亡");
  assert.equal(judgeIg({ n: 14, viewsMedian: 49, savedSum: 4 }), "切替候補");
  assert.equal(judgeIg({ n: 14, viewsMedian: 12, savedSum: 5 }), "続行");
  assert.equal(judgeYt({ n: 14, viewsMedian: 19 }), "切替候補");
});

test("renderMarkdown shows IG median + saves and the design-news baseline", () => {
  const history = {
    videos: [
      video("2026-09-12", { ig: { views: 5, saved: 0 }, yt: 0 }),
      video("2026-09-15", { genre: "ai-tools-top5", ig: { views: 120, saved: 7, shares: 2, reach: 90 }, yt: 3, tools: [{ name: "Resurf" }] }),
    ],
  };
  const md = renderMarkdown(history, { today: "2026-09-16" });
  assert.match(md, /## ジャンル試行の状態/);
  assert.match(md, /\| IG \| #1 \| 新作AIツール N選（Product Hunt 公式フィード） \| 2026-09-15 \| Day 2 \/ 14（第 1 期） \| 09-15\.\.09-16 \(n=1\) \| 120 \| 7 \|/);
  assert.doesNotMatch(md, /TOP5/);
  assert.match(md, /比較（旧ジャンル: デザインニュース/);
  assert.match(md, /\| 2026-09-15 \| ai-tools-top5 \| — \| Resurf \| 120 \| 7 \| 2 \| 3 \|/);
  assert.match(md, /## 直近 30 日に紹介したツール（再掲しない）\n\nResurf/);
});

test("a late judgment says so in the report, with the day it was due", () => {
  const videos = [];
  for (let i = 0; i < 20; i++) {
    videos.push(video(addDays("2026-09-18", i), { genre: "ai-tools-top5", ig: { views: 30, saved: 0 }, yt: 1 }));
  }
  const onTime = renderMarkdown({ videos }, { today: "2026-10-02" });
  assert.match(onTime, /今日の判定（今日は第 1 期 09-18\.\.10-01 の判定日）/);
  assert.doesNotMatch(onTime, /本来の判定日/);

  const late = renderMarkdown({ videos }, { today: "2026-10-04" });
  assert.match(late, /本来の判定日は 2026-10-02 で、その朝のレポートが出ていれば台帳に二重に書かない/);
});
