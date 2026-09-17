import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEnriched,
  toVideoTools,
  buildMeta,
  countSentences,
  charLength,
  displayDomain,
  parseEnrichedText,
  todayJst,
  textSafetyProblems,
  defaultOpeningNarration,
  PRICING_LABELS,
} from "./enriched-schema.mjs";
import { freshSince, isFresh, isNewLaunch } from "./pacific-time.mjs";

// Published on Product Hunt 2026-09-13 (Pacific) — fresh for the 2026-09-15 video.
const FRESH = "2026-09-13T00:01:00-07:00";

function tool(rank, overrides = {}) {
  return {
    rank,
    ph_rank: rank + 1,
    name: `Tool ${rank}`,
    ph_url: `https://www.producthunt.com/products/tool-${rank}`,
    ph_published_at: FRESH,
    website: `https://tool${rank}.example.com/`,
    tagline_en: "An AI helper",
    description: "会議メモを自動で要約する",
    who: "会社員・PM",
    pricing: "freemium",
    narration: "会議の要点を自動でまとめるAIツールです。議事録づくりの時間がほぼゼロになります。",
    image_url: null,
    ...overrides,
  };
}

function valid(overrides = {}) {
  return {
    date: "2026-09-15",
    genre: "ai-tools-top5",
    trial: 1,
    source: { mode: "ranking", ph_date: "2026-09-13", snapshot_fetched_at: "2026-09-14T09:31:00Z" },
    discovery: { method: "rank-pure", description: "dailyRank 順", sources: ["https://api.producthunt.com/v2/api/graphql"] },
    tools: [1, 2, 3, 4, 5].map((r) => tool(r)),
    ...overrides,
  };
}

const pickup = (count, toolOverrides = {}) =>
  valid({
    source: { mode: "pickup" },
    discovery: { method: "non-engineer", description: "新着から厳選", sources: ["https://www.producthunt.com/feed?category=artificial-intelligence"] },
    tools: Array.from({ length: count }, (_, i) => tool(i + 1, { ph_rank: undefined, ...toolOverrides })),
  });

// Legacy ranking fixtures opt in to ranking mode (off by default since the owner decision of 2026-09-15).
const errorsOf = (data, today = "2026-09-15") => validateEnriched(data, { today, allowRanking: true }).errors.join("\n");

/** The final API ranking a ranking-mode file must come from. */
const apiSnapshotFor = (data) => ({
  schemaVersion: 2,
  forVideoDate: data.date,
  source: "api",
  days: [
    {
      date: data.source.ph_date,
      status: "final",
      source: "api",
      posts: data.tools.map((t) => ({ id: `id-${t.rank}`, dailyRank: t.ph_rank, phUrl: t.ph_url, publishedAt: t.ph_published_at, isAI: true })),
    },
  ],
});

test("a well-formed ranking file passes with the date check and its API snapshot", () => {
  assert.deepEqual(validateEnriched(valid(), { today: "2026-09-15", snapshot: apiSnapshotFor(valid()), allowRanking: true }).errors, []);
});

test("stale date is an error unless the date check is off", () => {
  assert.match(errorsOf(valid(), "2026-09-16"), /does not match today/);
  assert.deepEqual(validateEnriched(valid(), { today: "2026-09-16", checkDate: false, snapshot: apiSnapshotFor(valid()), allowRanking: true }).errors, []);
});

test("ranking mode needs exactly five tools in video order", () => {
  assert.match(errorsOf(valid({ tools: [1, 2, 3, 4].map((r) => tool(r)) })), /ranking mode needs exactly 5/);
  assert.match(errorsOf(valid({ tools: [tool(2), tool(1), tool(3), tool(4), tool(5)] })), /rank must be 1/);
  const noRank = valid({ tools: [1, 2, 3, 4, 5].map((r) => tool(r, { ph_rank: undefined })) });
  assert.match(errorsOf(noRank), /ph_rank/);
});

test("pickup mode accepts 2-5 tools and refuses fewer (no post that day)", () => {
  assert.deepEqual(validateEnriched(pickup(2), { today: "2026-09-15" }).errors, []);
  assert.deepEqual(validateEnriched(pickup(5), { today: "2026-09-15" }).errors, []);
  assert.match(errorsOf(pickup(1)), /pickup mode needs 2-5 tools/);
  assert.match(errorsOf(pickup(6)), /pickup mode needs 2-5 tools/);
});

test("a skip day is valid only when fewer than 2 new launches were usable, and lists no tools", () => {
  const skip = (overrides = {}) => ({ date: "2026-09-15", genre: "ai-tools-top5", trial: 1, skip: { reason: "新作の候補が1本のため休止", fresh_candidates: 1 }, ...overrides });
  assert.deepEqual(validateEnriched(skip(), { today: "2026-09-15" }).errors, []);
  assert.match(errorsOf(skip({ skip: { reason: "気分で休止", fresh_candidates: 4 } })), /may only be skipped when fewer than 2/);
  assert.match(errorsOf(skip({ tools: [tool(1)] })), /must not list tools/);
  assert.match(errorsOf(skip({ skip: { reason: "詳細は https://evil.example", fresh_candidates: 0 } })), /skip\.reason contains a URL/);
  assert.match(errorsOf(skip(), "2026-09-16"), /does not match today/);
});

test("only new launches pass: ph_published_at must be inside the freshness window", () => {
  // Window for 2026-09-15 starts at 2026-09-13 00:00 PDT.
  assert.equal(freshSince("2026-09-15").toISOString(), "2026-09-13T07:00:00.000Z");
  assert.equal(isFresh("2026-09-12T23:59:00-07:00", "2026-09-15"), false);
  assert.equal(isFresh("2026-09-13T00:00:00-07:00", "2026-09-15"), true);
  const stale = pickup(3, { ph_published_at: "2026-09-10T11:43:38-07:00" });
  assert.match(errorsOf(stale), /is not a new launch for 2026-09-15/);
  const missing = pickup(3, { ph_published_at: undefined });
  assert.match(errorsOf(missing), /ph_published_at .* is required/);
  // Anchored to the video date, not the wall clock: a late pipeline run agrees with the routine.
  assert.deepEqual(validateEnriched(pickup(3), { today: "2026-09-20", checkDate: false }).errors, []);
});

test("a feed post created long before its launch is new when the feed listed it only after a fetch inside the window", () => {
  // Voiskey-like: post created 08-31, not listed by the 2026-09-13 14:30 PDT fetch (inside the window for 09-15).
  const created = "2026-08-31T04:01:15-07:00";
  const listed = pickup(3, { ph_published_at: created, ph_listed_after: "2026-09-13T21:30:00.000Z" });
  const listingSnapshot = {
    schemaVersion: 2,
    forVideoDate: "2026-09-15",
    source: "feed",
    days: [
      {
        date: "2026-09-14",
        status: "feed",
        source: "feed",
        posts: listed.tools.map((t) => ({ id: t.ph_url, name: t.name, phUrl: t.ph_url, publishedAt: created, listedAfter: "2026-09-13T21:30:00.000Z", isAI: true, inAiCategory: true })),
      },
    ],
  };
  assert.deepEqual(validateEnriched(listed, { today: "2026-09-15", snapshot: listingSnapshot }).errors, []);
  // Listing evidence only exists in a snapshot: without the same-day one the value cannot be trusted.
  assert.match(validateEnriched(listed, { today: "2026-09-15" }).errors.join("\n"), /tools\[0\]\.ph_listed_after needs the Product Hunt snapshot for 2026-09-15/);
  assert.equal(isNewLaunch({ publishedAt: created, listedAfter: "2026-09-13T21:30:00.000Z" }, "2026-09-15"), true);
  assert.equal(isNewLaunch({ publishedAt: created, listedAfter: null }, "2026-09-15"), false);

  // Listed after a fetch taken before the window: the launch may be older than 48 h.
  const early = pickup(3, { ph_published_at: created, ph_listed_after: "2026-09-12T21:30:00.000Z" });
  // The two limits differ: the publish time uses the window, the listing time
  // is allowed LISTING_GRACE_HOURS before it (2026-09-13T04:00Z here).
  assert.match(errorsOf(early), /ph_published_at 2026-08-31T04:01:15-07:00 is before 2026-09-13T07:00:00.000Z and ph_listed_after 2026-09-12T21:30:00.000Z is before 2026-09-13T04:00:00.000Z: tools\[0\] is not a new launch for 2026-09-15/);
  assert.match(errorsOf(pickup(3, { ph_listed_after: "yesterday" })), /ph_listed_after must be an ISO 8601 time or null/);
  assert.deepEqual(validateEnriched(pickup(3, { ph_listed_after: null }), { today: "2026-09-15" }).errors, []);
});

test("freshness window stays within 48 h of the routine start in PDT and PST", () => {
  const hours = (videoDate) => (new Date(`${videoDate}T07:30:00+09:00`) - freshSince(videoDate)) / 3600000;
  assert.equal(hours("2026-09-15"), 39.5); // PDT
  assert.equal(hours("2026-12-15"), 38.5); // PST
});

test("pickup mode must not use ranking vocabulary anywhere", () => {
  assert.match(errorsOf({ ...pickup(3), opening_narration: "新作AIツール、トップ5を紹介します。" }), /opening_narration uses ranking words/);
  assert.match(errorsOf(pickup(3, { narration: "今日のランキング1位のAIツールです。議事録づくりの時間がほぼゼロになります。" })), /uses ranking words/);
  // Ranking mode only warns.
  const ranked = valid({ tools: [tool(1, { narration: "総合1位のAIツールです。議事録づくりの時間がほぼゼロになります。" }), tool(2), tool(3), tool(4), tool(5)] });
  const res = validateEnriched(ranked, { today: "2026-09-15", snapshot: apiSnapshotFor(ranked), allowRanking: true });
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join("\n"), /mentions a rank/);
});

test("displayed text refuses links, mentions, hashtags, line breaks, control and invisible characters", () => {
  const bad = {
    url: "詳しくは https://evil.example で確認",
    www: "詳しくは www.evil.example へ",
    domain: "evil.com で無料配布中",
    mention: "@support に連絡",
    hashtag: "今すぐ #拡散希望",
    newline: "一行目\n二行目",
    control: "ベル\u{7}文字",
    zeroWidth: "ゼロ幅\u{200B}スペース",
    bidi: "向き\u{202E}反転",
    bom: "\u{FEFF}先頭BOM",
  };
  for (const [kind, value] of Object.entries(bad)) {
    assert.ok(textSafetyProblems(value).length > 0, `${kind} should be rejected`);
  }
  assert.deepEqual(textSafetyProblems("会議メモを自動で要約"), []);
  // Product names may contain a domain (Cal.com) but never a scheme URL.
  assert.deepEqual(textSafetyProblems("Cal.com", { allowDomains: true }), []);
  assert.ok(textSafetyProblems("https://cal.com", { allowDomains: true }).length > 0);

  const injected = valid({
    tools: [
      tool(1, { name: "Tool\u{200B}One" }),
      tool(2, { description: "詳細は evil.com へ" }),
      tool(3, { who: "#拡散希望 の人" }),
      tool(4, { narration: "@evil が作ったAIツールです。\n議事録づくりの時間がほぼゼロになります。" }),
      tool(5, { pricing_note: "www.evil.example" }),
    ],
  });
  const errors = errorsOf(injected);
  assert.match(errors, /tools\[0\]\.name contains an invisible/);
  assert.match(errors, /tools\[1\]\.description contains a domain name/);
  assert.match(errors, /tools\[2\]\.who contains a #hashtag/);
  assert.match(errors, /tools\[3\]\.narration contains a line break/);
  assert.match(errors, /tools\[3\]\.narration contains an @mention/);
  assert.match(errors, /tools\[4\]\.pricing_note contains a URL/);
});

test("pricing must be an allowed enum and URLs must be https without credentials", () => {
  const bad = valid({
    tools: [tool(1, { pricing: "cheap", website: "http://insecure.example.com", ph_url: "https://example.com/p" }), tool(2, { website: "https://user:pw@tool2.example.com/" }), tool(3), tool(4), tool(5)],
  });
  const errors = errorsOf(bad);
  assert.match(errors, /tools\[0\]\.pricing must be one of/);
  assert.match(errors, /tools\[0\]\.website must be/);
  assert.match(errors, /tools\[0\]\.ph_url must be/);
  assert.match(errors, /tools\[1\]\.website must be/);
});

test("Product Hunt redirect as website and template placeholders are rejected", () => {
  const redirect = valid({ tools: [tool(1, { website: "https://www.producthunt.com/r/p/1247901?app_id=339" }), tool(2), tool(3), tool(4), tool(5)] });
  assert.match(errorsOf(redirect), /website is a Product Hunt URL/);
  const placeholder = valid({ tools: [tool(1, { pricing_note: "任意", who: "誰向け" }), tool(2), tool(3), tool(4), tool(5)] });
  const errors = errorsOf(placeholder);
  assert.match(errors, /pricing_note still has the template placeholder/);
  assert.match(errors, /who still has the template placeholder/);
});

test("duplicate tool names are rejected", () => {
  assert.match(errorsOf(valid({ tools: [tool(1), tool(2, { name: "tool 1" }), tool(3), tool(4), tool(5)] })), /duplicated/);
});

test("narration length is enforced per tool and in total, sentence count is a warning", () => {
  const long = "あ".repeat(66) + "。";
  assert.match(errorsOf(valid({ tools: [tool(1, { narration: long }), tool(2), tool(3), tool(4), tool(5)] })), /narration: 67 chars/);
  const res = validateEnriched(valid({ tools: [tool(1, { narration: "AIで要約します。速いです。無料です。とても便利なのでおすすめできるツールです。" }), tool(2), tool(3), tool(4), tool(5)] }), { today: "2026-09-15" });
  assert.match(res.warnings.join("\n"), /4 sentences/);
});

test("toVideoTools: ranking shows the real Product Hunt rank, pickup shows order and no date", () => {
  const ranked = toVideoTools(valid({ tools: [tool(1, { pricing_note: "月$12〜", ph_rank: 9 }), tool(2), tool(3), tool(4), tool(5)] }));
  assert.equal(ranked[0].badge, "1");
  assert.equal(ranked[0].sourceNote, "Product Hunt 9/13 総合9位");
  assert.equal(ranked[0].pricingLabel, "月$12〜");
  assert.equal(ranked[1].pricingLabel, PRICING_LABELS.freemium);
  assert.equal(ranked[0].domain, "tool1.example.com");
  assert.equal(ranked[0].slug, "tool-1");

  const picked = toVideoTools(pickup(3));
  assert.equal(picked[0].badge, "1/3");
  // The feed's publish time is the post creation, not the launch day — no date on pickup cards.
  assert.equal(picked[2].sourceNote, "Product Hunt 新着");
  assert.equal(picked[0].phRank, null);
});

test("buildMeta: TOP5 only in ranking mode, N選 in pickup mode", () => {
  const r = buildMeta(valid());
  assert.equal(r.headline, "新作AIツール TOP5");
  assert.equal(r.bigLabel, "TOP5");
  assert.equal(r.titleTag, "新作AIツールTOP5");
  assert.equal(r.dateLabel, "2026.09.15 (火)");
  assert.match(r.sourceLabel, /Product Hunt 9\/13 ランキングの AI ツール上位5本/);

  const p = buildMeta(pickup(3));
  assert.equal(p.headline, "新作AIツール 3選");
  assert.equal(p.bigLabel, "3選");
  assert.equal(p.titleTag, "新作AIツール3選");
  for (const value of [p.headline, p.bigLabel, p.titleTag, p.sourceLabel, p.openingSourceLabel, defaultOpeningNarration("pickup", 3)]) {
    assert.ok(!/TOP|トップ|ランキング|位/.test(value), value);
  }
  assert.equal(defaultOpeningNarration("ranking", 5), "新作AIツール、トップ5を紹介します。");
});

test("helpers", () => {
  assert.equal(countSentences("フック文です。要点です。"), 2);
  assert.equal(countSentences("末尾に句点がない"), 1);
  assert.equal(charLength("🎉ab"), 3);
  assert.equal(displayDomain("https://www.resurf.app/pricing"), "resurf.app");
  assert.equal(todayJst(new Date("2026-09-14T15:00:00Z")), "2026-09-15");
});

test("parseEnrichedText repairs unescaped quotes and reports it", () => {
  const { data, repaired } = parseEnrichedText('{"a": "He said "hi" ok"}');
  assert.equal(repaired, true);
  assert.equal(data.a, 'He said "hi" ok');
});

// --- The freshness window against the real cron times -----------------------
//
// The fetch runs at 06:00 / 09:17 / 18:47 UTC. Earlier versions of these tests
// used made-up fetch times (21:30Z / 09:30Z), which hid the fact that the whole
// closed Pacific day fell out of the window: its 00:01 cohort carries the
// previous midday's fetch time as evidence.
test("a launch from the closed Pacific day is new, dated by the fetch that ran before midnight", () => {
  const videoDate = "2026-09-18"; // routine 07:30 JST 9/18 = 15:30 PDT 9/17
  // Window opens at 00:00 PDT on 9/16.
  assert.equal(freshSince(videoDate).toISOString(), "2026-09-16T07:00:00.000Z");

  // 9/16 00:01 PDT cohort: the 06:00 UTC fetch (23:00 PDT on 9/15) is the last
  // complete one that did not list it yet.
  assert.equal(isNewLaunch({ publishedAt: null, listedAfter: "2026-09-16T06:00:00.000Z" }, videoDate), true);
  // Same cohort seen an hour late (cron delay) — still before midnight.
  assert.equal(isNewLaunch({ publishedAt: null, listedAfter: "2026-09-16T06:55:00.000Z" }, videoDate), true);

  // 9/17 00:01 PDT cohort (the day in progress) was already covered.
  assert.equal(isNewLaunch({ publishedAt: null, listedAfter: "2026-09-17T06:00:00.000Z" }, videoDate), true);

  // Evidence from the previous midday (18:47 UTC = 11:47 PDT on 9/15) proves
  // nothing about the window: it is 13 hours before it opens.
  assert.equal(isNewLaunch({ publishedAt: null, listedAfter: "2026-09-15T18:47:00.000Z" }, videoDate), false);
  // The grace is bounded: 20:00 PDT on 9/15 is four hours early.
  assert.equal(isNewLaunch({ publishedAt: null, listedAfter: "2026-09-16T03:00:00.000Z" }, videoDate), false);
  // A launch listed two days before the window is never new.
  assert.equal(isNewLaunch({ publishedAt: null, listedAfter: "2026-09-14T18:47:00.000Z" }, videoDate), false);
});

test("the grace applies to listing evidence only, never to a publish time", () => {
  const videoDate = "2026-09-18";
  // 23:00 PDT on 9/15 as a publish time is outside the window: publishedAt is
  // the launch itself, so it needs no allowance.
  assert.equal(isNewLaunch({ publishedAt: "2026-09-16T06:00:00.000Z", listedAfter: null }, videoDate), false);
  assert.equal(isNewLaunch({ publishedAt: "2026-09-16T07:00:00.000Z", listedAfter: null }, videoDate), true);
});

test("winter (PST): the 06:00 UTC fetch lands at 22:00 Pacific and still dates the next day", () => {
  const videoDate = "2026-12-18"; // PST: UTC-8
  assert.equal(freshSince(videoDate).toISOString(), "2026-12-16T08:00:00.000Z");
  // 06:00 UTC on 12/16 = 22:00 PST on 12/15 — two hours before the window.
  assert.equal(isNewLaunch({ publishedAt: null, listedAfter: "2026-12-16T06:00:00.000Z" }, videoDate), true);
  // The previous midday is still out.
  assert.equal(isNewLaunch({ publishedAt: null, listedAfter: "2026-12-15T18:47:00.000Z" }, videoDate), false);
});
