/** Read-only guards around the morning routine's separately reviewed merge.
 * Default checks exact delivery on main; --prepare checks the candidate before
 * review. This helper never creates a PR, merges, deletes a branch or posts.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { todayJst } from "./enriched-schema.mjs";
import { SERIES, cliSeries, validateEpisodes, airedCheck } from "./jev.mjs";

export const REPO = "nannantown/figma-navi-video";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliRun = (args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });

function apiJson(run, path) {
  return JSON.parse(run(["api", `repos/${REPO}/${path}`, "--method", "GET"]));
}

function remoteLedger(run, ledgerPath) {
  const file = apiJson(run, `contents/${ledgerPath}?ref=main`);
  if (file.encoding !== "base64" || typeof file.content !== "string") throw new Error(`Cannot read main ${ledgerPath}: GitHub contents response is not base64 JSON`);
  return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
}

/** Inject gh/time in tests. All gh requests here are GET, including --prepare. */
export function deliverJev({ expected, history = null, pr, head, prepare = false, run = cliRun, now = () => new Date(), log = console.log, checkAired = airedCheck, series = SERIES.jev }) {
  const EPISODES_PATH = series.episodesPath;
  if (!Number.isSafeInteger(pr) || pr < 1 || !/^[a-f0-9]{40}$/.test(head || "")) throw new Error("Require --pr=<number> and --head=<full validated commit SHA>");
  const date = todayJst(now());
  const assertToday = () => {
    if (todayJst(now()) !== date) throw new Error(`JST date changed from ${date}; stop, fetch current main and research the new day's episode`);
  };
  if (expected?.episodes?.at(-1)?.date !== date) throw new Error(`Only today's (${date}) latest episode can be delivered; no past or future delivery`);
  const checked = validateEpisodes(expected, { date, today: date, history, checkAired, series });
  if (checked.errors.length) throw new Error(`Today's ledger is invalid:\n${checked.errors.join("\n")}`);

  const info = apiJson(run, `pulls/${pr}`);
  if (info.base?.repo?.full_name !== REPO || info.head?.repo?.full_name !== REPO || info.base?.ref !== "main") throw new Error(`PR #${pr} must belong to ${REPO} and target main`);
  if (info.head?.sha !== head || info.head?.ref !== `routine-content-${date}`) throw new Error(`PR #${pr} head changed or is not today's routine branch; stop and validate again`);
  if (!info.merged && info.state !== "open") throw new Error(`PR #${pr} is closed without a merge`);
  if (!info.merged && info.mergeable === false) throw new Error(`PR #${pr} has conflicts; stop and validate against current main`);
  const files = apiJson(run, `pulls/${pr}/files?per_page=100`);
  const allowed = new Set([EPISODES_PATH, `docs/pdca/${date}.md`]);
  if (!Array.isArray(files) || files.length !== info.changed_files || !files.some((f) => f.filename === EPISODES_PATH) || files.some((f) => !allowed.has(f.filename) || (f.previous_filename && !allowed.has(f.previous_filename)))) {
    throw new Error(`PR #${pr} must change only ${EPISODES_PATH} and today's PDCA report`);
  }
  const main = remoteLedger(run, EPISODES_PATH);
  assertToday();
  if (info.merged) {
    if (!isDeepStrictEqual(main, expected)) throw new Error(`DELIVERY FAILED: main does not contain the exact validated ${date} ledger (PR #${pr}, head ${head})`);
    log(`OK: main received the exact validated ${date} episode (PR #${pr}, head ${head})`);
    return { date, pr, head, delivered: true, readyForReview: false };
  }
  if (!prepare) throw new Error(`DELIVERY FAILED: PR #${pr} is not merged; today's episode has not been delivered by this PR`);
  const baseline = { ...expected, episodes: expected.episodes.slice(0, -1) };
  if (!isDeepStrictEqual(main, baseline)) throw new Error(`Main ledger changed since validation; stop, fetch main and validate again (PR #${pr})`);
  log(`READY FOR REVIEW: PR #${pr}, head ${head}, date ${date}. Read the complete PR diff and sources before a separate merge action. Not delivered yet.`);
  return { date, pr, head, delivered: false, readyForReview: true };
}

/** For daily-video: only when the ledger is well formed but has no episode for
 * today (errors carry "no episode for <date>"). If the routine's branch for
 * today exists, its PR is likely unmerged (the routine's own merge is refused by
 * the auto-mode classifier on many mornings — docs/routine-merge-miss.md).
 * Branches stay after a merge, so a broken ledger must not trigger this.
 * Returns a GitHub Actions error line, or null. */
export function unmergedRoutineHint(date, errors, lsRemote = (ref) => execFileSync("git", ["ls-remote", "--heads", "origin", ref], { cwd: root, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] })) {
  if (!errors.some((e) => e.startsWith(`no episode for ${date}`))) return null;
  const branch = `routine-content-${date}`;
  let out;
  try { out = lsRemote(`refs/heads/${branch}`); } catch { return null; }
  if (!String(out).split("\n").some((l) => l.trim().split(/\s+/)[1] === `refs/heads/${branch}`)) return null;
  return `::error title=原稿 PR が未マージかもしれない::${branch} ブランチがあり、${date} の回が main に無い。PR が未作成・未マージ、またはルーチンがまだ実行中の可能性がある。PR を確かめ、merge したら daily-video.yml を手で実行し直す: https://github.com/${REPO}/pulls?q=is%3Apr+head%3A${branch}`;
}

/**
 * main's post record, read like the ledger (gh api contents?ref=main), not from the working tree
 * or origin/main (a single-branch clone never fetches it): a lesson already posted from the stock
 * at 08:15 is only on main, and it closes that day to any other lesson.
 * Fail-closed: if main cannot be read, this safety check stops instead of guessing.
 * ponytail: the contents API returns base64 only up to 1 MB (the file is ~0.2 MB on 2026-10-22);
 * past that it stops here — switch to the raw media type then.
 */
export function readMainHistory({ run = cliRun } = {}) {
  try {
    return remoteLedger(run, "data/performance-history.json");
  } catch (err) {
    throw new Error(`could not read main's data/performance-history.json (${String(err?.message || err).split("\n")[0]}) — stopped: the delivery check needs this morning's post record; retry, and do not merge until it reads`);
  }
}

function cli(args) {
  if (args.some((a) => !/^(--prepare|--pr=\d+|--head=[a-f0-9]{40}|--series=(?:lesson|jev|news))$/.test(a))) throw new Error("Usage: node scripts/deliver-jev.mjs --pr=<number> --head=<SHA> [--prepare] [--series=lesson|jev|news] (read-only; no --merge)");
  // The ledger of the committed format (lesson / news / jev), unless --series says otherwise.
  const series = cliSeries(args, root);
  const pr = Number(args.find((a) => a.startsWith("--pr="))?.slice(5));
  const head = args.find((a) => a.startsWith("--head="))?.slice(7);
  if (!/^[a-f0-9]{40}$/.test(head || "")) throw new Error("Require --head=<full validated commit SHA>");
  const expected = JSON.parse(execFileSync("git", ["show", `${head}:${series.episodesPath}`], { cwd: root, encoding: "utf8", timeout: 10_000 }));
  const history = readMainHistory();
  deliverJev({ expected, history, pr, head, prepare: args.includes("--prepare"), series });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { cli(process.argv.slice(2)); } catch (err) {
    console.error(String(err?.stderr || err?.message || err).trim());
    process.exitCode = 1;
  }
}
