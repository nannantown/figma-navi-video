import { test } from "node:test";
import assert from "node:assert/strict";
import { toPost, mergePosts, twitterError } from "./fetch-jev-x.mjs";
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

test("a failed query records twitter-cli's JSON error (stdout), not its WARNING line, and never the session values", () => {
  const env = { TWITTER_AUTH_TOKEN: "a1b2c3d4e5f6a7b8c9d0", TWITTER_CT0: "ffeeddccbbaa99887766" };
  // --json: the error is JSON on stdout; stderr only has log lines.
  const ci = {
    stdout: JSON.stringify({ ok: false, schema_version: "1", error: { code: "api_error", message: "Twitter API error 404: https://x.com/i/api/graphql/abc/SearchTimeline" } }),
    stderr: "WARNING twitter_cli.client: Failed to init ClientTransaction: 'NoneType' object has no attribute 'group'\n",
    message: "Command failed: twitter search ...",
  };
  assert.equal(twitterError(ci, env), "api_error: Twitter API error 404: https://x.com/i/api/graphql/abc/SearchTimeline");
  // No JSON: the first stderr line that is not a WARNING.
  assert.equal(twitterError({ stdout: "", stderr: "WARNING noise\nError: rate limited (429)\n" }, env), "Error: rate limited (429)");
  // Session values are masked wherever they would appear.
  const leaky = { stdout: JSON.stringify({ ok: false, error: { message: `bad cookie auth_token=${env.TWITTER_AUTH_TOKEN}; ct0=${env.TWITTER_CT0}` } }) };
  const msg = twitterError(leaky, env);
  assert.ok(!msg.includes(env.TWITTER_AUTH_TOKEN) && !msg.includes(env.TWITTER_CT0), msg);
  assert.ok(!twitterError({ stderr: `Error: ${env.TWITTER_CT0} rejected` }, env).includes(env.TWITTER_CT0));
  assert.ok(!twitterError({ stderr: "Error: cookie auth_token=zzz999yyy888 rejected" }, {}).includes("zzz999yyy888"));
});

test("a session value with a trailing newline in the secret is still masked", () => {
  const env = { TWITTER_AUTH_TOKEN: "a1b2c3d4e5f6a7b8c9d0\n", TWITTER_CT0: "" };
  assert.ok(!twitterError({ stderr: "Error: token a1b2c3d4e5f6a7b8c9d0 rejected" }, env).includes("a1b2c3d4e5f6a7b8c9d0"));
});
