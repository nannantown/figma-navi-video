/** Genre trial #4 "AI 仕事術" (format "lesson"): beginner lessons on the Jev slide
 * machinery — 困りごと → 頼み方 (prompt box) → 答えの例 (answer box) → 注意. Tests
 * never write the production ledger. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  SERIES,
  LESSON_PILLARS,
  LESSON_NOTE,
  LESSON_IG_HASHTAGS,
  LESSON_ENDING_NARRATION,
  validateEpisodes,
  toJevVideoData,
  buildJevCaptions,
  stockProblems,
  stockEpisode,
  unusedStock,
  lessonFallback,
  lessonPrompt,
  promptSimilarity,
  mayCharacterOn,
} from "./jev.mjs";
import { buildCaptions } from "./generate-caption.mjs";
import { buildPostEntry } from "./record-upload.mjs";
import { upsertVideo } from "./history.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STOCK = JSON.parse(readFileSync(join(root, "data/ai-lesson-stock.json"), "utf8"));
const SAMPLE = JSON.parse(readFileSync(join(root, "data/samples/ai-lesson-episodes.sample.json"), "utf8"));
const LESSON = SERIES.lesson;
const clone = (x) => structuredClone(x);
const day = (i) => new Date(Date.UTC(2026, 9, 23 + i)).toISOString().slice(0, 10);
/** Stock lesson n as the episode of day n. */
const ep = (n, overrides = {}) => ({ ...stockEpisode(STOCK.lessons[n], day(n)), ...overrides });
const check = (episodes, opts = {}) => validateEpisodes({ episodes }, { date: episodes.at(-1).date, today: episodes.at(-1).date, series: LESSON, ...opts });
const errorsOf = (episodes, opts) => check(episodes, opts).errors.join("\n");
const withPrompt = (e, text) => {
  const x = clone(e);
  x.slides[1].diagram.items[0].label = text;
  return x;
};
const posted = (date, data, extra = {}) => ({ date, genre: "ai-lesson", trial: 4, jev: { ...data.jev, ...extra } });

test("lesson: the stock passes every check, covers every pillar and lasts two weeks or more", () => {
  assert.deepEqual(stockProblems(STOCK), []);
  assert.ok(STOCK.lessons.length >= 14);
  assert.deepEqual([...new Set(STOCK.lessons.map((l) => l.pillar))].sort(), Object.keys(LESSON_PILLARS).sort());
  // The file order already rotates the pillars (no two days in a row on one pillar).
  STOCK.lessons.forEach((l, i) => i > 0 && assert.notEqual(l.pillar, STOCK.lessons[i - 1].pillar, l.topic_key));
  assert.equal(check(SAMPLE.episodes, { pickLatest: true }).errors.length, 0);
});

test("lesson: the same lesson or the same prompt can never air twice (ledger and post records)", () => {
  // Same topic_key.
  assert.match(errorsOf([ep(0), { ...ep(1), topic_key: STOCK.lessons[0].topic_key, pillar: STOCK.lessons[0].pillar }]), /topic_key "ask-three-parts" was already used/);
  // Same prompt word for word, under another key and headline.
  const copy = withPrompt(ep(1), lessonPrompt(ep(0)));
  assert.match(errorsOf([ep(0), copy]), /the prompt is the same as the 2026-10-23 lesson's \(similarity 1\.00\)/);
  // Reworded a little is still the same 文例.
  const reworded = withPrompt(ep(2), "次のメールを、忙しい上司が30秒で読めるように3行でまとめてください。");
  assert.ok(promptSimilarity(lessonPrompt(reworded), lessonPrompt(ep(1))) >= 0.55);
  assert.match(errorsOf([ep(0), ep(1), reworded]), /the prompt is the same as the 2026-10-24 lesson's/);
  // A posted lesson missing from the ledger (posted from the stock at 08:15) still blocks its prompt and key.
  const first = toJevVideoData(ep(0), { series: LESSON, fallback: true });
  const history = { videos: [posted(day(0), first)] };
  assert.match(errorsOf([withPrompt(ep(1), lessonPrompt(ep(0)))], { history }), /prompt is the same as the 2026-10-23/);
  assert.match(errorsOf([{ ...ep(1), topic_key: "ask-three-parts", pillar: "ask" }], { history }), /topic_key "ask-three-parts" was already posted on 2026-10-23/);
  // …and is not reported as "missing from the ledger" (it never was in it).
  assert.doesNotMatch(errorsOf([ep(1)], { history }), /was posted but is missing/);
  assert.equal(errorsOf([ep(1)], { history }), "");
  // Kanji numerals count as digits (三行 = 3行).
  assert.equal(promptSimilarity("次の文章を三行で要約してください。", "次の文章を3行で要約してください。"), 1);
  // Every pair of stock prompts is far apart (the stock itself has no repeats).
  for (let i = 0; i < STOCK.lessons.length; i++) for (let j = 0; j < i; j++) assert.ok(promptSimilarity(lessonPrompt(STOCK.lessons[i]), lessonPrompt(STOCK.lessons[j])) < 0.55, `${STOCK.lessons[i].topic_key} ~ ${STOCK.lessons[j].topic_key}`);
});

test("lesson: no paid plan, no hype, no GitHub; the 4-slide shape with the prompt and answer boxes", () => {
  const paid = clone(ep(0));
  paid.slides[3].narration = "ChatGPT Plus に入ると、もっと長い文章も読みこめるので、仕事がはかどるようになります。";
  assert.match(errorsOf([paid]), /"ChatGPT Plus" — never recommend a paid plan/);
  const plan = clone(ep(0));
  plan.slides[0].body = "有料プランにすると、答えが長くなるので便利になることがあります。";
  assert.match(errorsOf([plan]), /"有料プラン" — never recommend a paid plan/);
  const hype = clone(ep(0));
  hype.hook = "誰でも月10万円の時間を浮かせる頼み方です。";
  assert.match(errorsOf([hype]), /"誰でも月" — no hype/);
  // Ordinary words stay allowed; get-rich talk does not.
  const plain = withPrompt(ep(0), "この案内文を、誰でも分かる言葉に直してください。毎日楽しく読めるように短くしてください。");
  assert.doesNotMatch(errorsOf([plain]), /no hype/);
  const income = clone(ep(0));
  income.slides[0].body = "この頼み方を覚えれば、月収100万円も夢ではありません。";
  assert.match(errorsOf([income]), /no hype/);
  // Column titles and sources are on screen too.
  const noteWord = clone(ep(0));
  noteWord.slides[0].diagram.items[1].note = "有料版";
  assert.match(errorsOf([noteWord]), /items\[1\]\.note: "有料版" — never recommend a paid plan/);
  const ghSource = { ...ep(0), sources: [{ url: "https://github.com/example/tool", title: "tool", outlet: "GitHub", published_at: null, role: "reference", official: false }] };
  assert.match(errorsOf([ghSource]), /sources\[0\]\.outlet: "GitHub"/);
  // prompt / answer boxes belong to lessons only.
  const newsSlide = clone(JSON.parse(readFileSync(join(root, "data/samples/ai-news-episodes.sample.json"), "utf8")).episodes[0]);
  newsSlide.slides[0].diagram = { type: "prompt", items: [{ label: "次の文章を3行で要約してください。" }] };
  assert.match(validateEpisodes({ episodes: [newsSlide] }, { pickLatest: true, series: SERIES.news }).errors.join("\n"), /"prompt" is for the lesson format only/);
  const fast = clone(ep(0));
  fast.headline = "仕事が10倍速になる型";
  assert.match(errorsOf([fast]), /no hype/);
  const gh = withPrompt(ep(0), "GitHub のリポジトリの説明文を、新人向けにやさしく書きかえてください。");
  assert.match(errorsOf([gh]), /AI Trend Daily covers GitHub/);
  const noPrompt = clone(ep(0));
  noPrompt.slides[1].diagram = { type: "steps", items: [{ label: "相手" }, { label: "目的" }] };
  assert.match(errorsOf([noPrompt]), /slides\[1\]\.diagram: must be \{ "type": "prompt"/);
  const three = clone(ep(0));
  three.slides = three.slides.slice(0, 3);
  assert.match(errorsOf([three]), /a lesson is 4 slides/);
  assert.match(errorsOf([{ ...ep(0), pillar: "money" }]), /pillar: one of ask/);
  assert.match(errorsOf([{ ...ep(0), pillar: "mail" }]), /starts with the pillar \("mail-…"\)/);
  assert.match(errorsOf([{ ...ep(0), redo_of: "2026-10-22" }]), /lesson series does not redo/);
  assert.match(errorsOf([{ ...ep(0), genre: "ai-news", trial: 3 }]), /genre: must be "ai-lesson"[\s\S]*trial: must be 4/);
  // Same pillar two days running is a nudge, not a stop.
  const again = { ...ep(1), pillar: "ask", topic_key: "ask-other-thing" };
  const r = check([ep(0), again]);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join("\n"), /"ask" again after 2026-10-23/);
});

test("lesson: 08:15 posts the next unused stock lesson when today's is missing, and the same one on a re-run", () => {
  const today = day(2);
  const ledger = { episodes: [ep(0), ep(1)] };
  const fb = lessonFallback(ledger, STOCK, { videos: [] }, today);
  assert.equal(fb.episode.topic_key, STOCK.lessons[2].topic_key);
  assert.equal(fb.episode.date, today);
  // A bad entry for today is replaced, not kept.
  const broken = { episodes: [ep(0), ep(1), { ...ep(2), slides: [] }] };
  assert.equal(lessonFallback(broken, STOCK, null, today).episode.topic_key, STOCK.lessons[2].topic_key);
  // Posted keys are skipped even when the ledger lacks them; the pillar of yesterday goes last.
  const data2 = toJevVideoData(stockEpisode(STOCK.lessons[2], day(1)), { series: LESSON, fallback: true });
  const left = unusedStock(STOCK, [ep(0)], { videos: [posted(day(1), data2)] }, today);
  assert.ok(!left.some((l) => l.topic_key === STOCK.lessons[2].topic_key || l.topic_key === STOCK.lessons[0].topic_key));
  assert.notEqual(left[0].pillar, STOCK.lessons[2].pillar);
  // The Instagram recovery the same day takes the lesson the morning already posted.
  const morning = toJevVideoData(fb.episode, { series: LESSON, fallback: true });
  const again = lessonFallback(ledger, STOCK, { videos: [posted(today, morning)] }, today);
  assert.equal(again.episode.topic_key, fb.episode.topic_key);
  // A stock lesson whose prompt already aired in other words is not offered.
  const reworded = toJevVideoData(withPrompt(ep(0), lessonPrompt(STOCK.lessons[2]).replace("、", "")), { series: LESSON });
  assert.ok(!unusedStock(STOCK, [], { videos: [posted(day(0), reworded)] }, today).some((l) => l.topic_key === STOCK.lessons[2].topic_key));
  // Nothing unused → null (generate-data then fails loudly).
  assert.equal(lessonFallback({ episodes: [] }, { lessons: [] }, null, today), null);
});

test("lesson: video data and captions — prompt box, answer box, the copyable prompt, no source line, saves and follows", () => {
  const data = toJevVideoData(SAMPLE.episodes[0], { series: LESSON });
  assert.equal(data.meta.mode, "jev");
  assert.equal(data.meta.genre, "ai-lesson");
  assert.equal(data.meta.trial, 4);
  assert.equal(data.meta.bigLabel, "LESSON");
  assert.equal(data.meta.openingSourceLabel, "今日のAI仕事術");
  assert.deepEqual(data.meta.endingLines, LESSON.endingLines);
  assert.deepEqual(data.tools.map((t) => t.diagram?.type), ["compare", "prompt", "answer", "steps"]);
  assert.equal(data.tools[1].diagram.items[0].label, lessonPrompt(SAMPLE.episodes[0]));
  assert.equal(data.tools[0].sourceLine, "");
  assert.equal(data.jev.prompt, lessonPrompt(SAMPLE.episodes[0]));
  assert.equal(data.jev.fallback, undefined);
  assert.match(LESSON_ENDING_NARRATION, /保存とフォロー/);
  assert.ok(Array.from(LESSON_ENDING_NARRATION).length <= 40);
  assert.equal(mayCharacterOn(data.meta, { MAY_CHARACTER: "on" }), true);
  const c = buildCaptions(data);
  assert.deepEqual(c, buildJevCaptions(data));
  assert.match(c.youtube.title, /^【AI仕事術】頼むときは3つを書く｜2026\/10\/23 #Shorts$/);
  assert.equal(c.youtube.titleTemplate, "ai-lesson");
  for (const text of [c.youtube.description, c.instagram]) {
    assert.ok(text.includes(`▼ そのまま使える頼み方（コピーして使えます）\n${data.jev.prompt}`));
    assert.ok(text.includes(LESSON_NOTE));
    assert.doesNotMatch(text, /出典:|Jev|TypeSafe|ニュース/);
  }
  assert.match(c.instagram, /保存して[\s\S]*フォロー/);
  assert.ok(c.instagram.endsWith(LESSON_IG_HASHTAGS.join(" ")));
  // The post record keeps the prompt (no 文例 twice) and the fallback mark.
  const fb = toJevVideoData(SAMPLE.episodes[0], { series: LESSON, fallback: true });
  const entry = buildPostEntry({ date: fb.meta.date, uploadResult: { videoId: "x", videoUrl: "u" }, trendingData: fb, captions: buildCaptions(fb) });
  assert.equal(entry.genre, "ai-lesson");
  assert.equal(entry.jev.prompt, data.jev.prompt);
  assert.equal(entry.jev.fallback, true);
});

test("lesson: Step 1 (generate-data) falls back to the stock with a warning when today's lesson is not on main", () => {
  const dir = mkdtempSync(join(tmpdir(), "lesson-step1-"));
  try {
    cpSync(join(root, "scripts"), join(dir, "scripts"), { recursive: true, filter: (p) => !p.endsWith(".test.mjs") });
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data/content-format.json"), JSON.stringify({ format: "lesson" }));
    writeFileSync(join(dir, "data/ai-lesson-stock.json"), JSON.stringify(STOCK));
    const today = day(1);
    writeFileSync(join(dir, "data/ai-lesson-episodes.json"), JSON.stringify({ episodes: [ep(0)] }));
    writeFileSync(join(dir, "data/performance-history.json"), JSON.stringify({ videos: [] }));
    const clock = join(dir, "clock.mjs");
    const instant = `${today}T00:00:00Z`;
    writeFileSync(clock, `const D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [${JSON.stringify(instant)}])); } static now() { return new D(${JSON.stringify(instant)}).getTime(); } };`);
    const run = () => spawnSync(process.execPath, ["--import", clock, join(dir, "scripts/generate-data.mjs")], {
      cwd: dir, encoding: "utf8", timeout: 10_000, env: { PATH: dirname(process.execPath), TZ: "UTC", SNS_POST_ENABLED: "false" },
    });
    let r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /::warning title=予備のレッスンで投稿::ネタ帳の「summary-three-lines」で投稿します。理由: 2026-10-24 の回が main に無い/);
    let data = JSON.parse(readFileSync(join(dir, "output/trending-data.json"), "utf8"));
    assert.equal(data.meta.date, today);
    assert.equal(data.meta.fallback, true);
    assert.equal(data.jev.topicKey, STOCK.lessons[1].topic_key);
    // 08:15 posted the stock lesson; then the routine's own (other) lesson reaches main.
    // A re-run that day (the Instagram recovery) must still build the stock lesson.
    const late = { ...stockEpisode(STOCK.lessons[5], today) };
    writeFileSync(join(dir, "data/ai-lesson-episodes.json"), JSON.stringify({ episodes: [ep(0), late] }));
    writeFileSync(join(dir, "data/performance-history.json"), JSON.stringify({ videos: [posted(today, data)] }));
    r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /今日はもう予備で出している/);
    assert.equal(JSON.parse(readFileSync(join(dir, "output/trending-data.json"), "utf8")).jev.topicKey, STOCK.lessons[1].topic_key);
    // …and the routine's lesson is refused for that day (deliver-jev will not merge it).
    assert.match(errorsOf([ep(0), late], { history: { videos: [posted(today, data)] } }), /already went out from the stock \("summary-three-lines"\)/);
    // Today's lesson on main, nothing posted yet → it is used, no warning.
    writeFileSync(join(dir, "data/performance-history.json"), JSON.stringify({ videos: [] }));
    writeFileSync(join(dir, "data/ai-lesson-episodes.json"), JSON.stringify({ episodes: [ep(0), ep(1)] }));
    r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /予備のレッスン/);
    data = JSON.parse(readFileSync(join(dir, "output/trending-data.json"), "utf8"));
    assert.equal(data.meta.fallback, undefined);
    assert.ok(existsSync(join(dir, "output/trending-data.json")));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("lesson: a lesson posted from the stock stays in the history past the 90-day trim (it is not in the ledger)", () => {
  const data = toJevVideoData(ep(0), { series: LESSON, fallback: true });
  const old = { videos: [posted("2026-01-01", data), { date: "2026-01-02", genre: "ai-lesson", jev: { topicKey: "x" } }] };
  const h = upsertVideo(old, { date: "2026-10-22", genre: "ai-lesson" }, { now: new Date("2026-10-22T00:00:00Z") });
  assert.deepEqual(h.videos.map((v) => v.date), ["2026-01-01", "2026-10-22"]);
});
