import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deliverJev, REPO } from "./deliver-jev.mjs";

const head = "a".repeat(40);
const date = "2026-10-12";
const sample = JSON.parse(readFileSync(new URL("../data/samples/jev-episodes.intro.sample.json", import.meta.url), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));

function fixture({ merged = false, onMerge, info: overrides = {}, files, main, expected, now } = {}) {
  const ledger = expected || clone(sample);
  if (!expected) ledger.episodes[0].date = date; // Mock copy only; never edits the production ledger.
  const info = {
    state: merged ? "closed" : "open", merged, mergeable: true, changed_files: 2,
    head: { sha: head, ref: `routine-content-${ledger.episodes.at(-1)?.date || date}`, repo: { full_name: REPO } },
    base: { ref: "main", repo: { full_name: REPO } }, ...overrides,
  };
  const baseline = { ...clone(ledger), episodes: clone(ledger.episodes.slice(0, -1)) };
  const state = { info, main: main || (merged ? clone(ledger) : baseline), merges: 0, calls: [], logs: [], sleeps: [] };
  const run = (args) => {
    state.calls.push(args);
    if (args[0] === "pr") {
      state.merges++;
      if (onMerge) return onMerge(state, ledger);
      state.info.merged = true;
      state.info.state = "closed";
      state.main = clone(ledger);
      return "Merged";
    }
    assert.equal(args[0], "api");
    assert.deepEqual(args.slice(-2), ["--method", "GET"]);
    if (args[1].endsWith("pulls/187")) return JSON.stringify(state.info);
    if (args[1].endsWith("/files?per_page=100")) return JSON.stringify(files || [{ filename: "data/jev-episodes.json" }, { filename: `docs/pdca/${ledger.episodes.at(-1).date}.md` }]);
    if (args[1].endsWith("contents/data/jev-episodes.json?ref=main")) return JSON.stringify({ encoding: "base64", content: Buffer.from(JSON.stringify(state.main)).toString("base64") });
    assert.fail(`Unexpected gh request: ${args}`);
  };
  const args = { expected: ledger, pr: 187, head, run, now: now || (() => new Date(`${date}T00:00:00Z`)), sleep: async (ms) => state.sleeps.push(ms), log: (line) => state.logs.push(line) };
  return { state, args };
}

test("default is read-only and an open content PR is a delivery failure", async () => {
  const f = fixture();
  await assert.rejects(deliverJev(f.args), /PR #187 is not merged/);
  assert.equal(f.state.merges, 0);
});

test("normal delivery merges only the pinned PR head, then checks actual main data", async () => {
  const f = fixture();
  const out = await deliverJev({ ...f.args, merge: true });
  assert.equal(out.delivered, true);
  assert.equal(f.state.merges, 1);
  assert.deepEqual(f.state.calls.find((a) => a[0] === "pr"), ["pr", "merge", "187", "--repo", REPO, "--squash", "--match-head-commit", head]);
  assert.match(f.state.logs.at(-1), /exact validated 2026-10-12/);
});

test("an already merged PR resumes read-only, without another merge", async () => {
  const f = fixture({ merged: true });
  assert.equal((await deliverJev({ ...f.args, merge: true })).delivered, true);
  assert.equal(f.state.merges, 0);
});

test("a merged PR with today's data missing from main fails", async () => {
  const f = fixture({ merged: true, main: { episodes: [] } });
  await assert.rejects(deliverJev(f.args), /main does not contain the exact validated/);
  assert.equal(f.state.merges, 0);
});

test("the presence of today's date is insufficient: changed copy fails", async () => {
  const f = fixture({ merged: true });
  f.state.main.episodes[0].headline = "別の原稿が届いた場合";
  await assert.rejects(deliverJev(f.args), /main does not contain the exact validated/);
});

test("three failed merges retain the actionable error and never report success", async () => {
  const f = fixture({ onMerge: () => { throw { stderr: "GraphQL: Resource not accessible by integration (403)" }; } });
  await assert.rejects(deliverJev({ ...f.args, merge: true }), /remains unmerged after 3 attempts[\s\S]*Resource not accessible/);
  assert.equal(f.state.merges, 3);
  assert.deepEqual(f.state.sleeps, [20_000, 40_000]);
  assert.equal(f.state.logs.some((l) => l.startsWith("OK:")), false);
});

test("a proxy returning exit zero without merging is still a hard failure", async () => {
  const f = fixture({ onMerge: () => "success" });
  await assert.rejects(deliverJev({ ...f.args, merge: true }), /gh returned success, but GitHub still reports the PR as open/);
  assert.equal(f.state.merges, 3);
});

test("a lost merge response is recovered by observing merged state and exact main", async () => {
  const f = fixture({ onMerge: (s, ledger) => {
    s.info.merged = true;
    s.info.state = "closed";
    s.main = clone(ledger);
    throw new Error("response lost");
  } });
  assert.equal((await deliverJev({ ...f.args, merge: true })).delivered, true);
  assert.equal(f.state.merges, 1);
});

test("a transient merge failure retries the same SHA and succeeds", async () => {
  const f = fixture({ onMerge: (s, ledger) => {
    if (s.merges === 1) throw new Error("Pull Request mergeability is still being calculated");
    s.info.merged = true;
    s.main = clone(ledger);
    return "Merged";
  } });
  assert.equal((await deliverJev({ ...f.args, merge: true })).delivered, true);
  assert.equal(f.state.merges, 2);
});

for (const days of [-1, 1]) {
  test(`${days < 0 ? "past" : "future"} episode is refused before any gh call`, async () => {
    const expected = clone(sample);
    expected.episodes[0].date = days < 0 ? "2026-10-11" : "2026-10-13";
    const f = fixture({ expected });
    await assert.rejects(deliverJev({ ...f.args, merge: true }), /no past or future delivery/);
    assert.equal(f.state.calls.length, 0);
  });
}

test("missing day is refused before any gh call, without falling back to the latest episode", async () => {
  const f = fixture({ expected: { episodes: [] } });
  await assert.rejects(deliverJev({ ...f.args, merge: true }), /Only today's/);
  assert.equal(f.state.calls.length, 0);
});

test("invalid copy is refused before any gh call", async () => {
  const f = fixture();
  f.args.expected.episodes[0].slides[0].narration = "200倍速いです。";
  await assert.rejects(deliverJev({ ...f.args, merge: true }), /Today's ledger is invalid/);
  assert.equal(f.state.calls.length, 0);
});

test("another content ledger on main stops delivery instead of overwriting it", async () => {
  const f = fixture({ main: clone(sample) });
  await assert.rejects(deliverJev({ ...f.args, merge: true }), /Main ledger changed since validation/);
  assert.equal(f.state.merges, 0);
});

test("past episodes must remain exactly as recorded on main", async () => {
  const expected = JSON.parse(readFileSync(new URL("../data/samples/jev-episodes.usecase.sample.json", import.meta.url), "utf8"));
  expected.episodes.at(-1).date = date;
  const f = fixture({ expected });
  f.state.main.episodes[0].headline = "過去回に別の見出しがある";
  await assert.rejects(deliverJev({ ...f.args, merge: true }), /Main ledger changed since validation/);
  assert.equal(f.state.merges, 0);
});

test("delivery preserves the existing aired-check guard on redo_of", async () => {
  const previous = clone(sample.episodes[0]);
  previous.date = "2026-10-10";
  const current = { ...clone(previous), date, redo_of: previous.date };
  const f = fixture({ expected: { episodes: [previous, current] } });
  await assert.rejects(deliverJev({ ...f.args, merge: true, checkAired: () => ({ verdict: "unknown", reason: "logs unavailable" }) }), /only a day whose posting logs say not-posted/);
  assert.equal(f.state.calls.length, 0);
});

for (const [name, overrides, pattern] of [
  ["head changed", { head: { sha: "b".repeat(40), ref: `routine-content-${date}`, repo: { full_name: REPO } } }, /head changed/],
  ["foreign repo", { base: { ref: "main", repo: { full_name: "other/repo" } } }, /must belong/],
  ["closed PR", { state: "closed" }, /closed without a merge/],
  ["conflict", { mergeable: false }, /has conflicts/],
]) {
  test(`${name} refuses a remote mutation`, async () => {
    const f = fixture({ info: overrides });
    await assert.rejects(deliverJev({ ...f.args, merge: true }), pattern);
    assert.equal(f.state.merges, 0);
  });
}

test("unexpected PR files refuse a remote mutation", async () => {
  const f = fixture({ files: [{ filename: "data/jev-episodes.json" }, { filename: ".recovery-trigger" }] });
  await assert.rejects(deliverJev({ ...f.args, merge: true }), /must change only/);
  assert.equal(f.state.merges, 0);
});

test("a head changing between retries is refused", async () => {
  const f = fixture({ onMerge: (s) => { s.info.head.sha = "b".repeat(40); throw new Error("head changed"); } });
  await assert.rejects(deliverJev({ ...f.args, merge: true }), /head changed/);
  assert.equal(f.state.merges, 1);
});

test("a network/read failure cannot unlock a merge", async () => {
  const f = fixture();
  const run = (args) => {
    if (args[1]?.includes("contents/")) throw new Error("network unavailable");
    return f.args.run(args);
  };
  await assert.rejects(deliverJev({ ...f.args, run, merge: true }), /network unavailable/);
  assert.equal(f.state.merges, 0);
});

test("JST midnight during network reads stops before the first mutation", async () => {
  let reads = 0;
  const f = fixture({ now: () => new Date(++reads < 3 ? "2026-10-12T14:59:59Z" : "2026-10-12T15:00:00Z") });
  await assert.rejects(deliverJev({ ...f.args, merge: true }), /JST date changed/);
  assert.equal(f.state.merges, 0);
});

test("JST midnight while retrying never merges yesterday's copy", async () => {
  let now = new Date("2026-10-12T14:59:59Z");
  const f = fixture({ now: () => now, onMerge: () => { throw new Error("temporary error"); } });
  const sleep = async () => { now = new Date("2026-10-12T15:00:00Z"); };
  await assert.rejects(deliverJev({ ...f.args, sleep, merge: true }), /JST date changed/);
  assert.equal(f.state.merges, 1);
});

for (const day of ["2026-12-31", "2027-01-01", "2028-02-29"]) {
  test(`normal delivery at calendar boundary ${day}`, async () => {
    const expected = clone(sample);
    expected.episodes[0].date = day;
    const f = fixture({ expected, now: () => new Date(`${day}T00:00:00Z`) });
    assert.equal((await deliverJev({ ...f.args, merge: true })).delivered, true);
  });
}
