/**
 * Fetch Product Hunt launches into data/product-hunt-daily.json.
 *
 * Runs in GitHub Actions (fetch-product-hunt.yml) twice a day — 18:30 JST
 * (the evening before) and 06:30 JST (second chance) — so the Claude Routine
 * (07:30 JST) can pick new AI tools from a fixed snapshot instead of crawling
 * the site itself. GitHub's cron can start 1-2 h late, which is why the primary
 * run is the evening before rather than just before the routine.
 *
 * Source (owner decision 2026-09-15, option B):
 *   - Default and only source used by the workflow: the official Atom feed.
 *     Recent featured launches without votes, rank, topics or images → the
 *     routine runs in "pickup" mode and never calls its order a ranking.
 *   - Official GraphQL API v2 is kept as an explicit opt-in only
 *     (PH_SOURCE=api plus PRODUCT_HUNT_API_TOKEN). A token alone does nothing:
 *     the API terms ask for a separate agreement for commercial use, and the
 *     owner chose not to use it. Opt-in gives dailyRank/votes → "ranking" mode.
 *
 * New launches from the feed: <published> is when the post was created, often
 * weeks before the launch, so each snapshot also carries a listing registry
 * (updateListing) and every post gets `listedAfter` — the last complete fetch
 * that did not list it yet. The previous snapshot at the output path is read
 * before it is overwritten.
 *
 * Usage:
 *   node scripts/fetch-product-hunt.mjs              # writes data/product-hunt-daily.json
 *   node scripts/fetch-product-hunt.mjs --dry-run    # print summary only
 *   node scripts/fetch-product-hunt.mjs --out=/tmp/ph.json
 *
 * 【一次資料】(2026-09-15, checked by fetching the live pages)
 *   - https://www.producthunt.com/feed?category=artificial-intelligence (50 entries):
 *     entry <published> equals the post's creation time, not the launch. The
 *     product pages show the launch at 00:01 Pacific: Voiskey created 2026-08-31,
 *     is.team created 2026-04-03 → both launched 2026-09-15; Resurf created 09-11
 *     → launched 09-13. Entries are grouped newest launch day first (feed rows
 *     1-18 = 09-15, 19-23 = 09-14, 24 = 09-13, 45 = 09-11), so a post that a fetch
 *     did not list yet cannot have launched before that fetch.
 *   - https://www.producthunt.com/robots.txt allows the feed; product pages are
 *     not read automatically (they were only opened by hand for this check).
 *
 * 【一次資料】(2026-09-14)
 *   - API v2 docs https://api.producthunt.com/v2/docs — endpoint POST /v2/api/graphql,
 *     Bearer token, developer token does not expire, public scope; "The Product Hunt
 *     API must not be used for commercial purposes" without contacting hello@producthunt.com
 *   - Rate limits https://api.producthunt.com/v2/docs/rate_limits/headers
 *     (6250 complexity / 15 min; per-query complexity cap, producthunt-api issue #236)
 *   - posts() args / Post fields https://api-v2-docs.producthunt.com/query/posts/ ,
 *     /object/post/ (featured, order, postedAfter/postedBefore, dailyRank, thumbnail.url(width));
 *     schema.graphql in github.com/producthunt/producthunt-api (PostsOrder RANKING/VOTES/…)
 *   - Product Hunt days are midnight-to-midnight Pacific time
 *     https://help.producthunt.com/en/articles/2305333-getting-started
 *   - Atom feed https://www.producthunt.com/feed (50 entries, no votes/rank/images)
 */

import { writeFileSync, mkdirSync, realpathSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  PACIFIC_TZ,
  zonedMidnightUtc,
  pacificDayBounds,
  videoDateForSnapshot,
  freshSince,
  isFresh,
  isNewLaunch,
} from "./pacific-time.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

export const API_URL = "https://api.producthunt.com/v2/api/graphql";
export const FEED_URL = "https://www.producthunt.com/feed";
export const USER_AGENT =
  "sns-hub-figma-navi-video/1.0 (+https://github.com/nannantown/figma-navi-video)";
export const MAX_POSTS_PER_DAY = 30;
export const DEFAULT_OUT = join(rootDir, "data", "product-hunt-daily.json");

// Topic slugs that mark a launch as "AI" or "developer". Product Hunt is
// migrating its taxonomy (topics → categories), so name/tagline keywords back
// the slug match up.
export const AI_TOPIC_SLUGS = new Set([
  "artificial-intelligence",
  "ai",
  "ai-agents",
  "ai-tools",
  "ai-infrastructure-tools",
  "ai-coding-agents",
  "llms",
  "generative-ai",
  "machine-learning",
  "chatgpt",
  "computer-vision",
  "voice-ai",
  "ai-video",
  "ai-image",
]);
export const DEV_TOPIC_SLUGS = new Set([
  "developer-tools",
  "apis",
  "github",
  "open-source",
  "software-engineering",
  "no-code",
  "devops",
  "coding-agents",
]);
// Keyword fallback for posts without topics (the feed has none). Bare
// "agent(s)" (real-estate / user agents) and bare "code" (QR / promo code)
// produced false positives, so only unambiguous forms count.
const AI_KEYWORDS = /\bAI\b|\bA\.I\.|\bGPT|\bLLMs?\b|\bagentic\b|\bAI[- ]?agents?\b|\bcopilot\b|machine learning|\bgenerative\b|\bML\b|\bneural\b|\bchatbots?\b|\bRAG\b/i;
const DEV_KEYWORDS = /\bdevs?\b|\bdevelopers?\b|\bAPIs?\b|\bSDKs?\b|\bCLI\b|open[- ]source|\bcoding\b|\bsource code\b|\bcodebases?\b|\bcode review\b|\bterminal\b|\bIDE\b|\bGitHub\b|\bdevops\b/i;

export { PACIFIC_TZ, zonedMidnightUtc, pacificDayBounds, videoDateForSnapshot, freshSince, isFresh, isNewLaunch };

// ---------------------------------------------------------------------------
// GraphQL API
// ---------------------------------------------------------------------------

export const POSTS_QUERY = `
query DailyPosts($after: DateTime!, $before: DateTime!, $first: Int!, $cursor: String) {
  posts(featured: true, order: RANKING, postedAfter: $after, postedBefore: $before, first: $first, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        name
        tagline
        description
        slug
        url
        website
        votesCount
        commentsCount
        createdAt
        featuredAt
        dailyRank
        thumbnail { type url(width: 480) }
        topics(first: 5) { edges { node { name slug } } }
      }
    }
  }
}
`;

class ComplexityError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function getToken(env = process.env) {
  const token = (env.PRODUCT_HUNT_API_TOKEN || "").trim();
  return token ? token : null;
}

/**
 * Where the snapshot comes from. The official Atom feed unless PH_SOURCE=api is
 * set together with a token (owner decision 2026-09-15: the API is not used).
 * @returns {{ source: "feed" | "api", token: string | null, notice: string | null }}
 */
export function resolveSource(env = process.env) {
  const requested = String(env.PH_SOURCE ?? "").trim().toLowerCase() || "feed";
  const token = getToken(env);
  if (requested === "api") {
    return token
      ? { source: "api", token, notice: null }
      : { source: "feed", token: null, notice: "PH_SOURCE=api but PRODUCT_HUNT_API_TOKEN is not set — using the official Atom feed." };
  }
  const notices = [];
  if (requested !== "feed") notices.push(`Unknown PH_SOURCE ${JSON.stringify(requested)} — using the official Atom feed.`);
  if (token) {
    notices.push("PRODUCT_HUNT_API_TOKEN is set but not used: the official Atom feed is the default (owner decision 2026-09-15). PH_SOURCE=api opts in.");
  }
  return { source: "feed", token: null, notice: notices.length > 0 ? notices.join(" ") : null };
}

export async function graphqlRequest(token, query, variables, { fetchImpl = fetch, retries = 3, sleepImpl = sleep } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 401) {
        // Never log the token itself — only that it was rejected.
        throw new Error("Product Hunt API HTTP 401 (PRODUCT_HUNT_API_TOKEN rejected)");
      }
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        const reset = Number(res.headers.get("x-rate-limit-reset") || 0);
        lastErr = new Error(`Product Hunt API HTTP ${res.status}`);
        if (attempt < retries) {
          await sleepImpl(Math.min(Math.max(reset, 2) * 1000, 60000) * attempt);
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) throw new Error(`Product Hunt API HTTP ${res.status}`);
      const body = await res.json();
      if (body.errors?.length) {
        const msg = body.errors.map((e) => e.message || e.error || "unknown").join("; ");
        if (/complexity/i.test(msg)) throw new ComplexityError(msg);
        throw new Error(`Product Hunt GraphQL error: ${msg}`);
      }
      return body.data;
    } catch (err) {
      if (err instanceof ComplexityError) throw err;
      lastErr = err;
      const fatal = /GraphQL error|HTTP 401/.test(err.message || "");
      if (attempt < retries && !fatal) {
        await sleepImpl(2000 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export function classifyPost(post) {
  const slugs = (post.topics || []).map((t) => t.slug);
  const text = `${post.name} ${post.tagline || ""}`;
  const isAI = slugs.some((s) => AI_TOPIC_SLUGS.has(s)) || AI_KEYWORDS.test(text);
  const isDev = slugs.some((s) => DEV_TOPIC_SLUGS.has(s)) || DEV_KEYWORDS.test(text);
  return { isAI, isDev };
}

/** Product Hunt URL without tracking query/hash — the form the routine copies into ph_url. */
export function cleanPhUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return String(url).split(/[?#]/)[0].replace(/\/$/, "");
  }
}

export function normalizePost(node) {
  const topics = (node.topics?.edges || []).map((e) => ({
    name: e.node?.name || "",
    slug: e.node?.slug || "",
  }));
  const thumb = node.thumbnail || null;
  const phUrl = cleanPhUrl(node.url);
  const post = {
    id: String(node.id ?? ""),
    name: node.name || "",
    tagline: node.tagline || "",
    description: (node.description || "").slice(0, 400),
    slug: node.slug || phUrl.split("/").pop() || "",
    url: phUrl,
    phUrl,
    // Product Hunt redirect, not the official site — the routine looks the real URL up.
    website: node.website || "",
    votes: Number.isFinite(node.votesCount) ? node.votesCount : null,
    comments: Number.isFinite(node.commentsCount) ? node.commentsCount : null,
    createdAt: node.createdAt || null,
    featuredAt: node.featuredAt || null,
    // When the launch went public on Product Hunt (feature time; creation time as fallback).
    publishedAt: node.featuredAt || node.createdAt || null,
    dailyRank: Number.isFinite(node.dailyRank) ? node.dailyRank : null,
    thumbnail: thumb && thumb.url && thumb.type !== "video" ? thumb.url : null,
    topics,
  };
  return { ...post, ...classifyPost(post) };
}

/** Sort by Product Hunt's own daily rank, then votes, and number them 1..n. */
export function rankPosts(posts) {
  const sorted = [...posts].sort((a, b) => {
    const ra = a.dailyRank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.dailyRank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return (b.votes ?? -1) - (a.votes ?? -1);
  });
  return sorted.map((p, i) => ({ order: i + 1, ...p }));
}

export async function fetchDayViaApi(token, bounds, { fetchImpl = fetch, maxPosts = MAX_POSTS_PER_DAY, sleepImpl = sleep } = {}) {
  const nodes = [];
  let cursor = null;
  let pageSize = 10;
  while (nodes.length < maxPosts) {
    let data;
    try {
      data = await graphqlRequest(
        token,
        POSTS_QUERY,
        { after: bounds.postedAfter, before: bounds.postedBefore, first: Math.min(pageSize, maxPosts - nodes.length), cursor },
        { fetchImpl, sleepImpl }
      );
    } catch (err) {
      if (err instanceof ComplexityError && pageSize > 3) {
        pageSize = Math.max(3, Math.floor(pageSize / 2));
        console.warn(`  query too complex, retrying with first: ${pageSize}`);
        continue;
      }
      throw err;
    }
    const conn = data?.posts;
    if (!conn) throw new Error("Product Hunt API returned no posts connection");
    for (const edge of conn.edges || []) nodes.push(edge.node);
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    cursor = conn.pageInfo.endCursor;
  }
  return rankPosts(nodes.map(normalizePost));
}

// ---------------------------------------------------------------------------
// Atom feed fallback (no token)
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseAtomFeed(xml) {
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[1];
    const name = decodeEntities(textOf(e, "title"));
    const linkMatch = e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i) || e.match(/<link[^>]*href="([^"]+)"/i);
    const url = linkMatch ? decodeEntities(linkMatch[1]) : "";
    const content = decodeEntities(textOf(e, "content"));
    // content = <p>tagline</p><p><a>Discussion</a> | <a href="/r/p/ID">Link</a></p>
    const firstParagraph = content.match(/<p>([\s\S]*?)<\/p>/i);
    const tagline = stripTags(firstParagraph ? firstParagraph[1] : content);
    const redirect = content.match(/href="(https:\/\/www\.producthunt\.com\/r\/p\/[^"]+)"/i);
    const phUrl = cleanPhUrl(url);
    const post = {
      id: (textOf(e, "id").match(/Post\/(\d+)/) || [])[1] || textOf(e, "id"),
      name,
      tagline,
      description: "",
      slug: phUrl.split("/").filter(Boolean).pop() || "",
      url: phUrl,
      phUrl,
      // Product Hunt redirect (/r/p/<id>), not the official site.
      website: redirect ? redirect[1] : "",
      votes: null,
      comments: null,
      createdAt: textOf(e, "published") || null,
      featuredAt: null,
      // Atom <published> = when the post was created. Never after the launch,
      // so it cannot let an old launch through, but posts are often created
      // weeks ahead of their launch day — buildSnapshot adds listedAfter for those.
      publishedAt: textOf(e, "published") || null,
      dailyRank: null,
      thumbnail: null,
      topics: [],
    };
    entries.push({ ...post, ...classifyPost(post) });
  }
  return entries;
}

export async function fetchFeed({ fetchImpl = fetch, category = "" } = {}) {
  const url = category ? `${FEED_URL}?category=${encodeURIComponent(category)}` : FEED_URL;
  const res = await fetchImpl(url, {
    headers: { Accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.5", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Product Hunt feed HTTP ${res.status} (${url})`);
  return parseAtomFeed(await res.text());
}

/**
 * Whether `?category=artificial-intelligence` actually filtered the feed.
 * The parameter is undocumented: an ignored one returns the general feed.
 * @returns {"ok" | "ignored" | "unknown"}
 */
export function aiCategoryFilterStatus(aiEntries, allEntries) {
  if (aiEntries.length === 0 || allEntries.length === 0) return "unknown";
  const allIds = new Set(allEntries.map((e) => e.id));
  const same = aiEntries.length === allEntries.length && aiEntries.every((e) => allIds.has(e.id));
  return same ? "ignored" : "ok";
}

/**
 * AI category entries first, then the general feed, deduplicated by post id.
 * Category membership (inAiCategory) is only trusted when the category filter
 * demonstrably worked; otherwise isAI stays keyword-based and inAiCategory null.
 */
export function mergeFeedEntries(aiEntries, allEntries) {
  const filter = aiCategoryFilterStatus(aiEntries, allEntries);
  const trusted = filter === "ok";
  const seen = new Set();
  const merged = [];
  const tagged = aiEntries.map((e) => (trusted ? { ...e, inAiCategory: true, isAI: true } : { ...e, inAiCategory: null }));
  const rest = allEntries.map((e) => ({ ...e, inAiCategory: trusted ? false : null }));
  for (const p of [...tagged, ...rest]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
  }
  return merged.map((p, i) => ({ order: i + 1, ...p }));
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/** Mark every post with `fresh` for the video date and count what the routine may use. */
export function annotateFreshness(posts, videoDate) {
  const annotated = posts.map((p) => ({ ...p, fresh: isNewLaunch(p, videoDate) }));
  return {
    posts: annotated,
    freshCount: annotated.filter((p) => p.fresh).length,
    freshAiCount: annotated.filter((p) => p.fresh && (p.isAI || p.inAiCategory === true)).length,
  };
}

// How long a post stays in the listing registry after a fetch last listed it.
// The AI category feed covers about five launch days (checked 2026-09-15).
export const LISTING_RETENTION_DAYS = 10;

/** Registry key of a feed post. */
export function listingKey(post) {
  return String(post?.id || post?.phUrl || "");
}

/** The listing registry of the snapshot this run replaces, when it can be trusted. */
export function previousListing(previous, now) {
  const listing = previous?.listing;
  if (!previous || previous.source !== "feed" || !listing || typeof listing.posts !== "object" || listing.posts === null) return null;
  if (listing.lastCompleteAt != null) {
    const t = Date.parse(listing.lastCompleteAt);
    // A registry from the future (clock skew, hand-edited file) proves nothing.
    if (!Number.isFinite(t) || t > now.getTime()) return null;
  }
  return listing;
}

/**
 * Carry the feed listing registry to this fetch.
 *
 * The feed shows the launches of the last few days, newest launch day first,
 * and a post only appears there once it has launched. So when a complete fetch
 * at time T did not list a post, the post launched after T:
 *
 *   listedAfter = lastCompleteAt of the registry when the post first showed up
 *                 (null when there was no earlier complete fetch)
 *
 * A fetch is complete when both feeds answered and the AI category filter
 * worked. Partial fetches still add and refresh posts but never move
 * lastCompleteAt, so a feed that failed once cannot make everything it missed
 * look new on the next run. Posts not listed for LISTING_RETENTION_DAYS are dropped.
 *
 * @param {object | null} previous snapshot being replaced (data/product-hunt-daily.json)
 * @param {object[]} posts posts listed by this fetch
 * @param {{ now: Date, complete: boolean }} opts
 * @returns {{ lastCompleteAt: string | null, posts: Record<string, { listedAfter: string | null, lastSeenAt: string }> }}
 */
export function updateListing(previous, posts, { now, complete }) {
  const nowIso = now.toISOString();
  const prev = previousListing(previous, now);
  const keepSince = now.getTime() - LISTING_RETENTION_DAYS * 24 * 3600 * 1000;
  const registry = {};
  for (const [key, entry] of Object.entries(prev?.posts || {})) {
    const lastSeen = Date.parse(entry?.lastSeenAt ?? "");
    if (!key || !Number.isFinite(lastSeen) || lastSeen < keepSince) continue;
    const listedAfter = typeof entry.listedAfter === "string" && Number.isFinite(Date.parse(entry.listedAfter)) ? entry.listedAfter : null;
    registry[key] = { listedAfter, lastSeenAt: entry.lastSeenAt };
  }
  const bound = prev?.lastCompleteAt ?? null;
  for (const p of posts) {
    const key = listingKey(p);
    if (!key) continue;
    if (registry[key]) registry[key].lastSeenAt = nowIso;
    else registry[key] = { listedAfter: bound, lastSeenAt: nowIso };
  }
  return { lastCompleteAt: complete ? nowIso : bound, posts: registry };
}

/** The snapshot currently at `path`, or null (first run, unreadable file). */
export function readPreviousSnapshot(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const FEED_NOTE =
  "Official Atom feed (default since the owner decision of 2026-09-15; AI category first). Order is NOT a ranking — use only posts with fresh=true (new launch: publishedAt or listedAfter inside the window) and present them as an editorial pickup (2-5 tools, never 'TOP5').";

export async function buildSnapshot({ env = process.env, fetchImpl = fetch, now = new Date(), sleepImpl = sleep, previous = null } = {}) {
  const { source, token, notice } = resolveSource(env);
  if (notice) console.warn(`  ${notice}`);
  const forVideoDate = videoDateForSnapshot(now);
  const snapshot = {
    schemaVersion: 2,
    fetchedAt: now.toISOString(),
    forVideoDate,
    // "新作" = launched on Product Hunt at or after this instant (00:00 Pacific
    // on the day before the Pacific day in progress at 07:30 JST of forVideoDate).
    freshSince: freshSince(forVideoDate).toISOString(),
    source,
    mode: source === "api" ? "ranking" : "pickup",
    note:
      source === "api"
        ? "Official API (explicit opt-in). days[] = last closed Pacific day (final ranking) and the day in progress. Pick the TOP5 from the latest day with status=final, in dailyRank order, fresh posts only."
        : FEED_NOTE,
    days: [],
  };

  if (source === "api") {
    try {
      for (const offset of [-1, 0]) {
        const bounds = pacificDayBounds(offset, now);
        const fetched = await fetchDayViaApi(token, bounds, { fetchImpl, sleepImpl });
        const { posts, freshCount, freshAiCount } = annotateFreshness(fetched, forVideoDate);
        snapshot.days.push({ ...bounds, source: "api", freshCount, freshAiCount, posts });
        console.log(
          `  ${bounds.date} (${bounds.status}): ${posts.length} posts, AI=${posts.filter((p) => p.isAI).length}, dev=${posts.filter((p) => p.isDev).length}, fresh AI=${freshAiCount}`
        );
      }
      return snapshot;
    } catch (err) {
      // A bad day on the API must not leave the routine without candidates:
      // fall back to the public feed in pickup mode and say why.
      console.warn(`  Product Hunt API failed (${err.message}) — falling back to the public Atom feed.`);
      snapshot.source = "feed";
      snapshot.mode = "pickup";
      snapshot.apiError = err.message;
      snapshot.note = `API failed (${err.message}). ${FEED_NOTE}`;
      snapshot.days = [];
    }
  }

  // Either feed may fail on its own; only both failing is fatal.
  const bounds = pacificDayBounds(0, now);
  const aiEntries = await fetchFeed({ fetchImpl, category: "artificial-intelligence" }).catch((err) => {
    console.warn(`  AI category feed failed (non-blocking): ${err.message}`);
    return [];
  });
  const allEntries = await fetchFeed({ fetchImpl, category: "" }).catch((err) => {
    console.warn(`  general feed failed (non-blocking): ${err.message}`);
    return [];
  });
  if (aiEntries.length === 0 && allEntries.length === 0) {
    throw new Error("Both Product Hunt feeds failed or were empty.");
  }
  const aiCategoryFilter = aiCategoryFilterStatus(aiEntries, allEntries);
  const merged = mergeFeedEntries(aiEntries, allEntries);
  const complete = aiEntries.length > 0 && allEntries.length > 0 && aiCategoryFilter === "ok";
  const listing = updateListing(previous, merged, { now, complete });
  const listed = merged.map((p) => ({ ...p, listedAfter: listing.posts[listingKey(p)]?.listedAfter ?? null }));
  const { posts, freshCount, freshAiCount } = annotateFreshness(listed, forVideoDate);
  snapshot.listing = listing;
  snapshot.days.push({ ...bounds, status: "feed", source: "feed", aiCategoryFilter, freshCount, freshAiCount, posts });
  const byPublish = posts.filter((p) => (p.isAI || p.inAiCategory === true) && isFresh(p.publishedAt, forVideoDate)).length;
  console.log(
    `  feed: ${posts.length} entries, AI=${posts.filter((p) => p.isAI).length}, fresh=${freshCount}, fresh AI=${freshAiCount} (by publish time ${byPublish}), category filter: ${aiCategoryFilter}`
  );
  console.log(
    `  listing: ${previousListing(previous, now) ? "carried from the previous snapshot" : "started (no usable previous snapshot)"}, this fetch ${complete ? "complete" : "partial"}, last complete fetch ${listing.lastCompleteAt ?? "none"}, tracked posts ${Object.keys(listing.posts).length}`
  );
  return snapshot;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = outArg ? outArg.slice("--out=".length) : DEFAULT_OUT;

  console.log("=== Fetch Product Hunt launches ===");
  // The snapshot being replaced carries the feed listing registry forward.
  const previous = readPreviousSnapshot(outPath);
  const snapshot = await buildSnapshot({ previous });
  const total = snapshot.days.reduce((s, d) => s + d.posts.length, 0);
  if (total === 0) {
    throw new Error("Product Hunt returned zero posts from every source — not writing the snapshot.");
  }

  const day = snapshot.days[0];
  for (const p of day.posts.slice(0, 10)) {
    console.log(
      `  ${p.dailyRank ? `#${p.dailyRank}` : `(${p.order})`} ${p.name} — ${p.tagline}${p.votes != null ? ` (${p.votes} votes)` : ""}${p.isAI ? " [AI]" : ""}${p.isDev ? " [dev]" : ""}${p.fresh ? ` [fresh${isFresh(p.publishedAt, snapshot.forVideoDate) ? "" : ": listed after " + p.listedAfter}]` : ""}`
    );
  }
  console.log(`  fresh since ${snapshot.freshSince} (for video ${snapshot.forVideoDate})`);

  if (dryRun) {
    console.log("\n--dry-run: snapshot not written");
    return;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`\nSnapshot → ${outPath} (source: ${snapshot.source}, for video ${snapshot.forVideoDate})`);
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirectRun) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
