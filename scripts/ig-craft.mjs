#!/usr/bin/env node
// Scores one AI lesson with the offline tools of instagram-agent-skill-ja
// (.claude/skills/ig-*, MIT, see .claude/skills/README.md): the 3 hook candidates
// (hookscore.py), the timing of what is said (beats.py), the Instagram caption
// as it will post (caption.py) and the AI tells in the script and the caption
// (detect.py). Owner trial 2026-11-02: docs/ig-skill-format.md.
//
//   node scripts/ig-craft.mjs --stock=<topic_key>            # a stock lesson
//   node scripts/ig-craft.mjs --date=YYYY-MM-DD              # a ledger episode
//   ... [--file=<json>] [--write]                            # --write stores craft.scores
//
// Exit 1 when the episode has no usable craft block, the picked hook scores
// under 50 or the caption check says 直す (FIX). Python 3 only, no network.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildJevCaptions, craftProblems, REEL_RECAP_NARRATION, REEL_SAVE_NARRATION, SERIES, stockEpisode, toJevVideoData } from "./jev.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, ".claude/skills");
export const SKILL_VERSION = "instagram-agent-skill-ja@0e7ac86";
// Measured 2026-11-02 the way the skill asks (beats.py --measured): 10/31's reel
// (meeting-minutes-three, Edge TTS Nanami +12%) ran 49 s for ~250 kana, scene
// pauses included → 5.1 kana a second (beats.py's default 9 is a person on camera).
export const CRAFT_CPS = 5.1;
export const HOOK_MIN = 50;
const HANDLE = "ai_ground_school";

function py(tool, args, input) {
  const dir = mkdtempSync(join(tmpdir(), "ig-craft-"));
  try {
    const file = join(dir, "in.txt");
    writeFileSync(file, input);
    const r = spawnSync("python3", ["-I", "-B", join(SKILLS, tool), file, ...args, "--json"], { encoding: "utf-8" });
    if (r.error || !r.stdout.trim()) throw new Error(`${tool}: ${r.error?.message || r.stderr.trim() || "no output"}`);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const round = (n) => Math.round(n * 10) / 10;

/** The spoken lines of the reel look, in order (scripts/reel.mjs scenes). */
export function spokenLines(ep) {
  return [ep.reel.hook, ...ep.reel.steps.map((s) => s.narration), REEL_RECAP_NARRATION, REEL_SAVE_NARRATION];
}

export function scoreEpisode(ep) {
  const c = ep.craft;
  const hooks = py("ig-reel/hookscore.py", ["--cps", String(CRAFT_CPS)], c.hooks.map((h) => h.say).join("\n") + "\n");
  const scored = c.hooks.map((h) => {
    const r = hooks.find((x) => x.hook === h.say);
    return { type: h.type, score: r ? round(r.score) : null, verdict: r?.verdict ?? null };
  });
  const picked = c.hooks.findIndex((h) => h.say === ep.reel.hook);
  const beats = py("ig-reel/beats.py", ["--cps", String(CRAFT_CPS)], spokenLines(ep).join("\n") + "\n");
  const caption = py("ig-caption/caption.py", ["--handle", HANDLE, "--keywords", (c.keywords || []).join(",")], captionOf(ep) + "\n");
  const script = py("ig-human/detect.py", [], spokenLines(ep).slice(0, -2).join("\n") + "\n");
  const captionHuman = py("ig-human/detect.py", [], captionOf(ep) + "\n");
  return {
    tool: SKILL_VERSION,
    hook: { ...scored[picked], say: ep.reel.hook },
    hooks: scored,
    seconds: { hook: round(beats.beats[0].dur), total: round(beats.total_seconds) },
    beatFlags: beats.beats.flatMap((b) => b.flags || []).length,
    caption: { verdict: caption.verdict, firstLine: caption.first_line_chars, issues: caption.checks.filter((x) => x.status !== "OK").map((x) => `${x.check}: ${x.status}`) },
    human: { script: round(scriptScore(script)), caption: round(scriptScore(captionHuman)) },
  };
}

const scriptScore = (r) => r.human_score;

/** The Instagram caption exactly as generate-caption.mjs would post it. */
export function captionOf(ep) {
  return buildJevCaptions(toJevVideoData(ep, { series: SERIES.lesson })).instagram;
}

function main(argv) {
  const arg = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const stockKey = arg("stock");
  const file = join(ROOT, arg("file") ?? (stockKey ? "data/ai-lesson-stock.json" : "data/ai-lesson-episodes.json"));
  const doc = JSON.parse(readFileSync(file, "utf-8"));
  const list = stockKey ? doc.lessons : doc.episodes;
  const i = stockKey ? list.findIndex((l) => l.topic_key === stockKey) : list.findIndex((e) => e.date === arg("date"));
  if (i < 0) throw new Error(`not found: ${stockKey ?? arg("date")} in ${file}`);
  const ep = stockKey ? stockEpisode(list[i], "2026-11-03") : list[i];
  if (!ep.reel) {
    console.log("NG no reel — the skill scores the step-by-step screen script (reel.hook / reel.title)");
    return 1;
  }
  const shape = ep.craft === undefined ? ["no craft block — write craft.hooks (3) and craft.captionLead first (docs/ig-skill-format.md)"] : craftProblems(ep, ep.topic_key);
  if (shape.length) {
    for (const p of shape) console.log(`NG ${p}`);
    return 1;
  }
  const s = scoreEpisode(ep);
  console.log(`${ep.topic_key}`);
  for (const [j, h] of s.hooks.entries()) console.log(`  ${ep.craft.hooks[j].say === ep.reel.hook ? "->" : "  "} ${String(h.score).padStart(5)} ${h.verdict ?? "?"}  [${h.type}] ${ep.craft.hooks[j].say}`);
  console.log(`  秒: フック ${s.seconds.hook} / 全体 ${s.seconds.total}（声 1 秒 ${CRAFT_CPS} かな、場面の間を除く）・注意 ${s.beatFlags}`);
  console.log(`  キャプション: ${s.caption.verdict}（1 行目 ${s.caption.firstLine} 字）${s.caption.issues.length ? " — " + s.caption.issues.join(" / ") : ""}`);
  console.log(`  AIっぽさ: 台本 ${s.human.script} / キャプション ${s.human.caption}`);
  if (argv.includes("--write")) {
    list[i].craft = { ...list[i].craft, scores: s };
    writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
    console.log(`  wrote craft.scores → ${file.slice(ROOT.length + 1)}`);
  }
  const bad = (s.hook.score ?? 0) < HOOK_MIN || s.caption.verdict === "FIX";
  if (bad) console.log(`NG ${(s.hook.score ?? 0) < HOOK_MIN ? `the picked hook scores under ${HOOK_MIN}` : "the caption check says 直す"}`);
  return bad ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
