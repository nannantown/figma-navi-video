import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildYouTubeTitle,
  buildYouTubeTags,
  buildInstagramCaption,
  buildCaptions,
  YT_TITLE_MAX,
  IG_HASHTAGS,
} from "./generate-caption.mjs";
import { charLength } from "./enriched-schema.mjs";

const baseTool = (rank, name) => ({
  rank,
  name,
  description: "会議メモを自動で要約",
  who: "会社員・PM",
  pricing: "freemium",
  pricingLabel: "無料プランあり",
  website: `https://tool${rank}.example.com`,
  domain: `tool${rank}.example.com`,
  narration: "x",
});

const data = (names) => ({
  meta: { date: "2026-09-15", shortDate: "9/15", sourceLabel: "Product Hunt 9/13 ランキングより", mode: "ranking" },
  tools: names.map((n, i) => baseTool(i + 1, n)),
});

test("title lists up to three tool names when it fits", () => {
  const title = buildYouTubeTitle(data(["Resurf", "Visiby", "Clipwise", "SWE-2", "Epilude"]).tools, "2026/09/15");
  assert.equal(title, "【新作AIツールTOP5】Resurf・Visiby・Clipwise ほか｜2026/09/15 #Shorts");
});

test("title never exceeds 100 characters (the 2026-09-14 YouTube failure)", () => {
  const long = "Extremely Long Product Name For An Agentic Workflow Automation Platform";
  for (const template of ["standard", "highlight", "emoji"]) {
    const title = buildYouTubeTitle(data([long, long + " 2", long + " 3", "d", "e"]).tools, "2026/09/15", template);
    assert.ok(charLength(title) <= YT_TITLE_MAX, `${template}: ${charLength(title)} chars`);
    assert.match(title, /#Shorts$/);
  }
  const single = buildYouTubeTitle(data(["あ".repeat(150), "b", "c", "d", "e"]).tools, "2026/09/15");
  assert.ok(charLength(single) <= YT_TITLE_MAX);
  assert.match(single, /…/);
});

test("title strips < and > which YouTube rejects", () => {
  const title = buildYouTubeTitle(data(["<Script> AI", "b", "c", "d", "e"]).tools, "2026/09/15");
  assert.ok(!/[<>]/.test(title));
});

test("Instagram caption has at most 5 hashtags and lists all tools", () => {
  const caption = buildInstagramCaption(data(["A", "B", "C", "D", "E"]));
  const tags = caption.match(/#\S+/g) || [];
  assert.ok(tags.length <= 5, `got ${tags.length} hashtags`);
  assert.deepEqual(tags, IG_HASHTAGS);
  for (const n of ["A", "B", "C", "D", "E"]) assert.match(caption, new RegExp(`\\d\\. ${n}：`));
  assert.match(caption, /保存/);
});

test("YouTube tags stay under the API budget and include tool names", () => {
  const tags = buildYouTubeTags(data(["Resurf", "Visiby", "C", "D", "E"]).tools);
  assert.ok(tags.includes("Resurf"));
  assert.ok(tags.join(",").length <= 500);
});

test("buildCaptions uses the hinted template and category 28", () => {
  const captions = buildCaptions(data(["A", "B", "C", "D", "E"]), { recommendedTitleTemplate: "highlight" });
  assert.equal(captions.youtube.titleTemplate, "highlight");
  assert.equal(captions.youtube.categoryId, "28");
  assert.match(captions.youtube.description, /1\. A｜会議メモを自動で要約/);
  assert.match(captions.youtube.description, /出典: Product Hunt/);
});
