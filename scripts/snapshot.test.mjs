import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { loadSnapshotForRun, DEFAULT_SNAPSHOT_PATH, ENRICHED_DATA_PATH } from "./snapshot.mjs";

// Real git in a throwaway repository, isolated from the user's and the outer repo's config.
const GIT_ENV = (() => {
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[k];
  return env;
})();

const runnerFor = (dir) => (args) => execFileSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "snapshot-run-"));
  const git = runnerFor(dir);
  git(["init", "-q", "-b", "main"]);
  mkdirSync(join(dir, "data"), { recursive: true });
  const write = (rel, value) => writeFileSync(join(dir, rel), `${JSON.stringify(value, null, 2)}\n`);
  const commit = (message, files) => {
    for (const [rel, value] of Object.entries(files)) write(rel, value);
    git(["add", "-A"]);
    // -c also covers git < 2.32, where GIT_CONFIG_GLOBAL is not honoured.
    git(["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", message]);
    return git(["rev-parse", "HEAD"]).trim();
  };
  return { dir, git, write, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const snap = (fetchedAt) => ({ schemaVersion: 2, forVideoDate: "2026-09-15", fetchedAt, days: [] });
const enriched = { date: "2026-09-15", genre: "ai-tools-top5", tools: [] };

test("the pipeline cross-checks against the snapshot in the routine's commit, not a newer one fetched afterwards", () => {
  const repo = makeRepo();
  try {
    repo.commit("snapshot 06:30", { [DEFAULT_SNAPSHOT_PATH]: snap("2026-09-14T21:30:00Z") });
    const routine = repo.commit("Content: 新作AIツール 2026-09-15", { [ENRICHED_DATA_PATH]: enriched });
    repo.commit("snapshot (late cron)", { [DEFAULT_SNAPSHOT_PATH]: snap("2026-09-14T23:05:00Z") });
    repo.commit("stats", { "data/performance-history.json": { videos: [] } });

    const res = loadSnapshotForRun(repo.dir, {}, { git: repo.git });
    assert.equal(res.error, null);
    assert.equal(res.commit, routine);
    assert.equal(res.snapshot.fetchedAt, "2026-09-14T21:30:00Z");
    assert.match(res.path, /^git [0-9a-f]{7}:data\/product-hunt-daily\.json$/);
    assert.match(res.notes.join("\n"), /working-tree snapshot \(fetched 2026-09-14T23:05:00Z\) is not the one at the routine's commit \(fetched 2026-09-14T21:30:00Z\)/);
  } finally {
    repo.cleanup();
  }
});

test("a routine commit that also edits the snapshot is checked against the version before it", () => {
  const repo = makeRepo();
  try {
    const fetched = repo.commit("snapshot", { [DEFAULT_SNAPSHOT_PATH]: snap("2026-09-14T21:30:00Z") });
    repo.commit("Content: 新作AIツール 2026-09-15", { [ENRICHED_DATA_PATH]: enriched, [DEFAULT_SNAPSHOT_PATH]: snap("edited-by-routine") });

    const res = loadSnapshotForRun(repo.dir, {}, { git: repo.git });
    assert.equal(res.commit, fetched);
    assert.equal(res.snapshot.fetchedAt, "2026-09-14T21:30:00Z");
    assert.match(res.notes.join("\n"), /also changed data\/product-hunt-daily\.json; using the version before it/);
  } finally {
    repo.cleanup();
  }
});

test("no snapshot at the routine's commit stays 'no snapshot' even if one was fetched later", () => {
  const repo = makeRepo();
  try {
    repo.commit("init", { "data/performance-history.json": { videos: [] } });
    repo.commit("Content: 新作AIツール 2026-09-15", { [ENRICHED_DATA_PATH]: enriched });
    repo.commit("first snapshot", { [DEFAULT_SNAPSHOT_PATH]: snap("2026-09-14T23:05:00Z") });

    const res = loadSnapshotForRun(repo.dir, {}, { git: repo.git });
    assert.equal(res.snapshot, null);
    assert.equal(res.error, null);
    assert.match(res.notes.join("\n"), /the routine had no snapshot/);
  } finally {
    repo.cleanup();
  }
});

test("dry runs, local edits, missing history and shallow clones use the working-tree snapshot", () => {
  const repo = makeRepo();
  const shallowDirs = [];
  try {
    repo.commit("snapshot", { [DEFAULT_SNAPSHOT_PATH]: snap("A") });
    repo.commit("Content", { [ENRICHED_DATA_PATH]: enriched });
    repo.commit("newer snapshot", { [DEFAULT_SNAPSHOT_PATH]: snap("B") });
    repo.commit("stats", { "data/performance-history.json": { videos: [] } });

    for (const env of [{ PH_SNAPSHOT_PATH: DEFAULT_SNAPSHOT_PATH }, { ENRICHED_PATH: "data/samples/enriched-ai-tools.sample.json" }]) {
      const res = loadSnapshotForRun(repo.dir, env, { git: repo.git });
      assert.equal(res.commit, null);
      assert.equal(res.snapshot.fetchedAt, "B");
      assert.deepEqual(res.notes, []);
    }

    const broken = loadSnapshotForRun(repo.dir, {}, { git: () => { throw new Error("not a git repository"); } });
    assert.equal(broken.snapshot.fetchedAt, "B");
    assert.match(broken.notes.join("\n"), /git history is not available; cross-checking against the working-tree snapshot/);

    // depth 3 ends at the routine's commit (no parent visible): too shallow to trust.
    // depth 4 includes its parent: the routine's snapshot is found.
    for (const [depth, expected] of [[3, "B"], [4, "A"]]) {
      const clone = mkdtempSync(join(tmpdir(), "snapshot-shallow-"));
      shallowDirs.push(clone);
      execFileSync("git", ["clone", "-q", "--depth", String(depth), `file://${repo.dir}`, clone], { env: GIT_ENV, stdio: "ignore" });
      const res = loadSnapshotForRun(clone, {}, { git: runnerFor(clone) });
      assert.equal(res.snapshot.fetchedAt, expected, `depth ${depth}`);
      if (depth === 3) assert.match(res.notes.join("\n"), /has no parent in this clone \(history too shallow\)/);
    }

    repo.write(ENRICHED_DATA_PATH, { ...enriched, date: "2026-09-16" });
    const edited = loadSnapshotForRun(repo.dir, {}, { git: repo.git });
    assert.equal(edited.snapshot.fetchedAt, "B");
    assert.match(edited.notes.join("\n"), /differs from commit [0-9a-f]{7} \(uncommitted edits\)/);
  } finally {
    repo.cleanup();
    for (const d of shallowDirs) rmSync(d, { recursive: true, force: true });
  }
});
