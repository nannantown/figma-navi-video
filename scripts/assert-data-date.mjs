/**
 * Guard for the recovery workflow (post-today-instagram.yml).
 *
 * That workflow can download an older day's video from its GitHub Release, but
 * generate-data.mjs / generate-caption.mjs always read the working tree's
 * data/enriched-ai-tools.json — which holds *today's* script. Posting an older
 * video with today's tool descriptions is worse than not posting at all, so the
 * run stops here instead.
 *
 * Usage: node scripts/assert-data-date.mjs 20260917
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function assertDataDate(tag, dataDate) {
  if (!/^\d{8}$/.test(tag ?? "")) return `date tag must be YYYYMMDD, got ${JSON.stringify(tag)}`;
  const want = `${tag.slice(0, 4)}-${tag.slice(4, 6)}-${tag.slice(6, 8)}`;
  if (dataDate === want) return null;
  return `data/enriched-ai-tools.json holds ${dataDate ?? "no date"}, but this run posts the ${want} video — the captions would describe different tools than the video shows. Re-post today's video instead, or check out the commit of ${want} first.`;
}

const entry = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (entry) {
  let dataDate = null;
  try {
    dataDate = JSON.parse(readFileSync(join(root, "data/enriched-ai-tools.json"), "utf-8")).date;
  } catch (err) {
    console.error(`::error title=No script to post::data/enriched-ai-tools.json could not be read (${err.message})`);
    process.exit(1);
  }
  const problem = assertDataDate(process.argv[2], dataDate);
  if (problem) {
    console.error(`::error title=Date mismatch::${problem}`);
    process.exit(1);
  }
  console.log(`Captions and video both belong to ${dataDate}`);
}
