/** The step-by-step "reel" look of a lesson (data/content-format.json "lessonLook": "reel",
 * docs/lesson-format.md §6): the episode's screen script, its checks, the scenes and the voice. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SERIES, validateEpisodes, stockEpisode, stockProblems, toJevVideoData, readLessonLook, reelNotes, REEL_PASTE_NOTE, REEL_CHECK_NOTE, REEL_SAVE_NARRATION } from "./jev.mjs";
import { reelScenes, voiceScenes, reelSeconds, reelCoverOffsetMs, sceneFrames, REEL_FPS } from "./reel.mjs";
import { buildPostEntry } from "./record-upload.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STOCK = JSON.parse(readFileSync(join(root, "data/ai-lesson-stock.json"), "utf8"));
const byKey = (k) => STOCK.lessons.find((l) => l.topic_key === k);
const DATE = "2026-10-25";
const ep = (key, edit = (x) => x) => edit(stockEpisode(byKey(key), DATE));
const errors = (e, look = "reel") => validateEpisodes({ episodes: [e] }, { date: DATE, today: DATE, series: SERIES.lesson, look }).errors.join("\n");

test("reel: every stock lesson has a valid reel (the 08:15 stand-in keeps the look)", () => {
  assert.ok(STOCK.lessons.every((l) => l.reel), "a stock lesson without reel");
  assert.deepEqual(stockProblems(STOCK), []);
});

test("reel: required only while the look is reel; the cards look ignores a missing one", () => {
  const noReel = ep("meeting-minutes-three", (x) => (delete x.reel, x));
  assert.match(errors(noReel), /\.reel: required while data\/content-format\.json "lessonLook" is "reel"/);
  assert.equal(errors(noReel, "cards"), "");
  assert.equal(errors(ep("meeting-minutes-three")), "");
});

test("reel: action order, type + send, step count, 「ステップN。」, heading length, hook says the count", () => {
  const swap = ep("meeting-minutes-three", (x) => ([x.reel.steps[2], x.reel.steps[3]] = [x.reel.steps[3], x.reel.steps[2]], x));
  assert.match(errors(swap), /each action once, in the order open → paste → type → send → check/);
  const noSend = ep("ask-three-parts", (x) => (x.reel.steps = x.reel.steps.filter((s) => s.action !== "send"), x));
  assert.match(errors(noSend), /needs a "send" step/);
  const prefix = ep("ask-three-parts", (x) => (x.reel.steps[1].narration = x.reel.steps[1].narration.replace("ステップ2。", "次に、"), x));
  assert.match(errors(prefix), /starts with 「ステップ2。」/);
  const long = ep("ask-three-parts", (x) => (x.reel.steps[0].heading = ["ふだん使っているAIを", "開く", ""], x));
  assert.match(errors(long), /heading: 13 chars \(allowed 2-12\)/);
  const count = ep("ask-three-parts", (x) => (x.reel.hook = "AIへの頼み方は、手順で変わります。", x));
  assert.match(errors(count), /say the number of steps as 「4つ」/);
});

test("reel: a pasting prompt needs a paste step, and the 社外秘 caution on screen or in the voice", () => {
  const noPaste = ep("meeting-minutes-three", (x) => {
    x.reel.steps = x.reel.steps.filter((s) => s.action !== "paste");
    delete x.reel.file;
    return x;
  });
  assert.match(errors(noPaste), /the prompt works on pasted text — add a "paste" step/);
  const silent = ep("summary-for-sales", (x) => {
    x.reel.steps[1].note = "資料を貼る";
    x.reel.steps[1].done = "貼った";
    x.reel.steps[1].narration = "ステップ2。営業の資料を、そのまま貼ります。";
    x.reel.steps[1].accents = [];
    return x;
  });
  assert.match(errors(silent), /pasting work text — the paste note or a step's narration must say/);
  // The default note itself says 仮名: on screen counts.
  const byDefault = ep("summary-for-sales", (x) => {
    delete x.reel.steps[1].note;
    x.reel.steps[1].narration = "ステップ2。営業の資料を、そのまま貼ります。";
    x.reel.steps[1].accents = [];
    return x;
  });
  assert.equal(errors(byDefault), "");
});

test("reel: answer rows fit the window, focus names a head, no paid plan / hype / dollars, total spoken length", () => {
  const rows = ep("meeting-minutes-three", (x) => (x.reel.answer[2].lines.push("来月また話す"), x));
  assert.match(errors(rows), /8 rows \(heads \+ lines\) — up to 7 fit/);
  const wide = ep("ask-three-parts", (x) => (x.reel.answer[0].lines[0] = "1. 領収書をもらって、日付と金額を確かめる", x));
  assert.match(errors(wide), /lines\[0\]: 22 chars \(allowed 2-20\)/);
  const focus = ep("meeting-minutes-three", (x) => (x.reel.steps[4].focus = ["宿題"], x));
  assert.match(errors(focus), /"宿題" is not a head of reel\.answer/);
  const paid = ep("ask-three-parts", (x) => (x.reel.steps[0].narration = "ステップ1。ChatGPT Plusで、新しいチャットを開きます。", x));
  assert.match(errors(paid), /never recommend a paid plan/);
  const hype = ep("ask-three-parts", (x) => (x.reel.title = "最強の頼み方", x));
  assert.match(errors(hype), /no hype/);
  const dollar = ep("ask-three-parts", (x) => (x.reel.answer[0].lines[4] = "5. 20ドルまで申請", x));
  assert.match(errors(dollar), /no dollar amounts/);
  const talky = ep("meeting-minutes-three", (x) => {
    for (const s of x.reel.steps) s.narration = `${s.narration.slice(0, 6)}${"あ".repeat(43)}。`;
    return x;
  });
  assert.match(errors(talky), /spoken chars with the fixed lines \(allowed 250\)/);
});

test("reel: the look switch — LESSON_LOOK wins, then the file's lessonLook, no field = cards", () => {
  const dir = mkdtempSync(join(tmpdir(), "look-"));
  try {
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data/content-format.json"), JSON.stringify({ format: "lesson" }));
    assert.equal(readLessonLook(dir, {}), "cards");
    writeFileSync(join(dir, "data/content-format.json"), JSON.stringify({ format: "lesson", lessonLook: "reel" }));
    assert.equal(readLessonLook(dir, {}), "reel");
    assert.equal(readLessonLook(dir, { LESSON_LOOK: "cards" }), "cards");
    assert.throws(() => readLessonLook(dir, { LESSON_LOOK: "reels" }), /LESSON_LOOK must be one of reel \/ cards/);
    writeFileSync(join(dir, "data/content-format.json"), JSON.stringify({ format: "lesson", lessonLook: "card" }));
    assert.equal(readLessonLook(dir, {}), "cards", "a typo in the file never stops the post");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Production right now (owner 2026-10-23): the reel.
  assert.equal(readLessonLook(root, {}), "reel");
});

test("reel: scenes — hook with N steps, one scene per step, recap of the headings, save; notes default to 仮名", () => {
  const e = ep("meeting-minutes-three");
  const data = toJevVideoData(e, { series: SERIES.lesson });
  assert.deepEqual(data.reel, e.reel);
  const s = reelScenes(data.reel, data.jev.prompt);
  assert.equal(s.prompt, e.slides[1].diagram.items[0].label);
  assert.equal(s.steps, 5);
  assert.deepEqual(s.scenes.map((x) => x.kind), ["hook", "step", "step", "step", "step", "step", "recap", "save"]);
  assert.deepEqual(s.scenes[0].heading, ["議事録は、AIで", "5ステップ", ""]);
  assert.deepEqual(s.recap, ["AIを開く", "会議のメモを貼る", "形を指定する", "送って待つ", "自分で確かめる"]);
  assert.equal(s.scenes.at(-1).narration, REEL_SAVE_NARRATION);
  assert.deepEqual(s.notes, { paste: REEL_PASTE_NOTE, done: "仮名にしてある", check: REEL_CHECK_NOTE });
  assert.deepEqual(reelNotes(byKey("summary-for-sales").reel), { paste: "社外秘は消してから", done: "消してある", check: "" });
  assert.deepEqual(reelNotes(byKey("ask-three-parts").reel), { paste: "", done: "", check: "" });
  // The cards look never gets a reel it did not ask for.
  assert.equal(toJevVideoData(ep("ask-three-parts", (x) => (delete x.reel, x)), { series: SERIES.lesson }).reel, undefined);
});

test("reel: voice — one clip per scene with words, length and the cover inside the hook", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reel-"));
  try {
    const s = reelScenes(byKey("ask-three-parts").reel, "社内の新人向けに説明してください。");
    // 48 kbps: 6000 bytes = 1 s
    const fake = async (text) => ({ audio: Buffer.alloc(6000 * 2), words: [{ offset: 0.1, duration: 0.3, text: text.slice(0, 2) }] });
    const voiced = await voiceScenes(s.scenes, { root: dir, rate: "+12%", synthesize: fake });
    assert.equal(voiced.length, s.scenes.length);
    assert.ok(voiced.every((v, i) => v.audio === `audio/reel/scene-${i}.mp3` && existsSync(join(dir, "public", v.audio))));
    assert.equal(voiced[0].duration, 2.45);
    assert.equal(reelSeconds(voiced), (voiced.length * Math.round(2.45 * REEL_FPS)) / REEL_FPS);
    const cover = reelCoverOffsetMs(voiced);
    assert.ok(cover > 0 && cover < (sceneFrames(voiced[0]) / REEL_FPS) * 1000, `cover ${cover} ms is inside the hook`);
    await assert.rejects(voiceScenes(s.scenes, { root: dir, rate: "+12%", synthesize: async () => ({ audio: Buffer.alloc(0), words: [] }) }), /no audio/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reel: the post record keeps the look, the real length and the reel's cover point", () => {
  const data = toJevVideoData(ep("ask-three-parts"), { series: SERIES.lesson });
  const entry = buildPostEntry({
    date: DATE,
    uploadResult: { videoId: "x", videoUrl: "u" },
    trendingData: data,
    captions: null,
    audioDurations: null,
    render: { look: "reel", seconds: 51.2, coverOffsetMs: 2833 },
  });
  assert.equal(entry.look, "reel");
  assert.equal(entry.coverOffsetMs, 2833);
  assert.equal(entry.durationSeconds, 51);
  assert.equal(entry.jev.topicKey, "ask-three-parts");
  // No render.json (the Instagram recovery from a Release): as before.
  const old = buildPostEntry({ date: DATE, uploadResult: { videoId: "x" }, trendingData: data, audioDurations: null });
  assert.equal(old.look, undefined);
  assert.equal(old.coverOffsetMs, null);
});

test("reel: the reel's own words get the slide checks — claims, 貼る talk, one row per check note, unique heads", () => {
  const claim = ep("ask-three-parts", (x) => (x.reel.steps[2].narration = "ステップ3。送信すると、AIは間違えない答えを返します。", x));
  assert.match(errors(claim), /reel\.steps\[2\]\.narration: claim without its source/);
  const shown = ep("ask-three-parts", (x) => (x.reel.answer[0].lines[4] = "ミスはゼロ", x));
  assert.match(errors(shown), /no speed\/accuracy\/"never wrong" claim on the screen/);
  const talks = ep("ask-three-parts", (x) => {
    x.reel.steps[1].narration = "ステップ2。会議の議事録を貼り付けて、形を書きます。";
    x.reel.steps[1].accents = [];
    x.reel.steps[3].narration = "ステップ4。答えはたたき台です。自分で見直して使います。";
    x.reel.steps[3].accents = [];
    return x;
  });
  assert.match(errors(talks), /pasting work text/);
  const wide = ep("meeting-minutes-three", (x) => {
    x.reel.answer[1].head = "担当と期限の宿題一覧";
    x.reel.steps[4].focus = ["担当と期限の宿題一覧"];
    x.reel.steps[4].note = "仮名は元の名前に戻して";
    return x;
  });
  assert.match(errors(wide), /the check note .* chars together \(up to 20 fit on one row\)/);
  const dup = ep("check-ask-sources", (x) => (x.reel.answer[1].head = x.reel.answer[0].head, x));
  assert.match(errors(dup), /each head once/);
  // A broken reel does not matter while the look is cards.
  assert.equal(errors(dup, "cards"), "");
});
