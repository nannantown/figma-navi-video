/**
 * Transform enriched design news into narration-ready data.
 * Input:  data/enriched-design-news.json (written by Claude Routine)
 * Output: output/trending-data.json
 *
 * Figma Navi runs news-first, so this script expects Claude-enriched
 * content to exist for today. No scraper fallback.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const enrichedPath = join(rootDir, "data", "enriched-design-news.json");

function todayJST() {
  const d = new Date();
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}`;
}

function loadEnrichedData() {
  if (!existsSync(enrichedPath)) {
    throw new Error(
      `enriched-design-news.json not found at ${enrichedPath}. Claude Routine must produce this file before the pipeline runs.`
    );
  }
  const enriched = JSON.parse(readFileSync(enrichedPath, "utf-8"));
  const today = todayJST();
  if (enriched.date !== today) {
    throw new Error(
      `enriched.date (${enriched.date}) does not match today JST (${today}). Routine may have failed or skipped.`
    );
  }
  return enriched;
}

function generateSections(article) {
  const ns = article.narration_sections || {};
  const st = article.section_titles || {};
  const sd = article.section_descriptions || {};

  const sections = [
    {
      key: "hook",
      name: st.hook || article.title,
      description: sd.hook || article.description,
      detail: "",
      narration: ns.hook || `${article.title}。${article.description}`,
    },
    {
      key: "origin",
      name: st.origin || "詳しく",
      description: sd.origin || article.description,
      detail: article.detail || "",
      narration: ns.origin || article.detail || "",
    },
    {
      key: "recommend",
      name: st.recommend || "おすすめ",
      description: sd.recommend || "今日試してみよう",
      detail: article.tags ? `キーワード: ${article.tags.join("、")}` : "",
      narration:
        ns.recommend ||
        (article.tags
          ? `キーワードは、${article.tags.join("、")}。ぜひチェックしてみてください。`
          : `ぜひチェックしてみてください。`),
    },
  ];
  return sections;
}

async function main() {
  const enriched = loadEnrichedData();
  const article = enriched.articles?.[0];
  if (!article) {
    throw new Error("enriched-design-news.json has no articles[0]");
  }

  console.log(`  Topic: ${article.title}`);
  if (enriched.discovery) {
    console.log(`  Discovery: ${enriched.discovery.method} — ${enriched.discovery.description || ""}`);
  }

  const sections = generateSections(article);
  const projects = sections.map((s, i) => ({
    rank: i + 1,
    name: s.name,
    fullName: article.source || "Figma Navi",
    description: s.description,
    detail: s.detail,
    narration: s.narration,
    category: article.category || "design",
    url: article.link || article.url || "",
  }));

  const data = {
    // No openingNarration: brand-intro title calls hurt IG Reels retention.
    // Video opens straight into the hook.
    endingNarration:
      "以上、今日のデザインニュースでした。フォローといいねで、毎日の情報をチェックしましょう。",
    projects,
    topicTitle: article.title,
  };

  const outputPath = join(outputDir, "trending-data.json");
  writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`\nGenerated ${projects.length} sections → ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
