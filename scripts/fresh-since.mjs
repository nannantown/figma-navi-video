/**
 * Print the "新作" window for a video date: Product Hunt launches at or after
 * this instant count as new. A snapshot post qualifies when its publishedAt or
 * its listedAfter is inside the window (see freshSince / isNewLaunch in
 * pacific-time.mjs).
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
console.log(`video date ${videoDate}: new launches = launched at or after ${since.toISOString()} (${p.month}/${p.day} 00:00 Pacific)`);
console.log("  a snapshot post counts when publishedAt or listedAfter is at or after this time (its fresh flag)");
console.log(`  (ranking mode is not used; with the API it would need source.ph_date ${expectedRankingDate(videoDate)})`);
