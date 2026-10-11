/** Exercise the real Step 1 in isolated directories, with a mock clock and
 * no credentials. TTS, video rendering and posting are never invoked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { todayJst } from "./enriched-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sample = JSON.parse(readFileSync(join(root, "data/samples/jev-episodes.intro.sample.json"), "utf8"));

function step1(episodes, instant, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jev-step1-"));
  try {
    cpSync(join(root, "scripts"), join(dir, "scripts"), { recursive: true, filter: (p) => !p.endsWith(".test.mjs") });
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data/content-format.json"), JSON.stringify({ format: "jev" }));
    writeFileSync(join(dir, "data/jev-episodes.json"), JSON.stringify({ episodes }));
    writeFileSync(join(dir, "data/performance-history.json"), JSON.stringify({ videos: [] }));
    // Preload only mocks time; all real validation and file selection still run.
    const mockTime = join(dir, "clock.mjs");
    writeFileSync(mockTime, `const OriginalDate = Date; globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [${JSON.stringify(instant)}])); } static now() { return new OriginalDate(${JSON.stringify(instant)}).getTime(); } };`);
    const result = spawnSync(process.execPath, ["--import", mockTime, join(dir, "scripts/generate-data.mjs")], {
      cwd: dir, encoding: "utf8", timeout: 10_000,
      env: { PATH: dirname(process.execPath), TZ: "UTC", SNS_POST_ENABLED: "false", ...extraEnv },
    });
    assert.ifError(result.error);
    const out = join(dir, "output/trending-data.json");
    return { ...result, generated: existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function intro(date) {
  const ep = structuredClone(sample.episodes[0]);
  ep.date = date; // Test fixture only; the production ledger is never written.
  return ep;
}

test("Step 1 refuses a missing day; yesterday is not a fallback", () => {
  const r = step1([intro("2026-10-09")], "2026-10-10T00:00:00Z");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no episode for 2026-10-10/);
  assert.equal(r.generated, null);
});

test("Step 1 produces today's validated Jev data on a normal day", () => {
  const r = step1([intro("2026-10-12")], "2026-10-12T00:00:00Z");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.generated.meta.mode, "jev");
  assert.equal(r.generated.meta.date, "2026-10-12");
  assert.equal(r.generated.tools.length, sample.episodes[0].slides.length);
});

test("Step 1 does not choose a future episode when today's episode is missing", () => {
  const r = step1([intro("2026-10-13")], "2026-10-12T00:00:00Z");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no episode for 2026-10-12/);
  assert.equal(r.generated, null);
});

test("Step 1 selects by JST across midnight, even with TZ=UTC", () => {
  const ep = intro("2026-10-12");
  const before = step1([ep], "2026-10-11T14:59:59.999Z");
  assert.equal(before.status, 1);
  assert.match(before.stderr, /no episode for 2026-10-11/);
  const after = step1([ep], "2026-10-11T15:00:00.000Z");
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.generated.meta.date, "2026-10-12");
});

test("Step 1 fails invalid narration before producing video data", () => {
  const ep = intro("2026-10-12");
  ep.slides[0].narration = "200倍速いです。";
  const r = step1([ep], "2026-10-12T00:00:00Z");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /claim without its source/);
  assert.equal(r.generated, null);
});

test("Step 1 refuses the stale verification override with posting enabled", () => {
  const r = step1([intro("2026-10-09")], "2026-10-12T00:00:00Z", { ALLOW_STALE_DATE: "1", SNS_POST_ENABLED: "true" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot be combined with SNS_POST_ENABLED=true/);
  assert.equal(r.generated, null);
});

test("JST date selection handles year changes and leap days", () => {
  for (const [instant, day] of [["2026-12-31T15:00:00Z", "2027-01-01"], ["2028-02-28T15:00:00Z", "2028-02-29"]]) {
    assert.equal(todayJst(new Date(instant)), day);
    const r = step1([intro(day)], instant);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.generated.meta.date, day);
  }
});
