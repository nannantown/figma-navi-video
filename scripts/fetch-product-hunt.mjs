/**
 * Fetch Product Hunt launches into data/product-hunt-daily.json.
 *
 * Runs in GitHub Actions (fetch-product-hunt.yml) twice a day — 18:17 JST
 * (the evening before) and 03:47 JST (second chance) — so the Claude Routine
 * (07:30 JST) can pick new AI tools from a fixed snapshot instead of crawling
 * the site itself. GitHub's cron can start 1-3 h late (worst at the top of the
 * hour), which is why neither run is close to the routine or on :00/:30.
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
 * (updateListing) and posts that newly appear above every already-known post
 * get `listedAfter` — the last complete fetch that did not list them yet. The
 * previous snapshot (main's, passed with --previous in Actions) is read before
 * it is overwritten. `listingHealth` in the snapshot says whether that evidence
 * is working; problems are printed as Actions annotations and exported for the
 * workflow's health step.
 *
 * Usage:
 *   node scripts/fetch-product-hunt.mjs              # writes data/product-hunt-daily.json
 *   node scripts/fetch-product-hunt.mjs --dry-run    # print summary only
 *   node scripts/fetch-product-hunt.mjs --out=/tmp/ph.json
 *   node scripts/fetch-product-hunt.mjs --previous=/tmp/main-snapshot.json   # carry the registry from this file
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

const NAMED_ENTITIES = { lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", amp: "&" };

/** One pass of XML/HTML entity decoding (named + numeric); unknown entities are left alone. */
function decodeEntities(s) {
  return s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return m;
      return String.fromCodePoint(cp);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? m : named;
  });
}

/**
 * Product Hunt escapes the HTML of <content type="html">, so the words inside it
 * are escaped twice: the first pass turns `&lt;p&gt;` into real markup, and the
 * text it carries still holds `&amp;amp;` / `&amp;#8212;`. Decode that second
 * level only after the markup is gone, so a literal `<` in a tagline
 * ("Compress images <50KB") can never be eaten as a tag.
 */
function decodeTextContent(s) {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
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
  const re = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[1];
    const name = decodeTextContent(stripTags(decodeEntities(textOf(e, "title"))));
    const linkMatch = e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i) || e.match(/<link[^>]*href="([^"]+)"/i);
    const url = linkMatch ? decodeEntities(linkMatch[1]) : "";
    const content = decodeEntities(textOf(e, "content"));
    // content = <p>tagline</p><p><a>Discussion</a> | <a href="/r/p/ID">Link</a></p>
    const firstParagraph = content.match(/<p>([\s\S]*?)<\/p>/i);
    const tagline = decodeTextContent(stripTags(firstParagraph ? firstParagraph[1] : content));
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

// A single bad answer at the evening run would otherwise leave the next morning thin.
export const FEED_ATTEMPTS = 3;
export const FEED_RETRY_DELAYS_MS = [5000, 20000];

/**
 * One feed, retried on network errors, timeouts, 429, 5xx and empty/unparseable
 * bodies (challenge pages). Other 4xx answers fail at once.
 */
export async function fetchFeed({ fetchImpl = fetch, category = "", sleepImpl = sleep, attempts = FEED_ATTEMPTS } = {}) {
  const url = category ? `${FEED_URL}?category=${encodeURIComponent(category)}` : FEED_URL;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryable = true;
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.5", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        retryable = res.status === 403 || res.status === 408 || res.status === 429 || res.status >= 500;
        throw new Error(`Product Hunt feed HTTP ${res.status} (${url})`);
      }
      const entries = parseAtomFeed(await res.text());
      if (entries.length === 0) throw new Error(`Product Hunt feed had no entries (${url})`);
      return entries;
    } catch (err) {
      lastError = err;
      if (!retryable || attempt === attempts) break;
      console.warn(`  feed attempt ${attempt}/${attempts} failed (${err.message}) — retrying`);
      await sleepImpl(FEED_RETRY_DELAYS_MS[attempt - 1] ?? FEED_RETRY_DELAYS_MS.at(-1));
    }
  }
  throw lastError;
}

// A complete feed page has ~50 entries (checked 2026-09-15).
export const MIN_FEED_ENTRIES = 20;
// The AI category feed reaches ~5 launch days back and the general feed ~1.5,
// so a working filter returns many entries the general feed does not have
// (26 of 50 on 2026-09-15). Two cached copies of the general feed differ by a
// post or two at most.
export const MIN_AI_ONLY_ENTRIES = 10;

/**
 * Whether `?category=artificial-intelligence` actually filtered the feed.
 * The parameter is undocumented: an ignored one returns the general feed.
 * @returns {"ok" | "ignored" | "unknown"}
 */
export function aiCategoryFilterStatus(aiEntries, allEntries) {
  if (aiEntries.length === 0 || allEntries.length === 0) return "unknown";
  const allIds = new Set(allEntries.map((e) => e.id));
  const aiOnly = aiEntries.filter((e) => !allIds.has(e.id)).length;
  if (aiOnly === 0) return "ignored";
  return aiOnly >= MIN_AI_ONLY_ENTRIES ? "ok" : "unknown";
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
 * The feed shows the launches of the last few days, newest launch day first
 * (order inside a day reshuffles within minutes), and a post only appears there
 * once it has launched. A launch that happened after the last complete fetch
 * (time T) therefore enters at the top: above every post the registry already
 * knows. Such a post gets
 *
 *   listedAfter = T (the registry's lastCompleteAt when the post first showed up)
 *
 * A post that is new to the registry but sits below a known post in any feed
 * it appears in is not dated: it is from an older launch day that the registry
 * never saw (the registry just started, the post was below the 50-entry cap,
 * a post above it was removed, or it joined the AI category late). Neither is
 * a post in a feed where no post is known at all (a reset registry or a changed
 * id format) — otherwise every listed post would look new at once.
 *
 * A fetch is complete when both feeds answered with a full page and the AI
 * category filter demonstrably worked. Partial fetches still add and refresh
 * posts but never move lastCompleteAt, so a feed that failed once cannot make
 * everything it missed look new on the next run. Posts not listed for
 * LISTING_RETENTION_DAYS are dropped.
 *
 * @param {object | null} previous snapshot being replaced (data/product-hunt-daily.json)
 * @param {object[]} posts posts listed by this fetch
 * @param {{ now: Date, complete: boolean, feeds?: string[][] }} opts
 *   feeds = registry keys of each feed in feed order (AI category, general)
 * @returns {{ lastCompleteAt: string | null, posts: Record<string, { listedAfter: string | null, lastSeenAt: string }>, stats: { known: number, added: number, dated: number, belowKnown: number, noKnownInFeed: number, feedsWithoutKnown: number } }}
 */
export function updateListing(previous, posts, { now, complete, feeds = [] }) {
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
  const knownKeys = new Set(Object.keys(registry));
  const feedViews = feeds
    .filter((keys) => Array.isArray(keys) && keys.length > 0)
    .map((keys) => {
      const firstKnown = keys.findIndex((k) => knownKeys.has(k));
      return { listed: new Set(keys), hasKnown: firstKnown >= 0, aboveKnown: new Set(firstKnown >= 0 ? keys.slice(0, firstKnown) : []) };
    });
  const stats = {
    known: 0,
    added: 0,
    dated: 0,
    belowKnown: 0,
    noKnownInFeed: 0,
    feedsWithoutKnown: knownKeys.size > 0 ? feedViews.filter((f) => !f.hasKnown).length : 0,
    // Entries carried over from the previous snapshot that survived retention.
    // 0 while a registry that used to hold posts means nothing can be dated.
    registrySize: knownKeys.size,
  };
  for (const p of posts) {
    const key = listingKey(p);
    if (!key) continue;
    if (registry[key]) {
      registry[key].lastSeenAt = nowIso;
      stats.known++;
      continue;
    }
    stats.added++;
    let listedAfter = null;
    if (bound !== null) {
      const views = feedViews.filter((f) => f.listed.has(key));
      if (views.length > 0 && views.every((f) => f.aboveKnown.has(key))) {
        listedAfter = bound;
        stats.dated++;
      } else if (views.some((f) => !f.hasKnown)) {
        stats.noKnownInFeed++;
      } else {
        stats.belowKnown++;
      }
    }
    registry[key] = { listedAfter, lastSeenAt: nowIso };
  }
  return { lastCompleteAt: complete ? nowIso : bound, posts: registry, stats };
}

// No complete fetch for this long = the listing evidence has stopped working.
export const LISTING_STALE_HOURS = 30;
// One launch day brings ~15-20 AI launches; far more dated at once is suspicious.
export const LISTING_DATED_WARN = 40;

/**
 * Whether the listing evidence works, for the snapshot, the routine and the
 * workflow. `alerts` fail the workflow's health step (after the snapshot is
 * committed); `warnings` only annotate the run.
 */
export function listingHealth({ previous, listing, complete, now, aiCategoryFilter, feedSizes }) {
  const carried = previousListing(previous, now) !== null;
  const hours = listing.lastCompleteAt ? Math.round(((now.getTime() - Date.parse(listing.lastCompleteAt)) / 3600000) * 10) / 10 : null;
  const alerts = [];
  const warnings = [];
  if (previous && !carried) {
    alerts.push("the previous snapshot's listing registry could not be used, so it was restarted — launches cannot be dated by listing until two complete fetches have run");
  }
  if (!complete) {
    const why = `AI category feed ${feedSizes.ai} entries, general feed ${feedSizes.all} entries, category filter ${aiCategoryFilter}`;
    if (listing.lastCompleteAt === null && previous) alerts.push(`no complete fetch has been recorded yet (${why})`);
    else if (hours !== null && hours >= LISTING_STALE_HOURS) alerts.push(`no complete fetch for ${hours} h — the listing baseline is frozen and new launches cannot be dated (${why})`);
    else warnings.push(`this fetch was partial (${why}); the baseline did not move`);
  }
  if (carried && listing.stats.registrySize === 0) {
    alerts.push(
      "the carried listing registry is empty (every entry aged out, so the fetch has been down for days) — nothing can be dated by listing until two complete fetches have run",
    );
  }
  if (!previous) {
    warnings.push("no previous snapshot was given — the registry starts empty, so this fetch cannot date any launch by listing");
  }
  if (listing.stats.feedsWithoutKnown > 0) {
    alerts.push(
      `${listing.stats.feedsWithoutKnown} feed(s) had no post the registry knows — their new posts were not dated (the feed rolled past the whole registry during a gap, or the id format changed)`,
    );
  }
  if (listing.stats.dated > LISTING_DATED_WARN) {
    warnings.push(`${listing.stats.dated} posts were dated by listing at once — check the feed`);
  }
  return {
    registry: carried ? "carried" : previous ? "restarted" : "started",
    thisFetch: complete ? "complete" : "partial",
    lastCompleteAt: listing.lastCompleteAt,
    hoursSinceComplete: hours,
    ...listing.stats,
    alerts,
    warnings,
  };
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
  const aiEntries = await fetchFeed({ fetchImpl, category: "artificial-intelligence", sleepImpl }).catch((err) => {
    console.warn(`  AI category feed failed (non-blocking): ${err.message}`);
    return [];
  });
  const allEntries = await fetchFeed({ fetchImpl, category: "", sleepImpl }).catch((err) => {
    console.warn(`  general feed failed (non-blocking): ${err.message}`);
    return [];
  });
  if (aiEntries.length === 0 && allEntries.length === 0) {
    throw new Error("Both Product Hunt feeds failed or were empty.");
  }
  const aiCategoryFilter = aiCategoryFilterStatus(aiEntries, allEntries);
  const merged = mergeFeedEntries(aiEntries, allEntries);
  const complete = aiEntries.length >= MIN_FEED_ENTRIES && allEntries.length >= MIN_FEED_ENTRIES && aiCategoryFilter === "ok";
  const { stats, ...listing } = updateListing(previous, merged, {
    now,
    complete,
    feeds: [aiEntries.map(listingKey), allEntries.map(listingKey)],
  });
  const listed = merged.map((p) => ({ ...p, listedAfter: listing.posts[listingKey(p)]?.listedAfter ?? null }));
  const { posts, freshCount, freshAiCount } = annotateFreshness(listed, forVideoDate);
  snapshot.listing = listing;
  snapshot.listingHealth = listingHealth({
    previous,
    listing: { ...listing, stats },
    complete,
    now,
    aiCategoryFilter,
    feedSizes: { ai: aiEntries.length, all: allEntries.length },
  });
  snapshot.days.push({ ...bounds, status: "feed", source: "feed", aiCategoryFilter, freshCount, freshAiCount, posts });
  const byPublish = posts.filter((p) => (p.isAI || p.inAiCategory === true) && isFresh(p.publishedAt, forVideoDate)).length;
  console.log(
    `  feed: ${posts.length} entries, AI=${posts.filter((p) => p.isAI).length}, fresh=${freshCount}, fresh AI=${freshAiCount} (by publish time ${byPublish}), category filter: ${aiCategoryFilter}`
  );
  const health = snapshot.listingHealth;
  console.log(
    `  listing: registry ${health.registry}, this fetch ${health.thisFetch}, last complete fetch ${health.lastCompleteAt ?? "none"}, tracked posts ${Object.keys(listing.posts).length}; new posts ${health.added} (dated ${health.dated}, below a known post ${health.belowKnown}, feed without known posts ${health.noKnownInFeed})`
  );
  return snapshot;
}

/**
 * Annotations for the run and outputs for the workflow's health step. Only
 * our own counts and times go into them — never feed text.
 */
export function reportListingHealth(health, env = process.env, { write = writeFileSync, log = console.log } = {}) {
  if (!health) return;
  const inActions = env.GITHUB_ACTIONS === "true";
  for (const w of health.warnings || []) log(inActions ? `::warning title=Product Hunt listing::${w}` : `  WARN ${w}`);
  for (const a of health.alerts || []) log(inActions ? `::error title=Product Hunt listing::${a}` : `  ALERT ${a}`);
  if (env.GITHUB_OUTPUT) {
    const alert = (health.alerts || []).join(" / ").replace(/[\r\n]+/g, " ");
    write(env.GITHUB_OUTPUT, `listing_alert=${alert}\n`, { flag: "a" });
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = outArg ? outArg.slice("--out=".length) : DEFAULT_OUT;
  const previousArg = process.argv.find((a) => a.startsWith("--previous="));

  console.log("=== Fetch Product Hunt launches ===");
  // The snapshot being replaced carries the feed listing registry forward. In
  // Actions it is main's latest one (--previous), not the possibly stale checkout.
  const previousPath = previousArg ? previousArg.slice("--previous=".length) : outPath;
  const previous = readPreviousSnapshot(previousPath);
  console.log(`  previous snapshot: ${previous ? `${previousPath} (fetched ${previous.fetchedAt ?? "?"})` : `none at ${previousPath}`}`);
  const snapshot = await buildSnapshot({ previous });
  reportListingHealth(snapshot.listingHealth);
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
