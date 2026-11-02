/** The 2026-11-02 trial: lessons made with instagram-agent-skill-ja (docs/ig-skill-format.md). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SERIES, buildJevCaptions, craftProblems, stockEpisode, toJevVideoData, validateEpisodes } from "./jev.mjs";
import { buildPostEntry } from "./record-upload.mjs";
import { HOOK_MIN, SKILL_VERSION, captionOf, scoreEpisode } from "./ig-craft.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STOCK = JSON.parse(readFileSync(join(root, "data/ai-lesson-stock.json"), "utf8"));
const crafted = STOCK.lessons.filter((l) => l.craft);
const ep = (l, date = "2026-11-03") => stockEpisode(l, date);
const errorsOf = (e) => validateEpisodes({ episodes: [e] }, { date: e.date, today: e.date, series: SERIES.lesson, look: "reel" }).errors.join("\n");

test("craft: the stock lessons still to air are made with the skill (scored, picked hook >= 50, on screen)", () => {
  assert.ok(crafted.length >= 15, `${crafted.length} crafted stock lessons`);
  for (const l of crafted) {
    assert.deepEqual(craftProblems(ep(l), l.topic_key), [], l.topic_key);
    const s = l.craft.scores;
    assert.equal(s?.tool, SKILL_VERSION, l.topic_key);
    assert.ok(s.hook.score >= HOOK_MIN, `${l.topic_key}: ${s.hook.score}`);
    assert.equal(s.hook.say, l.reel.hook, `${l.topic_key}: scores are for today's hook`);
    assert.notEqual(s.caption.verdict, "FIX", l.topic_key);
  }
});

test("craft: the caption opens with captionLead and the skill's paragraphs; without craft nothing changes", () => {
  const l = crafted[0];
  const data = toJevVideoData(ep(l), { series: SERIES.lesson });
  const c = buildJevCaptions(data);
  for (const text of [c.instagram, c.youtube.description]) {
    const lines = text.split("\n");
    assert.equal(lines[0], l.craft.captionLead);
    assert.equal(lines[2], "▼ そのまま使える頼み方（コピーして使えます）");
    for (const p of l.craft.captionBody) assert.ok(text.includes(`\n${p}\n`), p);
    assert.doesNotMatch(text, /^・/m);
  }
  const plain = structuredClone(ep(l));
  delete plain.craft;
  const p = buildJevCaptions(toJevVideoData(plain, { series: SERIES.lesson }));
  assert.equal(p.instagram.split("\n")[0], `${plain.headline}（11/3）`);
  assert.match(p.instagram, /^・/m);
});

test("craft: the post record keeps the scores for the 14-day judgment", () => {
  const l = crafted[0];
  const data = toJevVideoData(ep(l), { series: SERIES.lesson, fallback: true });
  const entry = buildPostEntry({ date: data.meta.date, uploadResult: { videoId: "x", videoUrl: "u" }, trendingData: data, captions: buildJevCaptions(data) });
  assert.equal(entry.jev.fallback, true);
  assert.deepEqual(entry.jev.craft, {
    tool: SKILL_VERSION,
    hookType: l.craft.scores.hook.type,
    hookScore: l.craft.scores.hook.score,
    hookSeconds: l.craft.scores.seconds.hook,
    caption: l.craft.scores.caption.verdict,
    humanScript: l.craft.scores.human.script,
    humanCaption: l.craft.scores.human.caption,
  });
  const plain = structuredClone(ep(l));
  delete plain.craft;
  assert.equal(toJevVideoData(plain, { series: SERIES.lesson }).jev.craft, undefined);
});

test("craft: the validator stops a bad craft block (picked hook not on screen, one type, long lead, hype, URL)", () => {
  const base = ep(crafted[0]);
  assert.equal(errorsOf(base), "");
  const bad = (f) => {
    const e = structuredClone(base);
    f(e);
    return errorsOf(e);
  };
  assert.match(bad((e) => (e.reel.hook = e.craft.hooks[1].say)), /picked candidate/);
  assert.match(bad((e) => e.craft.hooks.forEach((h) => (h.type = "呼びかけ"))), /3 different hook types/);
  assert.match(bad((e) => e.craft.hooks.pop()), /3 candidates/);
  assert.match(bad((e) => (e.craft.captionLead = "あ".repeat(31))), /captionLead: 31 chars/);
  assert.match(bad((e) => (e.craft.captionLead = "誰でも簡単に返信をやわらかく")), /no hype/);
  assert.match(bad((e) => (e.craft.captionBody = ["ChatGPT Plus なら返信をもっと上手に直せます。"])), /paid plan/);
  assert.match(bad((e) => (e.craft.captionBody = ["https://example.com を見て直してください。"])), /captionBody\[0\]/);
  assert.match(bad((e) => (e.craft.captionBody = ["私は毎日この頼み方で返信を直しています。"])), /own experience/);
  assert.match(bad((e) => (e.craft.keywords = ["a", "b", "c", "d"])), /keywords/);
});

const hasPython = spawnSync("python3", ["--version"]).status === 0;
test("craft: ig-craft scores a lesson with the vendored tools, offline", { skip: !hasPython && "no python3" }, () => {
  const e = ep(crafted[0]);
  const s = scoreEpisode(e);
  assert.equal(s.tool, SKILL_VERSION);
  assert.equal(s.hooks.length, 3);
  assert.ok(s.hooks.every((h) => typeof h.score === "number" && h.verdict));
  assert.deepEqual(s, e.craft.scores, "the stored scores are reproducible");
  assert.ok(captionOf(e).startsWith(e.craft.captionLead));
});
