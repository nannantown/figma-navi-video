import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEnriched, textSafetyProblems, hasRankingWords, skipSnapshotCheck, officialWebsiteProblems } from "./enriched-schema.mjs";
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

const feedPost = (id, overrides = {}) => ({ id: String(id), name: `Tool ${id}`, isAI: true, inAiCategory: true, publishedAt: FRESH, phUrl: `https://www.producthunt.com/products/p${id}`, ...overrides });

const snapshotFor = (videoDate, posts, extra = {}) => ({ schemaVersion: 2, forVideoDate: videoDate, source: "feed", days: [{ date: "2026-09-14", status: "feed", source: "feed", posts }], ...extra });

// Ranking mode is off by default (owner decision 2026-09-15); the legacy ranking tests opt in.
const run = (data, snapshot, opts = {}) => validateEnriched(data, { today: "2026-09-15", snapshot, allowRanking: true, ...opts });

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

const apiRankingDay = (overrides = {}) => ({
  date: "2026-09-13",
  status: "final",
  source: "api",
  posts: [2, 3, 4, 5, 6].map((r) => ({ id: String(r), dailyRank: r, phUrl: `https://www.producthunt.com/posts/tool-${r - 1}`, isAI: true, publishedAt: FRESH })),
  ...overrides,
});

test("ranking ranks and URLs must match the final API ranking in the snapshot for the video date", () => {
  const snapshot = { schemaVersion: 2, forVideoDate: "2026-09-15", source: "api", days: [apiRankingDay()] };
  assert.deepEqual(run(ranking(), snapshot).errors, []);

  const wrongUrl = ranking({ tools: [tool(1, { ph_url: "https://www.producthunt.com/posts/someone-else" }), tool(2), tool(3), tool(4), tool(5)] });
  assert.match(run(wrongUrl, snapshot).errors.join("\n"), /ph_rank 2 is https:\/\/www\.producthunt\.com\/posts\/tool-1 in the snapshot/);

  const inventedRank = ranking({ tools: [tool(1), tool(2), tool(3), tool(4), tool(5, { ph_rank: 40 })] });
  assert.match(run(inventedRank, snapshot).errors.join("\n"), /ph_rank 40 is not in the Product Hunt 2026-09-13 ranking snapshot/);

  const staleLaunch = { ...snapshot, days: [apiRankingDay({ posts: apiRankingDay().posts.map((p) => ({ ...p, publishedAt: p.dailyRank === 2 ? STALE : FRESH })) })] };
  assert.match(run(ranking(), staleLaunch).errors.join("\n"), /tools\[0\] was published 2026-09-10T00:01:00-07:00 per the snapshot/);
});

test("ranking mode is refused without a final API ranking for the video date (no invented ranks)", () => {
  assert.match(run(ranking(), null).errors.join("\n"), /ranking mode needs the final Product Hunt API ranking .* there is no Product Hunt snapshot/);

  const feedOnly = snapshotFor("2026-09-15", [feedPost(1), feedPost(2)]);
  feedOnly.days[0].date = "2026-09-13";
  assert.match(run(ranking(), feedOnly).errors.join("\n"), /has no final API ranking for 2026-09-13/);

  // Yesterday's snapshot whose in-progress day happens to be ph_date: provisional ranks are not accepted.
  const stale = { schemaVersion: 2, forVideoDate: "2026-09-14", source: "api", days: [apiRankingDay({ status: "in_progress" })] };
  assert.match(run(ranking(), stale).errors.join("\n"), /the snapshot is for 2026-09-14/);

  const provisional = { schemaVersion: 2, forVideoDate: "2026-09-15", source: "api", days: [apiRankingDay({ status: "in_progress" })] };
  assert.match(run(ranking(), provisional).errors.join("\n"), /has no final API ranking for 2026-09-13/);
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
  for (const value of ["詳細は evil.shop で", "ｗｗｗ．evil．com へ", "https：／／evil.com", "evil[.]com を見て", "evil(dot)com を見て", "evil.py で動く"]) {
    assert.ok(textSafetyProblems(value).length > 0, value);
  }
  // Tech names whose suffix is never a real TLD are fine in every field (review 2026-09-16).
  for (const value of ["v2.10対応の要約AI", "1.5GBまで無料", "3.5倍速く書ける", "Ph.D 取得者向け", "Node.js で動く", "Next.jsのアプリを速くする", "ASP.NET開発者"]) {
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

// --- Review round 2: pickup cross-check, bypasses, misfires, limits -----------

test("pickup tools must be in the snapshot for the video date and new per the snapshot's publish time", () => {
  const data = pickup();
  const posts = data.tools.map((t, i) => feedPost(i + 1, { phUrl: t.ph_url }));
  assert.deepEqual(run(data, snapshotFor("2026-09-15", posts)).errors, []);

  const missing = snapshotFor("2026-09-15", posts.slice(0, 2));
  assert.match(run(data, missing).errors.join("\n"), /tools\[2\]\.ph_url https:\/\/www\.producthunt\.com\/posts\/tool-3 is not in the Product Hunt snapshot for 2026-09-15/);

  const oldLaunch = snapshotFor("2026-09-15", posts.map((p, i) => (i === 0 ? { ...p, publishedAt: STALE } : p)));
  assert.match(run(data, oldLaunch).errors.join("\n"), /tools\[0\] was published 2026-09-10T00:01:00-07:00 per the snapshot/);

  const differs = snapshotFor("2026-09-15", posts.map((p) => ({ ...p, publishedAt: "2026-09-13T08:00:00-07:00" })));
  const res = run(data, differs);
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join("\n"), /ph_published_at differs from the snapshot/);

  assert.match(run(data, null).warnings.join("\n"), /pickup tools could not be cross-checked: no Product Hunt snapshot/);
});

test("pickup cross-check and skip check accept launches proven by the feed listing (listedAfter)", () => {
  const CREATED_EARLY = "2026-08-31T04:01:15-07:00"; // post created weeks before its launch
  const LISTED_AFTER = "2026-09-13T21:30:00.000Z"; // 14:30 PDT fetch inside the 2026-09-15 window
  const data = pickup({ ph_published_at: CREATED_EARLY, ph_listed_after: LISTED_AFTER });
  const posts = data.tools.map((t, i) => feedPost(i + 1, { phUrl: t.ph_url, publishedAt: CREATED_EARLY, listedAfter: LISTED_AFTER }));
  const ok = run(data, snapshotFor("2026-09-15", posts));
  assert.deepEqual(ok.errors, []);
  assert.ok(!ok.warnings.some((w) => /differs from the snapshot/.test(w)), ok.warnings.join("\n"));

  // The snapshot never saw a listing inside the window: not a new launch, whatever the routine wrote.
  const unproven = snapshotFor("2026-09-15", posts.map((p, i) => (i === 1 ? { ...p, listedAfter: null } : p)));
  assert.match(run(data, unproven).errors.join("\n"), /tools\[1\] was published 2026-08-31T04:01:15-07:00 per the snapshot — not a new launch/);
  const earlyListing = snapshotFor("2026-09-15", posts.map((p, i) => (i === 2 ? { ...p, listedAfter: "2026-09-12T21:30:00.000Z" } : p)));
  assert.match(
    run(data, earlyListing).errors.join("\n"),
    /tools\[2\] was published 2026-08-31T04:01:15-07:00 and first listed after 2026-09-12T21:30:00.000Z per the snapshot/
  );

  // Omitting ph_listed_after fails the file's own check even when the snapshot proves the launch.
  const res = run(pickup({ ph_published_at: CREATED_EARLY }), snapshotFor("2026-09-15", posts));
  assert.match(res.errors.join("\n"), /is not a new launch for 2026-09-15/); // the file alone does not prove it
  assert.match(res.warnings.join("\n"), /ph_listed_after differs from the snapshot \(2026-09-13T21:30:00.000Z\)/);

  // Skip days count listing-proven launches too.
  const skipSnap = snapshotFor("2026-09-15", [feedPost(1, { publishedAt: CREATED_EARLY, listedAfter: LISTED_AFTER }), feedPost(2, { publishedAt: CREATED_EARLY, listedAfter: LISTED_AFTER })]);
  assert.equal(skipSnapshotCheck(skipSnap, "2026-09-15").freshAi, 2);
  assert.match(run(skipDay(), skipSnap).errors.join("\n"), /skip is not allowed/);
});

test("snapshot posts without ids are still counted separately", () => {
  const snapshot = snapshotFor("2026-09-15", [feedPost(1, { id: "" }), feedPost(2, { id: "" })]);
  assert.equal(skipSnapshotCheck(snapshot, "2026-09-15").freshAi, 2);
  assert.match(run(skipDay(), snapshot).errors.join("\n"), /skip is not allowed/);
});

test("domain bypasses with ideographic dots, non-ASCII labels, spaced or spelled-out dots and IPs are rejected", () => {
  for (const value of ["evil。com で配布", "evil｡com で配布", "お名前.com で取得", "evil dot com を見て", "evil . com を見て", "evil .com を見て", "192.168.0.1 に接続"]) {
    assert.ok(textSafetyProblems(value).length > 0, value);
  }
  // Japanese sentences and tech words stay legal.
  for (const value of ["議事録を自動で作るAIツールです。Slackと連携できます。", "Unity と .NET 向けの開発支援", "Unity .NET 対応", "v2.10対応の要約AI", "1.5GBまで無料"]) {
    assert.deepEqual(textSafetyProblems(value), [], value);
  }
});

test("invisible tag characters, variation selector supplements and interlinear annotations are rejected", () => {
  for (const value of ["見えない\u{E0041}\u{E0042}タグ", "異体字\u{E0100}セレクタ", "注釈\u{FFF9}記号\u{FFFB}", "結合\u{200D}子"]) {
    assert.ok(textSafetyProblems(value).some((p) => /invisible/.test(p)), value);
  }
});

test("dotted tool names are allowed only for tech names or the official site's host", () => {
  assert.deepEqual(textSafetyProblems("Node.js Copilot", { allowDomains: true, allowedHost: "nodecopilot.dev" }), []);
  assert.deepEqual(textSafetyProblems("X.ai Grok", { allowDomains: true, allowedHost: "x.ai" }), []);
  assert.deepEqual(textSafetyProblems("Cal.com", { allowDomains: true, allowedHost: "cal.com" }), []);
  assert.deepEqual(textSafetyProblems("Perplexity.ai", { allowDomains: true, allowedHost: "www.perplexity.ai" }), []);
  assert.deepEqual(textSafetyProblems("ML.NET Assistant", { allowDomains: true, allowedHost: "dotnet.microsoft.com" }), []);
  const spam = textSafetyProblems("Buy at cheap-pills.shop/now", { allowDomains: true, allowedHost: "tool.example.com" });
  assert.match(spam.join("\n"), /not the official site \(cheap-pills\.shop\)/);

  const data = pickup();
  data.tools[0].name = "Deals at cheap-pills.shop";
  assert.match(run(data, null).errors.join("\n"), /tools\[0\]\.name contains a domain that is not the official site/);
});

test("ranking vocabulary: English, ナンバーワン and separators are caught; desktop/laptop/位置/三位一体/No 2FA are not", () => {
  for (const phrase of ["Best 5 AI tools", "best5", "Ranking of the day", "rank 1 on launch", "ナンバーワンの要約AI", "ナンバー1のツール", "トップ・5", "Top\u{2013}5", "Top:5", "今日のトップ５"]) {
    assert.equal(hasRankingWords(phrase), true, phrase);
  }
  for (const phrase of ["デスクトップ3台で同期", "ラップトップ2台に対応", "Laptop 4 GB でも動く", "Stop 3 times", "三位一体の設計", "同一位置に保存", "No 2FA required", "Rank Math 連携"]) {
    assert.equal(hasRankingWords(phrase), false, phrase);
  }
});

test("ph_url is limited to 120 characters", () => {
  const long = pickup({ ph_url: `https://www.producthunt.com/posts/${"a".repeat(100)}` });
  assert.match(run(long, null).errors.join("\n"), /ph_url: \d+ chars \(allowed up to 120\)/);
});

test("a website with a tab or newline cannot smuggle a line into the YouTube description", () => {
  for (const url of [
    "https://resurf.so/\n公式より安い→ https://scam.example",
    "https://resurf.so/\tあとで見る",
    "https://resurf.so/\u200b",
    " https://resurf.so/",
    "https://Resurf.so/Path ",
  ]) {
    assert.ok(officialWebsiteProblems(url).length > 0, url);
  }
  assert.deepEqual(officialWebsiteProblems("https://resurf.so/"), []);
  assert.deepEqual(officialWebsiteProblems("https://resurf.so"), []);
});
