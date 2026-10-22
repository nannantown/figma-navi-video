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
import { readContentFormat, seriesOf, resolveEpisodesPath, LESSON_GENRE } from "./jev.mjs";
import { loadHistory } from "./history.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function assertDataDate(tag, dataDate) {
  if (!/^\d{8}$/.test(tag ?? "")) return `date tag must be YYYYMMDD, got ${JSON.stringify(tag)}`;
  const want = `${tag.slice(0, 4)}-${tag.slice(4, 6)}-${tag.slice(6, 8)}`;
  if (dataDate === want) return null;
  return `the script data holds ${dataDate ?? "no date"}, but this run posts the ${want} video — the captions would describe different tools than the video shows. Re-post today's video instead, or check out the commit of ${want} first.`;
}

const entry = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (entry) {
  let dataDate = null;
  // Ledger formats (news / jev): generate-data.mjs renders the ledger's episode
  // for today, so the latest episode is what the captions would describe.
  const series = seriesOf(readContentFormat(root));
  const jev = Boolean(series);
  const dataPath = jev ? resolveEpisodesPath(root, process.env, series) : join(root, "data/enriched-ai-tools.json");
  try {
    const data = JSON.parse(readFileSync(dataPath, "utf-8"));
    dataDate = jev ? data.episodes?.at(-1)?.date : data.date;
  } catch (err) {
    console.error(`::error title=No script to post::${dataPath} could not be read (${err.message})`);
    process.exit(1);
  }
  // A lesson day posted from the stock (generate-data.mjs falls back the same way again).
  const tagDate = /^\d{8}$/.test(process.argv[2] ?? "") ? `${process.argv[2].slice(0, 4)}-${process.argv[2].slice(4, 6)}-${process.argv[2].slice(6, 8)}` : null;
  if (series?.format === "lesson" && dataDate !== tagDate && (loadHistory(root)?.videos || []).some((v) => v?.genre === LESSON_GENRE && v.date === tagDate && v.jev?.fallback)) dataDate = tagDate;
  const problem = assertDataDate(process.argv[2], dataDate);
  if (problem) {
    console.error(`::error title=Date mismatch::${problem}`);
    process.exit(1);
  }
  console.log(`Captions and video both belong to ${dataDate}`);
}
