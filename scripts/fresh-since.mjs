/**
 * Print the "新作" window for a video date: Product Hunt launches published at
 * or after this instant count as new (see freshSince in pacific-time.mjs).
 *
 * Usage:
 *   node scripts/fresh-since.mjs              # today's video date (JST)
 *   node scripts/fresh-since.mjs 2026-09-15
 */

import { freshSince, expectedRankingDate, tzParts, PACIFIC_TZ } from "./pacific-time.mjs";
import { todayJst } from "./enriched-schema.mjs";

const videoDate = process.argv[2] || todayJst();
if (!/^\d{4}-\d{2}-\d{2}$/.test(videoDate)) {
  console.error("usage: node scripts/fresh-since.mjs [YYYY-MM-DD]");
  process.exit(1);
}
const since = freshSince(videoDate);
const p = tzParts(since, PACIFIC_TZ);
console.log(`video date ${videoDate}: new launches = published at or after ${since.toISOString()} (${p.month}/${p.day} 00:00 Pacific)`);
console.log(`ranking mode: source.ph_date must be ${expectedRankingDate(videoDate)} (that day's final Product Hunt ranking)`);
