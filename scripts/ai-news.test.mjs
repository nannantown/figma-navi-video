/** Genre trial #3 "AI ニュース 1 本解説" (format "news"): the Jev slide machinery
 * with the news series. The sample is fictional (Example AI); tests never write
 * the production ledger. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  SERIES,
  NEWS_CLAIM_NOTE,
  NEWS_ENDING_NARRATION,
  NEWS_IG_HASHTAGS,
  validateEpisodes,
  nextSlot,
  toJevVideoData,
  buildJevCaptions,
  jevPdcaReport,
  readContentFormat,
  seriesState,
  mayCharacterOn,
  cliSeries,
} from "./jev.mjs";
import { buildCaptions } from "./generate-caption.mjs";
import { buildPostEntry } from "./record-upload.mjs";
import { deliverJev, REPO } from "./deliver-jev.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = JSON.parse(readFileSync(join(root, "data/samples/ai-news-episodes.sample.json"), "utf8"));
const NEWS = SERIES.news;
const clone = (x) => structuredClone(x);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** The sample re-dated to `date`, its sources published that day, re-keyed by `key`. */
function episode(date, key = `news-story-${date}`, overrides = {}) {
  const ep = clone(SAMPLE.episodes[0]);
  ep.date = date;
  ep.topic_key = key;
  ep.headline = `今日のAIの話 ${date.slice(5)}`;
  ep.sources = ep.sources.map((s) => ({ ...s, url: `${s.url}-${key}`, published_at: date }));
  return { ...ep, ...overrides };
}
const check = (episodes, opts = {}) => validateEpisodes({ episodes }, { date: episodes.at(-1).date, today: episodes.at(-1).date, series: NEWS, ...opts });
const errorsOf = (episodes, opts) => check(episodes, opts).errors.join("\n");

test("news: the sample validates; the committed switch is news and the ledger starts valid", () => {
  const r = validateEpisodes(SAMPLE, { pickLatest: true, series: NEWS });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(readContentFormat(root, {}), "news");
  assert.equal(readContentFormat(root, { CONTENT_FORMAT: "news" }), "news");
  const ledger = JSON.parse(readFileSync(join(root, "data/ai-news-episodes.json"), "utf8"));
  assert.ok(Array.isArray(ledger.episodes));
  assert.equal(cliSeries([], root, {}), NEWS);
  assert.equal(cliSeries(["--series=jev"], root, {}), SERIES.jev);
  assert.throws(() => cliSeries(["--series=pickup"], root, {}));
});

test("news: no stages — every day is the next news episode; no redo candidate", () => {
  assert.deepEqual(nextSlot([], NEWS), { episode: 1, kinds: ["news"] });
  assert.equal(nextSlot([episode("2026-10-14"), episode("2026-10-15")], NEWS).episode, 3);
  const state = seriesState([episode("2026-10-14")], { videos: [] }, "2026-10-15", NEWS);
  assert.equal(state.redoCandidate, null);
  assert.equal(state.unrecorded.length, 1);
  assert.match(errorsOf([episode("2026-10-14", "a", { kind: "explainer" })]), /kind: must be "news"/);
  assert.match(errorsOf([episode("2026-10-14"), episode("2026-10-15", "b", { redo_of: "2026-10-14" })]), /does not redo/);
});

test("news: the same story never airs twice (topic_key, the carrying source, the headline)", () => {
  const first = episode("2026-10-14", "openai-model-launch");
  assert.match(errorsOf([first, episode("2026-10-15", "openai-model-launch")]), /topic_key "openai-model-launch" was already used/);
  const sameSource = episode("2026-10-15", "other-key");
  sameSource.sources[0].url = `${first.sources[0].url}/?utm_source=x`; // same page, tracking query
  assert.match(errorsOf([first, sameSource]), /already carried the 2026-10-14 episode/);
  assert.match(errorsOf([first, episode("2026-10-15", "k2", { headline: first.headline })]), /headline is the same as 2026-10-14/);
  // A reference page may be cited again.
  const reuseRef = episode("2026-10-15", "k3");
  reuseRef.sources[1].url = first.sources[1].url;
  assert.equal(errorsOf([first, reuseRef]), "");
});

test("news: a posted story missing from the ledger, or posted again, is caught from the history", () => {
  const ep = episode("2026-10-15", "same-key");
  const history = { videos: [{ date: "2026-10-14", genre: "ai-news", jev: { kind: "news", topicKey: "same-key", sources: [] } }] };
  const errors = errorsOf([ep], { history });
  assert.match(errors, /was posted but is missing or changed in data\/ai-news-episodes\.json/);
  assert.match(errors, /topic_key "same-key" was already posted on 2026-10-14/);
});

test("news: fresh (within 3 days), confirmed on two sites, never carried by a GitHub repository", () => {
  const stale = episode("2026-10-14");
  stale.sources[0].published_at = "2026-10-10";
  assert.match(errorsOf([stale]), /no news source published on\/after 2026-10-11/);
  const edge = episode("2026-10-14");
  edge.sources[0].published_at = "2026-10-11";
  assert.equal(errorsOf([edge]), "");
  const single = episode("2026-10-14");
  single.sources = [single.sources[0]];
  single.research.checked = [single.sources[0].url];
  assert.match(errorsOf([single]), /second site/);
  const repo = episode("2026-10-14");
  repo.sources[0].url = "https://github.com/example/minutes";
  assert.match(errorsOf([repo]), /AI Trend Daily covers GitHub/);
  const repoAsReference = episode("2026-10-14");
  repoAsReference.sources[1].url = "https://github.com/example/minutes";
  assert.equal(errorsOf([repoAsReference]), "");
  const usecaseRole = episode("2026-10-14");
  usecaseRole.sources[1].role = "usecase";
  assert.match(errorsOf([usecaseRole]), /role "usecase" belongs to usecase episodes/);
});

test("news: claims name who says so; money is yen only; Jev's genre is not this series", () => {
  const bare = episode("2026-10-14");
  bare.slides[1].narration = "使い方は、録音を入れて要点を選ぶだけ。手で書くより10倍速いそうです。";
  assert.match(errorsOf([bare]), /claim without its source .*OpenAI によると/);
  const dollars = episode("2026-10-14");
  dollars.slides[2].narration = "料金は、月に5時間までなら無料です。それより多く使う人向けに、月額10ドルのプランがあります。";
  assert.match(errorsOf([dollars]), /no dollar amounts/);
  const onScreen = episode("2026-10-14");
  delete onScreen.slides[1].claim_source;
  onScreen.slides[1].body = "録音を入れて要点を選ぶだけで、手書きの10倍速く仕上がります。";
  assert.match(errorsOf([onScreen]), /set claim_source \(e\.g\. "OpenAI の発表"/);
  assert.match(errorsOf([episode("2026-10-14", "k", { genre: "jev-news", trial: 2 })]), /genre: must be "ai-news"[\s\S]*trial: must be 3/);
});

test("news: video data keeps the diagram, falls back to text without one, and says nothing about Jev", () => {
  const data = toJevVideoData(SAMPLE.episodes[0], { series: NEWS });
  assert.equal(data.meta.mode, "jev"); // the slide card layout
  assert.equal(data.meta.genre, "ai-news");
  assert.equal(data.meta.trial, 3);
  assert.equal(data.meta.bigLabel, "NEWS");
  assert.equal(data.meta.openingSourceLabel, "今日のAIニュース");
  assert.equal(data.meta.titleTag, "今日のAIニュース");
  assert.deepEqual(data.tools.map((t) => t.diagram?.type ?? null), ["flow", "steps", "compare", null]);
  assert.equal(data.tools[3].body, SAMPLE.episodes[0].slides[3].body); // no diagram → heading + body card
  assert.equal(data.tools[1].claimSource, "Example AI の発表");
  assert.equal(data.endingNarration, NEWS_ENDING_NARRATION);
  assert.ok(Array.from(NEWS_ENDING_NARRATION).length <= 40);
  assert.doesNotMatch(JSON.stringify(data), /Jev|TypeSafe|特集/);
  assert.equal(mayCharacterOn(data.meta, { MAY_CHARACTER: "on" }), true);
  // A broken diagram is dropped, never fatal.
  const broken = clone(SAMPLE.episodes[0]);
  broken.slides[0].diagram = { type: "flow", items: [{ label: "1つだけ" }] };
  const r = validateEpisodes({ episodes: [broken] }, { pickLatest: true, series: NEWS });
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join("\n"), /falls back to heading \+ body/);
  assert.equal(toJevVideoData(broken, { series: NEWS }).tools[0].diagram, null);
});

test("news: captions carry the news title tag, the yen note and the sources — no Jev hashtags", () => {
  const data = toJevVideoData(SAMPLE.episodes[0], { series: NEWS });
  const c = buildCaptions(data);
  assert.deepEqual(c, buildJevCaptions(data));
  assert.match(c.youtube.title, /^【今日のAIニュース】会議を自動で議事録にするAI｜2026\/10\/14 #Shorts$/);
  assert.equal(c.youtube.titleTemplate, "ai-news");
  assert.match(NEWS_CLAIM_NOTE, /円の金額は概算です/);
  for (const text of [c.youtube.description, c.instagram]) {
    assert.ok(text.includes(NEWS_CLAIM_NOTE));
    assert.match(text, /Example AI（2026-10-13）https:\/\/example\.com\/blog\/introducing-minutes/);
    assert.doesNotMatch(text, /Jev|TypeSafe|特集/);
  }
  assert.ok(c.instagram.endsWith(NEWS_IG_HASHTAGS.join(" ")));
  assert.ok(NEWS_IG_HASHTAGS.length <= 5);
  assert.doesNotMatch(c.youtube.tags.join(" "), /Jev|TypeSafe/);
});

test("news: the history entry and the PDCA numbers use the news genre", () => {
  const data = toJevVideoData(SAMPLE.episodes[0], { series: NEWS });
  const entry = buildPostEntry({ date: "2026-10-14", trendingData: data, captions: buildCaptions(data) });
  assert.equal(entry.genre, "ai-news");
  assert.equal(entry.trial, 3);
  assert.equal(entry.jev.topicKey, SAMPLE.episodes[0].topic_key);
  assert.equal(entry.titleTemplate, "ai-news");
  const history = { videos: [{ ...entry, instagram: { views: 30, saved: 2 } }, { date: "2026-10-12", genre: "jev-news", jev: { kind: "usecase" }, instagram: { views: 999, saved: 9 } }] };
  const report = jevPdcaReport(history, { today: "2026-10-15", series: NEWS });
  assert.match(report, /ジャンル試行 #3（AI ニュース 1 本解説）/);
  assert.match(report, /IG views 中央値 30（n=1）\/ IG 保存合計 2/);
  assert.match(report, /\| news \| 1 \| 30 \| 2 \|/);
  assert.match(report, /\| 2026-10-14 \| — \| news \|/);
});

test("news: delivery reads and allows only the news ledger", () => {
  const head = "b".repeat(40);
  const date = "2026-10-14";
  const expected = clone(SAMPLE);
  const info = { state: "closed", merged: true, mergeable: true, changed_files: 2, head: { sha: head, ref: `routine-content-${date}`, repo: { full_name: REPO } }, base: { ref: "main", repo: { full_name: REPO } } };
  const run = (files) => (args) => {
    if (args[1].endsWith("pulls/9")) return JSON.stringify(info);
    if (args[1].endsWith("/files?per_page=100")) return JSON.stringify(files);
    if (args[1].endsWith("contents/data/ai-news-episodes.json?ref=main")) return JSON.stringify({ encoding: "base64", content: Buffer.from(JSON.stringify(expected)).toString("base64") });
    assert.fail(`Unexpected gh request: ${args}`);
  };
  const base = { expected, pr: 9, head, now: () => new Date(`${date}T00:00:00Z`), log: () => {}, series: NEWS };
  const ok = deliverJev({ ...base, run: run([{ filename: "data/ai-news-episodes.json" }, { filename: `docs/pdca/${date}.md` }]) });
  assert.equal(ok.delivered, true);
  assert.throws(() => deliverJev({ ...base, run: run([{ filename: "data/jev-episodes.json" }, { filename: `docs/pdca/${date}.md` }]) }), /must change only data\/ai-news-episodes\.json/);
});

test("news: Step 1 (generate-data) renders today's news episode from the news ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "news-step1-"));
  try {
    cpSync(join(root, "scripts"), join(dir, "scripts"), { recursive: true, filter: (p) => !p.endsWith(".test.mjs") });
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data/content-format.json"), JSON.stringify({ format: "news" }));
    const today = "2026-10-14";
    writeFileSync(join(dir, "data/ai-news-episodes.json"), JSON.stringify({ episodes: [episode(addDays(today, -1), "yesterday"), episode(today)] }));
    writeFileSync(join(dir, "data/performance-history.json"), JSON.stringify({ videos: [] }));
    const clock = join(dir, "clock.mjs");
    const instant = `${today}T00:00:00Z`;
    writeFileSync(clock, `const D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [${JSON.stringify(instant)}])); } static now() { return new D(${JSON.stringify(instant)}).getTime(); } };`);
    const r = spawnSync(process.execPath, ["--import", clock, join(dir, "scripts/generate-data.mjs")], {
      cwd: dir, encoding: "utf8", timeout: 10_000, env: { PATH: dirname(process.execPath), TZ: "UTC", SNS_POST_ENABLED: "false" },
    });
    assert.equal(r.status, 0, r.stderr);
    const out = join(dir, "output/trending-data.json");
    assert.ok(existsSync(out));
    const data = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(data.meta.date, today);
    assert.equal(data.meta.genre, "ai-news");
    assert.match(r.stdout, /news 2026-10-14: news "news-story-2026-10-14"/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
