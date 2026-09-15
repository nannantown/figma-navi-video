import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pacificDayBounds,
  videoDateForSnapshot,
  parseAtomFeed,
  mergeFeedEntries,
  normalizePost,
  rankPosts,
  classifyPost,
  getToken,
  resolveSource,
  buildSnapshot,
  fetchDayViaApi,
  aiCategoryFilterStatus,
  updateListing,
  previousListing,
  readPreviousSnapshot,
  fetchFeed,
  listingHealth,
  reportListingHealth,
  LISTING_RETENTION_DAYS,
  MIN_AI_ONLY_ENTRIES,
  FEED_RETRY_DELAYS_MS,
} from "./fetch-product-hunt.mjs";

const noSleep = async () => {};

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xml:lang="en-US" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:www.producthunt.com,2005:Post/1247901</id>
    <published>2026-09-11T11:43:38-07:00</published>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/products/juggler"/>
    <title>Juggler</title>
    <content type="html">          &lt;p&gt;
            A visual AI coding harness
          &lt;/p&gt;
          &lt;p&gt;
            &lt;a href="https://www.producthunt.com/products/juggler?utm_campaign=producthunt-atom-posts-feed&amp;amp;utm_medium=rss-feed"&gt;Discussion&lt;/a&gt;
            |
            &lt;a href="https://www.producthunt.com/r/p/1247901?app_id=339"&gt;Link&lt;/a&gt;
          &lt;/p&gt;
</content>
  </entry>
  <entry>
    <id>tag:www.producthunt.com,2005:Post/1247984</id>
    <published>2026-09-11T13:35:39-07:00</published>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/products/oats"/>
    <title>Oats &amp; Co</title>
    <content type="html">&lt;p&gt;Meal planner for busy families&lt;/p&gt;</content>
  </entry>
</feed>`;

test("pacificDayBounds handles PDT and the closed/in-progress status", () => {
  // 2026-09-14 09:30 UTC = 18:30 JST = 02:30 PDT on 09-14
  const now = new Date("2026-09-14T09:30:00Z");
  const closed = pacificDayBounds(-1, now);
  assert.equal(closed.date, "2026-09-13");
  assert.equal(closed.postedAfter, "2026-09-13T07:00:00.000Z");
  assert.equal(closed.postedBefore, "2026-09-14T07:00:00.000Z");
  assert.equal(closed.status, "final");
  assert.equal(closed.leaderboardUrl, "https://www.producthunt.com/leaderboard/daily/2026/9/13");
  assert.equal(pacificDayBounds(0, now).status, "in_progress");
});

test("pacificDayBounds handles PST after the November DST change", () => {
  const now = new Date("2026-11-10T20:00:00Z"); // 12:00 PST
  const today = pacificDayBounds(0, now);
  assert.equal(today.date, "2026-11-10");
  assert.equal(today.postedAfter, "2026-11-10T08:00:00.000Z");
});

test("videoDateForSnapshot: evening runs prepare tomorrow, morning runs today", () => {
  assert.equal(videoDateForSnapshot(new Date("2026-09-14T09:30:00Z")), "2026-09-15"); // 18:30 JST
  assert.equal(videoDateForSnapshot(new Date("2026-09-14T21:30:00Z")), "2026-09-15"); // 06:30 JST next day
});

test("parseAtomFeed extracts name, tagline, slug and the redirect link", () => {
  const [juggler, oats] = parseAtomFeed(FEED);
  assert.equal(juggler.id, "1247901");
  assert.equal(juggler.name, "Juggler");
  assert.equal(juggler.tagline, "A visual AI coding harness");
  assert.equal(juggler.slug, "juggler");
  assert.equal(juggler.url, "https://www.producthunt.com/products/juggler");
  assert.equal(juggler.website, "https://www.producthunt.com/r/p/1247901?app_id=339");
  assert.equal(juggler.isAI, true);
  assert.equal(oats.name, "Oats & Co");
  assert.equal(oats.tagline, "Meal planner for busy families");
  assert.equal(oats.isAI, false);
});

// Older AI-category launches the general feed no longer shows (a working filter returns many).
const archiveEntries = (n, start = 9000) =>
  Array.from({ length: n }, (_, i) => ({ id: String(start + i), name: `Archive ${i}`, tagline: "AI archive", isAI: true, isDev: false }));

test("mergeFeedEntries keeps AI-category entries first and dedupes", () => {
  const all = parseAtomFeed(FEED);
  const ai = [all[1], ...archiveEntries(MIN_AI_ONLY_ENTRIES)]; // Oats appears in the AI category feed
  const merged = mergeFeedEntries(ai, all);
  assert.deepEqual(merged.slice(0, 1).map((p) => p.name), ["Oats & Co"]);
  assert.equal(merged[0].isAI, true);
  assert.equal(merged.at(-1).name, "Juggler");
  assert.equal(merged.at(-1).inAiCategory, false);
  assert.deepEqual(merged.map((p) => p.order), merged.map((_, i) => i + 1));
});

test("normalizePost + rankPosts order by dailyRank then votes", () => {
  const node = (id, dailyRank, votesCount, topics = []) => ({
    id,
    name: `P${id}`,
    tagline: "Something",
    slug: `p${id}`,
    url: `https://www.producthunt.com/products/p${id}`,
    votesCount,
    dailyRank,
    thumbnail: { type: "image", url: `https://ph-files.imgix.net/${id}.png` },
    topics: { edges: topics.map((slug) => ({ node: { name: slug, slug } })) },
  });
  const posts = rankPosts([node(1, 3, 50), node(2, 1, 10, ["artificial-intelligence"]), node(3, null, 99), node(4, 2, 20)].map(normalizePost));
  assert.deepEqual(posts.map((p) => p.id), ["2", "4", "1", "3"]);
  assert.equal(posts[0].isAI, true);
  assert.equal(posts[0].thumbnail, "https://ph-files.imgix.net/2.png");
});

test("API URLs lose their tracking query so they can be copied into ph_url", () => {
  const post = normalizePost({ id: 9, name: "X", tagline: "AI", slug: "x-ai", url: "https://www.producthunt.com/posts/x-ai?utm_campaign=producthunt-api&utm_medium=api-v2", topics: { edges: [] } });
  assert.equal(post.phUrl, "https://www.producthunt.com/posts/x-ai");
  assert.equal(post.url, post.phUrl);
  assert.equal(post.slug, "x-ai");
});

test("an ignored ?category= (same entries as the general feed) does not mark everything as AI", () => {
  const all = parseAtomFeed(FEED);
  assert.equal(aiCategoryFilterStatus(all, all), "ignored");
  const merged = mergeFeedEntries(all, all);
  const oats = merged.find((p) => p.name === "Oats & Co");
  assert.equal(oats.isAI, false);
  assert.equal(oats.inAiCategory, null);
  assert.equal(aiCategoryFilterStatus(all.slice(1), all), "ignored"); // a subset of the general feed proves nothing
  assert.equal(aiCategoryFilterStatus([...all, ...archiveEntries(MIN_AI_ONLY_ENTRIES)], all), "ok");
  // Two cached copies of the general feed that differ by one post are not a working filter.
  assert.equal(aiCategoryFilterStatus([...all, ...archiveEntries(1)], all), "unknown");
  assert.equal(aiCategoryFilterStatus(all, []), "unknown");
});

test("an API failure falls back to the feed in pickup mode and records the error", async () => {
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://api.producthunt.com")) return new Response("{}", { status: 502 });
    return new Response(FEED, { status: 200 });
  };
  const snap = await buildSnapshot({
    env: { PH_SOURCE: "api", PRODUCT_HUNT_API_TOKEN: "tok" },
    fetchImpl,
    now: new Date("2026-09-14T09:30:00Z"),
    sleepImpl: async () => {},
  });
  assert.equal(snap.source, "feed");
  assert.equal(snap.mode, "pickup");
  assert.match(snap.apiError, /502/);
  assert.ok(!snap.apiError.includes("tok"));
  assert.equal(snap.days.length, 1);
  assert.equal(snap.days[0].status, "feed");
});

test("feed entries are marked fresh only when published inside the window for the video date", async () => {
  const freshEntry = FEED.replace(
    "</feed>",
    `  <entry>
    <id>tag:www.producthunt.com,2005:Post/1250000</id>
    <published>2026-09-13T19:52:46-07:00</published>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/products/slashy"/>
    <title>Slashy Assistant</title>
    <content type="html">&lt;p&gt;The AI assistant that does email for you&lt;/p&gt;</content>
  </entry>
</feed>`
  );
  const fetchImpl = async () => new Response(freshEntry, { status: 200 });
  // 06:30 JST on 2026-09-15 → video 2026-09-15 → fresh since 2026-09-13 00:00 PDT
  const snap = await buildSnapshot({ env: {}, fetchImpl, now: new Date("2026-09-14T21:30:00Z") });
  assert.equal(snap.freshSince, "2026-09-13T07:00:00.000Z");
  const byName = Object.fromEntries(snap.days[0].posts.map((p) => [p.name, p]));
  assert.equal(byName["Slashy Assistant"].fresh, true);
  assert.equal(byName["Slashy Assistant"].publishedAt, "2026-09-13T19:52:46-07:00");
  assert.equal(byName.Juggler.fresh, false); // published 2026-09-11
  assert.equal(snap.days[0].freshCount, 1);
  assert.equal(snap.days[0].freshAiCount, 1);
});

test("API posts use featuredAt as the publish time", () => {
  const post = normalizePost({ id: 1, name: "X", tagline: "AI", slug: "x", url: "https://www.producthunt.com/posts/x", createdAt: "2026-09-10T10:00:00Z", featuredAt: "2026-09-13T07:01:00Z", topics: { edges: [] } });
  assert.equal(post.publishedAt, "2026-09-13T07:01:00Z");
});

test("a failing AI category feed does not fail the snapshot; both failing does", async () => {
  const aiDown = async (url) =>
    String(url).includes("category=") ? new Response("", { status: 503 }) : new Response(FEED, { status: 200 });
  const snap = await buildSnapshot({ env: {}, fetchImpl: aiDown, now: new Date("2026-09-14T21:30:00Z"), sleepImpl: noSleep });
  assert.equal(snap.days[0].posts.length, 2);
  assert.equal(snap.days[0].aiCategoryFilter, "unknown");

  const allDown = async () => new Response("", { status: 503 });
  await assert.rejects(buildSnapshot({ env: {}, fetchImpl: allDown, now: new Date("2026-09-14T21:30:00Z"), sleepImpl: noSleep }), /Both Product Hunt feeds failed/);
});

test("keyword classification avoids 'agents' and 'code' false positives", () => {
  const plain = (name, tagline) => classifyPost({ name, tagline, topics: [] });
  assert.equal(plain("Homely", "CRM for real estate agents").isAI, false);
  assert.equal(plain("QRify", "Beautiful QR code generator").isDev, false);
  assert.equal(plain("Promo Hub", "Share promo code deals").isDev, false);
  assert.equal(plain("Crew", "Build AI agents for support").isAI, true);
  assert.equal(plain("Reviewly", "Automated code review for teams").isDev, true);
  assert.equal(plain("Stackr", "Open-source SDK for developers").isDev, true);
});

test("classifyPost recognises dev tools by keyword", () => {
  assert.equal(classifyPost({ name: "Fastship", tagline: "Deploy from your terminal", topics: [] }).isDev, true);
});

test("getToken reads only PRODUCT_HUNT_API_TOKEN", () => {
  assert.equal(getToken({}), null);
  assert.equal(getToken({ PRODUCT_HUNT_API_TOKEN: "  abc " }), "abc");
});

test("resolveSource: the feed is the default; the API needs PH_SOURCE=api and a token (owner decision 2026-09-15)", () => {
  assert.deepEqual(resolveSource({}), { source: "feed", token: null, notice: null });
  assert.deepEqual(resolveSource({ PH_SOURCE: "feed" }), { source: "feed", token: null, notice: null });
  const tokenOnly = resolveSource({ PRODUCT_HUNT_API_TOKEN: "secret-token" });
  assert.equal(tokenOnly.source, "feed");
  assert.equal(tokenOnly.token, null);
  assert.match(tokenOnly.notice, /set but not used/);
  assert.ok(!tokenOnly.notice.includes("secret-token"));
  assert.deepEqual(resolveSource({ PH_SOURCE: " API ", PRODUCT_HUNT_API_TOKEN: "t" }), { source: "api", token: "t", notice: null });
  const apiWithoutToken = resolveSource({ PH_SOURCE: "api" });
  assert.equal(apiWithoutToken.source, "feed");
  assert.match(apiWithoutToken.notice, /PRODUCT_HUNT_API_TOKEN is not set/);
  assert.match(resolveSource({ PH_SOURCE: "graphql" }).notice, /Unknown PH_SOURCE "graphql"/);
});

test("a token alone never calls the API", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(FEED, { status: 200 });
  };
  const snap = await buildSnapshot({ env: { PRODUCT_HUNT_API_TOKEN: "tok" }, fetchImpl, now: new Date("2026-09-14T21:30:00Z") });
  assert.equal(snap.source, "feed");
  assert.equal(snap.mode, "pickup");
  assert.equal(snap.apiError, undefined);
  assert.ok(calls.every((u) => u.startsWith("https://www.producthunt.com/feed")), calls.join(", "));
});

// Feed with one post created weeks before its launch day (like Voiskey on 2026-09-15).
const feedWith = (...entries) =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries
    .map(
      ([id, published, name, tagline]) =>
        `<entry><id>tag:www.producthunt.com,2005:Post/${id}</id><published>${published}</published><link rel="alternate" type="text/html" href="https://www.producthunt.com/products/${name.toLowerCase()}"/><title>${name}</title><content type="html">&lt;p&gt;${tagline}&lt;/p&gt;</content></entry>`
    )
    .join("")}</feed>`;
const OLD_LAUNCH = ["1", "2026-09-10T08:00:00-07:00", "Oldie", "AI notes for teams"];
const EARLY_POST = ["2", "2026-08-31T04:01:15-07:00", "Voicey", "AI voice typing in every app"];
const OTHER = ["3", "2026-09-01T09:00:00-07:00", "Plainly", "Meal planner for families"];
// A full page: older AI-category launches below the listed posts (only the AI
// feed reaches that far back) and older general launches below the general feed.
const AI_TAIL = Array.from({ length: 24 }, (_, i) => [String(900 + i), "2026-08-01T08:00:00-07:00", `Archive${i}`, "AI archive tool"]);
const ALL_TAIL = Array.from({ length: 20 }, (_, i) => [String(800 + i), "2026-09-01T08:00:00-07:00", `General${i}`, "Recipe box for families"]);
// AI category feed + general feed, each a complete page (so the fetch counts as complete).
const feeds = (ai, all) => async (url) =>
  new Response(String(url).includes("category=") ? feedWith(...ai, ...AI_TAIL) : feedWith(...all, ...ALL_TAIL), { status: 200 });

test("listing registry: a post missing from a complete fetch inside the window is a new launch on the next fetch", async () => {
  // 2026-09-15 06:30 JST (14:30 PDT 09-14): baseline — Voicey has not launched yet.
  const first = await buildSnapshot({ env: {}, fetchImpl: feeds([OLD_LAUNCH], [OLD_LAUNCH, OTHER]), now: new Date("2026-09-14T21:30:00Z") });
  assert.equal(first.listing.lastCompleteAt, "2026-09-14T21:30:00.000Z");
  assert.ok(first.days[0].posts.every((p) => p.listedAfter === null));

  // 2026-09-15 18:30 JST (02:30 PDT 09-15): Voicey launched at 00:01 PDT and is listed now.
  const second = await buildSnapshot({
    env: {},
    fetchImpl: feeds([EARLY_POST, OLD_LAUNCH], [EARLY_POST, OLD_LAUNCH, OTHER]),
    now: new Date("2026-09-15T09:30:00Z"),
    previous: first,
  });
  assert.equal(second.forVideoDate, "2026-09-16"); // window starts 2026-09-14 00:00 PDT
  const byName = Object.fromEntries(second.days[0].posts.map((p) => [p.name, p]));
  assert.equal(byName.Voicey.listedAfter, "2026-09-14T21:30:00.000Z");
  assert.equal(byName.Voicey.fresh, true); // created 08-31, but proven to launch after 09-14 14:30 PDT
  assert.equal(byName.Oldie.listedAfter, null); // already listed at the baseline: unproven
  assert.equal(byName.Oldie.fresh, false);
  assert.equal(second.days[0].freshAiCount, 1);
  assert.equal(second.listing.lastCompleteAt, "2026-09-15T09:30:00.000Z");

  // The evidence is carried, not refreshed, on later fetches.
  const third = await buildSnapshot({
    env: {},
    fetchImpl: feeds([EARLY_POST, OLD_LAUNCH], [EARLY_POST, OLD_LAUNCH, OTHER]),
    now: new Date("2026-09-15T21:30:00Z"),
    previous: second,
  });
  const voicey = third.days[0].posts.find((p) => p.name === "Voicey");
  assert.equal(voicey.listedAfter, "2026-09-14T21:30:00.000Z");
  assert.equal(third.listing.posts["2"].lastSeenAt, "2026-09-15T21:30:00.000Z");
});

test("listing registry: partial fetches do not move lastCompleteAt, so posts they missed do not look new later", async () => {
  const base = await buildSnapshot({ env: {}, fetchImpl: feeds([OLD_LAUNCH, EARLY_POST], [OTHER]), now: new Date("2026-09-13T21:30:00Z") });
  // The AI category feed fails: only the general feed answers.
  const aiDown = async (url) =>
    String(url).includes("category=") ? new Response("", { status: 503 }) : new Response(feedWith(OTHER), { status: 200 });
  const partial = await buildSnapshot({ env: {}, fetchImpl: aiDown, now: new Date("2026-09-14T09:30:00Z"), previous: base, sleepImpl: noSleep });
  assert.equal(partial.listing.lastCompleteAt, "2026-09-13T21:30:00.000Z");
  assert.ok(partial.listing.posts["1"], "posts the partial fetch missed stay in the registry");

  const back = await buildSnapshot({ env: {}, fetchImpl: feeds([OLD_LAUNCH, EARLY_POST], [OTHER]), now: new Date("2026-09-14T21:30:00Z"), previous: partial });
  assert.ok(back.days[0].posts.every((p) => p.listedAfter === null), "nothing became new just because one fetch missed it");
});

test("listing registry: unusable previous snapshots start a new registry; stale entries are dropped", () => {
  const now = new Date("2026-09-15T09:30:00Z");
  const posts = [{ id: "7", phUrl: "https://www.producthunt.com/products/x" }];
  assert.equal(previousListing(null, now), null);
  assert.equal(previousListing({ source: "api", listing: { lastCompleteAt: null, posts: {} } }, now), null);
  assert.equal(previousListing({ source: "feed", listing: { lastCompleteAt: "2026-09-16T00:00:00Z", posts: {} } }, now), null);
  const { stats: firstStats, ...first } = updateListing(null, posts, { now, complete: true, feeds: [["7"]] });
  assert.deepEqual(first, {
    lastCompleteAt: "2026-09-15T09:30:00.000Z",
    posts: { 7: { listedAfter: null, lastSeenAt: "2026-09-15T09:30:00.000Z" } },
  });
  assert.equal(firstStats.added, 1);
  const old = {
    source: "feed",
    listing: {
      lastCompleteAt: "2026-09-14T21:30:00.000Z",
      posts: { 9: { listedAfter: null, lastSeenAt: "2026-09-01T00:00:00.000Z" }, 8: { listedAfter: "bad", lastSeenAt: "2026-09-14T21:30:00.000Z" } },
    },
  };
  const next = updateListing(old, posts, { now, complete: false, feeds: [["7", "8"]] });
  assert.equal(next.posts["9"], undefined); // not listed for more than LISTING_RETENTION_DAYS
  assert.equal(next.posts["8"].listedAfter, null);
  assert.equal(next.posts["7"].listedAfter, "2026-09-14T21:30:00.000Z"); // above the known post 8
  assert.equal(next.lastCompleteAt, "2026-09-14T21:30:00.000Z");
  assert.equal(LISTING_RETENTION_DAYS, 10);

  // Below a known post = an older launch day the registry never saw: not dated.
  const below = updateListing(old, posts, { now, complete: true, feeds: [["8", "7"]] });
  assert.equal(below.posts["7"].listedAfter, null);
  assert.equal(below.stats.belowKnown, 1);
  // A feed with no known post at all (reset / id format change): not dated, and reported.
  const unknownFeed = updateListing(old, posts, { now, complete: true, feeds: [["7"]] });
  assert.equal(unknownFeed.posts["7"].listedAfter, null);
  assert.equal(unknownFeed.stats.noKnownInFeed, 1);
  assert.equal(unknownFeed.stats.feedsWithoutKnown, 1);
  // Listed in two feeds: must be above the known posts in both.
  const twoFeeds = updateListing(old, posts, { now, complete: true, feeds: [["7", "8"], ["8", "7"]] });
  assert.equal(twoFeeds.posts["7"].listedAfter, null);
});

test("listing registry: an old post that first shows up low in the feed is not dated as a new launch", async () => {
  // Baseline at 2026-09-14 21:30Z lists OLD_LAUNCH on top; the AI tail below.
  const first = await buildSnapshot({ env: {}, fetchImpl: feeds([OLD_LAUNCH], [OLD_LAUNCH, OTHER]), now: new Date("2026-09-14T21:30:00Z") });
  // Next fetch: Voicey launched (top), and an old post created 09-01 appears at the very bottom
  // of the AI feed for the first time (e.g. a post above it was removed).
  const SURFACED = ["777", "2026-09-01T10:00:00-07:00", "Resurfaced", "AI helper for old docs"];
  const fetchImpl = async (url) =>
    new Response(
      String(url).includes("category=") ? feedWith(EARLY_POST, OLD_LAUNCH, ...AI_TAIL, SURFACED) : feedWith(EARLY_POST, OLD_LAUNCH, OTHER, ...ALL_TAIL),
      { status: 200 }
    );
  const second = await buildSnapshot({ env: {}, fetchImpl, now: new Date("2026-09-15T09:30:00Z"), previous: first });
  const byName = Object.fromEntries(second.days[0].posts.map((p) => [p.name, p]));
  assert.equal(byName.Voicey.listedAfter, "2026-09-14T21:30:00.000Z");
  assert.equal(byName.Voicey.fresh, true);
  assert.equal(byName.Resurfaced.listedAfter, null);
  assert.equal(byName.Resurfaced.fresh, false);
  assert.equal(second.days[0].freshAiCount, 1);
  assert.equal(second.listingHealth.dated, 1);
  assert.equal(second.listingHealth.belowKnown, 1);
  assert.deepEqual(second.listingHealth.alerts, []);
});

test("listing registry: a changed post id format dates nothing and raises an alert", async () => {
  const first = await buildSnapshot({ env: {}, fetchImpl: feeds([OLD_LAUNCH, EARLY_POST], [OLD_LAUNCH, OTHER]), now: new Date("2026-09-14T21:30:00Z") });
  const renamed = (xml) => xml.replaceAll(",2005:Post/", ",2005:Product/");
  const fetchImpl = async (url, init) => new Response(renamed(await (await feeds([OLD_LAUNCH, EARLY_POST], [OLD_LAUNCH, OTHER])(url, init)).text()), { status: 200 });
  const second = await buildSnapshot({ env: {}, fetchImpl, now: new Date("2026-09-15T09:30:00Z"), previous: first });
  assert.ok(second.days[0].posts.every((p) => p.listedAfter === null));
  assert.equal(second.days[0].freshAiCount, 0);
  assert.match(second.listingHealth.alerts.join("\n"), /2 feed\(s\) had no post the registry knows/);
});

test("fetches with short pages or a barely different category feed are partial", async () => {
  const short = async (url) => new Response(String(url).includes("category=") ? feedWith(EARLY_POST) : feedWith(OLD_LAUNCH, OTHER), { status: 200 });
  const snap = await buildSnapshot({ env: {}, fetchImpl: short, now: new Date("2026-09-14T21:30:00Z") });
  assert.equal(snap.listing.lastCompleteAt, null);
  assert.equal(snap.listingHealth.thisFetch, "partial");
  // Category ignored but the two cached copies differ by one post.
  const general = [OLD_LAUNCH, OTHER, ...ALL_TAIL];
  const cached = async (url) => new Response(String(url).includes("category=") ? feedWith(EARLY_POST, ...general) : feedWith(...general), { status: 200 });
  const snap2 = await buildSnapshot({ env: {}, fetchImpl: cached, now: new Date("2026-09-14T21:30:00Z") });
  assert.equal(snap2.days[0].aiCategoryFilter, "unknown");
  assert.equal(snap2.listingHealth.thisFetch, "partial");
  assert.ok(snap2.days[0].posts.every((p) => p.inAiCategory === null));
});

test("listingHealth: a frozen baseline and a restarted registry are alerts; one partial fetch is a warning", () => {
  const now = new Date("2026-09-16T09:30:00Z");
  const stats = { known: 10, added: 0, dated: 0, belowKnown: 0, noKnownInFeed: 0, feedsWithoutKnown: 0 };
  const base = { previous: { source: "feed", listing: { lastCompleteAt: null, posts: {} } }, now, aiCategoryFilter: "unknown", feedSizes: { ai: 0, all: 50 } };
  const recent = listingHealth({ ...base, listing: { lastCompleteAt: "2026-09-15T21:30:00.000Z", posts: {}, stats }, complete: false });
  assert.deepEqual(recent.alerts, []);
  assert.match(recent.warnings.join("\n"), /this fetch was partial/);
  const frozen = listingHealth({ ...base, listing: { lastCompleteAt: "2026-09-15T00:00:00.000Z", posts: {}, stats }, complete: false });
  assert.match(frozen.alerts.join("\n"), /no complete fetch for 33\.5 h/);
  const restarted = listingHealth({ ...base, previous: { source: "api" }, listing: { lastCompleteAt: now.toISOString(), posts: {}, stats }, complete: true });
  assert.equal(restarted.registry, "restarted");
  assert.match(restarted.alerts.join("\n"), /could not be used/);
  const started = listingHealth({ ...base, previous: null, listing: { lastCompleteAt: now.toISOString(), posts: {}, stats }, complete: true });
  assert.equal(started.registry, "started");
  assert.deepEqual(started.alerts, []);
});

test("reportListingHealth annotates the run and exports alerts for the workflow's health step", () => {
  const lines = [];
  const writes = [];
  const health = { alerts: ["no complete fetch for 31 h"], warnings: ["this fetch was partial"] };
  reportListingHealth(health, { GITHUB_ACTIONS: "true", GITHUB_OUTPUT: "/tmp/out" }, { log: (l) => lines.push(l), write: (...args) => writes.push(args) });
  assert.deepEqual(lines, ["::warning title=Product Hunt listing::this fetch was partial", "::error title=Product Hunt listing::no complete fetch for 31 h"]);
  assert.deepEqual(writes[0].slice(0, 2), ["/tmp/out", "listing_alert=no complete fetch for 31 h\n"]);
  const quiet = [];
  reportListingHealth({ alerts: [], warnings: [] }, { GITHUB_ACTIONS: "true", GITHUB_OUTPUT: "/tmp/out" }, { log: (l) => quiet.push(l), write: (...args) => writes.push(args) });
  assert.deepEqual(quiet, []);
  assert.equal(writes[1][1], "listing_alert=\n");
});

test("fetchFeed retries 5xx, 429 and empty pages with backoff, but not other 4xx", async () => {
  const sleeps = [];
  const sleepImpl = async (ms) => sleeps.push(ms);
  const answers = [new Response("", { status: 503 }), new Response("<html>challenge</html>", { status: 200 }), new Response(FEED, { status: 200 })];
  const entries = await fetchFeed({ fetchImpl: async () => answers.shift(), sleepImpl });
  assert.equal(entries.length, 2);
  assert.deepEqual(sleeps, FEED_RETRY_DELAYS_MS);

  let calls = 0;
  await assert.rejects(
    fetchFeed({ fetchImpl: async () => (calls++, new Response("", { status: 404 })), sleepImpl }),
    /HTTP 404/
  );
  assert.equal(calls, 1);

  let tooMany = 0;
  await assert.rejects(fetchFeed({ fetchImpl: async () => (tooMany++, new Response("", { status: 429 })), sleepImpl }), /HTTP 429/);
  assert.equal(tooMany, 3);
});

test("readPreviousSnapshot returns null for a missing or broken file", () => {
  assert.equal(readPreviousSnapshot("/nonexistent/product-hunt-daily.json"), null);
});

test("buildSnapshot without a token uses the feed in pickup mode", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(FEED, { status: 200, headers: { "content-type": "application/atom+xml" } });
  };
  const snap = await buildSnapshot({ env: {}, fetchImpl, now: new Date("2026-09-14T21:30:00Z") });
  assert.equal(snap.source, "feed");
  assert.equal(snap.mode, "pickup");
  assert.equal(snap.forVideoDate, "2026-09-15");
  assert.equal(snap.days[0].posts.length, 2);
  assert.ok(calls[0].endsWith("?category=artificial-intelligence"));
});

test("fetchDayViaApi pages through results and sends the bearer token", async () => {
  const seenAuth = [];
  let page = 0;
  const fetchImpl = async (_url, init) => {
    seenAuth.push(init.headers.Authorization);
    page++;
    const edges = [{ node: { id: String(page), name: `P${page}`, tagline: "AI thing", slug: `p${page}`, url: "u", votesCount: 10 - page, dailyRank: page, topics: { edges: [] } } }];
    const body = { data: { posts: { pageInfo: { hasNextPage: page < 2, endCursor: page < 2 ? "c1" : null }, edges } } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const posts = await fetchDayViaApi("tok", pacificDayBounds(-1, new Date("2026-09-14T09:30:00Z")), { fetchImpl, sleepImpl: async () => {} });
  assert.equal(posts.length, 2);
  assert.deepEqual(seenAuth, ["Bearer tok", "Bearer tok"]);
});

test("a rejected token fails fast without retries", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response("{}", { status: 401 });
  };
  await assert.rejects(
    fetchDayViaApi("bad", pacificDayBounds(-1), { fetchImpl, sleepImpl: async () => {} }),
    /401/
  );
  assert.equal(calls, 1);
});
