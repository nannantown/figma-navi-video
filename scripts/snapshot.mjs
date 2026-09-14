/**
 * Product Hunt snapshot (data/product-hunt-daily.json, committed by
 * fetch-product-hunt.yml) for validation cross-checks.
 *
 *   loadSnapshot        the working-tree file (validate-enriched.mjs, used by the routine)
 *   loadSnapshotForRun  the version the routine's commit carries (generate-data.mjs on Actions)
 *
 * PH_SNAPSHOT_PATH overrides the location for both (tests / dry runs).
 */

import { readFileSync, existsSync } from "fs";
import { join, isAbsolute } from "path";
import { execFileSync } from "child_process";

export const DEFAULT_SNAPSHOT_PATH = "data/product-hunt-daily.json";
export const ENRICHED_DATA_PATH = "data/enriched-ai-tools.json";

/** @returns {{ snapshot: object | null, path: string, error: string | null }} */
export function loadSnapshot(rootDir, env = process.env) {
  const rel = env.PH_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH;
  const path = isAbsolute(rel) ? rel : join(rootDir, rel);
  if (!existsSync(path)) return { snapshot: null, path, error: null };
  try {
    return { snapshot: JSON.parse(readFileSync(path, "utf-8")), path, error: null };
  } catch (err) {
    return { snapshot: null, path, error: `unreadable snapshot ${path}: ${err.message}` };
  }
}

const gitRunner = (rootDir) => (args) =>
  execFileSync("git", args, { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });

/**
 * The snapshot the routine's commit carries, for the pipeline's cross-checks.
 *
 * fetch-product-hunt.yml can commit a newer snapshot after the routine merged
 * its data (~07:30 JST) and before this job checks out main (08:15 JST, often
 * later). Checking the routine's tools against that newer file would fail days
 * for no reason: a skip looks wrong once more launches arrive, a pickup tool
 * scrolls out of the feed. So the pipeline reads data/product-hunt-daily.json
 * from the tree of the commit that last changed data/enriched-ai-tools.json
 * (the routine's squash merge; the routine validates against main's snapshot
 * right before merging, docs/routine-prompt.md step 8).
 *
 * If that commit also changed the snapshot, the version before it is used —
 * the routine must never edit fetched data.
 * Falls back to the working tree (with a note) when PH_SNAPSHOT_PATH or
 * ENRICHED_PATH is set (dry runs, verify mode), git history is unavailable or
 * too shallow, or the enriched file differs from that commit (local edits).
 *
 * @param {string} rootDir repository root
 * @param {Record<string, string | undefined>} [env]
 * @param {{ git?: (args: string[]) => string }} [deps]
 * @returns {{ snapshot: object | null, path: string, error: string | null, notes: string[], commit: string | null }}
 */
export function loadSnapshotForRun(rootDir, env = process.env, { git = gitRunner(rootDir) } = {}) {
  const notes = [];
  const workingTree = (why) => {
    if (why) notes.push(`${why}; cross-checking against the working-tree snapshot`);
    return { ...loadSnapshot(rootDir, env), notes, commit: null };
  };
  if (env.PH_SNAPSHOT_PATH || env.ENRICHED_PATH) return workingTree(null);

  let commit = "";
  let parents = [];
  try {
    [commit = "", ...parents] = git(["log", "-1", "--format=%H %P", "--", ENRICHED_DATA_PATH]).trim().split(/\s+/).filter(Boolean);
  } catch {
    return workingTree("git history is not available");
  }
  if (!commit) return workingTree(`no commit in this clone changes ${ENRICHED_DATA_PATH}`);
  const short = commit.slice(0, 7);
  // The boundary commit of a shallow clone has no parents and seems to add every file.
  if (parents.length === 0) return workingTree(`commit ${short} has no parent in this clone (history too shallow)`);

  let committed;
  try {
    committed = git(["show", `${commit}:${ENRICHED_DATA_PATH}`]);
  } catch {
    return workingTree(`cannot read ${ENRICHED_DATA_PATH} at ${short}`);
  }
  const workingEnriched = join(rootDir, ENRICHED_DATA_PATH);
  if (!existsSync(workingEnriched) || readFileSync(workingEnriched, "utf-8") !== committed) {
    return workingTree(`${ENRICHED_DATA_PATH} differs from commit ${short} (uncommitted edits)`);
  }

  let changed;
  try {
    changed = git(["diff", "--name-only", parents[0], commit, "--"]).split("\n").map((s) => s.trim());
  } catch {
    return workingTree(`cannot list the files changed by ${short}`);
  }
  let source = commit;
  if (changed.includes(DEFAULT_SNAPSHOT_PATH)) {
    source = parents[0];
    notes.push(`commit ${short} also changed ${DEFAULT_SNAPSHOT_PATH}; using the version before it (the routine must not edit fetched data)`);
  }

  const label = `git ${source.slice(0, 7)}:${DEFAULT_SNAPSHOT_PATH}`;
  let text;
  try {
    text = git(["show", `${source}:${DEFAULT_SNAPSHOT_PATH}`]);
  } catch {
    notes.push(`there is no ${DEFAULT_SNAPSHOT_PATH} at ${source.slice(0, 7)} (the routine had no snapshot)`);
    return { snapshot: null, path: label, error: null, notes, commit: source };
  }
  let snapshot = null;
  try {
    snapshot = JSON.parse(text);
  } catch (err) {
    return { snapshot: null, path: label, error: `unreadable snapshot ${label}: ${err.message}`, notes, commit: source };
  }
  const current = loadSnapshot(rootDir, env).snapshot;
  if (current && current.fetchedAt !== snapshot.fetchedAt) {
    notes.push(
      `the working-tree snapshot (fetched ${current.fetchedAt}) is not the one at the routine's commit (fetched ${snapshot.fetchedAt}); cross-checks use the routine's`
    );
  }
  return { snapshot, path: label, error: null, notes, commit: source };
}
