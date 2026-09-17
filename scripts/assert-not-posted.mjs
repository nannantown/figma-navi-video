/**
 * Guard for the recovery workflow (post-today-instagram.yml).
 *
 * The workflow exists because an Instagram upload can fail on its own after the
 * YouTube one succeeded. Running it twice would post the same Reel twice, and
 * Instagram has no idempotency key — so stop when the history already records a
 * media id for that day. `force` on the dispatch skips this guard.
 *
 * Usage: node scripts/assert-not-posted.mjs 20260917
 */
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadHistory } from "./history.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function alreadyPostedProblem(history, tag) {
  if (!/^\d{8}$/.test(tag ?? "")) return `date tag must be YYYYMMDD, got ${JSON.stringify(tag)}`;
  const date = `${tag.slice(0, 4)}-${tag.slice(4, 6)}-${tag.slice(6, 8)}`;
  const entry = (history?.videos || []).find((v) => v && v.date === date);
  const mediaId = entry?.instagram?.mediaId;
  if (!mediaId) return null;
  return `${date} is already recorded as posted to Instagram (media ${mediaId}). Re-running would publish the same Reel twice — run this workflow with force=true only if you checked the account and the post is really missing.`;
}

const entry = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (entry) {
  const problem = alreadyPostedProblem(loadHistory(root), process.argv[2]);
  if (problem) {
    console.error(`::error title=Already posted::${problem}`);
    process.exit(1);
  }
  console.log(`No Instagram media recorded for ${process.argv[2]} — going ahead`);
}
