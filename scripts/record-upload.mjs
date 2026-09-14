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

/** History entry for a posted day. Either platform result is enough. */
export function buildPostEntry({ date, uploadResult, igResult, trendingData, captions, audioDurations, enriched }) {
  const tools = trendingData?.tools || [];
  const durationSeconds = audioDurations ? Object.values(audioDurations).reduce((sum, d) => sum + (d || 0), 0) : 0;
  return {
    // null when the YouTube upload failed or was skipped that day
    videoId: uploadResult?.videoId ?? null,
    videoUrl: uploadResult?.videoUrl ?? null,
    date,
    // Genre trial bookkeeping: pdca-summary.mjs finds the trial start date
    // from the first posted entry carrying this genre.
    genre: GENRE,
    trial: TRIAL,
    title: captions?.youtube?.title || "",
    titleTemplate: captions?.youtube?.titleTemplate || "standard",
    hashtags: captions?.youtube?.tags || [],
    languages: [],
    projects: tools.map((t) => t.name),
    // Used by the routine to avoid featuring the same tool again within 30 days.
    tools: tools.map((t) => ({ name: t.name, slug: t.slug, phUrl: t.phUrl, website: t.website, pricing: t.pricing })),
    source: trendingData?.meta ? { mode: trendingData.meta.mode, label: trendingData.meta.sourceLabel } : null,
    durationSeconds: Math.round(durationSeconds),
    discovery: enriched?.discovery || null,
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

  const entry = buildPostEntry({
    date: localDate(),
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
  history = upsertVideo(history, entry);
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
  console.log(`record-upload: recorded ${entry.videoId ?? "(no YouTube upload)"} (${entry.date})`);
  console.log(`  Title: ${entry.title}`);
  console.log(`  Tools: ${entry.projects.join(" / ")}`);
  console.log(`  Instagram: ${entry.instagram ? entry.instagram.mediaId : "no media id (restored later by fetch-stats)"}`);
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
