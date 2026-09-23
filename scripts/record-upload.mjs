/**
 * Record the day in data/performance-history.json.
 *
 *   node scripts/record-upload.mjs          # a posted day: upload-result.json and/or instagram-result.json
 *   node scripts/record-upload.mjs --skip   # a skip day: output/skip.json (no video on purpose)
 *
 * Non-blocking: failures here don't affect the pipeline.
 */

import { readFileSync, writeFileSync, existsSync, realpathSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GENRE, TRIAL } from "./enriched-schema.mjs";
import { buildSkipEntry, upsertVideo } from "./history.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const historyPath = join(rootDir, "data", "performance-history.json");
const enrichedPath = join(rootDir, "data", "enriched-ai-tools.json");

function readJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readOptional(name) {
  try {
    return readJSON(join(outputDir, name));
  } catch (err) {
    console.error(`record-upload: unreadable ${name} (${err.message})`);
    return null;
  }
}

function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Which day this run records. The Instagram recovery workflow can re-post an
 * older day, and recording it as today would invent an entry for today (wiping
 * today's real one) and leave the real day unrecorded.
 *
 * `--date=2026-09-17` or `--date=20260917`, or RECORD_DATE with the same forms.
 * Anything else — including a date that does not exist, like 2026-13-45 — is a
 * hard error: guessing here corrupts the history.
 */
export function resolveRecordDate({ argv = process.argv, env = process.env, now = new Date() } = {}) {
  const arg = argv.find((a) => typeof a === "string" && a.startsWith("--date="));
  const raw = (arg ? arg.slice("--date=".length) : env.RECORD_DATE || "").trim();
  if (!raw) return localDate(now);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : /^\d{8}$/.test(raw)
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : null;
  // 2026-13-45 does not parse at all, 2026-02-30 rolls over into March: parse
  // it and compare the result back.
  const parsed = iso ? Date.parse(`${iso}T00:00:00Z`) : NaN;
  const real = Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === iso;
  if (!real) {
    throw new Error(`record-upload: --date / RECORD_DATE must be an existing day as YYYY-MM-DD or YYYYMMDD, got ${JSON.stringify(raw)}`);
  }
  return iso;
}

/** History entry for a posted day. Either platform result is enough. */
export function buildPostEntry({ date, uploadResult, igResult, trendingData, captions, audioDurations, enriched }) {
  // Genre trial #2 (Jev): the slides are not tools; the episode summary
  // (stage, kind, topic, sources) goes to `jev` instead.
  const jev = trendingData?.meta?.mode === "jev" ? trendingData.jev || null : null;
  const tools = jev ? [] : trendingData?.tools || [];
  const durationSeconds = audioDurations ? Object.values(audioDurations).reduce((sum, d) => sum + (d || 0), 0) : 0;
  return {
    // null when the YouTube upload failed or was skipped that day
    videoId: uploadResult?.videoId ?? null,
    videoUrl: uploadResult?.videoUrl ?? null,
    date,
    // Genre trial bookkeeping: pdca-summary.mjs finds the trial start date
    // from the first posted entry carrying this genre.
    genre: trendingData?.meta?.genre || GENRE,
    trial: trendingData?.meta?.trial || TRIAL,
    title: captions?.youtube?.title || "",
    titleTemplate: captions?.youtube?.titleTemplate || "standard",
    hashtags: captions?.youtube?.tags || [],
    languages: [],
    projects: jev ? [trendingData.meta.headline] : tools.map((t) => t.name),
    // Used by the routine to avoid featuring the same tool again within 30 days.
    tools: tools.map((t) => ({ name: t.name, slug: t.slug, phUrl: t.phUrl, website: t.website, pricing: t.pricing })),
    source: trendingData?.meta ? { mode: trendingData.meta.mode, label: trendingData.meta.sourceLabel } : null,
    durationSeconds: Math.round(durationSeconds),
    discovery: jev
      ? { method: jev.kind, description: jev.topic, sources: jev.sources.map((x) => x.url) }
      : enriched?.discovery || null,
    ...(jev ? { jev } : {}),
    stats: { views: 0, likes: 0, comments: 0, updatedAt: null },
    // Metrics are filled by fetch-stats.mjs (IG insights lag up to 48h)
    instagram: igResult?.mediaId
      ? {
          mediaId: igResult.mediaId,
          permalink: null,
          views: null,
          reach: null,
          likes: null,
          comments: null,
          shares: null,
          saved: null,
          updatedAt: null,
        }
      : null,
  };
}

function main() {
  const skipMode = process.argv.includes("--skip");
  let history = readJSON(historyPath) || { schemaVersion: 1, videos: [], optimizationLog: [] };

  if (skipMode) {
    const skip = readOptional("skip.json");
    if (!skip) {
      console.log("record-upload --skip: no output/skip.json, nothing to record.");
      return;
    }
    const entry = buildSkipEntry({ date: skip.date, genre: GENRE, trial: TRIAL, skip });
    history = upsertVideo(history, entry);
    writeFileSync(historyPath, JSON.stringify(history, null, 2));
    console.log(`record-upload: recorded skip day ${entry.date} (${entry.skip.reason}; fresh candidates ${entry.skip.fresh_candidates}, snapshot fresh AI ${entry.skip.snapshot_fresh_ai ?? "n/a"})`);
    return;
  }

  const uploadResult = readOptional("upload-result.json");
  const igResult = readOptional("instagram-result.json");
  if (!uploadResult?.videoId && !igResult?.mediaId) {
    console.log("record-upload: neither YouTube nor Instagram produced a result, skipping.");
    return;
  }

  const recordDate = resolveRecordDate();
  const entry = buildPostEntry({
    date: recordDate,
    uploadResult,
    igResult,
    trendingData: readOptional("trending-data.json"),
    captions: readOptional("captions.json"),
    audioDurations: readOptional("audio-durations.json"),
    enriched: (() => {
      try {
        return readJSON(enrichedPath);
      } catch {
        return null;
      }
    })(),
  });
  // Always fold into the day's entry: a run that only posted to one platform
  // must not erase what the other one recorded.
  history = upsertVideo(history, entry, { merge: true });
  const stored = history.videos.find((v) => v.date === entry.date) || entry;
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`record-upload: recorded ${stored.videoId ?? "(no YouTube upload)"} (${stored.date})`);
  console.log(`  Title: ${entry.title}`);
  console.log(`  Tools: ${entry.projects.join(" / ")}`);
  console.log(`  Instagram: ${stored.instagram ? stored.instagram.mediaId : "no media id (restored later by fetch-stats)"}`);
  console.log(`  Discovery: ${entry.discovery ? `${entry.discovery.method} (${entry.discovery.description || "no description"})` : "null"}`);
  console.log(`  History: ${history.videos.length} entries tracked`);
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
