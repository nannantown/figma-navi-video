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
  buildSnapshot,
  fetchDayViaApi,
  aiCategoryFilterStatus,
} from "./fetch-product-hunt.mjs";

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

test("mergeFeedEntries keeps AI-category entries first and dedupes", () => {
  const ai = parseAtomFeed(FEED).slice(1); // Oats appears in the AI category feed
  const all = parseAtomFeed(FEED);
  const merged = mergeFeedEntries(ai, all);
  assert.deepEqual(merged.map((p) => p.name), ["Oats & Co", "Juggler"]);
  assert.equal(merged[0].isAI, true);
  assert.deepEqual(merged.map((p) => p.order), [1, 2]);
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
  assert.equal(aiCategoryFilterStatus(all.slice(1), all), "ok");
  assert.equal(aiCategoryFilterStatus(all, []), "unknown");
});

test("an API failure falls back to the feed in pickup mode and records the error", async () => {
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://api.producthunt.com")) return new Response("{}", { status: 502 });
    return new Response(FEED, { status: 200 });
  };
  const snap = await buildSnapshot({ env: { PRODUCT_HUNT_API_TOKEN: "tok" }, fetchImpl, now: new Date("2026-09-14T09:30:00Z"), sleepImpl: async () => {} });
  assert.equal(snap.source, "feed");
  assert.equal(snap.mode, "pickup");
  assert.match(snap.apiError, /502/);
  assert.ok(!snap.apiError.includes("tok"));
  assert.equal(snap.days.length, 1);
  assert.equal(snap.days[0].status, "feed");
});

test("classifyPost recognises dev tools by keyword", () => {
  assert.equal(classifyPost({ name: "Fastship", tagline: "Deploy from your terminal", topics: [] }).isDev, true);
});

test("getToken reads only PRODUCT_HUNT_API_TOKEN", () => {
  assert.equal(getToken({}), null);
  assert.equal(getToken({ PRODUCT_HUNT_API_TOKEN: "  abc " }), "abc");
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
