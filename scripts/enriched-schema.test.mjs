import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEnriched,
  toVideoTools,
  buildMeta,
  countSentences,
  charLength,
  displayDomain,
  parseEnrichedText,
  todayJst,
  PRICING_LABELS,
} from "./enriched-schema.mjs";

function tool(rank, overrides = {}) {
  return {
    rank,
    ph_rank: rank + 1,
    name: `Tool ${rank}`,
    ph_url: `https://www.producthunt.com/products/tool-${rank}`,
    website: `https://tool${rank}.example.com/`,
    tagline_en: "An AI helper",
    description: "会議メモを自動で要約する",
    who: "会社員・PM",
    pricing: "freemium",
    narration: "会議の要点を自動でまとめるAIツールです。議事録づくりの時間がほぼゼロになります。",
    image_url: null,
    ...overrides,
  };
}

function valid(overrides = {}) {
  return {
    date: "2026-09-15",
    genre: "ai-tools-top5",
    trial: 1,
    source: { mode: "ranking", ph_date: "2026-09-13", snapshot_fetched_at: "2026-09-14T09:31:00Z" },
    discovery: { method: "rank-pure", description: "dailyRank 順", sources: ["https://www.producthunt.com/leaderboard/daily/2026/9/13"] },
    tools: [1, 2, 3, 4, 5].map((r) => tool(r)),
    ...overrides,
  };
}

test("a well-formed routine file passes with the date check", () => {
  const { errors } = validateEnriched(valid(), { today: "2026-09-15" });
  assert.deepEqual(errors, []);
});

test("stale date is an error unless the date check is off", () => {
  assert.match(validateEnriched(valid(), { today: "2026-09-16" }).errors.join("\n"), /does not match today/);
  assert.deepEqual(validateEnriched(valid(), { today: "2026-09-16", checkDate: false }).errors, []);
});

test("exactly five tools in video order are required", () => {
  const four = valid({ tools: [1, 2, 3, 4].map((r) => tool(r)) });
  assert.match(validateEnriched(four, { today: "2026-09-15" }).errors.join("\n"), /exactly 5/);
  const swapped = valid({ tools: [tool(2), tool(1), tool(3), tool(4), tool(5)] });
  assert.match(validateEnriched(swapped, { today: "2026-09-15" }).errors.join("\n"), /rank must be 1/);
});

test("ranking mode needs ph_date and ph_rank; pickup mode does not", () => {
  const noRank = valid({ tools: [1, 2, 3, 4, 5].map((r) => tool(r, { ph_rank: undefined })) });
  assert.match(validateEnriched(noRank, { today: "2026-09-15" }).errors.join("\n"), /ph_rank/);
  const pickup = valid({ source: { mode: "pickup" }, tools: noRank.tools });
  assert.deepEqual(validateEnriched(pickup, { today: "2026-09-15" }).errors, []);
});

test("pricing must be an allowed enum and URLs must be https", () => {
  const bad = valid({
    tools: [tool(1, { pricing: "cheap", website: "http://insecure.example.com", ph_url: "https://example.com/p" }), tool(2), tool(3), tool(4), tool(5)],
  });
  const errors = validateEnriched(bad, { today: "2026-09-15" }).errors.join("\n");
  assert.match(errors, /pricing must be one of/);
  assert.match(errors, /website must be/);
  assert.match(errors, /ph_url must be/);
});

test("narration length is enforced per tool and in total, sentence count is a warning", () => {
  const long = "あ".repeat(66) + "。";
  const tooLong = valid({ tools: [tool(1, { narration: long }), tool(2), tool(3), tool(4), tool(5)] });
  assert.match(validateEnriched(tooLong, { today: "2026-09-15" }).errors.join("\n"), /narration: 67 chars/);

  const three = "AIで要約します。速いです。無料です。";
  const res = validateEnriched(valid({ tools: [tool(1, { narration: three + "とても便利なのでおすすめできるツールです。" }), tool(2), tool(3), tool(4), tool(5)] }), { today: "2026-09-15" });
  assert.match(res.warnings.join("\n"), /4 sentences/);
});

test("Product Hunt redirect as website and template placeholders are rejected", () => {
  const redirect = valid({ tools: [tool(1, { website: "https://www.producthunt.com/r/p/1247901?app_id=339" }), tool(2), tool(3), tool(4), tool(5)] });
  assert.match(validateEnriched(redirect, { today: "2026-09-15" }).errors.join("\n"), /website is a Product Hunt URL/);
  const placeholder = valid({ tools: [tool(1, { pricing_note: "任意", who: "誰向け" }), tool(2), tool(3), tool(4), tool(5)] });
  const errors = validateEnriched(placeholder, { today: "2026-09-15" }).errors.join("\n");
  assert.match(errors, /pricing_note still has the template placeholder/);
  assert.match(errors, /who still has the template placeholder/);
});

test("duplicate tool names are rejected", () => {
  const dup = valid({ tools: [tool(1), tool(2, { name: "tool 1" }), tool(3), tool(4), tool(5)] });
  assert.match(validateEnriched(dup, { today: "2026-09-15" }).errors.join("\n"), /duplicated/);
});

test("toVideoTools fills display fields; pricing_note overrides the label", () => {
  const data = valid({ tools: [tool(1, { pricing_note: "月$12〜" }), tool(2), tool(3), tool(4), tool(5)] });
  const [first, second] = toVideoTools(data);
  assert.equal(first.pricingLabel, "月$12〜");
  assert.equal(second.pricingLabel, PRICING_LABELS.freemium);
  assert.equal(first.domain, "tool1.example.com");
  assert.equal(first.slug, "tool-1");
  assert.equal(first.phRank, 2);
});

test("buildMeta labels ranking vs pickup sources", () => {
  assert.equal(buildMeta(valid()).sourceLabel, "Product Hunt 9/13 ランキングより");
  assert.equal(buildMeta(valid()).dateLabel, "2026.09.15 (火)");
  assert.equal(buildMeta(valid({ source: { mode: "pickup" } })).sourceLabel, "Product Hunt の新着から厳選");
});

test("helpers", () => {
  assert.equal(countSentences("フック文です。要点です。"), 2);
  assert.equal(countSentences("末尾に句点がない"), 1);
  assert.equal(charLength("🎉ab"), 3);
  assert.equal(displayDomain("https://www.resurf.app/pricing"), "resurf.app");
  assert.equal(todayJst(new Date("2026-09-14T15:00:00Z")), "2026-09-15");
});

test("parseEnrichedText repairs unescaped quotes and reports it", () => {
  const { data, repaired } = parseEnrichedText('{"a": "He said "hi" ok"}');
  assert.equal(repaired, true);
  assert.equal(data.a, 'He said "hi" ok');
});
