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
  assert.match(errorsOf([full(), thief]), /is a stage-1 intro topic/);
  // Stage 2 with fewer than the minimum use cases: a filler, not a stop.
  const eps = ledger(1);
  const stage2filler = full({ date: addDays(eps.at(-1).date, 1), stage: 2, stage_episode: 2, kind: "explainer", topic_key: "explainer-router-basics", headline: "振り分け係のしくみ", research: { ...INTRO.episodes[0].research, no_news_reason: "未使用の使用例が見つからなかった（X・ブログ・HNを確認）" } });
  assert.deepEqual(check([...eps, stage2filler]).errors, []);
  assert.equal(nextSlot([...eps, stage2filler]).usecaseCount, 1);
});

test("an episode that never went out is offered again on the next day", () => {
  const first = full();
  // 9/24's 1-1 is in the ledger, but neither upload worked: no history entry.
  const noPosts = { videos: [] };
  const retry = full({ date: "2026-09-25", headline: "文章を書かないAI「Jev」とは" });
  // Same slot, same topic, same headline — allowed, because 9/24 never aired.
  const res = check([first, retry], { history: noPosts });
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join("\n"), /2026-09-24 "intro-what-is-jev" has no post record/);
  // Moving on to 1-2 instead would skip 1-1 for good: rejected.
  const skip = full({ date: "2026-09-25", topic_key: INTRO_TOPICS[1].key, stage_episode: 2, headline: "答えを型で返すAI" });
  assert.match(errorsOf([first, skip], { history: noPosts }), /must post "intro-what-is-jev" next/);
  // Once 9/24 is on record, 1-2 is next.
  assert.deepEqual(check([first, skip], { history: historyOf([first]) }).errors, []);
  // Without any history (a dry run) the ledger is trusted as is.
  assert.deepEqual(check([first, skip]).errors, []);
});
