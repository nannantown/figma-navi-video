/**
 * Platform captions for the AI tools TOP5 video.
 *
 * Input:  output/trending-data.json, output/optimization-hints.json (optional)
 * Output: output/captions.json
 *
 * Hard platform limits enforced here:
 *   - YouTube title ≤ 100 characters and no "<" / ">" — longer titles are
 *     rejected with "invalid or empty video title" (what broke 2026-09-13/14).
 *   - Instagram: ≤ 5 hashtags per Reel, caption ≤ 2,200 characters.
 *
 * 【一次資料】YouTube Data API videos resource: snippet.title max 100 chars, no < >
 *   https://developers.google.com/youtube/v3/docs/videos#snippet.title (2026-09-14)
 *   Instagram @creators 2025-12 announcement: up to 5 hashtags per post/Reel
 *   https://www.instagram.com/p/DSaxmEWkfL4/ ,
 *   https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/
 */

import { readFileSync, writeFileSync, existsSync, realpathSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { charLength } from "./enriched-schema.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "..", "output");

export const YT_TITLE_MAX = 100;
export const IG_CAPTION_MAX = 2200;
export const IG_HASHTAGS = ["#AIツール", "#生成AI", "#業務効率化", "#便利ツール", "#ProductHunt"];
export const YT_DESCRIPTION_HASHTAGS = ["#AIツール", "#生成AI", "#ProductHunt", "#新作AIツール", "#Shorts"];
export const YT_BASE_TAGS = ["AIツール", "生成AI", "ProductHunt", "新作AIツール", "AI活用", "便利ツール", "業務効率化", "Shorts"];
const YT_TAGS_MAX_CHARS = 450; // API limit is 500 incl. separators; keep headroom

export function sanitizeTitlePart(s) {
  return String(s ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

function titleFor(template, list, dateFull) {
  switch (template) {
    case "highlight":
      return `${list} 新作AIツールTOP5｜${dateFull} #Shorts`;
    case "emoji":
      return `AI Tools TOP5｜${list}｜${dateFull} #Shorts`;
    case "standard":
    default:
      return `【新作AIツールTOP5】${list}｜${dateFull} #Shorts`;
  }
}

/** Longest title that fits: up to 3 tool names, then fewer, then a truncated first name. */
export function buildYouTubeTitle(tools, dateFull, template = "standard") {
  const names = tools.map((t) => sanitizeTitlePart(t.name)).filter(Boolean);
  for (let n = Math.min(3, names.length); n >= 1; n--) {
    const list = names.slice(0, n).join("・") + (n < names.length ? " ほか" : "");
    const title = titleFor(template, list, dateFull);
    if (charLength(title) <= YT_TITLE_MAX) return title;
  }
  const suffix = names.length > 1 ? " ほか" : "";
  const overhead = charLength(titleFor(template, suffix, dateFull));
  const room = Math.max(1, YT_TITLE_MAX - overhead - 1);
  const first = Array.from(names[0] || "AIツール").slice(0, room).join("") + "…";
  return titleFor(template, first + suffix, dateFull);
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
  const lines = [`${meta.date.replace(/-/g, "/")} の新作AIツール TOP5（${meta.sourceLabel}）`, ""];
  for (const t of tools) {
    lines.push(`${t.rank}. ${t.name}｜${t.description}`);
    lines.push(`   誰向け: ${t.who} ／ 料金: ${t.pricingLabel}`);
    lines.push(`   ${t.website}`);
    lines.push("");
  }
  lines.push("出典: Product Hunt。料金や仕様は変わることがあるので、使う前に公式サイトで確認してください。");
  lines.push("毎朝、使える新作AIツールを1分で紹介しています。");
  lines.push("気になるツールは保存して、あとで試してみてください。");
  lines.push("");
  lines.push(YT_DESCRIPTION_HASHTAGS.join(" "));
  return lines.join("\n");
}

export function buildInstagramCaption(data) {
  const { meta, tools } = data;
  const head = [`新作AIツール TOP5（${meta.shortDate}）`, ""];
  const body = [];
  for (const t of tools) {
    body.push(`${t.rank}. ${t.name}：${t.description}`);
    body.push(`   ${t.who}向け／${t.pricingLabel}／${t.domain}`);
  }
  const tail = [
    "",
    `${meta.sourceLabel}。料金や仕様は変わることがあるので、公式サイトで確認してください。`,
    "気になるツールは保存して、あとで試してみてください。",
    "",
    IG_HASHTAGS.join(" "),
  ];
  let caption = [...head, ...body, ...tail].join("\n");
  if (charLength(caption) > IG_CAPTION_MAX) {
    // Drop the per-tool detail lines first; the list itself is the value.
    const compact = tools.map((t) => `${t.rank}. ${t.name}：${t.description}`);
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
      title: buildYouTubeTitle(data.tools, dateFull, template),
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
