/**
 * Schema + validation for data/enriched-ai-tools.json (written by the Claude
 * Routine every morning). Shared by generate-data.mjs (pipeline),
 * validate-enriched.mjs (routine self-check) and the unit tests, so the
 * routine and the pipeline can never disagree about what "valid" means.
 *
 * Human-readable spec: docs/enrichment-schema.md
 */

export const GENRE = "ai-tools-top5";
export const TRIAL = 1;
export const TOOL_COUNT = 5;

// Character windows. `hard` → error (pipeline refuses), `soft` → warning.
// Narration budget keeps the video under 60 s (Instagram Reels limit) at the
// TTS rate used by generate-audio.mjs (+30%): ~6 chars/s × 5 tools + opening
// + ending + padding.
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

export const DEFAULT_OPENING_NARRATION = "新作AIツール、トップ5を紹介します。";
export const DEFAULT_ENDING_NARRATION = "気になるツールは保存して、あとで試してみてください。";

const PH_URL_RE = /^https:\/\/www\.producthunt\.com\/(products|posts)\/[a-z0-9][a-z0-9-]*\/?$/i;

// Example values in docs/routine-prompt.md; copying them verbatim is a mistake.
const TEMPLATE_PLACEHOLDERS = {
  name: "ツール名（原文）",
  description: "一言",
  who: "誰向け",
  pricing_note: "任意",
  narration: "フック文。要点文。",
  tagline_en: "Product Hunt のタグライン（原文）",
};

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
    return u.protocol === "https:" && Boolean(u.hostname) && u.hostname.includes(".");
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

/**
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateEnriched(data, { today = todayJst(), checkDate = true } = {}) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["root must be a JSON object"], warnings };
  }

  if (typeof data.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    errors.push(`date must be YYYY-MM-DD (got ${JSON.stringify(data.date)})`);
  } else if (checkDate && data.date !== today) {
    errors.push(`date ${data.date} does not match today JST ${today} (routine failed or skipped?)`);
  }

  if (data.genre !== GENRE) errors.push(`genre must be "${GENRE}" (got ${JSON.stringify(data.genre)})`);

  const source = data.source || {};
  if (!SOURCE_MODES.includes(source.mode)) {
    errors.push(`source.mode must be one of ${SOURCE_MODES.join(" / ")} (got ${JSON.stringify(source.mode)})`);
  }
  if (source.mode === "ranking" && !/^\d{4}-\d{2}-\d{2}$/.test(source.ph_date || "")) {
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
  }

  const tools = data.tools;
  if (!Array.isArray(tools)) {
    errors.push("tools must be an array");
    return { errors, warnings };
  }
  if (tools.length !== TOOL_COUNT) errors.push(`tools must contain exactly ${TOOL_COUNT} entries (got ${tools.length})`);

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
    const key = String(t.name ?? "").trim().toLowerCase();
    if (key && seenNames.has(key)) errors.push(`${at}.name "${t.name}" is duplicated`);
    seenNames.add(key);

    checkLength(errors, warnings, `${at}.description`, t.description, LIMITS.description);
    checkLength(errors, warnings, `${at}.who`, t.who, LIMITS.who);

    if (!Object.prototype.hasOwnProperty.call(PRICING_LABELS, t.pricing)) {
      errors.push(`${at}.pricing must be one of ${Object.keys(PRICING_LABELS).join(" / ")} (got ${JSON.stringify(t.pricing)})`);
    }
    if (t.pricing_note != null) checkLength(errors, warnings, `${at}.pricing_note`, t.pricing_note, LIMITS.pricing_note);

    if (!isHttpsUrl(t.website)) errors.push(`${at}.website must be the tool's official https URL`);
    else if (isProductHuntHost(t.website)) {
      errors.push(`${at}.website is a Product Hunt URL — use the tool's own official site (the snapshot's website is only a redirect)`);
    }
    for (const [field, placeholder] of Object.entries(TEMPLATE_PLACEHOLDERS)) {
      if (typeof t[field] === "string" && t[field].trim() === placeholder) {
        errors.push(`${at}.${field} still has the template placeholder "${placeholder}"`);
      }
    }
    if (!PH_URL_RE.test(t.ph_url || "")) {
      errors.push(`${at}.ph_url must be https://www.producthunt.com/products/<slug> (got ${JSON.stringify(t.ph_url)})`);
    }
    if (t.image_url != null && t.image_url !== "" && !isHttpsUrl(t.image_url)) {
      errors.push(`${at}.image_url must be an https URL or null`);
    }

    checkLength(errors, warnings, `${at}.narration`, t.narration, LIMITS.narration);
    totalNarration += charLength(t.narration);
    const sentences = countSentences(t.narration);
    if (sentences !== 2) warnings.push(`${at}.narration has ${sentences} sentences (rule: hook 1 + point 1)`);
    if (/[0-9０-９一二三四五]\s*位|ランキング/.test(t.narration || "")) {
      warnings.push(`${at}.narration mentions a rank — the card already shows it`);
    }
    if (source.mode === "ranking" && !Number.isInteger(t.ph_rank)) {
      errors.push(`${at}.ph_rank (Product Hunt dailyRank) is required in ranking mode`);
    }
  });

  if (totalNarration > LIMITS.totalNarration.hard) {
    errors.push(`total tool narration ${totalNarration} chars exceeds ${LIMITS.totalNarration.hard} (video would pass 60 s)`);
  }

  return { errors, warnings };
}

/** Fill display defaults used by the video and captions. Assumes a valid input. */
export function toVideoTools(data) {
  return data.tools.map((t) => ({
    rank: t.rank,
    name: String(t.name).trim(),
    description: String(t.description).trim(),
    who: String(t.who).trim(),
    pricing: t.pricing,
    pricingLabel: (t.pricing_note && String(t.pricing_note).trim()) || PRICING_LABELS[t.pricing],
    website: t.website,
    domain: displayDomain(t.website),
    phUrl: t.ph_url,
    slug: String(t.ph_url).replace(/\/$/, "").split("/").pop(),
    phRank: Number.isInteger(t.ph_rank) ? t.ph_rank : null,
    imageUrl: t.image_url || null,
    image: null,
    narration: String(t.narration).trim(),
  }));
}

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** Labels shown on the opening card / captions. */
export function buildMeta(data) {
  const [y, m, d] = data.date.split("-").map(Number);
  const weekday = WEEKDAYS_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  let sourceLabel = "Product Hunt の新着から厳選";
  if (data.source?.mode === "ranking" && data.source.ph_date) {
    const [, pm, pd] = data.source.ph_date.split("-").map(Number);
    sourceLabel = `Product Hunt ${pm}/${pd} ランキングより`;
  }
  return {
    date: data.date,
    dateLabel: `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${weekday})`,
    shortDate: `${m}/${d}`,
    mode: data.source?.mode || "pickup",
    sourceLabel,
    method: data.discovery?.method || null,
  };
}
