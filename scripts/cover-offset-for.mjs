/**
 * Print the Instagram thumb_offset (ms) to use when re-posting a given day.
 *
 *   node scripts/cover-offset-for.mjs 20260922
 *   node scripts/cover-offset-for.mjs 2026-09-22
 *
 * The daily run derives the offset from that day's audio durations and
 * record-upload.mjs stores it in data/performance-history.json. The recovery
 * post only has an mp4 downloaded from a Release, so it reads the number back
 * from the history instead of guessing.
 *
 * stdout is only ever the number, so the caller can use it directly:
 *   INSTAGRAM_THUMB_OFFSET_MS=$(node scripts/cover-offset-for.mjs "$DATE")
 * Everything explanatory goes to stderr.
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadHistory } from "./history.mjs";
import { FALLBACK_OFFSET_MS, FALLBACK_SAFE_MAX_OPENING_SEC } from "./cover-frame.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** "20260922" and "2026-09-22" both mean the same day. */
export function normalizeDate(raw) {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

/**
 * The recorded offset for `date`, or null. Anything that is not a usable
 * positive integer counts as "not recorded" — a 0 would put the cover on the
 * first frame of the video.
 */
export function recordedOffsetMs(history, date) {
  const entry = (history?.videos || []).find((v) => v && v.date === date);
  const ms = entry?.coverOffsetMs;
  return Number.isInteger(ms) && ms > 0 ? ms : null;
}

function main() {
  const date = normalizeDate(process.argv[2]);
  if (!date) {
    console.error(`cover-offset-for: need a date as YYYYMMDD or YYYY-MM-DD, got ${JSON.stringify(process.argv[2])}`);
    process.exit(1);
  }

  const recorded = recordedOffsetMs(loadHistory(rootDir), date);
  if (recorded !== null) {
    console.error(`cover-offset-for: ${date} recorded coverOffsetMs=${recorded} — using it.`);
    console.log(recorded);
    return;
  }

  console.error(
    `cover-offset-for: WARNING — no coverOffsetMs recorded for ${date}.\n` +
      `  Falling back to ${FALLBACK_OFFSET_MS} ms, which only lands on the first tool card\n` +
      `  when that day's opening narration was <= ${FALLBACK_SAFE_MAX_OPENING_SEC} s. If it was longer, this\n` +
      `  post's Reels cover will be the brand-constant title card and the profile\n` +
      `  grid tile will look like every other day. Check the grid after posting.\n` +
      `  (Days rendered before 2026-09-22 have no recorded offset by design.)`
  );
  console.log(FALLBACK_OFFSET_MS);
}

if (process.argv[1] && process.argv[1].endsWith("cover-offset-for.mjs")) main();
