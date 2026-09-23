/**
 * Turn the routine's AI tools TOP5 into narration-ready video data.
 *
 * Input:  data/enriched-ai-tools.json (written by the Claude Routine, spec: docs/enrichment-schema.md)
 * Output: output/trending-data.json
 *
 * The routine is the only source of the Japanese copy, so a missing, stale or
 * invalid file is a hard error (same policy as the design-news pipeline): we
 * would rather skip a day than post yesterday's tools again.
 *
 * Env (verification only):
 *   ENRICHED_PATH=data/samples/enriched-ai-tools.sample.json   use another file
 *   ALLOW_STALE_DATE=1                                          skip the "date == today JST" check
 *     (refused when SNS_POST_ENABLED=true, so a sample can never be posted)
 *   PH_SNAPSHOT_PATH=data/samples/product-hunt-daily.sample.json  cross-check against another snapshot
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";
import {
  parseEnrichedText,
  validateEnriched,
  toVideoTools,
  buildMeta,
  todayJst,
  defaultOpeningNarration,
  skipSnapshotCheck,
  DEFAULT_ENDING_NARRATION,
} from "./enriched-schema.mjs";
import { loadSnapshotForRun } from "./snapshot.mjs";
import { loadHistory } from "./history.mjs";
import { readContentFormat, resolveEpisodesPath, loadEpisodes, validateEpisodes, toJevVideoData } from "./jev.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");

function resolveEnrichedPath() {
  const p = process.env.ENRICHED_PATH || "data/enriched-ai-tools.json";
  return isAbsolute(p) ? p : join(rootDir, p);
}

/**
 * Genre trial #2 (data/content-format.json = "jev"): today's episode from
 * data/jev-episodes.json → the same output/trending-data.json frame. The
 * ledger checks (series order, no repeated topic or source, claims named as
 * claims) are hard errors, like the pickup checks below.
 */
function generateJevData(allowStale) {
  const path = resolveEpisodesPath(rootDir);
  const today = todayJst();
  // A dry run renders the file's latest episode, whatever its date.
  // Production also cross-checks the posted history (a sample ledger in a dry
  // run is not the production series, so it is not).
  const history = allowStale ? null : loadHistory(rootDir);
  const { errors, warnings, episode } = validateEpisodes(loadEpisodes(path), { date: today, today, pickLatest: allowStale, history });
  for (const w of warnings) console.warn(`  WARN ${w}`);
  if (errors.length > 0) throw new Error(`${path} is invalid:\n  - ${errors.join("\n  - ")}`);
  const out = toJevVideoData(episode);
  mkdirSync(outputDir, { recursive: true });
  rmSync(join(outputDir, "skip.json"), { force: true });
  const outputPath = join(outputDir, "trending-data.json");
  writeFileSync(outputPath, JSON.stringify(out, null, 2));
  console.log(`  Jev ${episode.date}: stage ${episode.stage}-${episode.stage_episode} ${episode.kind} "${episode.topic_key}" — ${out.meta.headline}`);
  console.log(`\nGenerated ${out.tools.length} slides → ${outputPath}`);
}

function main() {
  const enrichedPath = resolveEnrichedPath();
  const allowStale = process.env.ALLOW_STALE_DATE === "1";
  if (allowStale && process.env.SNS_POST_ENABLED === "true") {
    throw new Error("ALLOW_STALE_DATE=1 is for dry runs only and cannot be combined with SNS_POST_ENABLED=true.");
  }
  if (readContentFormat(rootDir) === "jev") return generateJevData(allowStale);

  if (!existsSync(enrichedPath)) {
    throw new Error(
      `${enrichedPath} not found. The Claude Routine must commit data/enriched-ai-tools.json before the pipeline runs (docs/routine-prompt.md).`
    );
  }

  const { data, repaired } = parseEnrichedText(readFileSync(enrichedPath, "utf-8"));
  if (repaired) console.warn("  JSON needed auto-repair (unescaped quotes) — tell the routine to escape them.");

  // Skip days, ranking ranks and pickup tools are cross-checked against the
  // Product Hunt snapshot the routine's commit carries (a snapshot fetched after
  // the routine must not fail its day — see loadSnapshotForRun).
  const { snapshot, path: snapshotPath, error: snapshotError, notes: snapshotNotes } = loadSnapshotForRun(rootDir);
  for (const note of snapshotNotes) console.log(`  NOTE ${note}`);
  if (snapshotError) console.warn(`  WARN ${snapshotError}`);
  console.log(`  snapshot: ${snapshotPath}${snapshot ? ` (for ${snapshot.forVideoDate}, fetched ${snapshot.fetchedAt})` : " (none)"}`);

  // History = the 30-day repeat check (today's own entry is ignored, so a re-run is fine).
  // Ranks stay off unless PH_ALLOW_RANKING=1 (the reference dry run only).
  const history = loadHistory(rootDir);
  const { errors, warnings } = validateEnriched(data, {
    today: todayJst(),
    checkDate: !allowStale,
    snapshot,
    history,
    allowRanking: process.env.PH_ALLOW_RANKING === "1",
  });
  for (const w of warnings) console.warn(`  WARN ${w}`);
  if (errors.length > 0) {
    throw new Error(`enriched-ai-tools.json is invalid:\n  - ${errors.join("\n  - ")}`);
  }

  mkdirSync(outputDir, { recursive: true });
  const skipPath = join(outputDir, "skip.json");
  rmSync(skipPath, { force: true });
  if (data.skip) {
    // Intentional no-video day (too few new launches). pipeline.mjs stops
    // cleanly but loudly (Actions warning + job summary + history entry).
    const excludedUrls = (Array.isArray(data.skip.excluded) ? data.skip.excluded : []).map((x) => x?.ph_url).filter(Boolean);
    const check = skipSnapshotCheck(snapshot, data.date, { excludedUrls });
    const record = {
      date: data.date,
      reason: data.skip.reason,
      fresh_candidates: data.skip.fresh_candidates,
      snapshot_fresh_ai: check.freshAi,
      excluded: excludedUrls.length,
      snapshot_check: check.status,
      snapshot_note: check.reason || null,
    };
    writeFileSync(skipPath, JSON.stringify(record, null, 2));
    console.log(`  SKIP ${data.date}: ${record.reason} (fresh candidates: ${record.fresh_candidates}, snapshot: ${check.status}${check.freshAi != null ? ` ${check.freshAi}` : ""})`);
    return;
  }

  const tools = toVideoTools(data);
  const meta = buildMeta(data);
  console.log(`  ${meta.dateLabel} / ${meta.headline} / ${meta.sourceLabel} / method: ${meta.method}`);
  for (const t of tools) console.log(`  ${t.badge}. ${t.name} — ${t.description} (${t.who} / ${t.pricingLabel}) [${t.sourceNote}]`);

  const out = {
    openingNarration: (data.opening_narration && data.opening_narration.trim()) || defaultOpeningNarration(meta.mode, meta.count),
    endingNarration: DEFAULT_ENDING_NARRATION,
    meta,
    tools,
  };

  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "trending-data.json");
  writeFileSync(outputPath, JSON.stringify(out, null, 2));
  console.log(`\nGenerated ${tools.length} tool sections → ${outputPath}`);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
