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

/** Print the annotation and append the job summary when running in Actions. */
export function reportSkip(skip, { env = process.env, log = console.log, append = appendFileSync } = {}) {
  log(skipWarningCommand(skip));
  if (env.GITHUB_STEP_SUMMARY) append(env.GITHUB_STEP_SUMMARY, skipSummaryMarkdown(skip) + "\n");
}
