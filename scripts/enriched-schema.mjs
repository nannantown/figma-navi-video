/**
 * Schema + validation for data/enriched-ai-tools.json (written by the Claude
 * Routine every morning). Shared by generate-data.mjs (pipeline),
 * validate-enriched.mjs (routine self-check) and the unit tests, so the
 * routine and the pipeline can never disagree about what "valid" means.
 *
 * The routine's PR is merged without a human looking at it, and its text
 * lands verbatim in YouTube titles/descriptions and Instagram captions, so
 * every displayed text field is checked for links, mentions, hashtags,
 * line breaks, control and invisible characters.
 *
 * Human-readable spec: docs/enrichment-schema.md
 */

import { isNewLaunch, freshSince, expectedRankingDate, routineAnchor } from "./pacific-time.mjs";

export const GENRE = "ai-tools-top5";
export const TRIAL = 1;

// ranking = Product Hunt API final ranking → always exactly 5 ("TOP5").
// pickup  = editorial pick from the public feed, fresh launches only → 2-5.
//           Fewer than 2 fresh AI launches → the routine does not publish that day.
export const RANKING_TOOL_COUNT = 5;
export const PICKUP_MIN_TOOLS = 2;
export const PICKUP_MAX_TOOLS = 5;

// Character windows. `hard` → error (pipeline refuses), `soft` → warning.
// Narration budget keeps the video under 60 s (Instagram Reels limit) at the
// TTS rate used by generate-audio.mjs (+30%).
export const LIMITS = {
  name: { hard: [1, 40] },
  description: { hard: [6, 30], soft: [10, 24] },
  who: { hard: [2, 18], soft: [3, 14] },
  pricing_note: { hard: [0, 18] },
  narration: { hard: [30, 65], soft: [40, 58] },
  opening_narration: { hard: [0, 30] },
  // Keeps the YouTube description (5000 bytes) far from its limit with 5 tools.
  website: { hard: [0, 200] },
  ph_url: { hard: [0, 120] },
  totalNarration: { hard: 300 },
};

export const PRICING_LABELS = {
  free: "無料",
  freemium: "無料プランあり",
  trial: "無料トライアルあり",
  paid: "有料",
  unknown: "料金は公式サイトで確認",
};

export const SOURCE_MODES = ["ranking", "pickup"];

// Why a fresh AI launch in the snapshot was left out on a skip day
// (docs/routine-prompt.md step 4). "not-ai" is only for keyword matches
// outside the AI category.
export const SKIP_EXCLUSION_REASONS = ["recent", "ng", "no-site", "invite-only", "not-ai"];

// Tools featured within this many days are not featured again.
export const REPEAT_WINDOW_DAYS = 30;

export const DISCOVERY_METHODS = [
  "rank-pure",
  "non-engineer",
  "free-first",
  "job-theme",
  "creator-theme",
  "dev-theme",
];

export const DEFAULT_ENDING_NARRATION = "気になるツールは保存して、あとで試してみてください。";

export function defaultOpeningNarration(mode, count) {
  return mode === "ranking" ? "新作AIツール、トップ5を紹介します。" : `新作AIツールを${count}つ紹介します。`;
}

const PH_URL_RE = /^https:\/\/www\.producthunt\.com\/(products|posts)\/[a-z0-9][a-z0-9-]*\/?$/i;

// --- Text safety (all written as Unicode escapes on purpose) ---------------
// Pattern checks run on the NFKC-normalised value, so full-width and
// half-width look-alikes (full-width www/dots/colons/slashes, full-width TOP5,
// half-width katakana) are caught; control/invisible checks also run on the raw value.
// C0/C1 control characters, including line breaks and tabs.
export const CONTROL_CHARS_RE = /[\u{0}-\u{1F}\u{7F}-\u{9F}]/u;
// Invisible characters: every format character (Cf — ZWSP/ZWJ, bidi controls,
// BOM, tag characters, interlinear annotations …), every default-ignorable code
// point (variation selectors incl. the supplement, Hangul fillers, CGJ …) and
// the line / paragraph separators.
export const INVISIBLE_CHARS_RE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\u{2028}\u{2029}]/u;
const URL_RE = /[a-z][a-z0-9+.\-]*:\/\/|\bwww\./iu;
// NFKC leaves the ideographic full stop (and maps its half-width form to it);
// treat both as dots for the domain checks.
const IDEOGRAPHIC_DOTS_G = /[\u{3002}\u{FF61}]/gu;
// Host-like "label.label" (ASCII) whose last label starts with a letter:
// evil.shop, x.ai, Node.js. Versions and decimals (v2.10, 1.5GB) stay allowed.
const DOMAIN_SOURCE = "[a-z0-9](?:[a-z0-9\\-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9\\-]*[a-z0-9])?)*\\.[a-z][a-z0-9\\-]*[a-z0-9]";
const DOMAIN_RE = new RegExp(DOMAIN_SOURCE, "iu");
const DOMAIN_G = new RegExp(DOMAIN_SOURCE, "giu");
// Non-ASCII labels on common TLDs (e.g. a Japanese label + ".com"); lowercase TLD only so ".NET" stays allowed.
const INTL_DOMAIN_RE = /[\p{L}\p{N}][\p{L}\p{N}\-]*\.(?:com|net|org|jp|io|ai|app|dev|co|shop|store|site|online|xyz|info|biz|me|tv|ly)(?![\p{L}\p{N}])/u;
// Disguised dots: evil[.]com, evil(dot)com, evil dot com (any case) and
// evil . com / evil .com (lowercase TLD only, so "Unity .NET" stays legal).
const COMMON_TLDS = "(?:com|net|org|jp|io|ai|app|dev|co|shop|store|site|online|xyz|info|biz|me|tv|ly)";
const DEFANGED_BRACKET_RE = /[\[\(\{]\s*(?:\.|dot)\s*[\]\)\}]/iu;
const DEFANGED_WORD_RE = new RegExp(`[a-z0-9\\-]+\\s+dot\\s+${COMMON_TLDS}\\b`, "iu");
const DEFANGED_SPACED_RE = new RegExp(`[A-Za-z0-9\\-]+(?:\\s+\\.\\s*|\\s*\\.\\s+)${COMMON_TLDS}\\b`, "u");
const isDefanged = (s) => DEFANGED_BRACKET_RE.test(s) || DEFANGED_WORD_RE.test(s) || DEFANGED_SPACED_RE.test(s);
const IPV4_RE = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/u;
const MENTION_RE = /@[a-z0-9_]/iu;
const HASHTAG_RE = /#[^\s#]/u;
// Dotted product names that are not links (Node.js, ML.NET).
const TECH_SUFFIX_RE = /\.(?:js|ts|jsx|tsx|mjs|cjs|py|rb|rs|sh|md|NET)$/u;
// The subset that is never a real top-level domain, allowed in every text
// field ("Next.jsのアプリ", "ASP.NET開発者"). .py/.rs/.sh/.md are country TLDs,
// so outside names they still count as domains.
const SAFE_TECH_SUFFIX_RE = /\.(?:js|ts|jsx|tsx|mjs|cjs|NET)$/u;
// Ranking vocabulary that must not appear when the order is an editorial pick
// (checked after NFKC). Katakana/Latin left boundaries keep デスクトップ3台 and
// Laptop 4 GB legal; 位置 and 三位一体 are not ranks; "No 2FA" is not "No.2".
const RANK_SEP = "[\\s\\-_:\\u{30FB}\\u{2013}\\u{2014}]*";
const KANJI_DIGIT = "[\\u{4E00}\\u{4E8C}\\u{4E09}\\u{56DB}\\u{4E94}\\u{516D}\\u{4E03}\\u{516B}\\u{4E5D}\\u{5341}]";
const RANKING_WORDS_RE = new RegExp(
  [
    `(?<![a-z])TOP${RANK_SEP}\\d`,
    `(?<![\\u{30A0}-\\u{30FF}])\\u{30C8}\\u{30C3}\\u{30D7}${RANK_SEP}(?:\\d|${KANJI_DIGIT})`,
    "\\u{30E9}\\u{30F3}\\u{30AD}\\u{30F3}\\u{30B0}",
    "\\bRANKING\\b",
    "\\bRANK\\s*#?\\d",
    "\\d+\\s*\\u{4F4D}(?!\\u{7F6E})",
    `(?:${KANJI_DIGIT}|\\u{767E})+\\s*\\u{4F4D}(?!\\u{7F6E}|\\u{4E00}\\u{4F53})`,
    "\\u{9996}\\u{4F4D}(?!\\u{7F6E})",
    `\\u{4E0A}\\u{4F4D}\\s*(?:\\d|${KANJI_DIGIT})`,
    `\\u{30D9}\\u{30B9}\\u{30C8}${RANK_SEP}(?:\\d|${KANJI_DIGIT})`,
    `\\bBEST${RANK_SEP}\\d`,
    "\\u{30CA}\\u{30F3}\\u{30D0}\\u{30FC}\\s*(?:\\u{30EF}\\u{30F3}|\\d)",
    "\\bNo\\.\\s*\\d",
    "\\bNo\\d",
  ].join("|"),
  "iu"
);

// Vote, award and popularity claims about Product Hunt (checked after NFKC).
// The feed carries none of these facts and the owner decision of 2026-09-15
// forbids presenting them: 500票 / 1,200 upvotes / 票数 / 得票 / 投票数 /
// Product of the Day / Golden Kitty / ランクイン / トップに輝く・トップを獲得 /
// 一番人気 / top-rated / most upvoted / Product Hunt(プロダクトハント)で話題・人気・
// 注目・高評価・絶賛・受賞・首位・トップ・急上昇・票.
const PH_CLAIM_RE = new RegExp(
  [
    "\\d[\\d,]*\\s*(?:\\u{7968}|upvotes?\\b|votes?\\b)",
    "\\u{7968}\\u{6570}|\\u{5F97}\\u{7968}|\\u{6295}\\u{7968}\\u{6570}",
    "\\bProduct\\s*of\\s*the\\s*(?:Day|Week|Month|Year)\\b",
    "\\bGolden\\s*Kitt(?:y|ies)\\b",
    "\\u{30E9}\\u{30F3}\\u{30AF}\\u{30A4}\\u{30F3}",
    "\\u{30C8}\\u{30C3}\\u{30D7}\\s*[\\u{306B}\\u{3092}]\\s*(?:\\u{8F1D}|\\u{7ACB}|\\u{7372}|\\u{53D6}|\\u{98FE}|\\u{9078}|\\u{306A})",
    "(?:\\u{4E00}\\u{756A}|\\u{3044}\\u{3061}\\u{3070}\\u{3093})\\s*\\u{4EBA}\\u{6C17}",
    "\\btop[\\s\\-]*(?:rated|ranked|voted)\\b",
    "\\bmost[\\s\\-]*(?:up)?voted\\b",
    "(?:Product\\s*Hunt|\\u{30D7}\\u{30ED}\\u{30C0}\\u{30AF}\\u{30C8}\\s*\\u{30CF}\\u{30F3}\\u{30C8})[^\\u{3002}.!?\\u{FF01}\\u{FF1F}]{0,8}?(?:\\u{8A71}\\u{984C}|\\u{4EBA}\\u{6C17}|\\u{6CE8}\\u{76EE}|\\u{9AD8}\\u{8A55}\\u{4FA1}|\\u{7D76}\\u{8CDB}|\\u{53D7}\\u{8CDE}|\\u{9996}\\u{4F4D}|\\u{30C8}\\u{30C3}\\u{30D7}|\\u{6025}\\u{4E0A}\\u{6607}|\\u{7968})",
  ].join("|"),
  "iu"
);

// Calls to act on the post (「AI」とコメントして / 『資料』とDMください) and
// instruction-like text copied from a page (前の指示を無視して / ignore previous
// instructions). A closing quote is required before と/って so ordinary
// descriptions (SlackとTeamsのメッセージを要約) stay legal.
const SOLICIT_RE = new RegExp(
  [
    "[\\u{300D}\\u{300F}\"'\\u{201D}]\\s*(?:\\u{3068}|\\u{3063}\\u{3066})\\s*(?:DM|\\u{30B3}\\u{30E1}\\u{30F3}\\u{30C8}|\\u{8FD4}\\u{4FE1}|\\u{30E1}\\u{30C3}\\u{30BB}\\u{30FC}\\u{30B8}|\\u{9001})",
    "(?:\\u{524D}|\\u{4E0A}\\u{8A18}|\\u{3053}\\u{308C}\\u{307E}\\u{3067}|\\u{4EE5}\\u{524D})\\u{306E}(?:\\u{6307}\\u{793A}|\\u{547D}\\u{4EE4}|\\u{30D7}\\u{30ED}\\u{30F3}\\u{30D7}\\u{30C8})\\u{3092}?\\s*(?:\\u{7121}\\u{8996}|\\u{5FD8}\\u{308C})",
    "\\bignore\\s+(?:all\\s+|any\\s+|the\\s+)?(?:previous|prior|above|earlier)\\s+(?:instructions?|prompts?|messages?)\\b",
  ].join("|"),
  "iu"
);

// Hosts that are never a tool's official site: link shorteners, chat invites
// and forms. Link-in-bio services are refused only for profile paths, so their
// own launches (https://linktr.ee/) stay possible.
const BLOCKED_WEBSITE_HOSTS = new Set([
  "bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "buff.ly", "is.gd", "rebrand.ly", "cutt.ly", "lnkd.in",
  "shorturl.at", "rb.gy", "t.ly", "tiny.cc", "s.id", "dub.sh",
  "discord.gg", "t.me", "telegram.me", "wa.me", "chat.whatsapp.com", "lin.ee",
  "forms.gle", "docs.google.com", "forms.office.com",
]);
const PROFILE_WEBSITE_HOSTS = new Set(["linktr.ee", "lit.link", "beacons.ai", "bio.link", "discord.com", "line.me"]);

// Counts in the opening line ("5つ", "3選", "三つ") must match the video.
const OPENING_COUNT_RE = /(\d+)\s*(?:\u{3064}|\u{9078}|\u{672C}|\u{500B}|\u{30C4}\u{30FC}\u{30EB})/gu;
const OPENING_KANJI_COUNT_RE = /([\u{4E00}\u{4E8C}\u{4E09}\u{56DB}\u{4E94}\u{516D}\u{4E03}\u{516B}\u{4E5D}\u{5341}])\s*(?:\u{3064}|\u{9078}|\u{672C}|\u{500B})/gu;
const KANJI_NUMBERS = { "\u{4E00}": 1, "\u{4E8C}": 2, "\u{4E09}": 3, "\u{56DB}": 4, "\u{4E94}": 5, "\u{516D}": 6, "\u{4E03}": 7, "\u{516B}": 8, "\u{4E5D}": 9, "\u{5341}": 10 };
// 「向け」 is added on screen and in captions.
const WHO_SUFFIX_RE = /\u{5411}\u{3051}$/u;

// Example values in docs/routine-prompt.md; copying them verbatim is a mistake.
const TEMPLATE_PLACEHOLDERS = {
  name: "ツール名（原文）",
  description: "一言",
  who: "誰向け",
  pricing_note: "任意",
  narration: "フック文。要点文。",
  tagline_en: "Product Hunt のタグライン（原文）",
};

export function normalizeForChecks(value) {
  return String(value ?? "").normalize("NFKC");
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Dotted tokens in a product name that are neither tech names nor the official host. */
function foreignDomains(dotted, allowedHost) {
  return (dotted.match(DOMAIN_G) || []).filter((token) => {
    if (TECH_SUFFIX_RE.test(token)) return false;
    if (!allowedHost) return false;
    const t = token.toLowerCase();
    return !(allowedHost === t || allowedHost.endsWith(`.${t}`) || t.endsWith(`.${allowedHost}`));
  });
}

/**
 * Problems with a displayed text value (links, domains, IPs, mentions, hashtags,
 * control/invisible chars). `allowDomains` is for tool names: dotted product
 * names are allowed when they are tech names (Node.js) or match `allowedHost`
 * (the official site's host, e.g. X.ai for https://x.ai).
 */
export function textSafetyProblems(value, { allowDomains = false, allowedHost = null } = {}) {
  if (typeof value !== "string") return [];
  const norm = normalizeForChecks(value);
  const dotted = norm.replace(IDEOGRAPHIC_DOTS_G, ".");
  const problems = [];
  if (CONTROL_CHARS_RE.test(value) || CONTROL_CHARS_RE.test(norm)) problems.push("contains a line break or control character");
  if (INVISIBLE_CHARS_RE.test(value) || INVISIBLE_CHARS_RE.test(norm)) problems.push("contains an invisible (zero-width / bidi / tag) character");
  if (URL_RE.test(dotted)) problems.push("contains a URL");
  else if (isDefanged(dotted)) problems.push("contains a defanged domain");
  else if (IPV4_RE.test(dotted)) problems.push("contains an IP address");
  else if (allowDomains) {
    const foreign = foreignDomains(dotted, allowedHost);
    if (foreign.length > 0) problems.push(`contains a domain that is not the official site (${foreign.join(", ")})`);
  } else if ((dotted.match(DOMAIN_G) || []).some((token) => !SAFE_TECH_SUFFIX_RE.test(token)) || INTL_DOMAIN_RE.test(dotted)) {
    problems.push("contains a domain name (put URLs in website only)");
  }
  if (MENTION_RE.test(norm)) problems.push("contains an @mention");
  if (HASHTAG_RE.test(norm)) problems.push("contains a #hashtag");
  // Product names are copied as they are; every other field is our own text.
  if (!allowDomains && SOLICIT_RE.test(norm)) problems.push("contains a call to comment/DM or an instruction-like phrase");
  return problems;
}

/** Ranking vocabulary (TOP5, トップ5, ランキング, N位, 上位N, ベストN, No.N …) after NFKC normalisation. */
export function hasRankingWords(value) {
  return typeof value === "string" && RANKING_WORDS_RE.test(normalizeForChecks(value));
}

/** Product Hunt vote / award / popularity claims (500票, Product of the Day, トップに輝く, 一番人気, Product Huntで話題 …). */
export function hasProductHuntClaims(value) {
  return typeof value === "string" && PH_CLAIM_RE.test(normalizeForChecks(value));
}

/** Words a pickup video must not use: ranking vocabulary or Product Hunt vote/award/popularity claims. */
export function hasPickupForbiddenWords(value) {
  return hasRankingWords(value) || hasProductHuntClaims(value);
}

/**
 * Problems with a tool's official website beyond "https without credentials":
 * ports, queries/fragments (?ref=producthunt), IP or punycode hosts, link
 * shorteners, chat invites, forms and link-in-bio profile pages.
 */
export function officialWebsiteProblems(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^www\./, "");
  const problems = [];
  if (u.port) problems.push("has a port");
  if (u.search || u.hash || url.includes("?") || url.includes("#")) problems.push("has a query or fragment (remove ?ref=… and #…)");
  if (host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) problems.push("is an IP address, not a site name");
  if (host.split(".").some((label) => label.startsWith("xn--"))) problems.push("uses a punycode (xn--) host");
  if (BLOCKED_WEBSITE_HOSTS.has(bare)) problems.push(`is a link shortener, chat invite or form (${bare}), not an official site`);
  else if (PROFILE_WEBSITE_HOSTS.has(bare) && u.pathname !== "/") problems.push(`is a profile or invite page on ${bare}, not an official site`);
  return problems;
}

/** Numbers of tools announced in an opening line ("5つ", "3選", "三つ") that differ from `count`. */
export function openingCountMismatches(value, count) {
  if (typeof value !== "string") return [];
  const norm = normalizeForChecks(value);
  const found = [
    ...[...norm.matchAll(OPENING_COUNT_RE)].map((m) => Number(m[1])),
    ...[...norm.matchAll(OPENING_KANJI_COUNT_RE)].map((m) => KANJI_NUMBERS[m[1]]),
  ];
  return found.filter((n) => n !== count);
}

const NAME_STOP_TOKENS = new Set(["ai", "the", "by", "for", "and", "of", "to", "app", "io", "an", "a", "with", "your", "on", "in"]);

function nameTokens(name) {
  return normalizeForChecks(name)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !NAME_STOP_TOKENS.has(t) && (t.length >= 2 || /\p{N}/u.test(t)));
}

/**
 * Whether the name in the data is the Product Hunt post's name: one shared
 * significant word is enough ("Cognition SWE-2" for "Cognition's SWE-2",
 * "GhostWriter" for "GhostWriter by MyHandler"); names made only of stop
 * words or single letters (X.ai) are compared as squashed strings.
 */
export function namesMatch(dataName, snapshotName) {
  const a = nameTokens(dataName);
  const b = new Set(nameTokens(snapshotName));
  if (a.length > 0 && b.size > 0) return a.some((t) => b.has(t));
  const squash = (s) => normalizeForChecks(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const x = squash(dataName);
  const y = squash(snapshotName);
  return x !== "" && y !== "" && (x.includes(y) || y.includes(x));
}

/**
 * Tools featured in history entries in the REPEAT_WINDOW_DAYS before `date`
 * (the same date is ignored so a re-run of today's pipeline is not a repeat).
 * @returns {Map<string, string>} cleaned Product Hunt URL → date featured
 */
export function recentlyFeatured(history, date, days = REPEAT_WINDOW_DAYS) {
  const featured = new Map();
  const videos = Array.isArray(history) ? history : history?.videos;
  if (!Array.isArray(videos) || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return featured;
  const [y, m, d] = date.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
  for (const v of videos) {
    if (typeof v?.date !== "string" || v.date < from || v.date >= date) continue;
    for (const t of Array.isArray(v.tools) ? v.tools : []) {
      const key = cleanUrlKey(t?.phUrl || t?.ph_url);
      if (key && !(featured.get(key) > v.date)) featured.set(key, v.date);
    }
  }
  return featured;
}

export function isProductHuntHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "producthunt.com" || host.endsWith(".producthunt.com");
  } catch {
    return false;
  }
}

export function todayJst(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}`;
}

/** Visible character count (surrogate pairs count as one). */
export function charLength(s) {
  return Array.from(String(s ?? "")).length;
}

export function isHttpsUrl(s) {
  if (typeof s !== "string" || !s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && Boolean(u.hostname) && u.hostname.includes(".") && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** "https://www.example.com/foo" → "example.com" */
export function displayDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Count sentences ending in 。！？!? (a trailing fragment counts as one). */
export function countSentences(text) {
  const s = String(text ?? "").trim();
  if (!s) return 0;
  const parts = s.split(/(?<=[。！？!?])/).map((p) => p.trim()).filter(Boolean);
  return parts.length;
}

/**
 * Repairs the most common routine mistake: unescaped ASCII double quotes
 * inside string values. Kept from the design-news pipeline.
 */
export function repairJson(text) {
  let result = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && inString) {
      result += ch + (text[i + 1] || "");
      i += 2;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
      } else {
        const after = text.substring(i + 1).replace(/^\s+/, "");
        if (
          after[0] === "," || after[0] === ":" ||
          after[0] === "}" || after[0] === "]" ||
          after.length === 0
        ) {
          inString = false;
          result += ch;
        } else {
          result += '\\"';
        }
      }
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

export function parseEnrichedText(text) {
  try {
    return { data: JSON.parse(text), repaired: false };
  } catch (firstErr) {
    try {
      return { data: JSON.parse(repairJson(text)), repaired: true };
    } catch (secondErr) {
      throw new Error(
        `enriched JSON is invalid and could not be auto-repaired.\n` +
          `  Original: ${firstErr.message}\n  After repair: ${secondErr.message}`
      );
    }
  }
}

function checkLength(errors, warnings, label, value, limit) {
  const len = charLength(value);
  const [hmin, hmax] = limit.hard;
  if (len < hmin || len > hmax) {
    errors.push(`${label}: ${len} chars (allowed ${hmin}-${hmax})`);
    return;
  }
  if (limit.soft) {
    const [smin, smax] = limit.soft;
    if (len < smin || len > smax) warnings.push(`${label}: ${len} chars (target ${smin}-${smax})`);
  }
}

function checkText(errors, label, value, opts) {
  for (const problem of textSafetyProblems(value, opts)) errors.push(`${label} ${problem}`);
}

/** Stable identity of a snapshot post (ids can be empty in odd feed entries). */
function postKey(p) {
  return String(p.id || p.phUrl || p.url || p.name || "");
}

/**
 * Distinct new AI launches (AI category or AI keywords) in a snapshot for a
 * video date. Freshness is recomputed from publishedAt / listedAfter, not
 * trusted from the `fresh` flags.
 */
export function snapshotFreshAiPosts(snapshot, videoDate) {
  const byKey = new Map();
  for (const day of snapshot?.days || []) {
    for (const p of day.posts || []) {
      const ai = p.isAI === true || p.inAiCategory === true;
      const key = postKey(p);
      if (ai && key && !byKey.has(key) && isNewLaunch(p, videoDate)) byKey.set(key, p);
    }
  }
  return [...byKey.values()];
}

export function snapshotFreshAiCount(snapshot, videoDate) {
  return snapshotFreshAiPosts(snapshot, videoDate).length;
}

/**
 * Cross-check a skip day against the Product Hunt snapshot committed for the same video date.
 * Launches the routine excluded on purpose (skip.excluded, with a reason) do not count.
 * @param {{ excludedUrls?: string[] }} [opts]
 * @returns {{ status: "contradicted" | "consistent" | "unchecked", freshAi: number | null, excludedFresh?: number, usable?: object[], reason?: string }}
 */
export function skipSnapshotCheck(snapshot, videoDate, { excludedUrls = [] } = {}) {
  if (!snapshot) return { status: "unchecked", freshAi: null, reason: "no Product Hunt snapshot (data/product-hunt-daily.json)" };
  if (snapshot.forVideoDate !== videoDate) {
    return { status: "unchecked", freshAi: null, reason: `the snapshot is for ${snapshot.forVideoDate}, not ${videoDate}` };
  }
  const hasPublishTimes = (snapshot.days || []).some((d) => (d.posts || []).some((p) => typeof p.publishedAt === "string"));
  if (!hasPublishTimes) return { status: "unchecked", freshAi: null, reason: "the snapshot has no publish times (old format)" };
  const fresh = snapshotFreshAiPosts(snapshot, videoDate);
  const usable = fresh.filter((p) => !excludedUrls.some((u) => sameUrl(p.phUrl || p.url, u)));
  return {
    status: usable.length >= PICKUP_MIN_TOOLS ? "contradicted" : "consistent",
    freshAi: fresh.length,
    excludedFresh: fresh.length - usable.length,
    usable,
  };
}

function cleanUrlKey(u) {
  return String(u ?? "").split(/[?#]/)[0].replace(/\/$/, "").toLowerCase();
}

function sameUrl(a, b) {
  return cleanUrlKey(a) !== "" && cleanUrlKey(a) === cleanUrlKey(b);
}

/**
 * The snapshot post for a Product Hunt URL. A relaunch shares its product URL
 * with the earlier launch, so a match that is a new launch for `videoDate` wins.
 */
function findPostByUrl(snapshot, url, videoDate = null) {
  const matches = [];
  for (const day of snapshot?.days || []) {
    for (const p of day.posts || []) {
      if (sameUrl(p.phUrl || p.url, url)) matches.push(p);
    }
  }
  return (videoDate && matches.find((p) => isNewLaunch(p, videoDate))) || matches[0] || null;
}

/**
 * @param {object} data parsed data/enriched-ai-tools.json
 * @param {{ today?: string, checkDate?: boolean, snapshot?: object | null, history?: object | null, allowRanking?: boolean }} opts
 *   snapshot = the Product Hunt snapshot the routine worked from (data/product-hunt-daily.json).
 *   It cross-checks skip days, ranking ranks and pickup candidates.
 *   history = data/performance-history.json; tools featured in the last
 *   REPEAT_WINDOW_DAYS days are refused.
 *   allowRanking = accept source.mode "ranking" (off since the owner decision of
 *   2026-09-15; only PH_ALLOW_RANKING=1 — the reference dry run — turns it on),
 *   so data alone can never bring ranks back.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateEnriched(data, { today = todayJst(), checkDate = true, snapshot = null, history = null, allowRanking = false } = {}) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["root must be a JSON object"], warnings };
  }

  const dateOk = typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date);
  if (!dateOk) {
    errors.push(`date must be YYYY-MM-DD (got ${JSON.stringify(data.date)})`);
  } else if (checkDate && data.date !== today) {
    errors.push(`date ${data.date} does not match today JST ${today} (routine failed or skipped?)`);
  }

  if (data.genre !== GENRE) errors.push(`genre must be "${GENRE}" (got ${JSON.stringify(data.genre)})`);

  // A skip day: fewer than PICKUP_MIN_TOOLS usable new launches → no video, on purpose.
  if (data.skip != null) {
    const excludedUrls = [];
    if (typeof data.skip !== "object" || Array.isArray(data.skip)) {
      errors.push("skip must be an object { reason, fresh_candidates, excluded? }");
    } else {
      checkLength(errors, warnings, "skip.reason", data.skip.reason, { hard: [4, 80] });
      checkText(errors, "skip.reason", data.skip.reason);
      const n = data.skip.fresh_candidates;
      if (!Number.isInteger(n) || n < 0 || n >= PICKUP_MIN_TOOLS) {
        errors.push(`skip.fresh_candidates must be 0-${PICKUP_MIN_TOOLS - 1}: a day may only be skipped when fewer than ${PICKUP_MIN_TOOLS} new launches are usable`);
      }
      // New AI launches left out on purpose (docs/routine-prompt.md step 4) do not count against the skip.
      const excluded = data.skip.excluded;
      if (excluded != null) {
        if (!Array.isArray(excluded) || excluded.length > 60) {
          errors.push("skip.excluded must be an array (up to 60) of { ph_url, reason, note? }");
        } else {
          const featured = dateOk ? recentlyFeatured(history, data.date) : new Map();
          const snapshotForSkip = dateOk && snapshot && snapshot.forVideoDate === data.date ? snapshot : null;
          excluded.forEach((x, i) => {
            const at = `skip.excluded[${i}]`;
            if (!x || typeof x !== "object" || Array.isArray(x)) {
              errors.push(`${at} must be an object { ph_url, reason, note? }`);
              return;
            }
            const urlOk = PH_URL_RE.test(x.ph_url || "");
            if (!urlOk) errors.push(`${at}.ph_url must be https://www.producthunt.com/products/<slug> or /posts/<slug> without a query (got ${JSON.stringify(x.ph_url)})`);
            else excludedUrls.push(x.ph_url);
            if (!SKIP_EXCLUSION_REASONS.includes(x.reason)) {
              errors.push(`${at}.reason must be one of ${SKIP_EXCLUSION_REASONS.join(" / ")} (got ${JSON.stringify(x.reason)})`);
            }
            if (x.note != null) {
              checkLength(errors, warnings, `${at}.note`, x.note, { hard: [0, 40] });
              checkText(errors, `${at}.note`, x.note);
            }
            if (urlOk && x.reason === "not-ai" && snapshotForSkip && findPostByUrl(snapshotForSkip, x.ph_url, data.date)?.inAiCategory === true) {
              errors.push(`${at} is in Product Hunt's AI category — "not-ai" is only for keyword matches outside it`);
            }
            if (urlOk && x.reason === "recent" && history && !featured.has(cleanUrlKey(x.ph_url))) {
              warnings.push(`${at} is marked "recent" but is not in the last ${REPEAT_WINDOW_DAYS} days of performance history`);
            }
          });
        }
      }
    }
    if (Array.isArray(data.tools) && data.tools.length > 0) errors.push("a skip day must not list tools");
    if (dateOk) {
      const check = skipSnapshotCheck(snapshot, data.date, { excludedUrls });
      if (check.status === "contradicted") {
        const names = check.usable.slice(0, 6).map((p) => p.name || p.phUrl).join(" / ");
        errors.push(
          `skip is not allowed: the Product Hunt snapshot for ${data.date} lists ${check.freshAi} new AI launches and ${check.usable.length} of them are not in skip.excluded (>= ${PICKUP_MIN_TOOLS}: ${names}) — pick them, or list each one you leave out in skip.excluded with its reason`
        );
      } else if (check.status === "unchecked") {
        warnings.push(`skip could not be cross-checked against the snapshot: ${check.reason}`);
      }
    }
    return { errors, warnings };
  }

  const source = data.source || {};
  const mode = source.mode;
  if (!SOURCE_MODES.includes(mode)) {
    errors.push(`source.mode must be one of ${SOURCE_MODES.join(" / ")} (got ${JSON.stringify(mode)})`);
  }
  if (mode === "ranking" && !allowRanking) {
    errors.push('source.mode "ranking" is turned off (owner decision 2026-09-15: the official feed only, no ranks or votes) — use "pickup"');
  }
  const snapshotForToday = dateOk && snapshot && snapshot.forVideoDate === data.date ? snapshot : null;
  const expectedPhDate = dateOk ? expectedRankingDate(data.date) : null;
  let rankingDay = null;
  if (mode === "ranking") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.ph_date || "")) {
      errors.push("source.ph_date (Pacific date of the ranking, YYYY-MM-DD) is required in ranking mode");
    } else if (expectedPhDate && source.ph_date !== expectedPhDate) {
      errors.push(`source.ph_date ${source.ph_date} must be ${expectedPhDate} (the last closed Pacific day at the ${data.date} routine)`);
    }
    // Ranks can only come from the official API ranking of that day.
    rankingDay = (snapshotForToday?.days || []).find((d) => d.date === source.ph_date && d.source === "api" && d.status === "final") || null;
    if (!rankingDay) {
      const why = !snapshot
        ? "there is no Product Hunt snapshot"
        : !snapshotForToday
          ? `the snapshot is for ${snapshot.forVideoDate}`
          : `the snapshot has no final API ranking for ${source.ph_date}`;
      errors.push(`ranking mode needs the final Product Hunt API ranking in the snapshot for ${data.date}, but ${why} — use pickup mode instead`);
    }
  }

  const discovery = data.discovery;
  if (!discovery || typeof discovery !== "object") {
    errors.push("discovery block is required");
  } else {
    if (!discovery.method) errors.push("discovery.method is required");
    else if (!DISCOVERY_METHODS.includes(discovery.method)) {
      warnings.push(`discovery.method "${discovery.method}" is not in docs/strategy.md (${DISCOVERY_METHODS.join(", ")})`);
    }
    if (!Array.isArray(discovery.sources) || discovery.sources.length === 0) {
      errors.push("discovery.sources must list at least one source URL");
    }
  }

  if (data.opening_narration != null) {
    checkLength(errors, warnings, "opening_narration", data.opening_narration, LIMITS.opening_narration);
    checkText(errors, "opening_narration", data.opening_narration);
    if (mode === "pickup" && hasPickupForbiddenWords(data.opening_narration)) {
      errors.push("opening_narration uses ranking words or Product Hunt vote/award/popularity claims (TOP/トップ/ランキング/位/上位/ベスト/No./票/Product of the Day/トップに輝く/一番人気/Product Huntで話題) in pickup mode");
    }
  }

  const tools = data.tools;
  if (!Array.isArray(tools)) {
    errors.push("tools must be an array");
    return { errors, warnings };
  }
  if (mode === "pickup" && data.opening_narration != null) {
    const wrong = openingCountMismatches(data.opening_narration, tools.length);
    if (wrong.length > 0) errors.push(`opening_narration announces ${wrong.join("/")} tools but the video has ${tools.length}`);
  }
  if (mode === "ranking" && tools.length !== RANKING_TOOL_COUNT) {
    errors.push(`ranking mode needs exactly ${RANKING_TOOL_COUNT} tools (got ${tools.length})`);
  }
  if (mode === "pickup" && (tools.length < PICKUP_MIN_TOOLS || tools.length > PICKUP_MAX_TOOLS)) {
    errors.push(`pickup mode needs ${PICKUP_MIN_TOOLS}-${PICKUP_MAX_TOOLS} tools (got ${tools.length}); with fewer fresh launches the routine must not publish`);
  }

  const windowStart = dateOk ? freshSince(data.date).toISOString() : null;
  const featured = dateOk ? recentlyFeatured(history, data.date) : new Map();
  const sourceHosts = (Array.isArray(discovery?.sources) ? discovery.sources : [])
    .map((s) => (typeof s === "string" ? hostOf(s) : null))
    .filter(Boolean)
    .map((h) => h.replace(/^www\./, ""));
  let totalNarration = 0;
  const seenNames = new Set();
  tools.forEach((t, i) => {
    const at = `tools[${i}]`;
    if (!t || typeof t !== "object") {
      errors.push(`${at} must be an object`);
      return;
    }
    if (t.rank !== i + 1) errors.push(`${at}.rank must be ${i + 1} (tools are listed in video order)`);

    checkLength(errors, warnings, `${at}.name`, t.name, LIMITS.name);
    checkText(errors, `${at}.name`, t.name, { allowDomains: true, allowedHost: hostOf(t.website) });
    const key = String(t.name ?? "").normalize("NFKC").trim().toLowerCase();
    if (key && seenNames.has(key)) errors.push(`${at}.name "${t.name}" is duplicated`);
    seenNames.add(key);

    checkLength(errors, warnings, `${at}.description`, t.description, LIMITS.description);
    checkText(errors, `${at}.description`, t.description);
    checkLength(errors, warnings, `${at}.who`, t.who, LIMITS.who);
    checkText(errors, `${at}.who`, t.who);
    if (typeof t.who === "string" && WHO_SUFFIX_RE.test(t.who.trim())) {
      warnings.push(`${at}.who ends with 向け — it is added on screen and in captions (dropped automatically)`);
    }

    if (!Object.prototype.hasOwnProperty.call(PRICING_LABELS, t.pricing)) {
      errors.push(`${at}.pricing must be one of ${Object.keys(PRICING_LABELS).join(" / ")} (got ${JSON.stringify(t.pricing)})`);
    }
    if (t.pricing_note != null) {
      checkLength(errors, warnings, `${at}.pricing_note`, t.pricing_note, LIMITS.pricing_note);
      checkText(errors, `${at}.pricing_note`, t.pricing_note);
    }

    if (!isHttpsUrl(t.website)) errors.push(`${at}.website must be the tool's official https URL (no credentials)`);
    else if (isProductHuntHost(t.website)) {
      errors.push(`${at}.website is a Product Hunt URL — use the tool's own official site (the snapshot's website is only a redirect)`);
    } else {
      // Shown as "公式 <domain>" on the card and in both captions.
      for (const problem of officialWebsiteProblems(t.website)) errors.push(`${at}.website ${problem}`);
      const host = hostOf(t.website).replace(/^www\./, "");
      if (!sourceHosts.some((s) => s === host || s.endsWith(`.${host}`) || host.endsWith(`.${s}`))) {
        warnings.push(`${at}.website host ${host} is not in discovery.sources — add the official page you checked`);
      }
    }
    if (typeof t.website === "string" && charLength(t.website) > LIMITS.website.hard[1]) {
      errors.push(`${at}.website: ${charLength(t.website)} chars (allowed up to ${LIMITS.website.hard[1]})`);
    }
    if (!PH_URL_RE.test(t.ph_url || "")) {
      errors.push(`${at}.ph_url must be https://www.producthunt.com/products/<slug> or /posts/<slug> without a query (got ${JSON.stringify(t.ph_url)})`);
    } else if (charLength(t.ph_url) > LIMITS.ph_url.hard[1]) {
      errors.push(`${at}.ph_url: ${charLength(t.ph_url)} chars (allowed up to ${LIMITS.ph_url.hard[1]})`);
    }
    if (t.image_url != null && t.image_url !== "" && !isHttpsUrl(t.image_url)) {
      errors.push(`${at}.image_url must be an https URL or null`);
    }

    // 新作: launched on Product Hunt within the freshness window of the video date,
    // proven by the publish time or by the feed listing it only after a fetch
    // taken inside the window (ph_listed_after = the snapshot's listedAfter).
    const listedAfterValid =
      t.ph_listed_after == null || (typeof t.ph_listed_after === "string" && Number.isFinite(Date.parse(t.ph_listed_after)));
    if (!listedAfterValid) errors.push(`${at}.ph_listed_after must be an ISO 8601 time or null`);
    const listedAfter = listedAfterValid && typeof t.ph_listed_after === "string" ? t.ph_listed_after : null;
    if (listedAfter && dateOk) {
      // Listing evidence only exists in a snapshot; it can never be later than the routine.
      if (Date.parse(listedAfter) > routineAnchor(data.date).getTime()) {
        errors.push(`${at}.ph_listed_after ${listedAfter} is later than the ${data.date} routine — copy the snapshot's listedAfter`);
      } else if (!snapshotForToday) {
        errors.push(`${at}.ph_listed_after needs the Product Hunt snapshot for ${data.date} — without one, write null (docs/routine-prompt.md step 3b)`);
      }
    }
    if (typeof t.ph_url === "string" && featured.has(cleanUrlKey(t.ph_url))) {
      errors.push(`${at} (${t.name}) was already featured on ${featured.get(cleanUrlKey(t.ph_url))} — tools from the last ${REPEAT_WINDOW_DAYS} days are not featured again`);
    }
    if (typeof t.ph_published_at !== "string" || !Number.isFinite(Date.parse(t.ph_published_at))) {
      errors.push(`${at}.ph_published_at (Product Hunt publish time, ISO 8601) is required`);
    } else if (dateOk && !isNewLaunch({ publishedAt: t.ph_published_at, listedAfter }, data.date)) {
      errors.push(
        listedAfter
          ? `${at}.ph_published_at ${t.ph_published_at} and ph_listed_after ${listedAfter} are both before ${windowStart}: ${at} is not a new launch for ${data.date}`
          : `${at}.ph_published_at ${t.ph_published_at} is not a new launch for ${data.date} (must be at or after ${windowStart})`
      );
    }

    for (const [field, placeholder] of Object.entries(TEMPLATE_PLACEHOLDERS)) {
      if (typeof t[field] === "string" && t[field].trim() === placeholder) {
        errors.push(`${at}.${field} still has the template placeholder "${placeholder}"`);
      }
    }

    checkLength(errors, warnings, `${at}.narration`, t.narration, LIMITS.narration);
    checkText(errors, `${at}.narration`, t.narration);
    totalNarration += charLength(t.narration);
    const sentences = countSentences(t.narration);
    if (sentences !== 2) warnings.push(`${at}.narration has ${sentences} sentences (rule: hook 1 + point 1)`);

    const rankingWordFields = ["name", "description", "who", "pricing_note", "narration"].filter(
      (f) => typeof t[f] === "string" && (mode === "pickup" ? hasPickupForbiddenWords(t[f]) : hasRankingWords(t[f]))
    );
    if (rankingWordFields.length > 0) {
      if (mode === "pickup") {
        errors.push(
          `${at}.${rankingWordFields.join("/")} uses ranking words or Product Hunt vote/award/popularity claims (TOP/トップ/ランキング/位/上位/ベスト/No./票/Product of the Day/トップに輝く/一番人気/Product Huntで話題) in pickup mode${rankingWordFields.includes("name") ? " — a tool whose own name does this is excluded, never renamed" : ""}`
        );
      } else if (rankingWordFields.some((f) => f !== "name")) {
        warnings.push(`${at}.${rankingWordFields.filter((f) => f !== "name").join("/")} mentions a rank — the card already shows it`);
      }
    }
    if (mode === "ranking" && (!Number.isInteger(t.ph_rank) || t.ph_rank < 1)) {
      errors.push(`${at}.ph_rank (Product Hunt dailyRank) must be an integer >= 1 in ranking mode`);
    }
  });

  if (mode === "ranking") {
    const ranks = tools.map((t) => t?.ph_rank).filter((r) => Number.isInteger(r) && r >= 1);
    if (new Set(ranks).size !== ranks.length) errors.push("tools[].ph_rank must not repeat");
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] <= ranks[i - 1]) {
        errors.push("tools[].ph_rank must be strictly ascending in video order (dailyRank order)");
        break;
      }
    }
    if (rankingDay) {
      tools.forEach((t, i) => {
        if (!t || !Number.isInteger(t.ph_rank)) return;
        const post = (rankingDay.posts || []).find((p) => p.dailyRank === t.ph_rank);
        if (!post) {
          errors.push(`tools[${i}].ph_rank ${t.ph_rank} is not in the Product Hunt ${source.ph_date} ranking snapshot`);
        } else if (!sameUrl(post.phUrl || post.url, t.ph_url)) {
          errors.push(`tools[${i}] ph_rank ${t.ph_rank} is ${post.phUrl || post.url} in the snapshot, not ${t.ph_url}`);
        } else if (dateOk && !isNewLaunch(post, data.date)) {
          errors.push(`tools[${i}] was published ${post.publishedAt} per the snapshot — not a new launch for ${data.date}`);
        }
      });
    }
  }

  if (mode === "pickup") {
    // Pickup candidates must come from the snapshot (and be new per the snapshot, not per the routine).
    if (snapshotForToday) {
      tools.forEach((t, i) => {
        if (!t || typeof t.ph_url !== "string") return;
        const post = findPostByUrl(snapshotForToday, t.ph_url, data.date);
        if (!post) {
          errors.push(`tools[${i}].ph_url ${t.ph_url} is not in the Product Hunt snapshot for ${data.date}`);
          return;
        }
        if (typeof post.name === "string" && post.name.trim()) {
          if (hasPickupForbiddenWords(post.name)) {
            errors.push(`tools[${i}]: the Product Hunt name "${post.name}" uses ranking words or vote/award claims — exclude this tool (do not rename it)`);
          } else if (typeof t.name === "string" && !namesMatch(t.name, post.name)) {
            errors.push(`tools[${i}].name "${t.name}" is not the Product Hunt name "${post.name}" of ${t.ph_url} — use the original name, or exclude the tool (never rename it)`);
          }
        }
        if (!isNewLaunch(post, data.date)) {
          errors.push(
            `tools[${i}] was published ${post.publishedAt}${post.listedAfter ? ` and first listed after ${post.listedAfter}` : ""} per the snapshot — not a new launch for ${data.date}`
          );
        } else {
          if (typeof t.ph_published_at === "string" && Date.parse(t.ph_published_at) !== Date.parse(post.publishedAt)) {
            warnings.push(`tools[${i}].ph_published_at differs from the snapshot (${post.publishedAt})`);
          }
          const snapListed = typeof post.listedAfter === "string" ? Date.parse(post.listedAfter) : null;
          const toolListed = typeof t.ph_listed_after === "string" ? Date.parse(t.ph_listed_after) : null;
          if (snapListed !== toolListed) {
            warnings.push(`tools[${i}].ph_listed_after differs from the snapshot (${post.listedAfter ?? null})`);
          }
        }
      });
    } else if (dateOk) {
      warnings.push(
        `pickup tools could not be cross-checked: ${snapshot ? `the snapshot is for ${snapshot.forVideoDate}, not ${data.date}` : "no Product Hunt snapshot"}`
      );
    }
  }

  if (totalNarration > LIMITS.totalNarration.hard) {
    errors.push(`total tool narration ${totalNarration} chars exceeds ${LIMITS.totalNarration.hard} (video would pass 60 s)`);
  }

  return { errors, warnings };
}

/** Fill display defaults used by the video and captions. Assumes a valid input. */
export function toVideoTools(data) {
  const ranking = data.source?.mode === "ranking";
  const count = data.tools.length;
  const phDay = ranking && data.source.ph_date ? data.source.ph_date.split("-").slice(1).map(Number).join("/") : null;
  return data.tools.map((t) => ({
    rank: t.rank,
    // Big card badge: the position in this video. In pickup mode it is shown
    // as "1/3" so it cannot be read as a Product Hunt rank.
    badge: ranking ? String(t.rank) : `${t.rank}/${count}`,
    // Small line under the headline: what Product Hunt actually says. The feed
    // has no launch date (its publish time is when the post was created), so
    // pickup cards only say the tool is a new launch there.
    sourceNote: ranking ? `Product Hunt ${phDay} 総合${t.ph_rank}位` : "Product Hunt 新着",
    name: String(t.name).trim(),
    description: String(t.description).trim(),
    // 「向け」 is added by the card and the captions.
    who: String(t.who).trim().replace(WHO_SUFFIX_RE, "").trim() || String(t.who).trim(),
    pricing: t.pricing,
    pricingLabel: (t.pricing_note && String(t.pricing_note).trim()) || PRICING_LABELS[t.pricing],
    website: t.website,
    domain: displayDomain(t.website),
    phUrl: String(t.ph_url).replace(/\/$/, ""),
    slug: String(t.ph_url).replace(/\/$/, "").split("/").pop(),
    phRank: Number.isInteger(t.ph_rank) ? t.ph_rank : null,
    phPublishedAt: t.ph_published_at,
    imageUrl: t.image_url || null,
    image: null,
    narration: String(t.narration).trim(),
  }));
}

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** Labels shown on the opening card / cards / captions. */
export function buildMeta(data) {
  const [y, m, d] = data.date.split("-").map(Number);
  const weekday = WEEKDAYS_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const count = data.tools.length;
  const ranking = data.source?.mode === "ranking" && Boolean(data.source.ph_date);
  const phDay = ranking ? data.source.ph_date.split("-").slice(1).map(Number).join("/") : null;
  return {
    date: data.date,
    dateLabel: `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${weekday})`,
    shortDate: `${m}/${d}`,
    mode: ranking ? "ranking" : "pickup",
    count,
    // ranking: "新作AIツール TOP5" / pickup: "新作AIツール 3選" (never "TOP")
    headline: ranking ? `新作AIツール TOP${count}` : `新作AIツール ${count}選`,
    titleTag: ranking ? `新作AIツールTOP${count}` : `新作AIツール${count}選`,
    bigLabel: ranking ? `TOP${count}` : `${count}選`,
    sourceLabel: ranking
      ? `Product Hunt ${phDay} ランキングの AI ツール上位${count}本`
      : "Product Hunt の直近48時間の新着から厳選",
    openingSourceLabel: ranking ? `Product Hunt ${phDay} の AI ツール上位` : "Product Hunt の新着から厳選",
    method: data.discovery?.method || null,
  };
}
