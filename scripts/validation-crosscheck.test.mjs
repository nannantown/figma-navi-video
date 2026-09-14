import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEnriched, textSafetyProblems, hasRankingWords, skipSnapshotCheck } from "./enriched-schema.mjs";
import { expectedRankingDate } from "./pacific-time.mjs";

const FRESH = "2026-09-13T00:01:00-07:00";
const STALE = "2026-09-10T00:01:00-07:00";

function tool(rank, overrides = {}) {
  return {
    rank,
    ph_rank: rank + 1,
    name: `Tool ${rank}`,
    ph_url: `https://www.producthunt.com/posts/tool-${rank}`,
    ph_published_at: FRESH,
    website: `https://tool${rank}.example.com/`,
    description: "会議メモを自動で要約する",
    who: "会社員・PM",
    pricing: "freemium",
    narration: "会議の要点を自動でまとめるAIツールです。議事録づくりの時間がほぼゼロになります。",
    image_url: null,
    ...overrides,
  };
}

const ranking = (overrides = {}) => ({
  date: "2026-09-15",
  genre: "ai-tools-top5",
  trial: 1,
  source: { mode: "ranking", ph_date: "2026-09-13" },
  discovery: { method: "rank-pure", sources: ["https://api.producthunt.com/v2/api/graphql"] },
  tools: [1, 2, 3, 4, 5].map((r) => tool(r)),
  ...overrides,
});

const pickup = (toolOverrides = {}, count = 3) => ({
  date: "2026-09-15",
  genre: "ai-tools-top5",
  trial: 1,
  source: { mode: "pickup" },
  discovery: { method: "non-engineer", sources: ["https://www.producthunt.com/feed?category=artificial-intelligence"] },
  tools: Array.from({ length: count }, (_, i) => tool(i + 1, { ph_rank: undefined, ...toolOverrides })),
});

const skipDay = (freshCandidates = 1) => ({
  date: "2026-09-15",
  genre: "ai-tools-top5",
  trial: 1,
  skip: { reason: "新作の候補が1本のため休止", fresh_candidates: freshCandidates },
});

const feedPost = (id, overrides = {}) => ({ id: String(id), name: `P${id}`, isAI: true, inAiCategory: true, publishedAt: FRESH, phUrl: `https://www.producthunt.com/products/p${id}`, ...overrides });

const snapshotFor = (videoDate, posts, extra = {}) => ({ schemaVersion: 2, forVideoDate: videoDate, source: "feed", days: [{ date: "2026-09-14", status: "feed", source: "feed", posts }], ...extra });

const run = (data, snapshot) => validateEnriched(data, { today: "2026-09-15", snapshot });

// --- Must 1: skip days are cross-checked against the snapshot ----------------

test("skip is rejected when the snapshot for the same video date has >= 2 new AI launches", () => {
  const snapshot = snapshotFor("2026-09-15", [feedPost(1), feedPost(2), feedPost(3, { isAI: false, inAiCategory: false })]);
  const { errors } = run(skipDay(), snapshot);
  assert.match(errors.join("\n"), /skip is not allowed: the Product Hunt snapshot for 2026-09-15 lists 2 new AI launches/);
});

test("freshness is recomputed from publishedAt, not trusted from the snapshot flags", () => {
  const snapshot = snapshotFor("2026-09-15", [feedPost(1, { fresh: false }), feedPost(2, { fresh: false })]);
  assert.equal(skipSnapshotCheck(snapshot, "2026-09-15").freshAi, 2);
  const stale = snapshotFor("2026-09-15", [feedPost(1, { publishedAt: STALE, fresh: true }), feedPost(2, { publishedAt: STALE, fresh: true })]);
  assert.equal(skipSnapshotCheck(stale, "2026-09-15").status, "consistent");
});

test("skip with only one new AI launch in the snapshot passes without warnings about the cross-check", () => {
  const snapshot = snapshotFor("2026-09-15", [feedPost(1), feedPost(2, { publishedAt: STALE })]);
  const { errors, warnings } = run(skipDay(), snapshot);
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((w) => /cross-checked/.test(w)));
});

test("skip without a snapshot (or with another day's) passes but warns", () => {
  const none = run(skipDay(), null);
  assert.deepEqual(none.errors, []);
  assert.match(none.warnings.join("\n"), /skip could not be cross-checked against the snapshot: no Product Hunt snapshot/);
  const other = run(skipDay(), snapshotFor("2026-09-14", [feedPost(1), feedPost(2)]));
  assert.deepEqual(other.errors, []);
  assert.match(other.warnings.join("\n"), /snapshot is for 2026-09-14, not 2026-09-15/);
});

// --- Must 2: ranking mode cannot invent ranks ----------------------------------

test("ranking ph_date must be the last closed Pacific day for the video date", () => {
  assert.equal(expectedRankingDate("2026-09-15"), "2026-09-13");
  assert.equal(expectedRankingDate("2026-12-15"), "2026-12-13");
  const wrong = ranking({ source: { mode: "ranking", ph_date: "2020-01-01" } });
  assert.match(run(wrong, null).errors.join("\n"), /source\.ph_date 2020-01-01 must be 2026-09-13/);
});

test("ranking ph_rank must be integers >= 1, unique and ascending", () => {
  const allOne = ranking({ tools: [1, 2, 3, 4, 5].map((r) => tool(r, { ph_rank: 1 })) });
  assert.match(run(allOne, null).errors.join("\n"), /must not repeat/);
  const descending = ranking({ tools: [5, 4, 3, 2, 1].map((pr, i) => tool(i + 1, { ph_rank: pr })) });
  assert.match(run(descending, null).errors.join("\n"), /strictly ascending/);
  const zero = ranking({ tools: [tool(1, { ph_rank: 0 }), tool(2), tool(3), tool(4), tool(5)] });
  assert.match(run(zero, null).errors.join("\n"), /integer >= 1/);
});

test("ranking ranks and URLs must match the API snapshot for that day when it exists", () => {
  const apiDay = {
    date: "2026-09-13",
    status: "final",
    source: "api",
    posts: [2, 3, 4, 5, 6].map((r) => ({ id: String(r), dailyRank: r, phUrl: `https://www.producthunt.com/posts/tool-${r - 1}`, isAI: true, publishedAt: FRESH })),
  };
  const snapshot = { schemaVersion: 2, forVideoDate: "2026-09-15", source: "api", days: [apiDay] };
  assert.deepEqual(run(ranking(), snapshot).errors, []);

  const wrongUrl = ranking({ tools: [tool(1, { ph_url: "https://www.producthunt.com/posts/someone-else" }), tool(2), tool(3), tool(4), tool(5)] });
  assert.match(run(wrongUrl, snapshot).errors.join("\n"), /ph_rank 2 is https:\/\/www\.producthunt\.com\/posts\/tool-1 in the snapshot/);

  const inventedRank = ranking({ tools: [tool(1), tool(2), tool(3), tool(4), tool(5, { ph_rank: 40 })] });
  assert.match(run(inventedRank, snapshot).errors.join("\n"), /ph_rank 40 is not in the Product Hunt 2026-09-13 ranking snapshot/);

  assert.match(run(ranking(), null).warnings.join("\n"), /ranking could not be cross-checked/);
});

// --- Recommended 3: ranking vocabulary after NFKC ------------------------------

test("pickup ranking vocabulary is caught in full-width, half-width, English and kanji forms, names included", () => {
  for (const phrase of ["ＴＯＰ５の注目ツール", "Top-5 の新作", "上位5本から厳選", "ﾄｯﾌﾟ5を紹介", "ベスト5の新作", "業界No.1の要約AI", "一位のツール", "首位を独走", "第３位"]) {
    assert.equal(hasRankingWords(phrase), true, phrase);
  }
  for (const phrase of ["上位プランは有料", "トップページから試せる", "No limits で使える", "v2.10対応"]) {
    assert.equal(hasRankingWords(phrase), false, phrase);
  }
  assert.match(run(pickup({ description: "ＴＯＰ５の要約ツール" }), null).errors.join("\n"), /description uses ranking words/);
  const namedTop = pickup();
  namedTop.tools[0].name = "Top5 Notes";
  assert.match(run(namedTop, null).errors.join("\n"), /tools\[0\]\.name uses ranking words/);
});

// --- Recommended 4: domains, full-width URLs, defanged dots ---------------------

test("domains of any TLD, full-width URLs and defanged dots are rejected in text fields", () => {
  for (const value of ["詳細は evil.shop で", "ｗｗｗ．evil．com へ", "https：／／evil.com", "evil[.]com を見て", "evil(dot)com を見て", "Node.js で動く"]) {
    assert.ok(textSafetyProblems(value).length > 0, value);
  }
  for (const value of ["v2.10対応の要約AI", "1.5GBまで無料", "3.5倍速く書ける", "Ph.D 取得者向け"]) {
    assert.deepEqual(textSafetyProblems(value), [], value);
  }
  // Product names keep their dots, never schemes or defanged forms.
  assert.deepEqual(textSafetyProblems("Node.js", { allowDomains: true }), []);
  assert.deepEqual(textSafetyProblems("X.ai", { allowDomains: true }), []);
  assert.ok(textSafetyProblems("ｗｗｗ．evil．com", { allowDomains: true }).length > 0);
  assert.ok(textSafetyProblems("evil[.]com", { allowDomains: true }).length > 0);

  const data = pickup();
  data.tools[0].description = "詳細は evil.shop へ";
  data.tools[1].who = "ｗｗｗ．evil．com の人";
  data.tools[2].narration = "evil[.]com から使えるAIツールです。議事録づくりの時間がほぼゼロになります。";
  const errors = run(data, null).errors.join("\n");
  assert.match(errors, /tools\[0\]\.description contains a domain name/);
  assert.match(errors, /tools\[1\]\.who contains a URL/);
  assert.match(errors, /tools\[2\]\.narration contains a defanged domain/);
});

// --- Recommended 6: website length --------------------------------------------

test("website is limited to 200 characters", () => {
  const long = pickup({ website: `https://tool.example.com/${"a".repeat(200)}` });
  assert.match(run(long, null).errors.join("\n"), /website: \d+ chars \(allowed up to 200\)/);
});
