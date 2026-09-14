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
 * Attribution: the YouTube description links every tool to its Product Hunt
 * page (Product Hunt API docs ask for attribution with a link back); Instagram
 * captions cannot hold links, so they keep a plain "出典: Product Hunt".
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

/** Longest title that fits: up to 3 tool names, then fewer, then a truncated first name. */
export function buildYouTubeTitle(tools, dateFull, template = "standard", tag = "新作AIツールTOP5") {
  const names = tools.map((t) => sanitizeTitlePart(t.name)).filter(Boolean);
  const safeTag = sanitizeTitlePart(tag);
  for (let n = Math.min(3, names.length); n >= 1; n--) {
    const list = names.slice(0, n).join("・") + (n < names.length ? " ほか" : "");
    const title = titleFor(template, safeTag, list, dateFull);
    if (charLength(title) <= YT_TITLE_MAX) return title;
  }
  const suffix = names.length > 1 ? " ほか" : "";
  const overhead = charLength(titleFor(template, safeTag, suffix, dateFull));
  const room = Math.max(1, YT_TITLE_MAX - overhead - 1);
  const first = Array.from(names[0] || "AIツール").slice(0, room).join("") + "…";
  return titleFor(template, safeTag, first + suffix, dateFull);
}

export function buildYouTubeTags(tools) {
  const tags = [...YT_BASE_TAGS];
  for (const t of tools) {
    const tag = sanitizeTitlePart(t.name).replace(/[,"]/g, "");
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  const out = [];
  let used = 0;
  for (const tag of tags) {
    const cost = charLength(tag) + 1;
    if (used + cost > YT_TAGS_MAX_CHARS) break;
    out.push(tag);
    used += cost;
  }
  return out;
}

export function buildYouTubeDescription(data) {
  const { meta, tools } = data;
  const lines = [`${meta.date.replace(/-/g, "/")} の${cleanText(meta.headline)}（${cleanText(meta.sourceLabel)}）`, ""];
  for (const t of tools) {
    lines.push(`${t.rank}. ${cleanText(t.name)}｜${cleanText(t.description)}`);
    lines.push(`   誰向け: ${cleanText(t.who)} ／ 料金: ${cleanText(t.pricingLabel)}`);
    lines.push(`   公式サイト: ${t.website}`);
    lines.push(`   Product Hunt: ${t.phUrl}`);
    lines.push("");
  }
  lines.push(`出典: Product Hunt ${PRODUCT_HUNT_HOME}`);
  lines.push("料金や仕様は変わることがあるので、使う前に公式サイトで確認してください。");
  lines.push("毎朝、使える新作AIツールを1分で紹介しています。");
  lines.push("気になるツールは保存して、あとで試してみてください。");
  lines.push("");
  lines.push(YT_DESCRIPTION_HASHTAGS.join(" "));
  // snippet.description: max 5000 bytes, no "<" / ">".
  let description = lines.join("\n").replace(/[<>]/g, "");
  if (Buffer.byteLength(description, "utf-8") > YT_DESCRIPTION_MAX_BYTES) {
    description = Buffer.from(description, "utf-8").subarray(0, YT_DESCRIPTION_MAX_BYTES).toString("utf-8").replace(/\u{FFFD}+$/u, "");
  }
  return description;
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
  console.log(`  Instagram: ${charLength(captions.instagram)} chars, ${IG_HASHTAGS.length} hashtags`);
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
