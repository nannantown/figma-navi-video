import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deliverJev, REPO } from "./deliver-jev.mjs";

const head = "a".repeat(40);
const date = "2026-10-12";
const sample = JSON.parse(readFileSync(new URL("../data/samples/jev-episodes.intro.sample.json", import.meta.url), "utf8"));
const clone = (v) => structuredClone(v);

function fixture({ merged = false, info: overrides = {}, files, main, expected, now } = {}) {
  const ledger = expected || clone(sample);
  if (!expected) ledger.episodes[0].date = date; // Mock copy only.
  const info = {
    state: merged ? "closed" : "open", merged, mergeable: true, changed_files: 2,
    head: { sha: head, ref: `routine-content-${ledger.episodes.at(-1)?.date || date}`, repo: { full_name: REPO } },
    base: { ref: "main", repo: { full_name: REPO } }, ...overrides,
  };
  const baseline = { ...clone(ledger), episodes: clone(ledger.episodes.slice(0, -1)) };
  const state = { info, main: main || (merged ? clone(ledger) : baseline), calls: [], logs: [] };
  const run = (args) => {
    state.calls.push(args);
    assert.equal(args[0], "api");
    assert.deepEqual(args.slice(-2), ["--method", "GET"]); // No mutations in either mode.
    if (args[1].endsWith("pulls/187")) return JSON.stringify(state.info);
    if (args[1].endsWith("/files?per_page=100")) return JSON.stringify(files || [{ filename: "data/jev-episodes.json" }, { filename: `docs/pdca/${ledger.episodes.at(-1).date}.md` }]);
    if (args[1].endsWith("contents/data/jev-episodes.json?ref=main")) return JSON.stringify({ encoding: "base64", content: Buffer.from(JSON.stringify(state.main)).toString("base64") });
    assert.fail(`Unexpected gh request: ${args}`);
  };
  const args = { expected: ledger, pr: 187, head, run, now: now || (() => new Date(`${date}T00:00:00Z`)), log: (line) => state.logs.push(line) };
  return { state, args };
}

test("default is read-only and an open content PR is a delivery failure", () => {
  const f = fixture();
  assert.throws(() => deliverJev(f.args), /PR #187 is not merged/);
});

test("prepare checks the exact candidate and explicitly requires review, without merging", () => {
  const f = fixture();
  const out = deliverJev({ ...f.args, prepare: true });
  assert.equal(out.delivered, false);
  assert.equal(out.readyForReview, true);
  assert.match(f.state.logs.at(-1), /READY FOR REVIEW[\s\S]*Not delivered yet/);
  assert.equal(f.state.calls.length, 3);
});

test("normal delivered day confirms merged state and exact main ledger", () => {
  const f = fixture({ merged: true });
  const out = deliverJev(f.args);
  assert.equal(out.delivered, true);
  assert.equal(out.readyForReview, false);
  assert.match(f.state.logs.at(-1), /exact validated 2026-10-12/);
});

test("resuming prepare on an already merged PR only verifies delivery", () => {
  const f = fixture({ merged: true });
  assert.equal(deliverJev({ ...f.args, prepare: true }).delivered, true);
});

test("merged state alone cannot hide a missing day on main", () => {
  const f = fixture({ merged: true, main: { episodes: [] } });
  assert.throws(() => deliverJev(f.args), /main does not contain the exact validated/);
});

test("the presence of today's date is insufficient: different copy fails", () => {
  const f = fixture({ merged: true });
  f.state.main.episodes[0].headline = "別の原稿が届いた場合";
  assert.throws(() => deliverJev(f.args), /main does not contain the exact validated/);
});

test("open state stays a hard failure after a proxy claimed a successful merge", () => {
  const f = fixture();
  f.state.main = clone(f.args.expected);
  assert.throws(() => deliverJev(f.args), /PR #187 is not merged/);
});

for (const [name, day] of [["past", "2026-10-11"], ["future", "2026-10-13"]]) {
  test(`${name} episode is refused before any gh call`, () => {
    const expected = clone(sample);
    expected.episodes[0].date = day;
    const f = fixture({ expected });
    assert.throws(() => deliverJev({ ...f.args, prepare: true }), /no past or future delivery/);
    assert.equal(f.state.calls.length, 0);
  });
}

test("missing day is refused without falling back to the latest episode", () => {
  const f = fixture({ expected: { episodes: [] } });
  assert.throws(() => deliverJev({ ...f.args, prepare: true }), /Only today's/);
  assert.equal(f.state.calls.length, 0);
});

test("invalid copy is refused before any gh call", () => {
  const f = fixture();
  f.args.expected.episodes[0].slides[0].narration = "200倍速いです。";
  assert.throws(() => deliverJev({ ...f.args, prepare: true }), /Today's ledger is invalid/);
  assert.equal(f.state.calls.length, 0);
});

test("another content ledger on main requires new validation", () => {
  const f = fixture({ main: clone(sample) });
  assert.throws(() => deliverJev({ ...f.args, prepare: true }), /Main ledger changed since validation/);
});

test("past episodes must remain exactly as recorded on main", () => {
  const expected = JSON.parse(readFileSync(new URL("../data/samples/jev-episodes.usecase.sample.json", import.meta.url), "utf8"));
  expected.episodes.at(-1).date = date;
  const f = fixture({ expected });
  f.state.main.episodes[0].headline = "過去回に別の見出しがある";
  assert.throws(() => deliverJev({ ...f.args, prepare: true }), /Main ledger changed since validation/);
});

test("the existing aired-check guard on redo_of is preserved", () => {
  const previous = clone(sample.episodes[0]);
  previous.date = "2026-10-10";
  const current = { ...clone(previous), date, redo_of: previous.date };
  const f = fixture({ expected: { episodes: [previous, current] } });
  assert.throws(() => deliverJev({ ...f.args, prepare: true, checkAired: () => ({ verdict: "unknown", reason: "logs unavailable" }) }), /only a day whose posting logs say not-posted/);
  assert.equal(f.state.calls.length, 0);
});

for (const [name, overrides, pattern] of [
  ["head changed", { head: { sha: "b".repeat(40), ref: `routine-content-${date}`, repo: { full_name: REPO } } }, /head changed/],
  ["foreign repo", { base: { ref: "main", repo: { full_name: "other/repo" } } }, /must belong/],
  ["closed PR", { state: "closed" }, /closed without a merge/],
  ["conflict", { mergeable: false }, /has conflicts/],
]) {
  test(`${name} fails preparation`, () => {
    const f = fixture({ info: overrides });
    assert.throws(() => deliverJev({ ...f.args, prepare: true }), pattern);
  });
}

test("unexpected PR files fail preparation", () => {
  const f = fixture({ files: [{ filename: "data/jev-episodes.json" }, { filename: ".recovery-trigger" }] });
  assert.throws(() => deliverJev({ ...f.args, prepare: true }), /must change only/);
});

test("new readings for the voice may ride along, but only kana readings at the PR head", () => {
  const withReadings = (readings) => {
    const f = fixture({ files: [{ filename: "data/jev-episodes.json" }, { filename: `docs/pdca/${date}.md` }, { filename: "data/tts-readings.json" }], info: { changed_files: 3 } });
    const inner = f.args.run;
    f.args.run = (args) => (args[1].endsWith(`contents/data/tts-readings.json?ref=${head}`)
      ? JSON.stringify({ encoding: "base64", content: Buffer.from(JSON.stringify(readings)).toString("base64") })
      : inner(args));
    return f;
  };
  assert.equal(deliverJev({ ...withReadings({ _about: "x", 仮名: "かめい" }).args, prepare: true }).readyForReview, true);
  assert.throws(() => deliverJev({ ...withReadings({ 仮名: "有料プラン" }).args, prepare: true }), /bad readings/);
  const renamed = fixture({ files: [{ filename: "data/jev-episodes.json" }, { filename: "data/tts-readings.json", previous_filename: ".github/workflows/daily-video.yml" }] });
  assert.throws(() => deliverJev({ ...renamed.args, prepare: true }), /must change only/);
});

test("renaming a trigger into an allowed file cannot bypass the file scope", () => {
  const f = fixture({ files: [{ filename: "data/jev-episodes.json" }, { filename: `docs/pdca/${date}.md`, previous_filename: ".recovery-trigger" }] });
  assert.throws(() => deliverJev({ ...f.args, prepare: true }), /must change only/);
});

test("a network/read failure cannot report readiness", () => {
  const f = fixture();
  const run = (args) => {
    if (args[1]?.includes("contents/")) throw new Error("network unavailable");
    return f.args.run(args);
  };
  assert.throws(() => deliverJev({ ...f.args, run, prepare: true }), /network unavailable/);
});

test("JST midnight during network reads requires a new day's research", () => {
  let reads = 0;
  const f = fixture({ now: () => new Date(++reads < 2 ? "2026-10-12T14:59:59Z" : "2026-10-12T15:00:00Z") });
  assert.throws(() => deliverJev({ ...f.args, prepare: true }), /JST date changed/);
});

for (const day of ["2026-12-31", "2027-01-01", "2028-02-29"]) {
  test(`delivery check at calendar boundary ${day}`, () => {
    const expected = clone(sample);
    expected.episodes[0].date = day;
    const f = fixture({ merged: true, expected, now: () => new Date(`${day}T00:00:00Z`) });
    assert.equal(deliverJev(f.args).delivered, true);
  });
}

test("CLI explicitly rejects the old --merge mode before any git/gh action", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./deliver-jev.mjs", import.meta.url)), "--merge"], { encoding: "utf8", env: {}, timeout: 10_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /read-only; no --merge/);
});

const hintDate = "2026-10-21";
const missing = [`no episode for ${hintDate} (the routine appends today's episode to data/ai-news-episodes.json)`];
const branchLine = `d9b83afb\trefs/heads/routine-content-${hintDate}\n`;

test("unmergedRoutineHint: today's routine branch exists but main lacks the episode → loud error line", async () => {
  const { unmergedRoutineHint } = await import("./deliver-jev.mjs");
  const asked = [];
  const hint = unmergedRoutineHint(hintDate, missing, (ref) => { asked.push(ref); return branchLine; });
  assert.deepEqual(asked, [`refs/heads/routine-content-${hintDate}`]);
  assert.match(hint, /^::error title=原稿 PR が未マージかもしれない::/);
  assert.match(hint, /routine-content-2026-10-21/);
  assert.match(hint, /daily-video\.yml/);
});

test("unmergedRoutineHint: no branch (the routine wrote nothing) or git failure → null", async () => {
  const { unmergedRoutineHint } = await import("./deliver-jev.mjs");
  assert.equal(unmergedRoutineHint(hintDate, missing, () => ""), null);
  assert.equal(unmergedRoutineHint(hintDate, missing, () => `abc\trefs/heads/routine-content-${hintDate}-old\n`), null);
  assert.equal(unmergedRoutineHint(hintDate, missing, () => { throw new Error("offline"); }), null);
});

test("unmergedRoutineHint: a broken ledger is not called an unmerged PR, even when the branch is left over after a merge", async () => {
  const { unmergedRoutineHint } = await import("./deliver-jev.mjs");
  const { validateEpisodes, SERIES } = await import("./jev.mjs");
  const lsRemote = () => assert.fail("must not look for the branch when the ledger itself is broken");
  for (const ledger of [{ episodes: "oops" }, { episodes: [{ date: "not-a-date" }] }]) {
    const { errors, episode } = validateEpisodes(ledger, { date: hintDate, today: hintDate, series: SERIES.news });
    assert.equal(episode, null);
    assert.ok(errors.length > 0 && !errors.some((e) => e.startsWith("no episode for")));
    assert.equal(unmergedRoutineHint(hintDate, errors, lsRemote), null);
  }
});
