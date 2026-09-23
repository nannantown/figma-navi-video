import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  INTRO_TOPICS,
  USECASE_MIN,
  USECASE_TARGET,
  validateEpisodes,
  nextSlot,
  normalizeUrl,
  unattributedClaims,
  toJevVideoData,
  buildJevCaptions,
  jevPdcaReport,
  readContentFormat,
  CLAIM_NOTE,
} from "./jev.mjs";
import { buildCaptions } from "./generate-caption.mjs";
import { buildPostEntry } from "./record-upload.mjs";
import { recordFollowerCount } from "./instagram-insights.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, "data/samples", name), "utf-8"));
const INTRO = load("jev-episodes.intro.sample.json");
const USECASE = load("jev-episodes.usecase.sample.json");
const TODAY = "2026-10-30";

const clone = (x) => JSON.parse(JSON.stringify(x));
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Minimal ledger entries: all intros, then `usecases` use-case episodes. */
function ledger(usecases = 0, start = "2026-09-24") {
  const eps = INTRO_TOPICS.map((t, i) => ({ date: addDays(start, i), stage: 1, stage_episode: i + 1, kind: "intro", topic_key: t.key, sources: [] }));
  for (let i = 0; i < usecases; i++) {
    eps.push({
      date: addDays(start, INTRO_TOPICS.length + i),
      stage: 2,
      stage_episode: i + 1,
      kind: "usecase",
      topic_key: `usecase-example-${i + 1}`,
      sources: [{ url: `https://example.com/usecase-${i + 1}`, role: "usecase" }],
    });
  }
  return eps;
}

/** A full, valid episode built from the intro sample, re-dated and re-keyed. */
function full(overrides = {}) {
  return { ...clone(INTRO.episodes[0]), ...overrides };
}

function newsEpisode(date, url = "https://techcrunch.com/2026/10/01/jev-news/", published = date) {
  return full({
    date,
    stage: 3,
    stage_episode: 1,
    kind: "news",
    topic_key: `news-${date}`,
    headline: `Jev の新しい動き ${date.slice(5)}`,
    sources: [{ url, title: "Jev news", outlet: "TechCrunch", published_at: published, role: "news", official: false }],
  });
}

const check = (episodes, opts = {}) => validateEpisodes({ episodes }, { date: episodes.at(-1).date, today: episodes.at(-1).date, ...opts });
const errorsOf = (episodes, opts) => check(episodes, opts).errors.join("\n");

test("both dry-run samples validate", () => {
  for (const file of [INTRO, USECASE]) {
    const { errors } = validateEpisodes(file, { pickLatest: true, today: TODAY });
    assert.deepEqual(errors, []);
  }
});

// Shape only: the routine appends to the production ledger every morning, so
// its contents are not something a test can pin.
test("the production ledger is a ledger, and an empty one starts with the first intro", () => {
  const prod = JSON.parse(readFileSync(join(root, "data/jev-episodes.json"), "utf-8"));
  assert.ok(Array.isArray(prod.episodes));
  assert.equal(nextSlot([]).topicKey, INTRO_TOPICS[0].key);
});

// --- no repeats -----------------------------------------------------------

test("the same topic_key cannot be posted twice", () => {
  const eps = [...ledger(USECASE_TARGET), newsEpisode("2026-10-10")];
  eps.push({ ...newsEpisode("2026-10-11", "https://heise.de/other"), topic_key: "news-2026-10-10", stage_episode: 2 });
  assert.match(errorsOf(eps), /topic_key "news-2026-10-10" was already used on 2026-10-10/);
});

test("the same news source cannot carry two episodes, even written differently", () => {
  const eps = [...ledger(USECASE_TARGET), newsEpisode("2026-10-10", "https://techcrunch.com/2026/10/01/jev-news/")];
  eps.push({ ...newsEpisode("2026-10-11", "https://www.TechCrunch.com/2026/10/01/jev-news?utm_source=x#top", "2026-10-11"), stage_episode: 2 });
  assert.match(errorsOf(eps), /already carried the 2026-10-10 episode/);
});

test("the same use-case example cannot be shown twice", () => {
  const eps = ledger(2);
  const ep = clone(USECASE.episodes.at(-1));
  ep.date = addDays(eps.at(-1).date, 1);
  ep.stage_episode = 3;
  ep.sources[0].url = "https://example.com/usecase-2/";
  assert.match(errorsOf([...eps, ep]), /already carried/);
});

test("a reference source may be cited again (explainers re-use known facts)", () => {
  const eps = [...ledger(USECASE_TARGET), newsEpisode("2026-10-10")];
  const next = newsEpisode("2026-10-11", "https://heise.de/jev-update");
  next.stage_episode = 2;
  next.sources.push({ url: "https://techcrunch.com/2026/10/01/jev-news/", title: "t", outlet: "TechCrunch", published_at: "2026-10-10", role: "reference", official: false });
  assert.deepEqual(check([...eps, next]).errors, []);
});

test("a repeated headline is rejected", () => {
  const eps = [...ledger(USECASE_TARGET), newsEpisode("2026-10-10")];
  const next = { ...newsEpisode("2026-10-11", "https://heise.de/x"), stage_episode: 2, headline: eps.at(-1).headline };
  assert.match(errorsOf([...eps, next]), /headline is the same as 2026-10-10/);
});

test("normalizeUrl ignores www, query, hash, trailing slash and twitter/x", () => {
  assert.equal(normalizeUrl("https://www.Example.com/a/b/?utm_source=x&ref=y#x"), normalizeUrl("https://example.com/a/b"));
  // The query that identifies the page is kept: two HN threads are two sources.
  assert.notEqual(normalizeUrl("https://news.ycombinator.com/item?id=1"), normalizeUrl("https://news.ycombinator.com/item?id=2"));
  assert.equal(normalizeUrl("https://twitter.com/typesafeai/status/1"), normalizeUrl("https://x.com/typesafeai/status/1"));
});

// --- series order (owner 2026-09-23: intro → use cases → daily) ------------

test("stage 1 goes through the intro topics in order", () => {
  const second = full({ date: "2026-09-25", topic_key: INTRO_TOPICS[2].key, stage_episode: 2, headline: "別の見出しです" });
  assert.match(errorsOf([full(), second]), new RegExp(`must post "${INTRO_TOPICS[1].key}" next`));
});

test("a use case or news before the intros are done is rejected", () => {
  const eps = ledger(0).slice(0, 3);
  const ep = clone(USECASE.episodes.at(-1));
  ep.date = "2026-09-27";
  assert.match(errorsOf([...eps, ep]), /stage 2 is not allowed yet/);
});

test("stage_episode must count within the stage", () => {
  const ep = clone(USECASE.episodes.at(-1));
  ep.stage_episode = 2;
  assert.match(errorsOf([...ledger(0), ep]), /stage_episode: must be 1/);
});

test("stage 3 before the use-case minimum is rejected", () => {
  const eps = ledger(USECASE_MIN - 1);
  const ep = newsEpisode(addDays(eps.at(-1).date, 1));
  ep.research.stage2_exhausted_reason = "今日は新しい使用例が見つかりませんでした";
  assert.match(errorsOf([...eps, ep]), /stage 2 continues/);
});

test("stage 3 after the minimum needs the reason no unused example was found", () => {
  const eps = ledger(USECASE_MIN);
  const ep = newsEpisode(addDays(eps.at(-1).date, 1));
  assert.match(errorsOf([...eps, ep]), /stage2_exhausted_reason/);
  ep.research.stage2_exhausted_reason = "X・ブログ・記事を探したが未使用の使用例がなかった";
  assert.deepEqual(check([...eps, ep]).errors, []);
});

test("after the use-case target the series is in stage 3 and cannot go back", () => {
  const eps = ledger(USECASE_TARGET);
  assert.equal(nextSlot(eps).stage, 3);
  const ep = clone(USECASE.episodes.at(-1));
  ep.date = addDays(eps.at(-1).date, 1);
  ep.stage_episode = USECASE_TARGET + 1;
  assert.match(errorsOf([...eps, ep]), /the series is in stage 3; stage 2 is over/);
});

// --- news vs explainer ----------------------------------------------------

test("a news episode needs a news source published since the previous episode", () => {
  const eps = ledger(USECASE_TARGET);
  const ep = newsEpisode("2026-10-10", "https://heise.de/old", "2026-09-17");
  assert.match(errorsOf([...eps, ep]), /no news source published on\/after/);
});

test("an explainer day records why there was no news and may not use a news role", () => {
  const eps = ledger(USECASE_TARGET);
  const ep = full({ date: "2026-10-10", stage: 3, stage_episode: 1, kind: "explainer", topic_key: "explainer-pricing-math", headline: "Jevの料金をもう一度計算" });
  assert.match(errorsOf([...eps, ep]), /no_news_reason/);
  ep.research.no_news_reason = "前回以降、公式・主要媒体とも新しい発表がなかった";
  assert.deepEqual(check([...eps, ep]).errors, []);
  ep.sources[0].role = "news";
  assert.match(errorsOf([...eps, ep]), /role "news" belongs to news episodes/);
});

// --- claims stay claims -----------------------------------------------------

test("a speed or hallucination claim without its source is rejected", () => {
  assert.deepEqual(unattributedClaims("LLMより200倍速いです。"), ["LLMより200倍速いです。"]);
  assert.deepEqual(unattributedClaims("ハルシネーションを起こしません。"), ["ハルシネーションを起こしません。"]);
  assert.deepEqual(unattributedClaims("TypeSafeによると、200倍速いそうです。"), []);
  assert.deepEqual(unattributedClaims("LiteLLMの検証では約5.4倍でした。"), []);
  const ep = full();
  ep.slides[3].narration = "ChatGPTのようなLLMより40から200倍速い、とても速いAIモデルです。";
  assert.match(errorsOf([ep]), /claim without its source/);
});

test("screen text with a claim needs a claim_source label", () => {
  const ep = full();
  delete ep.slides[3].claim_source;
  assert.match(errorsOf([ep]), /set claim_source/);
});

test("a claim in the headline is rejected", () => {
  assert.match(errorsOf([full({ headline: "LLMの200倍速いAI" })]), /headline: no speed/);
});

// --- sources ---------------------------------------------------------------

test("official is only believable on TypeSafe's own sites", () => {
  const ep = full();
  ep.sources[2].official = true;
  assert.match(errorsOf([ep]), /techcrunch\.com is not a TypeSafe property/);
});

test("look-alike sites are never a source", () => {
  const ep = full();
  ep.sources[0].url = "https://jevtypesafeai.com/blog";
  ep.sources[0].official = false;
  assert.match(errorsOf([ep]), /look-alike/);
});

test("today's episode must exist and be dated today", () => {
  assert.match(validateEpisodes(INTRO, { date: "2026-10-01", today: "2026-10-01" }).errors.join(), /no episode for 2026-10-01/);
  assert.match(errorsOf([full()], { date: "2026-09-24", today: "2026-09-25" }), /date is not today/);
});

// --- video data, captions, history -----------------------------------------

test("video data keeps the pickup frame (tools[] with narration) and captions carry sources and the claim note", () => {
  const data = toJevVideoData(INTRO.episodes[0]);
  assert.equal(data.meta.mode, "jev");
  assert.equal(data.tools.length, 4);
  assert.ok(data.tools.every((t) => t.narration && t.heading && t.body));
  assert.equal(data.tools[3].claimSource, "TypeSafe の発表");
  const caps = buildCaptions(data, { recommendedTitleTemplate: "emoji" });
  assert.deepEqual(caps, buildJevCaptions(data));
  assert.ok(caps.youtube.title.length <= 100);
  assert.match(caps.youtube.title, /^【Jev入門】/);
  for (const s of INTRO.episodes[0].sources) {
    assert.ok(caps.youtube.description.includes(s.url));
    assert.ok(caps.instagram.includes(s.url));
  }
  assert.ok(caps.instagram.includes(CLAIM_NOTE));
  assert.match(caps.instagram, /#Jev/);
  assert.match(caps.youtube.description, /（TypeSafe の発表）/);
});

test("the history entry records the episode, not tools", () => {
  const data = toJevVideoData(USECASE.episodes.at(-1));
  const entry = buildPostEntry({ date: "2026-09-30", uploadResult: { videoId: "v" }, igResult: null, trendingData: data, captions: buildJevCaptions(data), audioDurations: null, enriched: { discovery: { method: "pickup-thing" } } });
  assert.equal(entry.genre, "jev-news");
  assert.equal(entry.trial, 2);
  assert.deepEqual(entry.tools, []);
  assert.equal(entry.jev.kind, "usecase");
  assert.equal(entry.jev.topicKey, "usecase-litellm-router");
  assert.equal(entry.discovery.method, "usecase");
  assert.ok(entry.discovery.sources.includes("https://docs.litellm.ai/blog/jev-auto-router-benchmark"));
});

test("follower counts are kept one per JST day and read as growth by the PDCA report", () => {
  const history = { videos: [] };
  recordFollowerCount(history, 200, new Date("2026-09-24T00:00:00Z"));
  recordFollowerCount(history, 205, new Date("2026-09-24T05:00:00Z"));
  recordFollowerCount(history, 230, new Date("2026-09-30T00:00:00Z"));
  assert.deepEqual(history.account.igFollowers, [{ date: "2026-09-24", count: 205 }, { date: "2026-09-30", count: 230 }]);
  history.videos.push({ date: "2026-09-24", genre: "jev-news", jev: { kind: "intro", stage: 1, stageEpisode: 1, topicKey: "intro-what-is-jev" }, instagram: { views: 40, saved: 3 }, stats: { views: 5, updatedAt: "x" } });
  history.videos.push({ date: "2026-09-25", genre: "jev-news", jev: { kind: "intro", stage: 1, stageEpisode: 2, topicKey: "intro-no-text" }, instagram: { views: 60, saved: 1 }, stats: { views: 0, updatedAt: null } });
  const report = jevPdcaReport(history, { today: "2026-09-30" });
  assert.match(report, /IG views 中央値 50（n=2）\/ IG 保存合計 4 \/ IG フォロワー増 \+25/);
  assert.match(report, /\| intro \| 2 \| 50 \| 4 \| 5 \|/);
});

test("content format: the committed switch is a known format; CONTENT_FORMAT overrides it; unknown values fail", async () => {
  const { FORMATS } = await import("./jev.mjs");
  assert.ok(FORMATS.includes(readContentFormat(root, {})));
  assert.equal(readContentFormat(root, { CONTENT_FORMAT: "pickup" }), "pickup");
  assert.throws(() => readContentFormat(root, { CONTENT_FORMAT: "ranking" }));
});

test("captions stay within the platform limits on the longest allowed episode", async () => {
  const { JEV_IG_CAPTION_MAX, JEV_YT_DESCRIPTION_MAX_BYTES } = await import("./jev.mjs");
  const ep = full({ headline: "あ".repeat(24) });
  ep.slides = Array.from({ length: 4 }, (_, i) => ({ heading: "見".repeat(18), body: "本".repeat(64), claim_source: "TypeSafe の発表まで", narration: `${i}`.repeat(95) }));
  ep.sources = Array.from({ length: 8 }, (_, i) => ({ url: `https://example.com/${"p".repeat(270)}${i}`, title: "t", outlet: "媒".repeat(30), published_at: "2026-09-20", role: i === 0 ? "news" : "reference", official: false }));
  const caps = buildJevCaptions(toJevVideoData(ep));
  assert.ok(Array.from(caps.instagram).length <= JEV_IG_CAPTION_MAX, `IG ${Array.from(caps.instagram).length}`);
  assert.ok(Buffer.byteLength(caps.youtube.description) <= JEV_YT_DESCRIPTION_MAX_BYTES);
  assert.ok(caps.youtube.title.length <= 100);
  // The day's own source keeps its URL as long as it fits.
  assert.ok(caps.youtube.description.includes(ep.sources[0].url));
});

// --- review follow-ups (2026-09-23) -----------------------------------------

test("claims written without digits or as 'no mistakes' still need a named source", () => {
  for (const s of ["数十倍速いです。", "十倍速く動きます。", "100分の1の料金です。", "費用は9割安くなります。", "業界最速のモデルです。", "精度は100%で、間違いがありません。", "ハルシネーションを起こしません。"]) {
    assert.deepEqual(unattributedClaims(s), [s], s);
  }
});

test("an attribution has to name who says so", () => {
  assert.equal(unattributedClaims("他モデルとの比較では10倍速いです。").length, 1);
  assert.equal(unattributedClaims("テストによると10倍速いです。").length, 1);
  assert.deepEqual(unattributedClaims("TypeSafeによると10倍速いそうです。"), []);
  assert.deepEqual(unattributedClaims("LiteLLMの検証では約5.4倍でした。"), []);
  assert.deepEqual(unattributedClaims("同社は、ハルシネーションが起きないと説明しています。"), []);
});

test("explaining a term is not a claim", () => {
  assert.deepEqual(unattributedClaims("ハルシネーションとは、AIがもっともらしい嘘を書くことです。"), []);
  assert.deepEqual(unattributedClaims("LLMは型エラーを起こすことがあります。"), []);
});

test("a claim_source label cannot carry the claim itself", () => {
  const ep = full();
  ep.slides[3].claim_source = "200倍速い";
  assert.match(errorsOf([ep]), /claim_source: a label says whose claim/);
});

test("< and > are rejected in text and stripped from captions (YouTube refuses them)", () => {
  const ep = full();
  ep.slides[0].body = "入力 -> 型付きの答え、という流れで答えを返す仕組みです。";
  assert.match(errorsOf([ep]), /no < or >/);
  const data = toJevVideoData(full());
  data.tools[0].body = "a <b> c";
  assert.ok(!/[<>]/.test(buildJevCaptions(data).youtube.description));
});

test("news dated the US evening before the previous JST episode still counts as new", () => {
  const eps = ledger(USECASE_TARGET);
  const last = eps.at(-1).date;
  const dayBefore = addDays(last, -1);
  const ep = newsEpisode(addDays(last, 1), "https://heise.de/us-evening", dayBefore);
  assert.deepEqual(check([...eps, ep]).errors, []);
  const old = newsEpisode(addDays(last, 1), "https://heise.de/older", addDays(last, -2));
  assert.match(errorsOf([...eps, old]), /no news source published on\/after/);
});

test("the posted history guards the ledger: a posted episode cannot vanish or be reused", () => {
  const eps = ledger(USECASE_TARGET);
  const posted = historyOf(eps);
  const today = newsEpisode(addDays(eps.at(-1).date, 1));
  assert.deepEqual(check([...eps, today], { history: posted }).errors, []);
  // The routine deleted the first episode from the ledger.
  assert.match(errorsOf([...eps.slice(1), today], { history: posted }), /was posted but is missing or changed/);
  // …or re-used a posted use case as today's news.
  const reuse = newsEpisode(addDays(eps.at(-1).date, 1), "https://example.com/usecase-5?utm_source=x");
  assert.match(errorsOf([...eps.slice(0, -1), { ...eps.at(-1), sources: [] }, reuse], { history: posted }), /already posted on/);
});

// --- rework 1 (2026-09-23): X outlet, fillers, unaired episodes ---------------

/** performance-history.json with every given episode posted. */
function historyOf(episodes) {
  return { videos: episodes.map((e) => ({ date: e.date, genre: "jev-news", jev: { kind: e.kind, topicKey: e.topic_key, sources: e.sources } })) };
}

test("an X source written the way the routine prompt says passes; an @handle does not", () => {
  const ep = full();
  ep.sources.push({ url: "https://x.com/typesafeai/status/2101786156572823624", title: "Jev is now available to everyone.", outlet: "X typesafeai", published_at: "2026-09-21", role: "reference", official: true });
  assert.deepEqual(errorsOf([ep], { today: "2026-09-24" }), "");
  ep.sources.at(-1).outlet = "X @typesafeai";
  assert.match(errorsOf([ep], { today: "2026-09-24" }), /write an X account as "X typesafeai" \(no @\)/);
});

test("stage 1 and 2 have a filler explainer that keeps posting without advancing the stage", () => {
  // Stage 1: the second intro cannot be written today.
  const filler = full({ date: "2026-09-25", kind: "explainer", stage_episode: 2, topic_key: "explainer-launch-day", headline: "Jevの公開日をふり返る" });
  assert.match(errorsOf([full(), filler], { history: historyOf([full()]) }), /no_news_reason.*stage-1 intro/);
  filler.research = { ...filler.research, no_news_reason: "公式ページが開けず、2回目のテーマの事実を確かめられなかった" };
  assert.deepEqual(check([full(), filler], { history: historyOf([full()]) }).errors, []);
  // The stage has not moved: the next slot is still the second intro, as episode 3.
  const slot = nextSlot([full(), filler]);
  assert.equal(slot.stage, 1);
  assert.equal(slot.topicKey, INTRO_TOPICS[1].key);
  assert.equal(slot.stageEpisode, 3);
  // A filler cannot take an intro's key.
  const thief = { ...filler, topic_key: INTRO_TOPICS[1].key };
  assert.match(errorsOf([full(), thief]), /starts with "intro-", which is reserved/);
  // Stage 2 with fewer than the minimum use cases: a filler, not a stop.
  const eps = ledger(1);
  const stage2filler = full({ date: addDays(eps.at(-1).date, 1), stage: 2, stage_episode: 2, kind: "explainer", topic_key: "explainer-router-basics", headline: "振り分け係のしくみ", research: { ...INTRO.episodes[0].research, no_news_reason: "未使用の使用例が見つからなかった（X・ブログ・HNを確認）" } });
  assert.deepEqual(check([...eps, stage2filler]).errors, []);
  assert.equal(nextSlot([...eps, stage2filler]).usecaseCount, 1);
});


// --- rework 2 (2026-09-23): explicit redo, no time window; labels by kind ----

/**
 * The reviewer's scenario: 9/24's 1-1 never aired, 9/25 redid it (redo_of),
 * then one aired episode a day. Returns the ledger up to (not incl.) `until`.
 */
function redoneSeries(until) {
  const eps = [
    { date: "2026-09-24", stage: 1, stage_episode: 1, kind: "intro", topic_key: INTRO_TOPICS[0].key, sources: [] },
    { date: "2026-09-25", stage: 1, stage_episode: 1, kind: "intro", topic_key: INTRO_TOPICS[0].key, sources: [], redo_of: "2026-09-24" },
  ];
  INTRO_TOPICS.slice(1).forEach((t, i) => eps.push({ date: addDays("2026-09-26", i), stage: 1, stage_episode: i + 2, kind: "intro", topic_key: t.key, sources: [] }));
  for (let i = 0; i < USECASE_TARGET; i++) eps.push({ date: addDays("2026-10-01", i), stage: 2, stage_episode: i + 1, kind: "usecase", topic_key: `usecase-ex-${i + 1}`, sources: [{ url: `https://example.com/u${i + 1}`, role: "usecase" }] });
  for (let d = "2026-10-06", n = 1; d < until; d = addDays(d, 1), n++) eps.push({ date: d, stage: 3, stage_episode: n, kind: "news", topic_key: `news-${d}`, sources: [{ url: `https://example.com/n/${d}`, role: "news" }] });
  return eps;
}

test("a redone episode stays out of the series for good — 81 and 200 days later still 0 errors", () => {
  for (const offset of [80, 81, 200]) {
    const target = addDays("2026-09-24", offset);
    const eps = redoneSeries(target);
    const today = newsEpisode(target, `https://example.com/today/${target}`);
    today.stage_episode = eps.filter((e) => e.stage === 3).length + 1;
    // Everything aired except 9/24 (its redo is 9/25).
    const history = historyOf(eps.filter((e) => e.date !== "2026-09-24"));
    assert.deepEqual(check([...eps, today], { history }).errors, [], `offset ${offset}`);
    // …and without any history (a dry run) too.
    assert.deepEqual(check([...eps, today]).errors, [], `offset ${offset}, no history`);
  }
});

test("a missing post record alone does not re-offer the episode (no double post)", () => {
  const first = full();
  const second = full({ date: "2026-09-25", topic_key: INTRO_TOPICS[1].key, stage_episode: 2, headline: "答えを型で返すAI" });
  // record-upload failed after a successful upload: no history entry for 9/24.
  const res = check([first, second], { history: { videos: [] } });
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join("\n"), /2026-09-24 "intro-what-is-jev" has no post record — counted as aired; run "node scripts\/jev\.mjs aired-check" and redo only with the redoSlot it prints/);
  // A redo of a day the history shows as posted is refused.
  const redo = full({ date: "2026-09-25", redo_of: "2026-09-24", headline: "Jevとは何か、もう一度" });
  assert.match(errorsOf([first, redo], { history: historyOf([first]) }), /recorded as posted.*post it twice/);
  // With no record, a redo is accepted (the routine only writes one after aired-check said not-posted).
  assert.deepEqual(check([first, redo], { history: { videos: [] } }).errors, []);
  // Only the latest episode can be redone.
  const late = full({ date: "2026-09-26", redo_of: "2026-09-24", headline: "Jevとは何か、三度目" });
  assert.match(errorsOf([first, { ...second, date: "2026-09-25" }, late], { history: historyOf([second]) }), /only the latest episode \(2026-09-25\) can be redone/);
});

/**
 * A fake gh: `runsByWf` maps a workflow file to its `run list` rows; `attempts`
 * maps "id/attempt" to { status, conclusion, log }. Calls are recorded.
 */
function fakeGh(runsByWf, attempts = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    if (args[1] === "list") return JSON.stringify(runsByWf[args[3]] || []);
    const id = args[2];
    const n = args.includes("--attempt") ? args[args.indexOf("--attempt") + 1] : "last";
    const a = attempts[`${id}/${n}`];
    if (!a) throw Object.assign(new Error(`no fake for ${args.join(" ")}`), { stderr: "" });
    return args.includes("--log") ? a.log : JSON.stringify({ status: a.status, conclusion: a.conclusion });
  };
  return { run, calls };
}
const dayRun = (id, conclusion, attempt = 1, createdAt = "2026-09-23T23:20:00Z") => ({ databaseId: id, attempt, createdAt, event: "schedule", status: "completed", conclusion });

test("aired-check reads the day's posting logs: success line → posted, none → not-posted, unreadable → unknown", async () => {
  const { classifyPostLogs, airedCheck, seriesState } = await import("./jev.mjs");
  const att = (log, conclusion = "failure") => ({ id: 7, attempt: 1, status: "completed", conclusion, log });
  assert.equal(classifyPostLogs([att("build\n  Uploaded! https://youtube.com/shorts/abc\n")]).verdict, "posted");
  assert.equal(classifyPostLogs([att("  Published! Media ID: 1789")]).verdict, "posted");
  assert.equal(classifyPostLogs([att("Render failed: out of memory")]).verdict, "not-posted");
  assert.equal(classifyPostLogs([]).verdict, "unknown");
  const gh = (log) => fakeGh({ "daily-video.yml": [dayRun(7, "failure")] }, { "7/1": { status: "completed", conclusion: "failure", log } }).run;
  assert.equal(airedCheck("2026-09-24", { run: gh("Render failed") }).verdict, "not-posted");
  assert.equal(airedCheck("2026-09-24", { run: gh("Uploaded! https://youtube.com/shorts/x") }).verdict, "posted");
  assert.match(airedCheck("2026-09-25", { run: gh("Render failed") }).reason, /^no-runs/);
  assert.equal(airedCheck("2026-09-24", { run: () => { throw new Error("gh: not logged in"); } }).verdict, "unknown");
  // `next` names only the redo candidate (the latest unrecorded episode); it never prints a slot.
  const state = seriesState([full()], { videos: [] }, "2026-09-25");
  assert.equal(state.topicKey, INTRO_TOPICS[1].key);
  assert.equal(state.redoCandidate, "2026-09-24");
  assert.equal("redoSlot" in state, false);
  assert.equal(seriesState([full()], historyOf([full()]), "2026-09-25").redoCandidate, null);
});

test("two unrecorded days in a row: a not-posted day before the latest can never unlock a redo of the latest (no double post)", async () => {
  const { redoCheck, airedCheck } = await import("./jev.mjs");
  const d1 = full(); // 9/24: really not posted
  const d2 = full({ date: "2026-09-25", topic_key: INTRO_TOPICS[1].key, stage_episode: 2, headline: "答えを型で返すAI" }); // 9/25: posted, history push failed
  const history = { videos: [] };
  const gh = fakeGh(
    { "daily-video.yml": [dayRun(24, "failure", 1, "2026-09-23T23:20:00Z"), dayRun(25, "success", 1, "2026-09-24T23:20:00Z")] },
    { "24/1": { status: "completed", conclusion: "failure", log: "Render failed" }, "25/1": { status: "completed", conclusion: "success", log: "Uploaded! https://youtube.com/shorts/y" } },
  );
  const check = (date) => airedCheck(date, { run: gh.run });
  assert.equal(check("2026-09-24").verdict, "not-posted");
  // aired-check always checks the candidate (9/25), which went out → no slot.
  const r = redoCheck([d1, d2], history, "2026-09-26", { check });
  assert.deepEqual([r.date, r.verdict, r.redoSlot], ["2026-09-25", "posted", null]);
  assert.deepEqual(r.unrecorded.map((u) => u.date), ["2026-09-24", "2026-09-25"]);
  // A redo of 9/25 written anyway fails validation: 9/25's own logs say posted.
  const redo = full({ date: "2026-09-26", topic_key: INTRO_TOPICS[1].key, stage_episode: 2, redo_of: "2026-09-25", headline: "答えを型で返すAI、もう一度" });
  assert.match(errorsOf([d1, d2, redo], { history, checkAired: check }), /redo_of: aired-check 2026-09-25 says posted/);
  // …and a redo of 9/24 is not the latest episode.
  assert.match(errorsOf([d1, d2, { ...redo, redo_of: "2026-09-24" }], { history, checkAired: check }), /only the latest episode \(2026-09-25\) can be redone/);
  // When the candidate really did not go out, the slot comes out and validates.
  const quiet = fakeGh({ "daily-video.yml": [dayRun(25, "failure", 1, "2026-09-24T23:20:00Z")] }, { "25/1": { status: "completed", conclusion: "failure", log: "Render failed" } });
  const ok = redoCheck([d1, d2], history, "2026-09-26", { check: (d) => airedCheck(d, { run: quiet.run }) });
  assert.deepEqual(ok.redoSlot && { redo_of: ok.redoSlot.redo_of, topicKey: ok.redoSlot.topicKey, stageEpisode: ok.redoSlot.stageEpisode }, { redo_of: "2026-09-25", topicKey: INTRO_TOPICS[1].key, stageEpisode: 2 });
  assert.deepEqual(validateEpisodes({ episodes: [d1, d2, redo] }, { date: "2026-09-26", today: "2026-09-26", history, checkAired: (d) => airedCheck(d, { run: quiet.run }) }).errors, []);
  // An unknown verdict at validation time refuses the redo too.
  assert.match(errorsOf([d1, d2, redo], { history, checkAired: () => ({ verdict: "unknown", reason: "forbidden: HTTP 403" }) }), /says unknown \(forbidden: HTTP 403\)/);
});

test("a run cut off (cancelled / timed_out / …) with no success line is unknown, never not-posted", async () => {
  const { airedCheck } = await import("./jev.mjs");
  for (const conclusion of ["cancelled", "timed_out", "startup_failure", "action_required", "neutral", "skipped", "stale"]) {
    const gh = fakeGh({ "daily-video.yml": [dayRun(9, conclusion)] }, { "9/1": { status: "completed", conclusion, log: "Uploading to YouTube…" } });
    const r = airedCheck("2026-09-24", { run: gh.run });
    assert.equal(r.verdict, "unknown", conclusion);
    assert.match(r.reason, new RegExp(`^interrupted: run 9 attempt 1 ended ${conclusion}`));
  }
  // A cut-off run beside one that printed the success line: posted.
  const both = fakeGh(
    { "daily-video.yml": [dayRun(9, "cancelled")], "post-today-instagram.yml": [dayRun(10, "success")] },
    { "9/1": { status: "completed", conclusion: "cancelled", log: "x" }, "10/1": { status: "completed", conclusion: "success", log: "Published! Media ID: 5" } },
  );
  assert.equal(airedCheck("2026-09-24", { run: both.run }).verdict, "posted");
  // A run still going is unknown too (its log cannot be read yet).
  const going = fakeGh({ "daily-video.yml": [{ ...dayRun(9, null), status: "in_progress" }] });
  assert.match(airedCheck("2026-09-24", { run: going.run }).reason, /^in-progress/);
});

test("a re-run run: every attempt's log is read, and a success in any attempt means posted", async () => {
  const { airedCheck } = await import("./jev.mjs");
  const attempts = {
    "9/1": { status: "completed", conclusion: "failure", log: "  Uploaded! https://youtube.com/shorts/z\nrecord-upload failed" },
    "9/2": { status: "completed", conclusion: "failure", log: "Render failed" },
  };
  const gh = fakeGh({ "daily-video.yml": [dayRun(9, "failure", 2)] }, attempts);
  const r = airedCheck("2026-09-24", { run: gh.run });
  assert.equal(r.verdict, "posted");
  assert.match(r.reason, /run 9 attempt 1/);
  assert.ok(gh.calls.includes("run view 9 --attempt 1 --log") && gh.calls.includes("run view 9 --attempt 2 --log"), gh.calls.join("\n"));
  assert.deepEqual(r.runs.map((x) => [x.attempt, x.conclusion]), [[1, "failure"], [2, "failure"]]);
  // Both attempts failed without a success line → not-posted; an earlier cancelled attempt → unknown.
  const none = fakeGh({ "daily-video.yml": [dayRun(9, "failure", 2)] }, { ...attempts, "9/1": { ...attempts["9/1"], log: "Render failed" } });
  assert.equal(airedCheck("2026-09-24", { run: none.run }).verdict, "not-posted");
  const cut = fakeGh({ "daily-video.yml": [dayRun(9, "failure", 2)] }, { ...attempts, "9/1": { status: "completed", conclusion: "cancelled", log: "Uploading…" } });
  assert.match(airedCheck("2026-09-24", { run: cut.run }).reason, /^interrupted: run 9 attempt 1 ended cancelled/);
});

test("aired-check says why it cannot tell (gh missing / not logged in / 403 / empty log), and the self-test prints one line", async () => {
  const { airedCheck, airedCheckSelfTest, ghFailure } = await import("./jev.mjs");
  const fail = (props) => () => { throw Object.assign(new Error(props.message || "Command failed: gh run list"), props); };
  assert.match(ghFailure({ code: "ENOENT", message: "spawnSync gh ENOENT" }), /^gh-missing/);
  assert.match(ghFailure({ stderr: "To get started with GitHub CLI, please run:  gh auth login\n", message: "Command failed" }), /^not-authenticated/);
  assert.match(ghFailure({ stderr: "HTTP 403: Resource not accessible by integration (https://api.github.com/…)\n", message: "Command failed" }), /^forbidden: HTTP 403.*actions:read/);
  assert.match(ghFailure({ stderr: "HTTP 404: Not Found\n", message: "Command failed" }), /^not-found/);
  assert.match(airedCheck("2026-09-24", { run: fail({ stderr: "HTTP 403: Resource not accessible by integration" }) }).reason, /^forbidden/);
  const empty = fakeGh({ "daily-video.yml": [dayRun(9, "failure")] }, { "9/1": { status: "completed", conclusion: "failure", log: "  \n" } });
  assert.match(airedCheck("2026-09-24", { run: empty.run }).reason, /^empty-log/);

  // Self-test: the latest successful scheduled posting run, read the way aired-check reads it, down to its success line.
  const dry = { ...dayRun(6, "success"), event: "workflow_dispatch" };
  const ok = fakeGh({ "daily-video.yml": [{ ...dayRun(5, null), status: "in_progress" }, dry, dayRun(4, "success", 2)] }, { "4/2": { log: "Uploaded! https://youtube.com/shorts/q" } });
  assert.deepEqual(airedCheckSelfTest({ run: ok.run }), { ok: true, line: "aired-check self-test: OK — read run 4 (2026-09-24) and found its upload success line" });
  assert.ok(ok.calls.includes("run view 4 --attempt 2 --log"));
  assert.equal(airedCheckSelfTest({ run: fail({ code: "ENOENT" }) }).line, "aired-check self-test: NG — gh-missing: the gh CLI is not installed");
  assert.match(airedCheckSelfTest({ run: fail({ stderr: "HTTP 403: Resource not accessible by integration" }) }).line, /^aired-check self-test: NG — forbidden: /);
  assert.match(airedCheckSelfTest({ run: fakeGh({}).run }).line, /NG — no-runs/);
  // Logs that read but lack the success line (partial logs, changed wording) → NG.
  const blank = fakeGh({ "daily-video.yml": [dayRun(4, "success")] }, { "4/1": { log: "Set up job\nRun pipeline" } });
  assert.match(airedCheckSelfTest({ run: blank.run }).line, /NG — no-success-line: .*\(4\)/);
  for (const r of [ok, blank]) assert.equal(airedCheckSelfTest({ run: r.run }).line.includes("\n"), false);
});

test("a failed run that had started an upload is unknown (the upload may have gone through)", async () => {
  const { airedCheck } = await import("./jev.mjs");
  for (const log of ["YouTube: uploading output/aitools-20260924.mp4\n  Uploading...\nError: socket hang up", "Instagram: uploading Reel via file\n  Publishing...\nError: (#1) An unknown error occurred"]) {
    const gh = fakeGh({ "daily-video.yml": [dayRun(9, "failure")] }, { "9/1": { status: "completed", conclusion: "failure", log } });
    assert.match(airedCheck("2026-09-24", { run: gh.run }).reason, /^upload-started: run 9 attempt 1/);
  }
  // Credentials missing: the upload never started → still not-posted.
  const skipped = fakeGh({ "daily-video.yml": [dayRun(9, "failure")] }, { "9/1": { status: "completed", conclusion: "failure", log: "YouTube: credentials not configured, skipping upload.\nRender failed" } });
  assert.equal(airedCheck("2026-09-24", { run: skipped.run }).verdict, "not-posted");
});

test("an Instagram recovery run on a later day counts for the day it posted (its 'Using date:')", async () => {
  const { airedCheck } = await import("./jev.mjs");
  const failedDay = { "9/1": { status: "completed", conclusion: "failure", log: "Render failed" } };
  const later = (usedTag) => fakeGh(
    { "daily-video.yml": [dayRun(9, "failure")], "post-today-instagram.yml": [dayRun(12, "success", 1, "2026-09-24T15:30:00Z")] }, // 2026-09-25 00:30 JST
    { ...failedDay, "12/1": { status: "completed", conclusion: "success", log: `Using date: ${usedTag}\n  Published! Media ID: 77` } },
  );
  assert.equal(airedCheck("2026-09-24", { run: later("20260924").run }).verdict, "posted");
  // A later recovery of another day does not count for this one.
  assert.equal(airedCheck("2026-09-24", { run: later("20260925").run }).verdict, "not-posted");
  // A recovery run from before the day is never read.
  const before = fakeGh({ "daily-video.yml": [dayRun(9, "failure")], "post-today-instagram.yml": [dayRun(12, "success", 1, "2026-09-22T15:30:00Z")] }, failedDay);
  assert.equal(airedCheck("2026-09-24", { run: before.run }).verdict, "not-posted");
});

test("the opening's 第N回 counts only intros / use cases, not the filler explainers in between", async () => {
  const { kindOrdinal } = await import("./jev.mjs");
  const intro2 = full({ date: "2026-09-26", topic_key: INTRO_TOPICS[1].key, stage_episode: 3 });
  assert.equal(toJevVideoData(intro2).meta.openingSourceLabel, "Jev って何？ 第2回");
  const filler = full({ date: "2026-09-25", kind: "explainer", stage_episode: 2, topic_key: "explainer-launch-day" });
  assert.equal(toJevVideoData(filler).meta.openingSourceLabel, "Jev 解説");
  // Use cases: the number validateEpisodes hands over (fillers not counted).
  const eps = ledger(1);
  const stage2filler = full({ date: addDays(eps.at(-1).date, 1), stage: 2, stage_episode: 2, kind: "explainer", topic_key: "explainer-router-basics", headline: "振り分け係のしくみ", research: { ...INTRO.episodes[0].research, no_news_reason: "未使用の使用例が見つからなかった（X・ブログ・HNを確認）" } });
  const uc = clone(USECASE.episodes.at(-1));
  uc.date = addDays(stage2filler.date, 1);
  uc.stage_episode = 3;
  const res = check([...eps, stage2filler, uc]);
  assert.deepEqual(res.errors, []);
  assert.equal(res.usecaseNumber, 2);
  assert.equal(toJevVideoData(uc, { usecaseNumber: res.usecaseNumber }).meta.openingSourceLabel, "Jev の使い道 第2回");
  assert.equal(kindOrdinal({ kind: "news" }), null);
});

test("a non-intro episode cannot use an intro- topic_key", () => {
  const filler = full({ date: "2026-09-25", kind: "explainer", stage_episode: 2, topic_key: "intro-extra-notes", research: { ...INTRO.episodes[0].research, no_news_reason: "公式ページが開けず確認できなかった" } });
  assert.match(errorsOf([full(), filler]), /starts with "intro-", which is reserved/);
});
