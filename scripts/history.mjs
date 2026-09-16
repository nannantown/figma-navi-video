/**
 * data/performance-history.json helpers shared by record-upload.mjs,
 * fetch-stats.mjs and pdca-summary.mjs.
 *
 * A "skip entry" records a day the routine deliberately published nothing
 * (too few new launches). It keeps the day visible in the history and the
 * PDCA report, but must never be treated as a posted video: it has no
 * videoId, no stats and no Instagram media, and it is excluded from medians,
 * hashtag/title learning and the trial start date.
 */

import { readFileSync } from "fs";
import { join } from "path";

export const HISTORY_KEEP_DAYS = 90;

/**
 * data/performance-history.json for validation (the 30-day repeat check), or
 * null when it is missing or unreadable — the check is then skipped, never fatal.
 */
export function loadHistory(rootDir) {
  try {
    return JSON.parse(readFileSync(join(rootDir, "data", "performance-history.json"), "utf-8"));
  } catch {
    return null;
  }
}

export function isSkipEntry(video) {
  return Boolean(video && video.skip && typeof video.skip === "object");
}

/** Entries that are real posts (not skip days). */
export function postedVideos(videos) {
  return (videos || []).filter((v) => !isSkipEntry(v));
}

export function buildSkipEntry({ date, genre, trial, skip }) {
  return {
    videoId: null,
    videoUrl: null,
    date,
    genre,
    trial,
    skip: {
      reason: String(skip.reason ?? ""),
      fresh_candidates: Number.isInteger(skip.fresh_candidates) ? skip.fresh_candidates : null,
      snapshot_fresh_ai: Number.isInteger(skip.snapshot_fresh_ai) ? skip.snapshot_fresh_ai : null,
    },
    title: "",
    titleTemplate: null,
    hashtags: [],
    languages: [],
    projects: [],
    tools: [],
    source: null,
    durationSeconds: 0,
    discovery: null,
    stats: { views: 0, likes: 0, comments: 0, updatedAt: null },
    instagram: null,
  };
}

function cutoffDate(now, keepDays) {
  const cutoff = new Date(now.getTime());
  cutoff.setDate(cutoff.getDate() - keepDays);
  return cutoff.toISOString().slice(0, 10);
}

/** Replace the entry for the same date, append, and keep the last `keepDays` days. */
const isEmptyValue = (v) =>
  v === null ||
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Fold `next` into the entry already recorded for that day, keeping everything
 * `next` does not know about.
 *
 * The Instagram recovery workflow only downloads the video from its Release, so
 * it has no upload-result.json and reports `videoId: null`. Replacing the day
 * with that would delete the YouTube id and the stats for good — and fetch-stats
 * only refreshes entries that have a videoId, so the day would silently drop out
 * of the YouTube median too.
 */
export function mergeVideoEntry(existing, next) {
  if (!existing) return next;
  const merged = { ...existing };
  for (const [key, value] of Object.entries(next)) {
    if (isEmptyValue(value)) continue; // never overwrite something with nothing
    // 0 here means "this run did not measure it" (durationSeconds comes out 0
    // when the recovery run has no audio-durations.json), never a real zero.
    if (typeof value === "number" && value === 0 && typeof existing[key] === "number" && existing[key] > 0) continue;
    if (key === "stats") {
      // A fresh entry carries zeroes; they mean "not fetched yet", not "zero views".
      const hasNumbers = value.views || value.likes || value.comments || value.updatedAt;
      if (!hasNumbers && existing.stats) continue;
    }
    if (key === "instagram" && existing.instagram?.mediaId && !value?.mediaId) continue;
    merged[key] = value;
  }
  // A day that posted is no longer a paused day.
  if (!Object.prototype.hasOwnProperty.call(next, "skip") && merged.skip) delete merged.skip;
  return merged;
}

/**
 * Replace the day's entry (default), or fold into it with `merge: true` when the
 * caller only knows part of the day (the Instagram recovery run).
 */
export function upsertVideo(history, entry, { now = new Date(), keepDays = HISTORY_KEEP_DAYS, merge = false } = {}) {
  const base = history && Array.isArray(history.videos) ? history : { schemaVersion: 1, videos: [], optimizationLog: [], ...(history || {}) };
  const limit = cutoffDate(now, keepDays);
  const existing = merge ? (base.videos || []).find((v) => v && v.date === entry.date) : null;
  const videos = (base.videos || []).filter((v) => v.date !== entry.date);
  videos.push(merge ? mergeVideoEntry(existing, entry) : entry);
  return { ...base, videos: videos.filter((v) => v.date >= limit) };
}
