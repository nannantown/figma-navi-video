/**
 * Numbers for the daily PDCA report of genre trial #1 (新作AIツール N選 from the Product Hunt feed).
 *
 * Reads data/performance-history.json and prints Markdown the routine pastes
 * into docs/pdca/YYYY-MM-DD.md. The judgement metrics are the IG views median
 * and the IG saves total over the trial window, with YT views median shown
 * separately (IG and YT are never added together).
 *
 * Aggregation is identical to the common jq command in sns-hub
 * docs/strategy/genre-experiment.md: IG rows need instagram.views != null,
 * YT rows need stats.updatedAt != null, median averages the two middle values.
 *
 * Usage:
 *   node scripts/pdca-summary.mjs                       # today JST
 *   node scripts/pdca-summary.mjs --today=2026-09-20 --start=2026-09-15
 */

import { readFileSync, realpathSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GENRE, TRIAL, todayJst } from "./enriched-schema.mjs";
import { isSkipEntry, postedVideos } from "./history.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const historyPath = join(__dirname, "..", "data", "performance-history.json");

export const TRIAL_DAYS = 14;
// Planned first post of the new format: the branch is merged after the
// 2026-09-16 daily run (that morning still posted the old format), so the first
// new video is 2026-09-17. The real start is the first posted ai-tools-top5 day
// in performance-history.json.
export const PLANNED_START = "2026-09-17";
export const MIN_SAMPLES = 7;
// A judgment that was missed on its day stays due for this many more mornings.
const JUDGMENT_GRACE_DAYS = 2;

// Initial thresholds (sns-hub docs/strategy/genre-experiment.md (c), provisional).
export const THRESHOLDS = {
  ig: { dead: { viewsMedian: 10, savedSum: 5 }, switch: { viewsMedian: 50, savedSum: 5 } },
  yt: { dead: { viewsMedian: 5 }, switch: { viewsMedian: 20 } },
};

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetween(from, to) {
  const toUtc = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

export function genreOf(video) {
  return video.genre || "design-news";
}

export function summarizeWindow(videos, { from, to }) {
  const all = videos.filter((v) => v.date >= from && v.date <= to);
  // Skip days (no video on purpose) are counted, never measured.
  const inWindow = postedVideos(all);
  const yt = inWindow.filter((v) => v.stats?.updatedAt != null).map((v) => v.stats.views ?? 0);
  const ig = inWindow.filter((v) => v.instagram != null && v.instagram.views != null).map((v) => v.instagram);
  return {
    from,
    to,
    posts: inWindow.length,
    skipped: all.length - inWindow.length,
    yt: { n: yt.length, viewsMedian: median(yt) },
    ig: {
      n: ig.length,
      viewsMedian: median(ig.map((m) => m.views)),
      savedSum: ig.reduce((s, m) => s + (m.saved ?? 0), 0),
      sharesSum: ig.reduce((s, m) => s + (m.shares ?? 0), 0),
      reachMedian: median(ig.map((m) => m.reach).filter((x) => x != null)),
    },
  };
}

export function judgeIg({ n, viewsMedian, savedSum }) {
  if (n < MIN_SAMPLES) return "判定保留（データ不足）";
  const t = THRESHOLDS.ig;
  if (viewsMedian < t.dead.viewsMedian && savedSum < t.dead.savedSum) return "配信死亡";
  if (viewsMedian < t.switch.viewsMedian && savedSum < t.switch.savedSum) return "切替候補";
  return "続行";
}

export function judgeYt({ n, viewsMedian }) {
  if (n < MIN_SAMPLES) return "判定保留（データ不足）";
  const t = THRESHOLDS.yt;
  if (viewsMedian < t.dead.viewsMedian) return "配信死亡";
  if (viewsMedian < t.switch.viewsMedian) return "切替候補";
  return "続行";
}

/**
 * Trial position: actual start = first posted entry of this genre (skip days do
 * not start a trial), else the planned start.
 *
 * The trial is judged every TRIAL_DAYS, as in docs/genre-experiment.md
 * (d = today − start): on d ≥ 14 with d % 14 = 0 the window is
 * (cycleStart − 14)..(cycleStart − 1), `verdict` is set and the next judgment is
 * cycleStart + 14; on every other day the window is max(start, today − 13)..today,
 * `verdict` is null and the next judgment is start + 14 × (floor(d / 14) + 1).
 * So the routine writes a judgment section once per cycle, not every morning after.
 * A judgment stays due for JUDGMENT_GRACE_DAYS mornings after its day (same
 * window, same verdict) so that one missed morning cannot skip a whole cycle.
 */
export function trialStatus(videos, { today, plannedStart = PLANNED_START }) {
  const trialVideos = videos.filter((v) => genreOf(v) === GENRE).sort((a, b) => a.date.localeCompare(b.date));
  const firstPost = postedVideos(trialVideos)[0];
  const started = Boolean(firstPost);
  const startDate = started ? firstPost.date : plannedStart;
  const dayN = daysBetween(startDate, today) + 1;
  const elapsed = Math.max(0, dayN - 1);
  const cycleIndex = started ? Math.floor(elapsed / TRIAL_DAYS) : 0;
  const cycleStart = addDays(startDate, cycleIndex * TRIAL_DAYS);
  const dayInCycleIndex = started ? elapsed % TRIAL_DAYS : 0;
  // The judgment is due on day start + 14k, but the routine can miss a morning
  // (a failed run, a late start). Without a grace window `% 14 === 0` would skip
  // that cycle's judgment for good, so it stays due for JUDGMENT_GRACE_DAYS more
  // mornings. The window is anchored to the finished cycle, not to today, so a
  // late judgment reads exactly the same 14 days as an on-time one.
  const isJudgmentDay = started && elapsed >= TRIAL_DAYS && dayInCycleIndex <= JUDGMENT_GRACE_DAYS;
  const judgmentLate = isJudgmentDay && dayInCycleIndex > 0;
  const from = isJudgmentDay ? addDays(cycleStart, -TRIAL_DAYS) : [startDate, addDays(today, -(TRIAL_DAYS - 1))].sort().at(-1);
  const to = isJudgmentDay ? addDays(cycleStart, -1) : today;
  const summary = summarizeWindow(trialVideos, { from, to });
  return {
    started,
    startDate,
    dayN,
    cycle: cycleIndex + 1,
    dayInCycle: started ? (elapsed % TRIAL_DAYS) + 1 : null,
    // The next judgment after today (on a judgment day: the one after it).
    judgmentDate: addDays(cycleStart, TRIAL_DAYS),
    isJudgmentDay,
    judgmentLate,
    judgedCycle: isJudgmentDay ? cycleIndex : null,
    summary,
    verdict: isJudgmentDay ? { ig: judgeIg(summary.ig), yt: judgeYt(summary.yt) } : null,
  };
}

const fmt = (x) => (x == null ? "—" : Number.isInteger(x) ? String(x) : x.toFixed(1));

export function renderMarkdown(history, { today, plannedStart = PLANNED_START }) {
  const videos = history.videos || [];
  const st = trialStatus(videos, { today, plannedStart });
  const s = st.summary;
  const windowLabel = s.from > s.to ? "—" : `${s.from.slice(5)}..${s.to.slice(5)}`;
  const day = !st.started ? `開始前（予定 ${st.startDate}）` : `Day ${st.dayInCycle} / ${TRIAL_DAYS}（第 ${st.cycle} 期）`;
  const lines = [];

  lines.push("## ジャンル試行の状態");
  lines.push("");
  lines.push("| アカウント | 試行 # | ジャンル / 型 | 開始日 | 経過日 | 判定窓 | IG views 中央値 | IG 保存合計 | YT views 中央値 | 次の判定日 |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  lines.push(`| IG | #${TRIAL} | 新作AIツール N選（Product Hunt 公式フィード） | ${st.startDate}${st.started ? "" : "（予定）"} | ${day} | ${windowLabel} (n=${s.ig.n}) | ${fmt(s.ig.viewsMedian)} | ${s.ig.savedSum} | — | ${st.judgmentDate} |`);
  lines.push(`| YT | #${TRIAL} | 同上 | ${st.startDate}${st.started ? "" : "（予定）"} | ${day} | ${windowLabel} (n=${s.yt.n}) | — | — | ${fmt(s.yt.viewsMedian)} | ${st.judgmentDate} |`);
  lines.push("");
  if (st.verdict) {
    lines.push(
      `- 今日の判定（今日は第 ${st.judgedCycle} 期 ${windowLabel} の判定日${st.judgmentLate ? "。本来の判定日は " + addDays(st.startDate, st.judgedCycle * TRIAL_DAYS) + " で、その朝のレポートが出ていれば台帳に二重に書かない" : ""}）: IG = **${st.verdict.ig}** / YT = **${st.verdict.yt}**（閾値: docs/strategy.md の合格ライン）`
    );
  } else {
    lines.push(`- 今日の判定: なし（次の判定日 ${st.judgmentDate} まで待つ）。IG 参考: シェア合計 ${s.ig.sharesSum} / リーチ中央値 ${fmt(s.ig.reachMedian)}`);
  }
  lines.push(`- 判定窓の投稿 ${s.posts} 本 / 休止 ${s.skipped} 日（休止日は中央値・合計に入れない）`);
  lines.push("");

  // Baseline: the design-news genre's last 14 days before this trial started.
  const legacy = videos.filter((v) => genreOf(v) !== GENRE && v.date < st.startDate);
  if (legacy.length > 0) {
    const lastLegacy = legacy.map((v) => v.date).sort().at(-1);
    const b = summarizeWindow(legacy, { from: addDays(lastLegacy, -13), to: lastLegacy });
    lines.push(
      `- 比較（旧ジャンル: デザインニュース、${b.from.slice(5)}..${b.to.slice(5)}）: IG views 中央値 ${fmt(b.ig.viewsMedian)} / IG 保存合計 ${b.ig.savedSum} (n=${b.ig.n}) / YT views 中央値 ${fmt(b.yt.viewsMedian)} (n=${b.yt.n})`
    );
    lines.push("");
  }

  const recent = videos
    .filter((v) => v.date >= addDays(today, -13) && v.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  lines.push("## 直近 14 日の投稿（IG views / 保存を主指標に）");
  lines.push("");
  lines.push("| 日付 | ジャンル | method | ツール | IG views | IG 保存 | IG シェア | YT views |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const v of recent) {
    if (isSkipEntry(v)) {
      lines.push(
        `| ${v.date} | ${genreOf(v)} | — | 休止（${v.skip.reason}／新作の候補 ${v.skip.fresh_candidates ?? "?"}・スナップショットの新作AI ${v.skip.snapshot_fresh_ai ?? "照合なし"}） | — | — | — | — |`
      );
      continue;
    }
    const tools = (v.tools || []).map((t) => t.name).join(" / ") || (v.projects || []).slice(0, 1).join("") || "—";
    const ig = v.instagram;
    const igPending = ig && ig.views == null ? "未取得" : "—";
    lines.push(
      `| ${v.date} | ${genreOf(v)} | ${v.discovery?.method || "—"} | ${tools} | ${ig?.views ?? igPending} | ${ig?.saved ?? "—"} | ${ig?.shares ?? "—"} | ${v.stats?.updatedAt ? v.stats.views ?? 0 : "未取得"} |`
    );
  }
  lines.push("");
  lines.push("※ IG insights は最大 48 時間遅れる。未取得の回は中央値・合計から除外している。");
  lines.push("");

  // Dedupe input for the routine: tools featured in the last 30 days.
  const featured = [];
  for (const v of videos.filter((x) => x.date >= addDays(today, -30) && x.date <= today)) {
    for (const t of v.tools || []) {
      if (t?.name && !featured.includes(t.name)) featured.push(t.name);
    }
  }
  lines.push("## 直近 30 日に紹介したツール（再掲しない）");
  lines.push("");
  lines.push(featured.length > 0 ? featured.join(" / ") : "（まだなし）");
  return lines.join("\n");
}

function main() {
  const todayArg = process.argv.find((a) => a.startsWith("--today="));
  const startArg = process.argv.find((a) => a.startsWith("--start="));
  const today = todayArg ? todayArg.slice("--today=".length) : todayJst();
  const plannedStart = startArg ? startArg.slice("--start=".length) : PLANNED_START;
  let history;
  try {
    history = JSON.parse(readFileSync(historyPath, "utf-8"));
  } catch (err) {
    console.error(`data/performance-history.json が読めません（${err.message}）。ファイルが壊れていないか確認してください。`);
    process.exit(1);
  }
  console.log(renderMarkdown(history, { today, plannedStart }));
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirectRun) main();
