/**
 * Make a skip day visible in GitHub Actions: a `::warning::` annotation on the
 * run and a job summary with the reason and the candidate counts.
 *
 * 【一次資料】GitHub Actions workflow commands (warning syntax, GITHUB_STEP_SUMMARY)
 *   https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands (2026-09-14)
 *   Escaping rules: actions/toolkit packages/core/src/command.ts escapeData / escapeProperty
 *   https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts (2026-09-14)
 */

import { appendFileSync } from "fs";
import { isSkipEntry } from "./history.mjs";

// A single paused day is by design. Two in a row means the supply of new
// launches stopped — almost always the fetch workflow or the listing registry,
// not Product Hunt — and until now the run stayed green while nothing posted.
export const SKIP_STREAK_LIMIT = 2;

export function escapeWorkflowData(s) {
  return String(s ?? "").replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export function escapeWorkflowProperty(s) {
  return escapeWorkflowData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function snapshotLine(skip) {
  switch (skip.snapshot_check) {
    case "consistent":
      return `スナップショットの新作 AI 件数: ${skip.snapshot_fresh_ai}（照合済み）`;
    case "unchecked":
      return `スナップショットと照合できず: ${skip.snapshot_note || "理由不明"}`;
    default:
      return `スナップショット照合: ${skip.snapshot_check ?? "不明"}`;
  }
}

export function skipWarningCommand(skip) {
  const title = escapeWorkflowProperty(`新作AIツール ${skip.date} は休止`);
  const message = escapeWorkflowData(
    `投稿なし（動画を作らずに終了）。理由: ${skip.reason} / ルーチンが数えた新作の候補: ${skip.fresh_candidates} 本 / ${snapshotLine(skip)}`
  );
  return `::warning title=${title}::${message}`;
}

export function skipSummaryMarkdown(skip) {
  return [
    `### 新作AIツール: ${skip.date} は休止（投稿なし）`,
    "",
    `- 理由: ${skip.reason}`,
    `- ルーチンが数えた新作の候補: ${skip.fresh_candidates} 本（2 本未満のため休止）`,
    `- ${snapshotLine(skip)}`,
    "- performance-history.json に休止日として記録（中央値・合計には入れない）",
    "",
  ].join("\n");
}

function addDaysIso(date, delta) {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/**
 * How many days immediately before `date` are recorded as paused days.
 * A day with no entry at all stops the count: that run never finished, so it
 * failed loudly on its own.
 */
export function precedingSkipStreak(videos, date, { maxLookback = 30 } = {}) {
  const byDate = new Map((videos || []).filter((v) => v && typeof v.date === "string").map((v) => [v.date, v]));
  let streak = 0;
  let cursor = String(date);
  for (let i = 0; i < maxLookback; i++) {
    cursor = addDaysIso(cursor, -1);
    const entry = byDate.get(cursor);
    if (!entry || !isSkipEntry(entry)) break;
    streak++;
  }
  return streak;
}

/**
 * null while pausing is still normal; otherwise the annotation and summary for
 * a run that must go red.
 */
export function skipStreakProblem(videos, skip) {
  const streak = precedingSkipStreak(videos, skip?.date) + 1; // today included
  if (streak < SKIP_STREAK_LIMIT) return null;
  const title = escapeWorkflowProperty(`新作AIツール ${streak} 日連続で休止`);
  const message = escapeWorkflowData(
    `${skip.date} まで ${streak} 日続けて投稿がありません。Product Hunt に新作が無い日が続くことは通常ないので、` +
      `取得（fetch-product-hunt.yml）が止まっていないか、掲載の記録（listing）が壊れていないかを確認してください。今日の理由: ${skip.reason}`
  );
  return {
    streak,
    command: `::error title=${title}::${message}`,
    summary: [
      `### 新作AIツール: ${streak} 日連続で休止（投稿ゼロ）`,
      "",
      `- ${skip.date} まで ${streak} 日続けて投稿がありません`,
      "- まず `gh run list --workflow=fetch-product-hunt.yml` で取得が動いているかを見る",
      "- 取得が動いているなら、スナップショットの `listing` に `listedAfter` が入っているかを見る（全部 null なら掲載の記録が働いていない）",
      "",
    ].join("\n"),
  };
}

/** Print the annotation and append the job summary when running in Actions. */
export function reportSkip(skip, { env = process.env, log = console.log, append = appendFileSync } = {}) {
  log(skipWarningCommand(skip));
  if (env.GITHUB_STEP_SUMMARY) append(env.GITHUB_STEP_SUMMARY, skipSummaryMarkdown(skip) + "\n");
}

/** Report a run of paused days; returns true when the run must fail. */
export function reportSkipStreak(videos, skip, { env = process.env, log = console.error, append = appendFileSync } = {}) {
  const problem = skipStreakProblem(videos, skip);
  if (!problem) return false;
  log(problem.command);
  if (env.GITHUB_STEP_SUMMARY) append(env.GITHUB_STEP_SUMMARY, problem.summary + "\n");
  return true;
}
