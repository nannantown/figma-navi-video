/**
 * Time helpers shared by the Product Hunt fetcher and the enriched-data
 * validator. Product Hunt days run midnight-to-midnight Pacific time
 * (America/Los_Angeles, DST-aware).
 *
 * 【一次資料】Product Hunt day boundaries:
 *   https://help.producthunt.com/en/articles/2305333-getting-started (2026-09-14)
 */

export const PACIFIC_TZ = "America/Los_Angeles";

// The morning routine is scheduled at 07:30 JST (cron 30 22 * * * UTC).
export const ROUTINE_TIME_JST = "07:30:00";

export function tzParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function tzOffsetMinutes(date, timeZone) {
  const p = tzParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - date.getTime()) / 60000;
}

export function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** UTC instant of local midnight (00:00:00) on y-m-d in `timeZone`, DST-safe. */
export function zonedMidnightUtc(year, month, day, timeZone = PACIFIC_TZ) {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = naive - tzOffsetMinutes(new Date(naive), timeZone) * 60000;
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  guess = naive - offset * 60000;
  return new Date(guess);
}

/**
 * Bounds of the Pacific calendar day `dayOffset` days from `now`
 * (0 = the day currently in progress on Product Hunt, -1 = the last closed day).
 */
export function pacificDayBounds(dayOffset = 0, now = new Date()) {
  const p = tzParts(now, PACIFIC_TZ);
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth() + 1;
  const d = target.getUTCDate();
  const after = zonedMidnightUtc(y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const before = zonedMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return {
    date: ymd(y, m, d),
    postedAfter: after.toISOString(),
    postedBefore: before.toISOString(),
    status: before.getTime() <= now.getTime() ? "final" : "in_progress",
    leaderboardUrl: `https://www.producthunt.com/leaderboard/daily/${y}/${m}/${d}`,
  };
}

/**
 * JST date of the morning video a snapshot is meant for.
 * Runs from 12:00 JST onward prepare the next morning's video.
 */
export function videoDateForSnapshot(now = new Date()) {
  const p = tzParts(now, "Asia/Tokyo");
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + (p.hour >= 12 ? 1 : 0)));
  return ymd(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

/** The routine's scheduled start for a JST video date. */
export function routineAnchor(videoDate) {
  return new Date(`${videoDate}T${ROUTINE_TIME_JST}+09:00`);
}

/**
 * Freshness window start for a video date: 00:00 Pacific on the day before the
 * Pacific day that is in progress when the routine starts. "新作" = published
 * on Product Hunt on that Pacific day or the next one, which is always within
 * 48 hours of the routine start (38.5-39.5 h at most). Anchored to the video
 * date — not to the wall clock — so the routine and a later pipeline run agree.
 */
export function freshSince(videoDate) {
  const p = tzParts(routineAnchor(videoDate), PACIFIC_TZ);
  const prev = new Date(Date.UTC(p.year, p.month - 1, p.day - 1));
  return zonedMidnightUtc(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
}

/**
 * The Pacific date whose final Product Hunt ranking a ranking-mode video must
 * use: the day that starts at freshSince (the last closed day at 07:30 JST).
 */
export function expectedRankingDate(videoDate) {
  const p = tzParts(freshSince(videoDate), PACIFIC_TZ);
  return ymd(p.year, p.month, p.day);
}

/** true when `publishedAt` (ISO 8601 with offset) is inside the freshness window of `videoDate`. */
export function isFresh(publishedAt, videoDate) {
  const t = Date.parse(publishedAt ?? "");
  if (!Number.isFinite(t)) return false;
  return t >= freshSince(videoDate).getTime() && t <= routineAnchor(videoDate).getTime() + 24 * 3600 * 1000;
}
