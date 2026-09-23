import { test } from "node:test";
import assert from "node:assert/strict";
import { toPost, mergePosts } from "./fetch-jev-x.mjs";
import { isOfficialUrl } from "./jev.mjs";

// X snapshot for the Jev routine (owner decision 2026-09-23, option C).

const RAW = {
  id: "2101786156572823624",
  text: "Jev is now available to everyone.",
  author: { screenName: "typesafeai", name: "TypeSafe AI" },
  createdAt: "Sun Sep 20 21:30:43 +0000 2026",
  urls: ["https://console.typesafe.ai"],
  metrics: { views: 10, likes: 2 },
};

test("X posts are reduced to public fields with a stable URL and the JST date", () => {
  const p = toPost(RAW);
  assert.equal(p.url, "https://x.com/typesafeai/status/2101786156572823624");
  assert.equal(p.dateJst, "2026-09-21");
  assert.deepEqual(Object.keys(p).sort(), ["author", "authorName", "createdAt", "dateJst", "id", "isRetweet", "links", "metrics", "quoted", "text", "url"]);
  assert.equal(toPost({ id: "1", author: {} }), null);
  assert.equal(toPost({ ...RAW, createdAt: "not a date" }), null);
});

test("snapshots merge by id, keep the newest reading and drop posts past the keep window", () => {
  const p = toPost(RAW);
  const old = { ...p, id: "1", createdAt: "2026-08-01T00:00:00.000Z" };
  const merged = mergePosts([old, { ...p, text: "old reading" }], [p], { now: new Date("2026-09-23T00:00:00Z") });
  assert.deepEqual(merged.map((x) => x.id), [p.id]);
  assert.equal(merged[0].text, p.text);
});

test("the company's and the CEO's X accounts count as official; others do not", () => {
  assert.ok(isOfficialUrl("https://x.com/typesafeai/status/1"));
  assert.ok(isOfficialUrl("https://x.com/CompleteSkeptic/status/1"));
  assert.ok(!isOfficialUrl("https://x.com/olearycrew/status/1"));
});

test("a community post is attributed by naming its author", async () => {
  const { unattributedClaims } = await import("./jev.mjs");
  assert.deepEqual(unattributedClaims("olearycrewさんの投稿によると、10倍速くなったそうです。"), []);
  assert.equal(unattributedClaims("ある投稿によると、10倍速くなったそうです。").length, 1);
});
