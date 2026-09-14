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

import { isFresh, freshSince, tzParts, PACIFIC_TZ } from "./pacific-time.mjs";

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
// C0/C1 control characters, including line breaks and tabs.
export const CONTROL_CHARS_RE = /[\u{0}-\u{1F}\u{7F}-\u{9F}]/u;
// Zero-width / invisible / bidi-control characters and the BOM:
// soft hyphen, CGJ, Arabic letter mark, Hangul fillers, Khmer/Mongolian
// invisibles, ZWSP..RLM, LS/PS + bidi embeddings/overrides, word joiner and
// bidi isolates, variation selectors, ZWNBSP, halfwidth Hangul filler.
export const INVISIBLE_CHARS_RE = /[\u{AD}\u{34F}\u{61C}\u{115F}\u{1160}\u{17B4}\u{17B5}\u{180B}-\u{180F}\u{200B}-\u{200F}\u{2028}-\u{202E}\u{2060}-\u{206F}\u{3164}\u{FE00}-\u{FE0F}\u{FEFF}\u{FFA0}]/u;
const URL_RE = /[a-z][a-z0-9+.-]*:\/\/|\bwww\./i;
const BARE_DOMAIN_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|app|dev|co|jp|xyz|me|so|gg|tv|ly|link|site|info|biz)\b/i;
const MENTION_RE = /[@\u{FF20}][A-Za-z0-9_]/u;
const HASHTAG_RE = /[#\u{FF03}][^\s#\u{FF03}]/u;
// Ranking vocabulary that must not appear when the order is an editorial pick:
// TOP5 / トップ5 / ランキング / N位 (ASCII or full-width digits).
const RANKING_WORDS_RE = /TOP\s*[0-9\u{FF10}-\u{FF19}]|\u{30C8}\u{30C3}\u{30D7}\s*[0-9\u{FF10}-\u{FF19}]|\u{30E9}\u{30F3}\u{30AD}\u{30F3}\u{30B0}|[0-9\u{FF10}-\u{FF19}]+\s*\u{4F4D}/iu;

// Example values in docs/routine-prompt.md; copying them verbatim is a mistake.
const TEMPLATE_PLACEHOLDERS = {
  name: "ツール名（原文）",
  description: "一言",
  who: "誰向け",
  pricing_note: "任意",
  narration: "フック文。要点文。",
  tagline_en: "Product Hunt のタグライン（原文）",
};

/** Problems with a displayed text value (links, mentions, hashtags, control/invisible chars). */
export function textSafetyProblems(value, { allowDomains = false } = {}) {
  if (typeof value !== "string") return [];
  const problems = [];
  if (CONTROL_CHARS_RE.test(value)) problems.push("contains a line break or control character");
  if (INVISIBLE_CHARS_RE.test(value)) problems.push("contains an invisible (zero-width / bidi) character");
  if (URL_RE.test(value)) problems.push("contains a URL");
  else if (!allowDomains && BARE_DOMAIN_RE.test(value)) problems.push("contains a domain name (put URLs in website only)");
  if (MENTION_RE.test(value)) problems.push("contains an @mention");
  if (HASHTAG_RE.test(value)) problems.push("contains a #hashtag");
  return problems;
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

/**
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateEnriched(data, { today = todayJst(), checkDate = true } = {}) {
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
    if (typeof data.skip !== "object" || Array.isArray(data.skip)) {
      errors.push("skip must be an object { reason, fresh_candidates }");
    } else {
      checkLength(errors, warnings, "skip.reason", data.skip.reason, { hard: [4, 80] });
      checkText(errors, "skip.reason", data.skip.reason);
      const n = data.skip.fresh_candidates;
      if (!Number.isInteger(n) || n < 0 || n >= PICKUP_MIN_TOOLS) {
        errors.push(`skip.fresh_candidates must be 0-${PICKUP_MIN_TOOLS - 1}: a day may only be skipped when fewer than ${PICKUP_MIN_TOOLS} new launches are usable`);
      }
    }
    if (Array.isArray(data.tools) && data.tools.length > 0) errors.push("a skip day must not list tools");
    return { errors, warnings };
  }

  const source = data.source || {};
  const mode = source.mode;
  if (!SOURCE_MODES.includes(mode)) {
    errors.push(`source.mode must be one of ${SOURCE_MODES.join(" / ")} (got ${JSON.stringify(mode)})`);
  }
  if (mode === "ranking" && !/^\d{4}-\d{2}-\d{2}$/.test(source.ph_date || "")) {
    errors.push("source.ph_date (Pacific date of the ranking, YYYY-MM-DD) is required in ranking mode");
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
    if (mode === "pickup" && RANKING_WORDS_RE.test(data.opening_narration)) {
      errors.push("opening_narration uses ranking words (TOP/トップ/ランキング/位) in pickup mode");
    }
  }

  const tools = data.tools;
  if (!Array.isArray(tools)) {
    errors.push("tools must be an array");
    return { errors, warnings };
  }
  if (mode === "ranking" && tools.length !== RANKING_TOOL_COUNT) {
    errors.push(`ranking mode needs exactly ${RANKING_TOOL_COUNT} tools (got ${tools.length})`);
  }
  if (mode === "pickup" && (tools.length < PICKUP_MIN_TOOLS || tools.length > PICKUP_MAX_TOOLS)) {
    errors.push(`pickup mode needs ${PICKUP_MIN_TOOLS}-${PICKUP_MAX_TOOLS} tools (got ${tools.length}); with fewer fresh launches the routine must not publish`);
  }

  const windowStart = dateOk ? freshSince(data.date).toISOString() : null;
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
    checkText(errors, `${at}.name`, t.name, { allowDomains: true });
    const key = String(t.name ?? "").trim().toLowerCase();
    if (key && seenNames.has(key)) errors.push(`${at}.name "${t.name}" is duplicated`);
    seenNames.add(key);

    checkLength(errors, warnings, `${at}.description`, t.description, LIMITS.description);
    checkText(errors, `${at}.description`, t.description);
    checkLength(errors, warnings, `${at}.who`, t.who, LIMITS.who);
    checkText(errors, `${at}.who`, t.who);

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
    }
    if (!PH_URL_RE.test(t.ph_url || "")) {
      errors.push(`${at}.ph_url must be https://www.producthunt.com/products/<slug> or /posts/<slug> without a query (got ${JSON.stringify(t.ph_url)})`);
    }
    if (t.image_url != null && t.image_url !== "" && !isHttpsUrl(t.image_url)) {
      errors.push(`${at}.image_url must be an https URL or null`);
    }

    // 新作: published on Product Hunt within the freshness window of the video date.
    if (typeof t.ph_published_at !== "string" || !Number.isFinite(Date.parse(t.ph_published_at))) {
      errors.push(`${at}.ph_published_at (Product Hunt publish time, ISO 8601) is required`);
    } else if (dateOk && !isFresh(t.ph_published_at, data.date)) {
      errors.push(`${at}.ph_published_at ${t.ph_published_at} is not a new launch for ${data.date} (must be at or after ${windowStart})`);
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

    const rankingWords = ["description", "who", "pricing_note", "narration"].filter(
      (f) => typeof t[f] === "string" && RANKING_WORDS_RE.test(t[f])
    );
    if (rankingWords.length > 0) {
      if (mode === "pickup") errors.push(`${at}.${rankingWords.join("/")} uses ranking words (TOP/トップ/ランキング/位) in pickup mode`);
      else warnings.push(`${at}.${rankingWords.join("/")} mentions a rank — the card already shows it`);
    }
    if (mode === "ranking" && !Number.isInteger(t.ph_rank)) {
      errors.push(`${at}.ph_rank (Product Hunt dailyRank) is required in ranking mode`);
    }
  });

  if (totalNarration > LIMITS.totalNarration.hard) {
    errors.push(`total tool narration ${totalNarration} chars exceeds ${LIMITS.totalNarration.hard} (video would pass 60 s)`);
  }

  return { errors, warnings };
}

function pacificMonthDay(iso) {
  const p = tzParts(new Date(iso), PACIFIC_TZ);
  return `${p.month}/${p.day}`;
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
    // Small line under the headline: what Product Hunt actually says.
    sourceNote: ranking ? `Product Hunt ${phDay} 総合${t.ph_rank}位` : `Product Hunt ${pacificMonthDay(t.ph_published_at)} 公開`,
    name: String(t.name).trim(),
    description: String(t.description).trim(),
    who: String(t.who).trim(),
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
      : "Product Hunt の新着（直近48時間の公開）から厳選",
    openingSourceLabel: ranking ? `Product Hunt ${phDay} の AI ツール上位` : "Product Hunt の新着から厳選",
    method: data.discovery?.method || null,
  };
}
