/**
 * The captions a day's Reel actually went out with, for an Instagram retry.
 *   node scripts/day-run-captions.mjs --date=YYYYMMDD   # needs output/aitools-<date>.mp4 (from the Release)
 * The Release keeps only the video; daily-video.yml's artifact (30 days) keeps
 * the video AND output/captions.json. The artifact whose video is byte-for-byte
 * the Release's (SHA-256) holds the caption of that post → output/captions.json
 * (+ output/trending-data.json, the day's data record-upload.mjs reads).
 * No match → exit 1 (a scheduled retry never regenerates a caption).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** daily-video.yml runs created on the stamp's JST day, newest first (gh lists newest first). */
export function runsOfDay(runs, stamp) {
  const day = (iso) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10).replaceAll("-", "");
  return (runs || []).filter((r) => day(r.createdAt) === stamp);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stamp = process.argv.find((a) => a.startsWith("--date="))?.slice(7);
  if (!/^\d{8}$/.test(stamp ?? "")) throw new Error("--date=YYYYMMDD required");
  const video = `output/aitools-${stamp}.mp4`;
  const want = sha(video);
  const runs = JSON.parse(execFileSync("gh", ["run", "list", "--workflow", "daily-video.yml", "--limit", "30", "--json", "databaseId,number,createdAt"], { encoding: "utf-8" }));
  for (const run of runsOfDay(runs, stamp)) {
    const dir = mkdtempSync(join(tmpdir(), "day-run-"));
    try {
      execFileSync("gh", ["run", "download", String(run.databaseId), "-n", `aitools-video-${run.number}`, "-D", dir], { stdio: "inherit" });
    } catch {
      continue; // no artifact (cancelled before upload, expired)
    }
    const v = join(dir, `aitools-${stamp}.mp4`);
    const c = join(dir, "captions.json");
    if (existsSync(v) && existsSync(c) && sha(v) === want) {
      copyFileSync(c, "output/captions.json");
      // The day's data too, so record-upload.mjs folds the same tools/genre into the entry.
      const data = join(dir, "trending-data.json");
      if (existsSync(data)) copyFileSync(data, "output/trending-data.json");
      console.log(`Captions from daily-video run #${run.number} (its video matches the Release v${stamp})`);
      process.exit(0);
    }
  }
  console.error(`::error title=No captions::no daily-video.yml artifact of ${stamp} holds the Release's video — the caption it went out with is unknown`);
  process.exit(1);
}
