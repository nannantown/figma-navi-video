/** Finish the morning routine's existing PR delivery; never generates copy or posts.
 * Default = read-only check. --merge explicitly enables the existing squash merge.
 * Production success means the exact validated ledger is present on main, not
 * merely that git push / gh pr merge returned zero (the cloud proxy can do that).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { todayJst } from "./enriched-schema.mjs";
import { EPISODES_PATH, validateEpisodes, airedCheck } from "./jev.mjs";

export const REPO = "nannantown/figma-navi-video";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliRun = (args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function failureText(err) {
  return String(err?.stderr || err?.message || err).trim().slice(0, 1200);
}

function apiJson(run, path) {
  return JSON.parse(run(["api", `repos/${REPO}/${path}`, "--method", "GET"]));
}

function remoteLedger(run) {
  const file = apiJson(run, `contents/${EPISODES_PATH}?ref=main`);
  if (file.encoding !== "base64" || typeof file.content !== "string") throw new Error("Cannot read main ledger: GitHub contents response is not base64 JSON");
  return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
}

function checkPr(run, pr, head, date) {
  const info = apiJson(run, `pulls/${pr}`);
  if (info.base?.repo?.full_name !== REPO || info.head?.repo?.full_name !== REPO || info.base?.ref !== "main") throw new Error(`PR #${pr} must belong to ${REPO} and target main`);
  if (info.head?.sha !== head || info.head?.ref !== `routine-content-${date}`) throw new Error(`PR #${pr} head changed or is not today's routine branch; stop and validate again`);
  if (!info.merged && info.state !== "open") throw new Error(`PR #${pr} is closed without a merge`);
  if (!info.merged && info.mergeable === false) throw new Error(`PR #${pr} has conflicts; stop and validate against current main`);
  const files = apiJson(run, `pulls/${pr}/files?per_page=100`);
  const allowed = new Set([EPISODES_PATH, `docs/pdca/${date}.md`]);
  if (!Array.isArray(files) || files.length !== info.changed_files || !files.some((f) => f.filename === EPISODES_PATH) || files.some((f) => !allowed.has(f.filename))) {
    throw new Error(`PR #${pr} must change only ${EPISODES_PATH} and today's PDCA report`);
  }
  return info;
}

/** Inject gh, time and sleep in tests; no real token or remote write is needed. */
export async function deliverJev({ expected, history = null, pr, head, merge = false, run = cliRun, now = () => new Date(), sleep = delay, log = console.log, checkAired = airedCheck }) {
  if (!Number.isSafeInteger(pr) || pr < 1 || !/^[a-f0-9]{40}$/.test(head || "")) throw new Error("Require --pr=<number> and --head=<full validated commit SHA>");
  const date = todayJst(now());
  const assertToday = () => {
    if (todayJst(now()) !== date) throw new Error(`JST date changed from ${date}; stop, fetch current main and research the new day's episode`);
  };
  if (expected?.episodes?.at(-1)?.date !== date) throw new Error(`Only today's (${date}) latest episode can be delivered; no past or future delivery`);
  const checked = validateEpisodes(expected, { date, today: date, history, checkAired });
  if (checked.errors.length) throw new Error(`Today's ledger is invalid:\n${checked.errors.join("\n")}`);
  const baseline = { ...expected, episodes: expected.episodes.slice(0, -1) };
  const verify = () => {
    assertToday();
    if (!isDeepStrictEqual(remoteLedger(run), expected)) throw new Error(`DELIVERY FAILED: main does not contain the exact validated ${date} ledger (PR #${pr}, head ${head})`);
    log(`OK: main received the exact validated ${date} episode (PR #${pr}, head ${head})`);
    return { date, pr, head, delivered: true };
  };

  let info = checkPr(run, pr, head, date);
  if (!merge) {
    if (!info.merged) throw new Error(`DELIVERY FAILED: PR #${pr} is not merged; today's episode has not been delivered by this PR`);
    return verify();
  }
  if (info.merged) return verify(); // Resume after a lost merge response.

  const failures = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      await sleep((attempt - 1) * 20_000);
      info = checkPr(run, pr, head, date);
      if (info.merged) return verify();
    }
    assertToday();
    // Another content PR may have landed since validation. Never overwrite its
    // ledger or merge two independently written episodes for the same slot.
    if (!isDeepStrictEqual(remoteLedger(run), baseline)) throw new Error(`Main ledger changed since validation; stop, fetch main and validate again (PR #${pr})`);
    // Take one final time check after the network reads, before any mutation.
    assertToday();
    try {
      run(["pr", "merge", String(pr), "--repo", REPO, "--squash", "--match-head-commit", head]);
    } catch (err) {
      const reason = `merge attempt ${attempt}: ${failureText(err)}`;
      failures.push(reason);
      log(reason);
    }
    info = checkPr(run, pr, head, date);
    if (info.merged) return verify();
  }
  throw new Error(`DELIVERY FAILED: PR #${pr} remains unmerged after 3 attempts (head ${head}).\n${failures.join("\n") || "gh returned success, but GitHub still reports the PR as open"}\nDo not run the video workflow or relabel this episode; report the PR and error to the owner.`);
}

async function cli(args) {
  if (args.some((a) => !/^(--merge|--pr=\d+|--head=[a-f0-9]{40})$/.test(a))) throw new Error("Usage: node scripts/deliver-jev.mjs --pr=<number> --head=<SHA> [--merge]");
  const pr = Number(args.find((a) => a.startsWith("--pr="))?.slice(5));
  const head = args.find((a) => a.startsWith("--head="))?.slice(7);
  if (!/^[a-f0-9]{40}$/.test(head || "")) throw new Error("Require --head=<full validated commit SHA>");
  // Read the committed ledger, not an uncommitted edit or a verification sample.
  const expected = JSON.parse(execFileSync("git", ["show", `${head}:${EPISODES_PATH}`], { cwd: root, encoding: "utf8", timeout: 10_000 }));
  const history = JSON.parse(readFileSync(join(root, "data/performance-history.json"), "utf8"));
  await deliverJev({ expected, history, pr, head, merge: args.includes("--merge") });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  cli(process.argv.slice(2)).catch((err) => { console.error(failureText(err)); process.exitCode = 1; });
}
