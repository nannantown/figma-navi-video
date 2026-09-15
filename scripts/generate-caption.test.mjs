import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildYouTubeTitle,
  buildYouTubeTags,
  buildInstagramCaption,
  buildYouTubeDescription,
  buildCaptions,
  cleanText,
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
  phUrl: `https://www.producthunt.com/products/tool-${rank}`,
  narration: "x",
});

const rankingMeta = {
  date: "2026-09-15",
  shortDate: "9/15",
  mode: "ranking",
  count: 5,
  headline: "新作AIツール TOP5",
  titleTag: "新作AIツールTOP5",
  sourceLabel: "Product Hunt 9/13 ランキングの AI ツール上位5本",
};

const pickupMeta = (count) => ({
  date: "2026-09-15",
  shortDate: "9/15",
  mode: "pickup",
  count,
  headline: `新作AIツール ${count}選`,
  titleTag: `新作AIツール${count}選`,
  sourceLabel: "Product Hunt の直近48時間の新着から厳選",
});

const data = (names, meta = rankingMeta) => ({ meta, tools: names.map((n, i) => baseTool(i + 1, n)) });

test("title lists up to three tool names when it fits", () => {
  const title = buildYouTubeTitle(data(["Resurf", "Visiby", "Clipwise", "SWE-2", "Epilude"]).tools, "2026/09/15", "standard", "新作AIツール5選");
  assert.equal(title, "【新作AIツール5選】Resurf・Visiby・Clipwise ほか｜2026/09/15 #Shorts");
  // Without a tag the fallback never claims a ranking (owner decision 2026-09-15).
  const fallback = buildYouTubeTitle(data(["Resurf", "Visiby", "Clipwise"]).tools, "2026/09/15");
  assert.match(fallback, /^【新作AIツール】Resurf/);
  assert.doesNotMatch(fallback, /TOP|トップ/);
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

test("pickup mode never says TOP / トップ / ランキング in any caption", () => {
  const captions = buildCaptions(data(["Juggler", "Oats", "Slashy"], pickupMeta(3)), { recommendedTitleTemplate: "emoji" });
  assert.equal(captions.youtube.title, "新作AIツール3選｜Juggler・Oats・Slashy｜2026/09/15 #Shorts");
  for (const text of [captions.youtube.title, captions.youtube.description, captions.instagram]) {
    assert.ok(!/TOP|トップ|ランキング/.test(text), text);
  }
  assert.match(captions.instagram, /^新作AIツール 3選（9\/15）/);
});

test("YouTube description links every tool to Product Hunt; Instagram keeps a plain attribution", () => {
  const d = data(["Resurf", "Visiby", "C", "D", "E"]);
  const { youtube, instagram } = buildCaptions(d, null);
  for (const t of d.tools) {
    assert.ok(youtube.description.includes(`Product Hunt: ${t.phUrl}`), t.name);
    assert.ok(youtube.description.includes(`公式サイト: ${t.website}`), t.name);
  }
  assert.match(youtube.description, /出典: Product Hunt https:\/\/www\.producthunt\.com\//);
  assert.match(instagram, /出典: Product Hunt 9\/13 ランキングの AI ツール上位5本/);
  assert.ok(!/https?:\/\//.test(instagram), "IG captions carry no links");
});

test("Instagram caption has at most 5 hashtags and lists all tools", () => {
  const caption = buildInstagramCaption(data(["A", "B", "C", "D", "E"]));
  const tags = caption.match(/#\S+/g) || [];
  assert.ok(tags.length <= 5, `got ${tags.length} hashtags`);
  assert.deepEqual(tags, IG_HASHTAGS);
  for (const n of ["A", "B", "C", "D", "E"]) assert.match(caption, new RegExp(`\\d\\. ${n}：`));
  assert.match(caption, /保存/);
});

test("captions drop control and invisible characters even if a value slipped through", () => {
  assert.equal(cleanText("Tool\u{200B}One\nNext\u{202E}"), "ToolOne Next");
  const d = data(["Bad\u{200B}Name", "B", "C", "D", "E"]);
  d.tools[0].description = "一行目\n二行目";
  const { youtube, instagram } = buildCaptions(d, null);
  assert.ok(youtube.title.includes("BadName"));
  assert.ok(instagram.includes("1. BadName：一行目 二行目"));
});

test("YouTube tags stay under the API budget and include tool names", () => {
  const tags = buildYouTubeTags(data(["Resurf", "Visiby", "C", "D", "E"]).tools);
  assert.ok(tags.includes("Resurf"));
  assert.ok(tags.join(",").length <= 500);
});

test("YouTube description drops < > and stays within 5000 bytes", () => {
  const d = data(["<A>", "B", "C", "D", "E"]);
  d.tools[0].description = "あ".repeat(3000);
  const captions = buildCaptions(d, null);
  assert.ok(!/[<>]/.test(captions.youtube.description));
  assert.ok(Buffer.byteLength(captions.youtube.description, "utf-8") <= 5000);
});

test("a tight description budget drops optional lines first and always keeps Product Hunt links and attribution", () => {
  const d = data(["Resurf", "Visiby", "Clipwise", "SWE-2", "Epilude"]);
  for (const t of d.tools) t.website = `https://tool.example.com/${"a".repeat(180)}`;
  const full = buildYouTubeDescription(d);
  const budget = Buffer.byteLength(full, "utf-8") - 200;
  const packed = buildYouTubeDescription(d, { maxBytes: budget });
  assert.ok(Buffer.byteLength(packed, "utf-8") <= budget);
  for (const t of d.tools) assert.ok(packed.includes(`Product Hunt: ${t.phUrl}`), t.name);
  assert.match(packed, /出典: Product Hunt https:\/\/www\.producthunt\.com\//);
  assert.ok(!packed.includes("毎朝、使える新作AIツール"), "CTA lines go first");

  // Even an absurdly small budget keeps the attribution block.
  const tiny = buildYouTubeDescription(d, { maxBytes: 400 });
  assert.ok(Buffer.byteLength(tiny, "utf-8") <= 400);
  assert.match(tiny, /出典: Product Hunt https:\/\/www\.producthunt\.com\//);
});

test("buildCaptions uses the hinted template and category 28", () => {
  const captions = buildCaptions(data(["A", "B", "C", "D", "E"]), { recommendedTitleTemplate: "highlight" });
  assert.equal(captions.youtube.titleTemplate, "highlight");
  assert.equal(captions.youtube.categoryId, "28");
  assert.match(captions.youtube.title, /^A・B・C ほか 新作AIツールTOP5｜/);
  assert.match(captions.youtube.description, /1\. A｜会議メモを自動で要約/);
});
