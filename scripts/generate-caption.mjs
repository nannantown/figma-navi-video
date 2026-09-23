/**
 * Platform captions for the new-AI-tools video.
 *
 * Input:  output/trending-data.json, output/optimization-hints.json (optional)
 * Output: output/captions.json
 *
 * Hard platform limits enforced here:
 *   - YouTube title ≤ 100 characters and no "<" / ">" — longer titles are
 *     rejected with "invalid or empty video title" (what broke 2026-09-13/14).
 *   - YouTube description ≤ 5000 bytes, no "<" / ">".
 *   - Instagram: ≤ 5 hashtags per Reel, caption ≤ 2,200 characters.
 * Attribution: the YouTube description lists every tool's Product Hunt page
 * URL next to "出典: Product Hunt" — as text: URLs in Shorts descriptions are
 * not clickable (YouTube Help answer 13748639, checked 2026-09-16). Instagram
 * captions cannot hold links either, so they keep a plain "出典: Product Hunt".
 * Wording: "TOP5" only in ranking mode; pickup mode says "N選".
 *
 * 【一次資料】YouTube Data API videos resource (2026-09-14):
 *   snippet.title max 100 characters, snippet.description max 5000 bytes, both
 *   without "<" / ">"; snippet.tags max 500 characters incl. commas
 *   https://developers.google.com/youtube/v3/docs/videos
 *   Instagram @creators 2025-12 announcement: up to 5 hashtags per post/Reel
 *   https://www.instagram.com/p/DSaxmEWkfL4/ ,
 *   https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/
 *   Product Hunt API v2 docs (attribution / commercial use): https://api.producthunt.com/v2/docs
 */

import { readFileSync, writeFileSync, existsSync, realpathSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { charLength, CONTROL_CHARS_RE, INVISIBLE_CHARS_RE } from "./enriched-schema.mjs";
import { buildJevCaptions } from "./jev.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX_BYTES = 5000;
export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAGS = ["#AIツール", "#生成AI", "#業務効率化", "#便利ツール", "#ProductHunt"];
export const YT_DESCRIPTION_HASHTAGS = ["#AIツール", "#生成AI", "#ProductHunt", "#新作AIツール", "#Shorts"];
export const YT_BASE_TAGS = ["AIツール", "生成AI", "ProductHunt", "新作AIツール", "AI活用", "便利ツール", "業務効率化", "Shorts"];
const YT_TAGS_MAX_CHARS = 450; // API limit is 500 incl. separators; keep headroom
const PRODUCT_HUNT_HOME = "https://www.producthunt.com/";

const CONTROL_G = new RegExp(CONTROL_CHARS_RE.source, "gu");
const INVISIBLE_G = new RegExp(INVISIBLE_CHARS_RE.source, "gu");

/** Defence in depth behind the validator: one line, no control/invisible chars. */
export function cleanText(s) {
  return String(s ?? "").replace(CONTROL_G, " ").replace(INVISIBLE_G, "").replace(/\s+/g, " ").trim();
}

export function sanitizeTitlePart(s) {
  return cleanText(s).replace(/[<>]/g, "");
}

function titleFor(template, tag, list, dateFull) {
  switch (template) {
    case "highlight":
      return `${list} ${tag}｜${dateFull} #Shorts`;
    case "emoji":
      return `${tag}｜${list}｜${dateFull} #Shorts`;
    case "standard":
    default:
      return `【${tag}】${list}｜${dateFull} #Shorts`;
  }
}

/**
 * A title fits when it is within the limit by both ways of counting.
 *
 * 【一次資料】YouTube Data API, videos resource, snippet.title (2026-09-16):
 * https://developers.google.com/youtube/v3/docs/videos — "The property value
 * has a maximum length of 100 characters and may contain all valid UTF-8
 * characters except < and >." It does not say whether a character outside the
 * BMP (an emoji) counts once or twice, and the 2026-09-13/14 uploads already
 * failed with `invalid or empty video title`, so the title has to fit under the
 * stricter of the two counts: code points (Array.from) and UTF-16 units.
 */
function titleFits(title) {
  return charLength(title) <= YT_TITLE_MAX && title.length <= YT_TITLE_MAX;
}

/** Longest title that fits: up to 3 tool names, then fewer, then a truncated first name. */
export function buildYouTubeTitle(tools, dateFull, template = "standard", tag = "新作AIツール") {
  const names = tools.map((t) => sanitizeTitlePart(t.name)).filter(Boolean);
  const safeTag = sanitizeTitlePart(tag);
  for (let n = Math.min(3, names.length); n >= 1; n--) {
    const list = names.slice(0, n).join("・") + (n < names.length ? " ほか" : "");
    const title = titleFor(template, safeTag, list, dateFull);
    if (titleFits(title)) return title;
  }
  const suffix = names.length > 1 ? " ほか" : "";
  const chars = Array.from(names[0] || "AIツール");
  for (let room = chars.length; room >= 1; room--) {
    const title = titleFor(template, safeTag, `${chars.slice(0, room).join("")}…${suffix}`, dateFull);
    if (titleFits(title)) return title;
  }
  return titleFor(template, safeTag, `…${suffix}`, dateFull);
}

export function buildYouTubeTags(tools) {
  const tags = [...YT_BASE_TAGS];
  const seen = new Set(tags.map((t) => t.toLowerCase()));
  for (const t of tools) {
    const tag = sanitizeTitlePart(t.name).replace(/[,"]/g, "");
    // A tool called "Shorts" must not take a second slot next to the base tag.
    if (tag && !seen.has(tag.toLowerCase())) {
      tags.push(tag);
      seen.add(tag.toLowerCase());
    }
  }
  const out = [];
  let used = 0;
  for (const tag of tags) {
    const cost = charLength(tag) + 1;
    // Skip the ones that do not fit and keep going: one long tool name must not
    // drop every shorter tag behind it.
    if (used + cost > YT_TAGS_MAX_CHARS) continue;
    out.push(tag);
    used += cost;
  }
  return out;
}

/**
 * YouTube description, packed so the attribution always survives the 5000-byte
 * limit: optional lines are dropped first (CTA → who/pricing → official site →
 * long descriptions); every tool keeps its "Product Hunt: <url>" link and the
 * "出典: Product Hunt" line always stays.
 */
/**
 * Both captions number the tools 1. 2. 3., which a reader could take for a
 * Product Hunt ranking. The video says "1/5" for the same reason. Only the
 * channel description carried this disclaimer before, so every post now says it
 * in pickup mode (ranking mode really is ranked, so it does not).
 */
export const NOT_A_RANKING_NOTE = "番号は紹介の順番で、Product Hunt の順位ではありません。";

export function buildYouTubeDescription(data, { maxBytes = YT_DESCRIPTION_MAX_BYTES } = {}) {
  const { meta, tools } = data;
  const dateLabel = meta.date.replace(/-/g, "/");
  const cta = [
    "料金や仕様は変わることがあるので、使う前に公式サイトで確認してください。",
    "毎朝、使える新作AIツールを1分で紹介しています。",
    "気になるツールは保存して、あとで試してみてください。",
  ];
  const strip = (s) => String(s ?? "").replace(/[<>]/g, "");
  const bytes = (s) => Buffer.byteLength(s, "utf-8");

  const compose = (level) => {
    const lines = [strip(level >= 5 ? `${dateLabel} の${cleanText(meta.headline)}` : `${dateLabel} の${cleanText(meta.headline)}（${cleanText(meta.sourceLabel)}）`), ""];
    for (const t of tools) {
      const name = strip(cleanText(t.name));
      lines.push(level >= 4 ? `${t.rank}. ${name}` : `${t.rank}. ${name}｜${strip(cleanText(t.description))}`);
      if (level < 2) lines.push(`   誰向け: ${strip(cleanText(t.who))} ／ 料金: ${strip(cleanText(t.pricingLabel))}`);
      if (level < 3) lines.push(`   公式サイト: ${strip(t.website)}`);
      lines.push(`   Product Hunt: ${strip(t.phUrl)}`);
      lines.push("");
    }
    lines.push(`出典: Product Hunt ${PRODUCT_HUNT_HOME}`);
    if (meta.mode !== "ranking") lines.push(NOT_A_RANKING_NOTE);
    if (level < 1) lines.push(...cta);
    lines.push("");
    lines.push(YT_DESCRIPTION_HASHTAGS.join(" "));
    return lines.join("\n");
  };

  for (let level = 0; level <= 5; level++) {
    const description = compose(level);
    if (bytes(description) <= maxBytes) return description;
  }
  // Unreachable with the validator's limits (name ≤ 40, website ≤ 200); keep the
  // attribution block and cut tool names as a last resort.
  const attribution = `\n出典: Product Hunt ${PRODUCT_HUNT_HOME}\n\n${YT_DESCRIPTION_HASHTAGS.join(" ")}`;
  const links = tools.map((t) => `${t.rank}. Product Hunt: ${strip(t.phUrl)}`).join("\n");
  return Buffer.from(links, "utf-8").subarray(0, Math.max(0, maxBytes - bytes(attribution))).toString("utf-8").replace(/\u{FFFD}+$/u, "") + attribution;
}

export function buildInstagramCaption(data) {
  const { meta, tools } = data;
  const head = [`${cleanText(meta.headline)}（${meta.shortDate}）`, ""];
  const body = [];
  for (const t of tools) {
    body.push(`${t.rank}. ${cleanText(t.name)}：${cleanText(t.description)}`);
    body.push(`   ${cleanText(t.who)}向け／${cleanText(t.pricingLabel)}／${t.domain}`);
  }
  const tail = [
    "",
    // sourceLabel always starts with "Product Hunt …" (see buildMeta).
    `出典: ${cleanText(meta.sourceLabel)}`,
    ...(meta.mode === "ranking" ? [] : [NOT_A_RANKING_NOTE]),
    "料金や仕様は変わることがあるので、公式サイトで確認してください。",
    "気になるツールは保存して、あとで試してみてください。",
    "",
    IG_HASHTAGS.join(" "),
  ];
  let caption = [...head, ...body, ...tail].join("\n");
  if (charLength(caption) > IG_CAPTION_MAX) {
    // Drop the per-tool detail lines first; the list itself is the value.
    const compact = tools.map((t) => `${t.rank}. ${cleanText(t.name)}：${cleanText(t.description)}`);
    caption = [...head, ...compact, ...tail].join("\n");
  }
  return caption;
}

export function buildCaptions(data, hints) {
  // Genre trial #2: Jev episodes carry their own title / hashtags / sources.
  if (data.meta.mode === "jev") return buildJevCaptions(data);
  const template = hints?.recommendedTitleTemplate || "standard";
  const dateFull = data.meta.date.replace(/-/g, "/");
  return {
    date: { full: dateFull, compact: data.meta.date.replace(/-/g, "") },
    youtube: {
      title: buildYouTubeTitle(data.tools, dateFull, template, data.meta.titleTag),
      titleTemplate: template,
      description: buildYouTubeDescription(data),
      tags: buildYouTubeTags(data.tools),
      categoryId: "28", // Science & Technology
    },
    instagram: buildInstagramCaption(data),
  };
}

function loadOptimizationHints() {
  const hintsPath = join(outputDir, "optimization-hints.json");
  if (!existsSync(hintsPath)) return null;
  try {
    return JSON.parse(readFileSync(hintsPath, "utf-8"));
  } catch {
    return null;
  }
}

function main() {
  const data = JSON.parse(readFileSync(join(outputDir, "trending-data.json"), "utf-8"));
  const hints = loadOptimizationHints();
  const captions = buildCaptions(data, hints);

  const outputPath = join(outputDir, "captions.json");
  writeFileSync(outputPath, JSON.stringify(captions, null, 2));
  console.log(`Captions → ${outputPath}`);
  console.log(`  YouTube title (${charLength(captions.youtube.title)} chars): ${captions.youtube.title}`);
  console.log(`  Instagram: ${charLength(captions.instagram)} chars`);
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirectRun) main();
