/**
 * Genre trial #2: "Jev の毎朝ニュース" — one episode a day about the AI model
 * Jev (TypeSafe AI), until the owner says stop.
 *
 * The morning routine appends one episode to data/jev-episodes.json (spec and
 * series plan: docs/jev-format.md). The file is the ledger of everything ever
 * posted, so the rules that keep the series honest are checked here:
 *
 *   - Series order (owner 2026-09-23): stage 1 explains what Jev is (a fixed
 *     list of intro topics, in order), stage 2 shows real use cases (each with
 *     the source of the example), stage 3 is daily news — or an explainer when
 *     nothing new came out.
 *   - No repeats: a topic_key is used once; the source that carries a day's
 *     news or use case is used once.
 *   - Company claims stay claims: any sentence with a speed/cost multiplier or
 *     "does not hallucinate" style wording names who says so.
 *
 * Which format the pipeline runs is data/content-format.json ("news" / "jev" / "pickup").
 *
 * The same machinery runs genre trial #3 "AI ニュース 1 本解説" (format
 * "news", owner 2026-10-13: Jev ended): one AI story a day, explained in
 * order, from data/ai-news-episodes.json (docs/news-format.md). It has no
 * stages; the slide card, diagram, yen-only and claim rules are shared.
 * SERIES below holds what differs; every function defaults to the Jev series.
 *
 * CLI (the routine runs this before committing; the series follows
 * data/content-format.json unless --series=lesson|jev|news is given):
 *   node scripts/jev.mjs validate [--file=path] [--no-date-check]
 *   node scripts/jev.mjs next     # which stage / episode / topic comes next (+ unrecorded / redoCandidate)
 *   node scripts/jev.mjs aired-check   # did the redo candidate go out? (posting runs' logs via gh; prints redoSlot only if not)
 *   node scripts/jev.mjs aired-check --self-test   # can this environment's gh read the posting runs' logs? (one line)
 *   node scripts/jev.mjs pdca     # numbers for docs/pdca/$TODAY.md
 *   node scripts/jev.mjs validate-stock [--file=path]   # lesson: every stock lesson passes, no repeats inside the stock
 */

import { readFileSync, existsSync, realpathSync } from "fs";
import { execFileSync } from "child_process";
import { join, dirname, isAbsolute } from "path";
import { fileURLToPath } from "url";
import {
  textSafetyProblems,
  normalizeForChecks,
  hostOf,
  isHttpsUrl,
  charLength,
  todayJst,
  parseEnrichedText,
  CONTROL_CHARS_RE,
  INVISIBLE_CHARS_RE,
} from "./enriched-schema.mjs";

export const JEV_GENRE = "jev-news";
export const JEV_TRIAL = 2;
export const JEV_LAUNCH_DATE = "2026-09-15"; // early access + seed announcement
export const EPISODES_PATH = "data/jev-episodes.json";
export const FORMAT_PATH = "data/content-format.json";
export const FORMATS = ["lesson", "news", "jev", "pickup"];
// Genre trial #4 (owner 2026-10-22): one AI tip a day for office workers who
// just started with ChatGPT and the like — 困りごと → 頼み方 → 答えの例 → 注意.
export const LESSON_GENRE = "ai-lesson";
export const LESSON_TRIAL = 4;
export const LESSON_EPISODES_PATH = "data/ai-lesson-episodes.json";
// The evergreen stock: the routine starts from it, and 08:15 posts its next unused
// lesson when today's episode is missing (an unmerged routine PR never leaves a blank day).
export const LESSON_STOCK_PATH = "data/ai-lesson-stock.json";
// topic_key starts with the pillar ("mail-polite-decline").
export const LESSON_PILLARS = {
  ask: "頼み方の型",
  summary: "要約",
  mail: "メール",
  sheet: "表計算",
  slides: "資料づくり",
  research: "調べもの",
  check: "確かめ方",
  meeting: "会議・議事録",
};
// Two prompts this alike (character-bigram Dice) are the same 文例 told twice.
export const LESSON_PROMPT_SIMILARITY_MAX = 0.55;
export const NEWS_GENRE = "ai-news";
export const NEWS_TRIAL = 3;
export const NEWS_EPISODES_PATH = "data/ai-news-episodes.json";
// A day's story must be this fresh (JST today minus N days; outlets date in US time, weekends).
export const NEWS_FRESH_DAYS = 3;
// AI Trend Daily (the other AI account) posts GitHub's trending repositories:
// a repository page never carries this channel's story (owner 2026-10-13).
export const NEWS_BLOCKED_PRIMARY_HOSTS = ["github.com", "github.io", "githubusercontent.com"];
// Same story told again: topic_key's first two parts (会社-中身) within this many days.
export const NEWS_SAME_STORY_DAYS = 7;

/** "openai-gpt6-release" → "openai-gpt6" (会社-中身). */
export function storyKey(topicKey) {
  return String(topicKey ?? "").split("-").slice(0, 2).join("-");
}

/** Hosts under a blocked name (gist.github.com, foo.github.io, raw.githubusercontent.com). */
function isBlockedNewsHost(host) {
  return NEWS_BLOCKED_PRIMARY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** The site a host belongs to, for "two different sites": help.openai.com = openai.com, www.itmedia.co.jp = itmedia.co.jp. */
export function siteOf(host) {
  const labels = String(host ?? "").toLowerCase().split(".").filter(Boolean);
  const secondLevel = labels.length >= 3 && labels.at(-1).length === 2 && ["co", "ac", "ne", "or", "go", "ed", "gr", "lg", "com", "net", "org", "gov", "edu"].includes(labels.at(-2));
  return labels.slice(secondLevel ? -3 : -2).join(".");
}

// ---------------------------------------------------------------------------
// Series plan (docs/jev-format.md is the prose version — keep them in sync)
// ---------------------------------------------------------------------------

/** Stage 1: "Jev とは何か", posted in exactly this order. */
export const INTRO_TOPICS = [
  { key: "intro-what-is-jev", theme: "Jev って何？ 誰が作った、どんな AI か" },
  { key: "intro-no-text", theme: "文章を書かない AI — 答えを「型」と確信度で返す" },
  { key: "intro-vs-llm", theme: "ChatGPT のような LLM と何が違う？ 得意と不得意" },
  { key: "intro-speed-claim", theme: "「速い」と言う理由 — TypeSafe の主張と第三者の測定" },
  { key: "intro-cost-claim", theme: "料金のしくみ — 入力 100 万トークン約 6 円を計算してみる" },
  { key: "intro-no-hallucination-claim", theme: "「ハルシネーションしない」の意味と限界" },
];

/** Stage 2: use-case episodes. Stage 3 starts after USECASE_TARGET, or after
 *  USECASE_MIN when the routine records that no unused example was found. */
export const USECASE_MIN = 3;
export const USECASE_TARGET = 5;

// "explainer" in stages 1-2 is the filler for a day whose intro / use case cannot
// be written: it keeps the daily post going without advancing the stage.
export const KINDS_BY_STAGE = { 1: ["intro", "explainer"], 2: ["usecase", "explainer"], 3: ["news", "explainer"] };
/** Role of the source that carries the day's content; used once in the whole series. */
export const PRIMARY_ROLE = { usecase: "usecase", news: "news" };
export const SOURCE_ROLES = ["news", "usecase", "reference"];

export const LIMITS = {
  topic: [4, 40],
  headline: [6, 24],
  hook: [8, 40],
  heading: [4, 18],
  body: [8, 64],
  claimSource: [4, 16],
  narration: [30, 95],
  // Slides only. Plus hook (max 40) and JEV_ENDING_NARRATION (max 40), the
  // worst case is ~380 chars, which has to stay under the 58 s target.
  narrationTotal: 300,
  slides: [3, 4],
  sources: [1, 8],
  checked: [1, 30],
  outlet: [2, 30],
  reason: [8, 120],
};

// TypeSafe's own properties. `official: true` is only believable on these.
const OFFICIAL_HOST_RE = /(^|\.)typesafe\.ai$/;
const OFFICIAL_PATHS = [
  ["github.com", "/typesafe-ai"],
  ["x.com", "/typesafeai"],
  ["twitter.com", "/typesafeai"],
  // The CEO's own account: his posts are the company speaking (launch thread).
  ["x.com", "/completeskeptic"],
  ["twitter.com", "/completeskeptic"],
  ["www.linkedin.com", "/company/typesafe-ai"],
  ["linkedin.com", "/company/typesafe-ai"],
];
// Look-alike sites found on 2026-09-23 that are NOT TypeSafe's. Never a source.
export const LOOKALIKE_HOSTS = ["jevtypesafeai.com", "jevfast.com", "jevbooks.com"];
const SHORTENER_HOSTS = ["bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "buff.ly", "lnkd.in", "linktr.ee"];

// ---------------------------------------------------------------------------
// Claims: speed/cost multipliers, "never hallucinates", "no type errors" …
// ---------------------------------------------------------------------------

const NUM = "(?:\\d+(?:\\.\\d+)?|[一二三四五六七八九十百千万数何]+)";
// "does not happen" after an error-type word: the claim is the negation
// ("ハルシネーションしない"), not the word ("ハルシネーションとは…" is a definition).
const NEGATION = "(?:しない|しません|起こさない|起こしません|起きない|起きません|ない|ません|ゼロ|0\\s*%|不可能)";
const ERROR_WORD = "(?:ハルシネーション|幻覚|型エラー|間違い|間違え|ミス|誤り|嘘|うそ)";
// The diagram's split check reads short boxes, so it takes a wider net ("エラー", "誤答", "無し", "0件").
// Sentences keep the narrow one: "エラーが出ても慌てない。" is advice, not a claim.
const WIDE_NEGATION = "(?:しない|しません|起こさない|起こしません|起きない|起きません|ない|無い|ません|なし|無し|なくなる|無くなる|ゼロ|0(?:\\.0+)?\\s*(?:%|件|回|個)|不可能)";
const WIDE_ERROR_WORD = "(?:ハルシネーション|幻覚|エラー|間違い|間違え|ミス|誤り|誤答|嘘|うそ)";
const CLAIM_PARTS = [
  `${NUM}\\s*(?:[〜~\\-–]\\s*${NUM}\\s*)?倍`, // 40〜200倍 / 数十倍 / 十倍
  `${NUM}\\s*分の\\s*[1一]`, // 100分の1
  "(?<![\\d.])\\d+(?:\\.\\d+)?[xX×](?![A-Za-z0-9])", // 200x / 5× ("Haiku 4.5 × Jev" is a pairing)
  "(?<![\\d/])1\\s*[/／]\\s*\\d{2,}\\s*(?:の|に)\\s*(?:料金|価格|コスト|費用|時間)", // 1/100の料金 (not a date)
  `${NUM}\\s*割\\s*(?:安|減|速|削減|少な)`, // 9割安く
  `\\d+(?:\\.\\d+)?\\s*%\\s*(?:安|減|削減|速|高速|少な|の?精度|正確|正し)`, // 96%減 / 100%正しい
  "(?:精度|正答率|正解率)\\s*(?:は|が)?\\s*\\d+(?:\\.\\d+)?\\s*%", // 精度は100%
  "最速|桁違い|業界(?:最|一)|世界(?:最|一)",
  // General AI news (trial #3): "beats GPT-5", "state of the art", "No.1 on a benchmark".
  "上回(?:る|り|っ)|(?:性能|精度|スコア|成績)[^。！？]{0,12}?(?:超え|勝っ|勝る)",
  "最高(?:水準|性能|レベル|峰|クラス)|最も(?:高性能|高い|賢い|速い|優れ)",
  "首位|トップ(?:クラス|レベル|水準)|[1１一]\\s*位(?:に|を|と|で|の)|No\\.?\\s*1(?![0-9])|ナンバーワン|SOTA",
  "世界初|業界初|史上最|最大級|最強|人間(?:並み|レベル|を超)|博士(?:号)?レベル|超える性能|より高性能",
  // Jev's "mathematically guaranteed / correct" — not "数学的な問題" (a topic, not a claim).
  "数学的(?:な|に)?\\s*(?:正し|保証|証明|間違|正確|厳密)",
  `${ERROR_WORD}[^。！？]{0,12}?${NEGATION}`, // keep last: CLAIM_NO_ERROR_RE drops it
];
const CLAIM_RE = new RegExp(CLAIM_PARTS.join("|"), "u");
const CLAIM_NO_ERROR_RE = new RegExp(CLAIM_PARTS.slice(0, -1).join("|"), "u");
// Who says so, named, in the same sentence: "TypeSafe によると",
// "LiteLLM の検証では", "同社は…と説明しています", "日経新聞によると".
// A bare "比較では" / "テストによると" names nobody and does not count.
const SOURCE_NAME = "(?:TypeSafe(?:\\s*AI)?|タイプセーフ|同社|開発元|開発会社|[A-Za-z][A-Za-z0-9.&'\\- ]{1,40}|[\\u4E00-\\u9FFF\\u30A0-\\u30FF]{1,12}(?:社|新聞|誌|紙|通信))";
const ATTRIBUTION_RE = new RegExp(
  `${SOURCE_NAME}(?:さん|氏|CEO|社)?\\s*(?:の(?:検証|測定|計測|テスト|比較|発表|調査|評価|ベンチマーク|まとめ|記事|投稿|ポスト)(?:では|によると|によれば)|によると|によれば|の主張|は[^。！？]*?(?:と主張|と説明|と発表|としています|とうたって|と話して|と述べて))`,
  "u"
);

export function hasClaim(text) {
  return CLAIM_RE.test(normalizeForChecks(text));
}

/** Whether a sentence names who makes its claim. */
export function isAttributed(sentence) {
  return ATTRIBUTION_RE.test(normalizeForChecks(sentence));
}

/** Sentences that state a claim without saying whose claim it is. */
export function unattributedClaims(text) {
  const norm = normalizeForChecks(text);
  return norm
    .split(/(?<=[。！？!?])/)
    .map((s) => s.trim())
    .filter((s) => s && CLAIM_RE.test(s) && !ATTRIBUTION_RE.test(s));
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

// Query parameters that only say where a click came from. Everything else in
// the query identifies the page (news.ycombinator.com/item?id=…, youtube watch?v=…).
const TRACKING_PARAM_RE = /^(?:utm_.*|ref|ref_src|ref_url|s|t|source|fbclid|gclid|mc_cid|mc_eid|igshid|si)$/i;

/** Canonical form for "same source" checks: host without www, no tracking query, no hash, no trailing slash. */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^mobile\./, "").replace(/^twitter\.com$/, "x.com");
    const path = u.pathname.replace(/\/+$/, "") || "";
    const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM_RE.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
    return `${host}${path.toLowerCase()}${query}`;
  } catch {
    return String(url ?? "").trim().toLowerCase();
  }
}

export function isOfficialUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (OFFICIAL_HOST_RE.test(host)) return true;
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  return OFFICIAL_PATHS.some(([h, p]) => host === h && (path === p || path.startsWith(`${p}/`)));
}

function urlProblems(url, label) {
  if (!isHttpsUrl(url)) return [`${label}: must be an https URL`];
  const host = hostOf(url).replace(/^www\./, "");
  if (LOOKALIKE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return [`${label}: ${host} is a look-alike site, not TypeSafe — never use it as a source`];
  }
  if (SHORTENER_HOSTS.includes(host)) return [`${label}: use the full URL, not a shortener (${host})`];
  if (charLength(url) > 300) return [`${label}: URL longer than 300 chars`];
  return [];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// ---------------------------------------------------------------------------
// Series position
// ---------------------------------------------------------------------------

/**
 * What the next episode must be, from the episodes posted so far.
 * Returns { stage, stageEpisode, kinds, topicKey?, theme?, usecaseCount, canAdvanceEarly }.
 */
export function nextSlot(previous, series = SERIES.jev) {
  // The news series has no stages: every day is the next news episode.
  if (!series.staged) return { episode: previous.length + 1, kinds: series.kinds };
  // stage_episode counts every aired episode of the stage (fillers included);
  // what moves the series on is the intros / use cases actually aired.
  const inStage = (stage) => previous.filter((e) => e.stage === stage).length + 1;
  const doneIntros = new Set(previous.filter((e) => e.kind === "intro").map((e) => e.topic_key));
  const nextIntro = INTRO_TOPICS.find((t) => !doneIntros.has(t.key));
  const usecaseCount = previous.filter((e) => e.kind === "usecase").length;
  if (nextIntro) {
    return {
      stage: 1,
      stageEpisode: inStage(1),
      kinds: KINDS_BY_STAGE[1],
      topicKey: nextIntro.key,
      theme: nextIntro.theme,
      usecaseCount,
      canAdvanceEarly: false,
    };
  }
  const reachedStage3 = previous.some((e) => e.stage === 3);
  if (!reachedStage3 && usecaseCount < USECASE_TARGET) {
    return {
      stage: 2,
      stageEpisode: inStage(2),
      kinds: KINDS_BY_STAGE[2],
      usecaseCount,
      canAdvanceEarly: usecaseCount >= USECASE_MIN,
    };
  }
  return {
    stage: 3,
    stageEpisode: inStage(3),
    kinds: KINDS_BY_STAGE[3],
    usecaseCount,
    canAdvanceEarly: false,
  };
}

// ---------------------------------------------------------------------------
// Episodes that did not go out: explicit redo, never inferred from time
// ---------------------------------------------------------------------------
//
// A ledger entry counts as aired unless a LATER entry says `redo_of: "<its
// date>"`. That marker is permanent data, so the chain never changes with the
// passing of time (no look-back window) and a redone entry never comes back.
//
// The routine only writes `redo_of` after `node scripts/jev.mjs aired-check`
// found the day's posting runs and neither upload's success line in their
// logs. A missing history record alone is not enough: record-upload or the
// history push can fail after a successful upload, and redoing then would
// post the same episode twice. aired-check always checks the redo candidate
// (the latest aired entry) and is the only place a redo slot is printed, and
// `jev.mjs validate` re-runs the check on the `redo_of` date itself — so a
// not-posted verdict for another day (two unrecorded days in a row) can never
// unlock a redo of the latest one. The validator additionally refuses a redo
// of a day that the history does show as posted.

/** Success lines printed by upload-youtube.mjs / upload-instagram.mjs. */
const POSTED_LOG_RE = /Uploaded! https:\/\/|YouTube upload complete: https:\/\/|Published! Media ID: \S+/;
/** First lines of an upload attempt (printed after the credential checks). */
const UPLOAD_STARTED_RE = /YouTube: uploading |Instagram: uploading Reel/;

/**
 * Verdict for one day from every attempt of its posting runs (daily-video.yml
 * and post-today-instagram.yml on main): [{ id, attempt, status, conclusion, log }].
 * A success line in any attempt → "posted". "not-posted" needs every attempt
 * to have finished as success / failure with a readable log: a run cut off
 * (cancelled, timed_out, …) may have uploaded before printing its success
 * line. Anything else is "unknown" with the reason, and never allows a redo.
 */
export function classifyPostLogs(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return { verdict: "unknown", reason: "no-runs: no posting run on main that day" };
  const posted = attempts.find((a) => POSTED_LOG_RE.test(String(a.log ?? "")));
  if (posted) return { verdict: "posted", reason: `success line in run ${posted.id} attempt ${posted.attempt}` };
  const running = attempts.find((a) => a.status !== "completed");
  if (running) return { verdict: "unknown", reason: `in-progress: run ${running.id} attempt ${running.attempt} is ${running.status}` };
  const cut = attempts.find((a) => a.conclusion !== "success" && a.conclusion !== "failure");
  if (cut) return { verdict: "unknown", reason: `interrupted: run ${cut.id} attempt ${cut.attempt} ended ${cut.conclusion} (it may have uploaded before its success line)` };
  const empty = attempts.find((a) => String(a.log ?? "").trim().length === 0);
  if (empty) return { verdict: "unknown", reason: `empty-log: run ${empty.id} attempt ${empty.attempt}` };
  // An upload that started and then failed may still have gone through (a lost
  // response, a publish that errored after publishing).
  const started = attempts.find((a) => UPLOAD_STARTED_RE.test(String(a.log)));
  if (started) return { verdict: "unknown", reason: `upload-started: run ${started.id} attempt ${started.attempt} began an upload but shows no success line` };
  return { verdict: "not-posted", reason: `no success line in ${attempts.length} attempt(s)` };
}

/** Why a gh call failed: a short code + gh's first line (gh never prints the token). */
export function ghFailure(err) {
  if (err?.code === "ENOENT") return "gh-missing: the gh CLI is not installed";
  const text = `${err?.stderr ?? ""}\n${err?.message ?? err}`;
  const line = text.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 160) ?? "";
  if (/HTTP 403|Resource not accessible/i.test(text)) return `forbidden: ${line} (the token cannot read Actions — it needs actions:read)`;
  if (/HTTP 401|gh auth login|not logged in|authenticat/i.test(text)) return `not-authenticated: ${line}`;
  if (/HTTP 404/i.test(text)) return `not-found: ${line} (is the repo visible to the token?)`;
  if (err?.code === "ETIMEDOUT" || err?.signal) return `timeout: ${line}`;
  return `gh-error: ${line}`;
}

/** Dates taken out of the chain by a `redo_of` of an entry up to and including `index`. */
function redoneDates(eps, index) {
  return new Set(eps.slice(0, index + 1).map((e) => e.redo_of).filter(Boolean));
}

/**
 * Entries before `date` (not redone) that have no post record in the history
 * and come after the last recorded Jev post — candidates for aired-check.
 * Informational only: they still count as aired until a redo says otherwise.
 */
export function unrecordedEpisodes(episodes, history, date, genre = JEV_GENRE) {
  if (!history || !Array.isArray(history.videos)) return [];
  const recorded = history.videos.filter((v) => v?.genre === genre && !v.skip).map((v) => v.date);
  const last = recorded.sort().at(-1) ?? "";
  const redone = new Set(episodes.map((e) => e.redo_of).filter(Boolean));
  return episodes.filter((e) => e.date < date && e.date > last && !redone.has(e.date) && !recorded.includes(e.date));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function lengthProblem(value, [min, max], label) {
  if (typeof value !== "string" || !value.trim()) return `${label}: required`;
  const n = charLength(value.trim());
  if (n < min || n > max) return `${label}: ${n} chars (allowed ${min}-${max})`;
  return null;
}

function textProblems(value, label) {
  const problems = textSafetyProblems(value).map((p) => `${label}: ${p}`);
  // YouTube rejects a description containing < or > (the upload fails).
  if (typeof value === "string" && /[<>＜＞]/.test(value)) problems.push(`${label}: no < or > (YouTube rejects them); write → or 「」 instead`);
  return problems;
}

// Money is written in yen only (owner decision 2026-10-06): a number right
// before ドル/セント, 米ドル, $ or USD. ハードル / ミドル / ハンドル stay allowed.
const DOLLAR_RE = /[0-9０-９一二三四五六七八九十百千万億兆数]\s*(?:ドル|セント|dollars?\b|cents?\b)|(?:米国?|US\s*)ドル|[$＄]|(?<![A-Za-z])USD(?![A-Za-z])/i;

/** Text shown in the video, the title or the caption — not sources (their titles quote the page). */
function shownTextProblems(value, label) {
  const problems = textProblems(value, label);
  if (typeof value === "string" && DOLLAR_RE.test(value)) problems.push(`${label}: no dollar amounts — convert to yen at the rough current rate (e.g. 約3,000円)`);
  return problems;
}

/** Minimal shape every ledger entry needs for the order and repeat checks. */
function ledgerProblems(ep, i, series) {
  const at = `episodes[${i}]`;
  const errors = [];
  if (!ep || typeof ep !== "object") return [`${at}: must be an object`];
  if (!isRealDate(ep.date)) errors.push(`${at}.date: must be YYYY-MM-DD`);
  if (!series.staged) {
    if (!series.kinds.includes(ep.kind)) errors.push(`${at}.kind: must be ${series.kinds.map((k) => `"${k}"`).join(" / ")}`);
    // Yesterday's news posted a day late is stale: this series never redoes a day.
    if (ep.redo_of != null) errors.push(`${at}.redo_of: the ${series.format} series does not redo a missed day — write today's episode instead`);
  } else if (![1, 2, 3].includes(ep.stage)) errors.push(`${at}.stage: must be 1, 2 or 3`);
  else if (!(KINDS_BY_STAGE[ep.stage] || []).includes(ep.kind)) {
    errors.push(`${at}.kind: ${JSON.stringify(ep.kind)} is not a kind of stage ${ep.stage} (${(KINDS_BY_STAGE[ep.stage] || []).join(" / ")})`);
  }
  if (typeof ep.topic_key !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ep.topic_key) || ep.topic_key.length > 60) {
    errors.push(`${at}.topic_key: lowercase-hyphen slug, up to 60 chars`);
  }
  if (!Array.isArray(ep.sources)) errors.push(`${at}.sources: must be an array`);
  if (ep.redo_of != null && !isRealDate(ep.redo_of)) errors.push(`${at}.redo_of: the YYYY-MM-DD of the episode this one redoes`);
  return errors;
}

function primaryUrls(ep) {
  const role = PRIMARY_ROLE[ep.kind];
  if (!role || !Array.isArray(ep.sources)) return [];
  return ep.sources.filter((s) => s?.role === role).map((s) => normalizeUrl(s.url));
}

/**
 * Validate the ledger and fully check one episode (the one to post).
 * @returns {{ errors: string[], warnings: string[], episode: object|null, slot: object|null }}
 */
export function validateEpisodes(file, { date = todayJst(), today = todayJst(), pickLatest = false, history = null, checkAired = null, series = SERIES.jev, look = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!file || typeof file !== "object" || !Array.isArray(file.episodes)) {
    return { errors: ['top level must be { "episodes": [...] }'], warnings, episode: null, slot: null };
  }
  const eps = file.episodes;
  eps.forEach((ep, i) => errors.push(...ledgerProblems(ep, i, series)));
  if (errors.length > 0) return { errors, warnings, episode: null, slot: null };

  for (let i = 1; i < eps.length; i++) {
    if (!(eps[i - 1].date < eps[i].date)) errors.push(`episodes[${i}].date: dates must be unique and ascending (${eps[i - 1].date} → ${eps[i].date})`);
  }

  const index = pickLatest ? eps.length - 1 : eps.findIndex((e) => e.date === date);
  if (index < 0) {
    errors.push(`no episode for ${date} (the routine appends today's episode to ${series.episodesPath})`);
    return { errors, warnings, episode: null, slot: null };
  }
  const ep = eps[index];
  const at = `episode ${ep.date}`;

  // Redone entries (a later entry's redo_of) never went out: they leave the
  // chain for good. Everything else counts as aired.
  const redone = redoneDates(eps, index);
  eps.slice(0, index + 1).forEach((e, i) => {
    if (e.redo_of && !eps.slice(0, i).some((p) => p.date === e.redo_of)) errors.push(`episode ${e.date}.redo_of: no earlier episode dated ${e.redo_of}`);
  });
  const chain = eps.slice(0, index + 1).filter((e) => !redone.has(e.date));
  const previous = chain.slice(0, -1);
  if (ep.redo_of) {
    // Only the latest entry can be redone: once the series moved past it,
    // taking it out would reorder what already aired.
    const beforeRedo = eps.slice(0, index).filter((e) => !redoneDates(eps, index - 1).has(e.date));
    if (beforeRedo.at(-1)?.date !== ep.redo_of) {
      errors.push(`${at}.redo_of: only the latest episode (${beforeRedo.at(-1)?.date ?? "none"}) can be redone, not ${ep.redo_of} — the series has moved past it`);
    }
    const postedThatDay = (history?.videos || []).some((v) => v?.genre === series.genre && !v.skip && v.date === ep.redo_of);
    if (postedThatDay) errors.push(`${at}.redo_of: ${ep.redo_of} is recorded as posted in performance-history.json — redoing it would post it twice`);
    // The CLI passes the live gh check: the redone day itself must read not-posted.
    if (checkAired) {
      const r = checkAired(ep.redo_of);
      if (r?.verdict !== "not-posted") errors.push(`${at}.redo_of: aired-check ${ep.redo_of} says ${r?.verdict ?? "nothing"}${r?.reason ? ` (${r.reason})` : ""} — only a day whose posting logs say not-posted can be redone`);
    }
  }
  for (const e of unrecordedEpisodes(eps.slice(0, index), history, ep.date, series.genre)) {
    warnings.push(`${e.date} "${e.topic_key}" has no post record — counted as aired; ${series.staged ? `run "node scripts/jev.mjs aired-check" and redo only with the redoSlot it prints` : `the ${series.format} series does not redo a day (its topic stays used)`}`);
  }

  // Series order. Every aired entry is checked against the ones before it,
  // so a ledger edited out of order fails too (not just today's entry).
  if (series.staged) chain.forEach((e, i) => errors.push(...orderProblems(e, chain.slice(0, i), `episode ${e.date}`)));
  const slot = nextSlot(previous, series);

  // No repeats: topic_key once, the day's primary source once.
  const seenKeys = new Map();
  const seenPrimary = new Map();
  for (const e of chain) {
    if (seenKeys.has(e.topic_key)) errors.push(`episode ${e.date}: topic_key "${e.topic_key}" was already used on ${seenKeys.get(e.topic_key)}`);
    else seenKeys.set(e.topic_key, e.date);
    for (const u of primaryUrls(e)) {
      if (seenPrimary.has(u)) errors.push(`episode ${e.date}: source ${u} already carried the ${seenPrimary.get(u)} episode — find something not posted yet`);
      else seenPrimary.set(u, e.date);
    }
  }
  const headlines = new Map(previous.filter((e) => typeof e.headline === "string").map((e) => [normalizeForChecks(e.headline).replace(/\s+/g, ""), e.date]));
  const ownHeadline = normalizeForChecks(ep.headline ?? "").replace(/\s+/g, "");
  if (headlines.has(ownHeadline)) errors.push(`${at}: headline is the same as ${headlines.get(ownHeadline)}`);

  // The ledger is edited by the routine itself; performance-history.json is
  // written by Actions when a post goes live. A posted episode missing from
  // the ledger (or re-keyed) would silently re-open its topic and sources.
  const posted = (history?.videos || []).filter((v) => v?.genre === series.genre && !v.skip && v.jev && v.date < ep.date);
  const ownPrimary = new Set(primaryUrls(ep));
  for (const v of posted) {
    const kept = eps.find((e) => e.date === v.date);
    // A stock lesson posted at 08:15 (lessonFallback) never was in the ledger; its key still counts below.
    if (!v.jev.fallback && (!kept || kept.topic_key !== v.jev.topicKey)) {
      errors.push(`ledger: the ${v.date} episode ("${v.jev.topicKey}") was posted but is missing or changed in ${series.episodesPath} — restore it (past episodes are never rewritten)`);
    }
    if (v.jev.topicKey === ep.topic_key) errors.push(`${at}: topic_key "${ep.topic_key}" was already posted on ${v.date}`);
    for (const s of v.jev.sources || []) {
      // News never reuses a page in any role; Jev only guards the carrying source.
      const own = series.staged ? ownPrimary : new Set((ep.sources || []).map((x) => normalizeUrl(x?.url)));
      // A lesson may cite the same help page again (its reference sources are not the content).
      if (((!series.staged && ep.kind === "news") || s.role === PRIMARY_ROLE[v.jev.kind]) && own.has(normalizeUrl(s.url))) errors.push(`${at}: source ${s.url} was already posted on ${v.date}`);
    }
  }

  // Today's episode: full content check.
  if (!pickLatest && ep.date !== today) errors.push(`${at}: date is not today (${today})`);
  if (ep.genre !== series.genre) errors.push(`${at}.genre: must be "${series.genre}"`);
  if (ep.trial !== series.trial) errors.push(`${at}.trial: must be ${series.trial}`);
  for (const [field, limits] of [["topic", LIMITS.topic], ["headline", LIMITS.headline], ["hook", LIMITS.hook]]) {
    const p = lengthProblem(ep[field], limits, `${at}.${field}`);
    if (p) errors.push(p);
    errors.push(...shownTextProblems(ep[field], `${at}.${field}`));
  }
  for (const u of unattributedClaims(ep.hook ?? "")) errors.push(`${at}.hook: claim without its source — "${u}" (write ${series.attributionHint})`);
  if (hasClaim(ep.headline ?? "")) errors.push(`${at}.headline: no speed/cost/"no hallucination" claim in the headline (put it on a slide with claim_source)`);

  errors.push(...slideProblems(ep, at, series));
  warnings.push(...diagramWarnings(ep, at, series));
  errors.push(...sourceProblems(ep, previous, at, today, warnings, series));
  if (series.format === "lesson") {
    const lesson = lessonProblems(ep, at, previous, posted, history, look ?? readLessonLook());
    errors.push(...lesson.errors);
    warnings.push(...lesson.warnings);
  }

  const r = ep.research;
  const checkedLimits = series.checkedLimits ?? LIMITS.checked;
  if (r == null && checkedLimits[0] === 0) {
    // An evergreen lesson needs no research record.
  } else if (!r || typeof r !== "object" || !Array.isArray(r.checked)) {
    errors.push(`${at}.research.checked: list the URLs you checked today`);
  } else {
    if (r.checked.length < checkedLimits[0] || r.checked.length > checkedLimits[1]) errors.push(`${at}.research.checked: ${r.checked.length} URLs (allowed ${checkedLimits.join("-")})`);
    r.checked.forEach((u, i) => errors.push(...urlProblems(u, `${at}.research.checked[${i}]`)));
  }
  if (ep.kind === "explainer") {
    const p = lengthProblem(r?.no_news_reason, LIMITS.reason, `${at}.research.no_news_reason`);
    const why = ep.stage === 3 ? "why there was no new information" : `why today's stage-${ep.stage} ${ep.stage === 1 ? "intro" : "use case"} could not be written (the filler does not advance the stage)`;
    if (p) errors.push(`${p} — an explainer day records ${why}`);
  }
  if (ep.stage === 3 && slot.stage === 2) {
    const p = lengthProblem(r?.stage2_exhausted_reason, LIMITS.reason, `${at}.research.stage2_exhausted_reason`);
    if (p) errors.push(`${p} — stage 3 before ${USECASE_TARGET} use cases needs the reason no unused example was found`);
  }

  // The opening label counts use cases only (fillers in between do not shift it).
  return { errors, warnings, episode: ep, slot, usecaseNumber: ep.kind === "usecase" ? slot.usecaseCount + 1 : null };
}

function orderProblems(ep, previous, at) {
  const slot = nextSlot(previous);
  // An intro key belongs to its intro episode; a filler cannot take it.
  // The intro- prefix belongs to the stage-1 intros; a filler or any other kind cannot take it.
  if (ep.kind !== "intro" && ep.topic_key.startsWith("intro-")) return [`${at}: "${ep.topic_key}" starts with "intro-", which is reserved for the stage-1 intros; a ${ep.kind} needs its own topic_key`];
  if (slot.stage === 1) {
    if (ep.stage !== 1) return [`${at}: stage ${ep.stage} is not allowed yet — stage 1 continues with "${slot.topicKey}" (${slot.theme})`];
    // An explainer is the filler for a day the intro cannot be written.
    if (ep.kind === "intro" && ep.topic_key !== slot.topicKey) return [`${at}: stage 1 must post "${slot.topicKey}" next, got "${ep.topic_key}"`];
  } else if (slot.stage === 2) {
    const early = ep.stage === 3 && slot.canAdvanceEarly;
    if (ep.stage !== 2 && !early) {
      return [`${at}: stage 2 continues (use case ${slot.stageEpisode} of ${USECASE_TARGET}${slot.stageEpisode > USECASE_MIN ? "; stage 3 is allowed with research.stage2_exhausted_reason" : ""})`];
    }
  } else if (ep.stage !== 3) {
    return [`${at}: the series is in stage 3; stage ${ep.stage} is over`];
  }
  const expectedEpisode = ep.stage === slot.stage ? slot.stageEpisode : 1;
  if (ep.stage_episode !== expectedEpisode) return [`${at}.stage_episode: must be ${expectedEpisode} (episode number within stage ${ep.stage})`];
  return [];
}

function slideProblems(ep, at, series) {
  const errors = [];
  const slides = ep.slides;
  if (!Array.isArray(slides) || slides.length < LIMITS.slides[0] || slides.length > LIMITS.slides[1]) {
    return [`${at}.slides: ${LIMITS.slides.join("-")} slides`];
  }
  let total = 0;
  slides.forEach((s, i) => {
    const sat = `${at}.slides[${i}]`;
    if (series.format !== "lesson" && DIAGRAM_SENTENCE.has(s?.diagram?.type)) errors.push(`${sat}.diagram: "${s.diagram.type}" is for the lesson format only`);
    for (const [field, limits] of [["heading", LIMITS.heading], ["body", LIMITS.body], ["narration", LIMITS.narration]]) {
      const p = lengthProblem(s?.[field], limits, `${sat}.${field}`);
      if (p) errors.push(p);
      errors.push(...shownTextProblems(s?.[field], `${sat}.${field}`));
    }
    total += charLength(s?.narration ?? "");
    for (const u of unattributedClaims(s?.narration ?? "")) errors.push(`${sat}.narration: claim without its source — "${u}" (write ${series.attributionHint})`);
    // Screen text is too short for "TypeSafe によると", so the card carries a
    // "whose claim" label instead.
    const onScreenClaim = hasClaim(s?.heading ?? "") || hasClaim(s?.body ?? "");
    if (s?.claim_source != null) {
      const p = lengthProblem(s.claim_source, LIMITS.claimSource, `${sat}.claim_source`);
      if (p) errors.push(p);
      errors.push(...shownTextProblems(s.claim_source, `${sat}.claim_source`));
      if (hasClaim(s.claim_source)) errors.push(`${sat}.claim_source: a label says whose claim it is, not the claim itself (e.g. ${series.claimSourceHint})`);
    } else if (onScreenClaim) {
      errors.push(`${sat}: the screen text states a claim — set claim_source (e.g. ${series.claimSourceHint})`);
    }
  });
  if (total > LIMITS.narrationTotal) errors.push(`${at}.slides: narration total ${total} chars (max ${LIMITS.narrationTotal}, the video must stay under 60 s)`);
  return errors;
}

// The top half as a picture (owner 2026-10-06): the diagram shows the order,
// May's bubble says the words. Optional and never fatal — a slide whose
// diagram is missing or broken keeps the old heading + body card.
// Item counts per type: steps = 手順 1→2(→3), flow = 入力→処理→出力, compare = 前/後・A/B.
// prompt / answer (lesson, 2026-10-22): one box with the copy-paste request typed into an AI, and the
// example of what comes back — the sentence itself is the content there, so it may be long.
export const DIAGRAM_TYPES = { steps: [2, 3], flow: [3, 3], compare: [2, 2], prompt: [1, 1], answer: [1, 1] };
// Per type: a flow box is ~210 px wide, so its words are shorter (12 chars wrapped to 4 lines and pushed the source line into May).
const DIAGRAM_LABEL = { steps: [1, 12], flow: [1, 8], compare: [1, 12], prompt: [12, 70], answer: [8, 60] };
const DIAGRAM_NOTE = { flow: [1, 6], compare: [1, 8] };
const DIAGRAM_TOTAL = 40;
const DIAGRAM_SENTENCE = new Set(["prompt", "answer"]);
// A label this long that the narration also says word for word is the bubble twice.
const DIAGRAM_ECHO_MIN = 8;
const FLOW_LATIN_MAX = 8;

// A box that answers an error word: optional "Jev は/なら/では/:", optional adverb, then the negation or a bare 0
// ("一切しない", "ほぼゼロ", "Jevは0件", "完全になくなる", "0").
const BOX_NEGATION_RE = new RegExp(
  `^\\s*(?:Jev\\s*(?:は|なら|では|[:：])?\\s*)?(?:ほぼ|一切|まったく|全く|完全に|絶対に?|原理的に)?\\s*(?:${WIDE_NEGATION}|0(?:\\.0+)?\\s*$)`,
  "u"
);
const ERROR_WORD_RE = new RegExp(WIDE_ERROR_WORD, "u");
// One box is a few words, so the wide pair is safe there ("ハルシネーション無し", "誤答ゼロ").
const BOX_CLAIM_RE = new RegExp(`${WIDE_ERROR_WORD}[^。！？]{0,12}?${WIDE_NEGATION}`, "u");
/** A claim the viewer reads across the heading and the boxes: "40〜200" | "倍", a compare row
 *  "40〜200" ‖ "倍速い", or an error word answered by a box that opens with the negation
 *  ("ハルシネーションの数" + "Jev: しない", "型エラー" → "ゼロ"). Unrelated boxes are not glued
 *  ("型エラーとは" + "型が合わない" is an explainer, not "no type errors"). */
function splitClaim(heading, items) {
  const boxes = items.filter((it) => it && typeof it === "object");
  const text = (v) => (typeof v === "string" ? normalizeForChecks(v) : "");
  const parts = [text(heading), ...boxes.map((it) => text(it.note) + text(it.label)), ...boxes.map((it) => text(it.label))].filter(Boolean);
  for (const a of parts) for (const b of parts) if (a !== b && CLAIM_NO_ERROR_RE.test(a + b)) return true;
  const labels = boxes.map((it) => text(it.label));
  if (boxes.some((it) => BOX_CLAIM_RE.test(text(it.note) + text(it.label)))) return true;
  // The error word may sit in the heading, another box, or this box's own column title.
  const before = [text(heading), ...boxes.map((it) => text(it.note) + text(it.label))];
  return labels.some((l, i) => BOX_NEGATION_RE.test(l) && before.some((p, j) => ERROR_WORD_RE.test(j === i + 1 ? text(boxes[i].note) : p)));
}

/** Why `slide.diagram` cannot be drawn ([] = fine, or no diagram at all). */
export function diagramProblems(slide) {
  const d = slide?.diagram;
  if (d == null) return [];
  if (typeof d !== "object" || Array.isArray(d)) return ["must be an object { type, items }"];
  // hasOwn: "constructor" / "toString" would otherwise come back from the prototype.
  const counts = typeof d.type === "string" && Object.hasOwn(DIAGRAM_TYPES, d.type) ? DIAGRAM_TYPES[d.type] : null;
  if (!counts) return [`type must be ${Object.keys(DIAGRAM_TYPES).join(" / ")}`];
  if (!Array.isArray(d.items) || d.items.length < counts[0] || d.items.length > counts[1]) {
    return [`${d.type} takes ${counts[0] === counts[1] ? counts[0] : counts.join("-")} items`];
  }
  const problems = [];
  const narration = normalizeForChecks(slide.narration ?? "").replace(/\s+/g, "");
  let total = 0;
  d.items.forEach((it, i) => {
    const at = `items[${i}]`;
    if (!it || typeof it !== "object") return problems.push(`${at}: must be an object { label, note }`);
    const fields = [["label", DIAGRAM_LABEL[d.type]]];
    const noteGiven = it.note != null && !(typeof it.note === "string" && !it.note.trim());
    if (d.type === "compare" || noteGiven) fields.push(["note", DIAGRAM_NOTE[d.type] ?? DIAGRAM_NOTE.compare]);
    for (const [field, limits] of fields) {
      const p = lengthProblem(it[field], limits, `${at}.${field}`);
      if (p) problems.push(d.type === "compare" && field === "note" ? `${p} (the column title, e.g. "前" / "後")` : p);
      problems.push(...shownTextProblems(it[field], `${at}.${field}`));
      if (typeof it[field] !== "string") continue;
      total += charLength(it[field].trim());
      if (hasClaim(it[field]) && !slide.claim_source) problems.push(`${at}.${field}: states a claim — the slide needs claim_source`);
      const flat = normalizeForChecks(it[field]).replace(/\s+/g, "");
      // Names ("TypeSafe", "Haiku 4.5") may repeat; a Japanese phrase may not.
      if (!DIAGRAM_SENTENCE.has(d.type) && charLength(flat) >= DIAGRAM_ECHO_MIN && /[\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}]/u.test(flat) && narration.includes(flat)) problems.push(`${at}.${field}: the narration says "${it[field].trim()}" word for word — the picture uses short words, the bubble the sentence`);
    }
    if ((d.type === "steps" || DIAGRAM_SENTENCE.has(d.type)) && noteGiven) problems.push(`${at}.note: ${d.type} takes a label only`);
    // A flow box is ~210 px wide: a longer Latin word breaks mid-word ("OpenRou|terAPI").
    const latin = typeof it.label === "string" ? Math.max(0, ...(it.label.match(/[A-Za-z0-9.]+/g) || []).map((w) => w.length)) : 0;
    if (d.type === "flow" && latin > FLOW_LATIN_MAX) problems.push(`${at}.label: a Latin word of ${latin} letters does not fit a flow box (max ${FLOW_LATIN_MAX}) — shorten the name or use steps / compare`);
    // On screen the column title and its value read as one phrase ("精度" + "100%", "料金" + "42ドル").
    if (typeof it.note === "string" && typeof it.label === "string") {
      const both = `${it.note}${it.label} ${it.label}${it.note}`;
      if (hasClaim(both) && !hasClaim(it.label) && !hasClaim(it.note) && !slide.claim_source) problems.push(`${at}: "${it.note}" + "${it.label}" states a claim — the slide needs claim_source`);
      if (DOLLAR_RE.test(both) && !DOLLAR_RE.test(it.label) && !DOLLAR_RE.test(it.note)) problems.push(`${at}: "${it.note}" + "${it.label}" is a dollar amount — convert to yen`);
    }
  });
  // The viewer reads the heading and the boxes together: a claim split over them
  // ("ハルシネーションの数" + "Jev: しない", "型エラー" → "ゼロ") still needs claim_source.
  if (!slide.claim_source && !problems.some((p) => /claim/.test(p)) && splitClaim(slide.heading, d.items)) {
    problems.push(`the heading and the boxes together state a claim — the slide needs claim_source`);
  }
  if (!DIAGRAM_SENTENCE.has(d.type) && total > DIAGRAM_TOTAL) problems.push(`${total} chars in the picture (max ${DIAGRAM_TOTAL} — fewer words)`);
  return problems;
}

/** Warnings only: the post goes out either way. */
function diagramWarnings(ep, at, series) {
  if (!Array.isArray(ep.slides)) return [];
  const warnings = ep.slides.flatMap((s, i) => diagramProblems(s).map((p) => `${at}.slides[${i}].diagram: ${p} — this slide falls back to heading + body`));
  if (!ep.slides.some((s) => s?.diagram != null)) warnings.push(`${at}: no slide has a diagram — the top half stays text (add slides[].diagram, ${series.routinePrompt})`);
  return warnings;
}

/** The diagram as the video draws it, or null (then the card shows heading + body). */
export function videoDiagram(slide) {
  if (slide?.diagram == null || diagramProblems(slide).length > 0) return null;
  const { type, items } = slide.diagram;
  return { type, items: items.map((it) => ({ label: it.label.trim(), note: typeof it.note === "string" && it.note.trim() ? it.note.trim() : null })) };
}

// ---------------------------------------------------------------------------
// Lesson (genre trial #4): 困りごと → 頼み方 (prompt) → 答えの例 (answer) → 注意
// ---------------------------------------------------------------------------

// Never recommend a paid plan (owner 2026-10-22): the viewer is a beginner on whatever AI they have.
const LESSON_PAID_RE = /有料(?:プラン|版|会員)|課金|月額|年額|サブスク|(?:ChatGPT|Claude|Gemini|Copilot|Perplexity)\s*(?:Plus|Pro|Max|Team|Enterprise|Advanced|Business|Premium)|(?<![A-Za-z])(?:Plus|Pro|Max|Premium|Advanced|Team)\s*(?:プラン|版)/i;
// No get-rich / magic talk (「誰でも月◯万」 and the like).
const LESSON_HYPE_RE = /(?:誰|だれ)でも(?:簡単|かんたん|すぐ|月|稼|儲|できる)|月(?:収|に)?\s*[0-9０-９一二三四五六七八九十百千]+\s*万|(?:お金|万円?|円|収入)を?稼|稼げ|儲か|儲け|副業|不労|楽して(?:稼|儲|お金)|放置で|爆速|神(?:ツール|プロンプト|機能|技)|最強|革命|激変|魔法の|一瞬で|必勝|裏技|知らないと損|[0-9０-９]+\s*倍(?:速|早|も速|の効率)/;
// A prompt that works on pasted text ("次の文章を…", "このスライドの…") puts work text into an AI:
// slide 2's narration or slide 4 must say to strip / pseudonymise it or check the company's rule.
// Broad on purpose: a false hit only asks for one more sentence of caution.
// 「この〜」 is any noun (このデータ / この内容 / この一文 …), except mid-word hits (かっこの・どこの).
export const LESSON_PASTE_RE = /貼|下記|上記|以下|次の|つぎの|(?<![っこそど])この|ここの|これを|こちらの|下の|上の|添付|届いた|メモを|議事録/u;
// Slide 2's body / narration talk about the prompt itself (「この一文を送ります」): not a paste. The prompt is never stripped.
const LESSON_SELF_RE = /この(?:一文|頼み方|ように|まま|コツ|ひと言|ひとこと)/gu;
export const LESSON_PRIVACY_RE =/社外秘|個人情報|個人名|人の名前|仮名|会社のルール|会社の決まり/u;
// AI Trend Daily covers GitHub; this channel never introduces a repository.
const LESSON_GITHUB_RE = /git\s*hub|ギットハブ|リポジトリ/i;

// ---------------------------------------------------------------------------
// The step-by-step "reel" look (owner 2026-10-23: 「1回あのキャンバスに出してる案でやってみよう」).
// A lesson then also carries `reel`: the screen script — 3-5 steps, each one
// thing done in a simplified chat window (open / paste / type / send / check),
// told as 「ステップN。…」. Rendered by src/compositions/LessonReel.tsx through
// scripts/reel.mjs. Switch: data/content-format.json "lessonLook" ("reel" /
// "cards" = the 4-card look). Spec: docs/lesson-format.md §6.
// ---------------------------------------------------------------------------

export const LESSON_LOOKS = ["reel", "cards"];
/** Window actions, in the only order they can happen. type and send are always there. */
export const REEL_ACTIONS = ["open", "paste", "type", "send", "check"];
export const REEL_RECAP_NARRATION = "これで完了です。";
export const REEL_SAVE_NARRATION = "手順は、この動画の中にあります。使うときに見返せるよう、保存しておいてください。";
export const REEL_PASTE_NOTE = "名前は仮名に（Aさん・B社）";
export const REEL_PASTE_DONE = "仮名にしてある";
export const REEL_CHECK_NOTE = "仮名 → 元の名前に";
// Spoken characters, fixed lines included: ~0.2 s a character at +12% (the 見本: 241 → 52 s).
const REEL_NARRATION_TOTAL = 250;
const REEL_LIMITS = {
  title: [2, 11], // hook line 1 at 64px; line 2 is 「Nステップ」
  hook: [10, 40],
  heading: [2, 12], // the three parts together, one line at 64px
  narration: [14, 50],
  accent: [1, 8],
  file: [3, 14],
  note: [4, 16],
  done: [3, 8],
  head: [1, 10],
  line: [2, 20], // one row of the window at 32px, never wraps
};
const REEL_ANSWER_ROWS = 7;

/** "reel" or "cards". LESSON_LOOK overrides the file (verification runs); no field = "cards". */
export function readLessonLook(root = rootDir, env = process.env) {
  const fromEnv = env.LESSON_LOOK;
  if (fromEnv) {
    if (!LESSON_LOOKS.includes(fromEnv)) throw new Error(`LESSON_LOOK must be one of ${LESSON_LOOKS.join(" / ")}, got ${JSON.stringify(fromEnv)}`);
    return fromEnv;
  }
  const p = join(root, FORMAT_PATH);
  const look = existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")).lessonLook : undefined;
  if (look === undefined) return "cards";
  if (!LESSON_LOOKS.includes(look)) throw new Error(`${FORMAT_PATH}: "lessonLook" must be one of ${LESSON_LOOKS.join(" / ")}, got ${JSON.stringify(look)}`);
  return look;
}

/** Every reel string the viewer sees or hears, as [field, value]. */
function reelTexts(reel) {
  if (!reel || typeof reel !== "object") return [];
  const out = [["reel.title", reel.title], ["reel.hook", reel.hook], ["reel.file", reel.file]];
  (Array.isArray(reel.answer) ? reel.answer : []).forEach((s, i) => {
    out.push([`reel.answer[${i}].head`, s?.head]);
    (Array.isArray(s?.lines) ? s.lines : []).forEach((l, j) => out.push([`reel.answer[${i}].lines[${j}]`, l]));
  });
  (Array.isArray(reel.steps) ? reel.steps : []).forEach((s, i) => {
    (Array.isArray(s?.heading) ? s.heading : []).forEach((h, j) => out.push([`reel.steps[${i}].heading[${j}]`, h]));
    for (const f of ["narration", "note", "done"]) out.push([`reel.steps[${i}].${f}`, s?.[f]]);
  });
  return out.filter(([, v]) => typeof v === "string");
}

/** The notes the window shows: on the pasted memo, after it lands, on the checked answer ("" = none). */
export function reelNotes(reel) {
  const paste = (reel?.steps || []).find((s) => s?.action === "paste");
  const check = (reel?.steps || []).find((s) => s?.action === "check");
  return {
    paste: paste ? (paste.note ?? REEL_PASTE_NOTE) : "",
    done: paste ? (paste.done ?? REEL_PASTE_DONE) : "",
    check: check ? (check.note ?? (paste ? REEL_CHECK_NOTE : "")) : "",
  };
}

/** Problems of ep.reel (shape, lengths, order of the actions, the 社外秘 caution on screen or in the voice). */
export function reelProblems(ep, at, pastes) {
  const errors = [];
  const reel = ep.reel;
  const r = `${at}.reel`;
  if (!reel || typeof reel !== "object" || Array.isArray(reel)) return [`${r}: required while data/content-format.json "lessonLook" is "reel" — the step-by-step screen script (docs/lesson-format.md §6)`];
  const len = (v, key, label) => {
    const p = lengthProblem(v, REEL_LIMITS[key], label);
    if (p) errors.push(p);
  };
  len(reel.title, "title", `${r}.title`);
  len(reel.hook, "hook", `${r}.hook`);
  const steps = Array.isArray(reel.steps) ? reel.steps : [];
  if (steps.length < 3 || steps.length > 5) errors.push(`${r}.steps: 3-5 steps (got ${steps.length})`);
  const actions = steps.map((s) => s?.action);
  const order = actions.map((a) => REEL_ACTIONS.indexOf(a));
  if (order.some((o) => o < 0)) errors.push(`${r}.steps[].action: each one of ${REEL_ACTIONS.join(" / ")}`);
  else if (order.some((o, i) => i > 0 && o <= order[i - 1])) errors.push(`${r}.steps[].action: each action once, in the order ${REEL_ACTIONS.join(" → ")}`);
  for (const need of ["type", "send"]) if (!actions.includes(need)) errors.push(`${r}.steps: needs a "${need}" step (the prompt is typed, then sent)`);
  if (typeof reel.hook === "string" && steps.length && !reel.hook.includes(`${steps.length}つ`)) errors.push(`${r}.hook: say the number of steps as 「${steps.length}つ」 (the bars come in on that word)`);
  steps.forEach((s, i) => {
    const sa = `${r}.steps[${i}]`;
    const h = s?.heading;
    if (!Array.isArray(h) || h.length !== 3 || h.some((x) => typeof x !== "string") || !h[1]?.trim()) {
      errors.push(`${sa}.heading: ["before", "orange word", "after"] — the middle one is required`);
    } else len(h.join(""), "heading", `${sa}.heading`);
    len(s?.narration, "narration", `${sa}.narration`);
    if (typeof s?.narration === "string" && !s.narration.startsWith(`ステップ${i + 1}。`)) errors.push(`${sa}.narration: starts with 「ステップ${i + 1}。」`);
    if (s?.accents !== undefined) {
      if (!Array.isArray(s.accents) || s.accents.length > 4) errors.push(`${sa}.accents: up to 4 words`);
      else s.accents.forEach((a, j) => {
        len(a, "accent", `${sa}.accents[${j}]`);
        if (typeof a === "string" && typeof s.narration === "string" && !s.narration.includes(a)) errors.push(`${sa}.accents[${j}]: "${a}" is not in the narration (the subtitle colours it orange)`);
      });
    }
    if (s?.note !== undefined && (s.action !== "paste" && s.action !== "check")) errors.push(`${sa}.note: only a paste or check step has a note`);
    if (s?.note !== undefined && s.note !== "") len(s.note, "note", `${sa}.note`);
    if (s?.done !== undefined && s.action !== "paste") errors.push(`${sa}.done: only a paste step has done`);
    if (s?.done !== undefined && s.done !== "") len(s.done, "done", `${sa}.done`);
  });
  const answer = Array.isArray(reel.answer) ? reel.answer : [];
  if (answer.length < 1 || answer.length > 3) errors.push(`${r}.answer: 1-3 parts, each { "head": "…", "lines": ["…"] }`);
  let rows = 0;
  answer.forEach((sec, i) => {
    len(sec?.head, "head", `${r}.answer[${i}].head`);
    const lines = Array.isArray(sec?.lines) ? sec.lines : [];
    if (lines.length < 1) errors.push(`${r}.answer[${i}].lines: at least 1 line`);
    lines.forEach((l, j) => len(l, "line", `${r}.answer[${i}].lines[${j}]`));
    rows += 1 + lines.length;
  });
  if (rows > REEL_ANSWER_ROWS) errors.push(`${r}.answer: ${rows} rows (heads + lines) — up to ${REEL_ANSWER_ROWS} fit in the window`);
  const heads = answer.map((s) => s?.head);
  const check = steps.find((s) => s?.action === "check");
  if (check?.focus !== undefined) {
    if (!Array.isArray(check.focus) || check.focus.length < 1 || check.focus.length > 2) errors.push(`${r}.steps[check].focus: 1-2 answer heads`);
    else for (const f of check.focus) if (!heads.includes(f)) errors.push(`${r}.steps[check].focus: "${f}" is not a head of reel.answer`);
  }
  const hasPaste = actions.includes("paste");
  if (hasPaste) len(reel.file, "file", `${r}.file`);
  else if (reel.file !== undefined) errors.push(`${r}.file: only with a paste step`);
  if (typeof reel.file === "string" && /[\\/]/.test(reel.file)) errors.push(`${r}.file: a file name, no / or \\`);
  // Pasted work text: the window shows the paste, and the caution is on screen or in the voice.
  if (pastes && !hasPaste) errors.push(`${r}.steps: the prompt works on pasted text — add a "paste" step`);
  if (pastes || hasPaste) {
    const notes = reelNotes(reel);
    const said = [notes.paste, notes.done, notes.check, ...steps.map((s) => s?.narration)].filter((t) => typeof t === "string").join(" ");
    if (!LESSON_PRIVACY_RE.test(normalizeForChecks(said))) errors.push(`${r}: pasting work text — the paste note or a step's narration must say to make 社外秘・人の名前・社名 仮名 (A社・Bさん) first, or to check 会社のルール`);
  }
  const spoken = [reel.hook, ...steps.map((s) => s?.narration), REEL_RECAP_NARRATION, REEL_SAVE_NARRATION].filter((t) => typeof t === "string");
  const total = spoken.reduce((n, t) => n + charLength(t), 0);
  if (total > REEL_NARRATION_TOTAL) errors.push(`${r}: ${total} spoken chars with the fixed lines (allowed ${REEL_NARRATION_TOTAL}) — the video must stay under 59 s`);
  for (const [field, value] of reelTexts(reel)) {
    errors.push(...shownTextProblems(value, `${at}.${field}`));
    if (/[\n\r]/.test(value)) errors.push(`${at}.${field}: no line breaks`);
  }
  return errors;
}

function lessonShownTexts(ep) {
  const out = [["topic", ep.topic], ["headline", ep.headline], ["hook", ep.hook], ...reelTexts(ep.reel)];
  (Array.isArray(ep.slides) ? ep.slides : []).forEach((s, i) => {
    for (const f of ["heading", "body", "narration", "claim_source"]) out.push([`slides[${i}].${f}`, s?.[f]]);
    (Array.isArray(s?.diagram?.items) ? s.diagram.items : []).forEach((it, j) => {
      out.push([`slides[${i}].diagram.items[${j}].label`, it?.label]);
      out.push([`slides[${i}].diagram.items[${j}].note`, it?.note]);
    });
  });
  (Array.isArray(ep.sources) ? ep.sources : []).forEach((s, i) => out.push([`sources[${i}].outlet`, s?.outlet], [`sources[${i}].url`, s?.url]));
  return out.filter(([, v]) => typeof v === "string");
}

/** The copy-paste request shown on screen (slide 2's prompt box), or null. */
export function lessonPrompt(ep) {
  const d = Array.isArray(ep?.slides) ? ep.slides.find((s) => s?.diagram?.type === "prompt")?.diagram : null;
  return typeof d?.items?.[0]?.label === "string" ? d.items[0].label.trim() : null;
}

const KANJI_DIGITS = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9" };
function flatPrompt(s) {
  return normalizeForChecks(String(s ?? "")).toLowerCase().replace(/[一二三四五六七八九]/gu, (c) => KANJI_DIGITS[c]).replace(/[\s、。，．,.!！?？「」『』（）()［］[\]【】・:：;；"'“”‘’〜~…]/gu, "");
}

/** Character-bigram Dice coefficient of two prompts (1 = the same words). */
export function promptSimilarity(a, b) {
  const grams = (s) => {
    const c = Array.from(flatPrompt(s));
    const m = new Map();
    for (let i = 0; i < c.length - 1; i++) m.set(c[i] + c[i + 1], (m.get(c[i] + c[i + 1]) || 0) + 1);
    return { m, n: Math.max(0, c.length - 1) };
  };
  const x = grams(a);
  const y = grams(b);
  if (x.n === 0 || y.n === 0) return flatPrompt(a) === flatPrompt(b) ? 1 : 0;
  let common = 0;
  for (const [g, k] of x.m) common += Math.min(k, y.m.get(g) || 0);
  return (2 * common) / (x.n + y.n);
}

function lessonProblems(ep, at, previous, posted, history, look) {
  const errors = [];
  const warnings = [];
  const sameDay = (history?.videos || []).find((v) => v?.genre === LESSON_GENRE && !v.skip && v.date === ep.date && v.jev?.fallback);
  if (sameDay && sameDay.jev.topicKey !== ep.topic_key) errors.push(`${at}: ${ep.date} already went out from the stock ("${sameDay.jev.topicKey}") — this lesson cannot air that day; close its PR (the stock lesson is the day's record)`);
  if (!Object.hasOwn(LESSON_PILLARS, ep.pillar ?? "")) errors.push(`${at}.pillar: one of ${Object.keys(LESSON_PILLARS).join(" / ")}`);
  else if (!String(ep.topic_key).startsWith(`${ep.pillar}-`)) errors.push(`${at}.topic_key: starts with the pillar ("${ep.pillar}-…")`);
  if (!Array.isArray(ep.slides) || ep.slides.length !== 4) {
    errors.push(`${at}.slides: a lesson is 4 slides — 困りごと / 頼み方 (diagram prompt) / 答えの例 (diagram answer) / 注意`);
  } else {
    for (const [i, type] of [[1, "prompt"], [2, "answer"]]) {
      const s = ep.slides[i];
      if (s?.diagram?.type !== type) errors.push(`${at}.slides[${i}].diagram: must be { "type": "${type}", "items": [{ "label": "…" }] }`);
      else for (const p of diagramProblems(s)) errors.push(`${at}.slides[${i}].diagram: ${p}`);
    }
    for (const i of [0, 3]) if (DIAGRAM_SENTENCE.has(ep.slides[i]?.diagram?.type)) errors.push(`${at}.slides[${i}].diagram: prompt / answer belong to slides 2 and 3`);
  }
  for (const [field, value] of lessonShownTexts(ep)) {
    const t = normalizeForChecks(value);
    const paid = LESSON_PAID_RE.exec(t);
    if (paid) errors.push(`${at}.${field}: "${paid[0]}" — never recommend a paid plan; the lesson works on any AI the viewer has`);
    const hype = LESSON_HYPE_RE.exec(t);
    if (hype) errors.push(`${at}.${field}: "${hype[0]}" — no hype (誰でも・稼げる・最強・◯倍速…); say plainly what the tip does`);
    const gh = LESSON_GITHUB_RE.exec(t);
    if (gh) errors.push(`${at}.${field}: "${gh[0]}" — AI Trend Daily covers GitHub; a lesson never introduces a repository`);
  }
  const prompt = lessonPrompt(ep);
  const s1 = Array.isArray(ep.slides) ? ep.slides[1] : null;
  const pastes = (typeof prompt === "string" && LESSON_PASTE_RE.test(normalizeForChecks(prompt)))
    || [s1?.body, s1?.narration].some((t) => typeof t === "string" && LESSON_PASTE_RE.test(normalizeForChecks(t).replace(LESSON_SELF_RE, "")));
  if (pastes) {
    const s3 = ep.slides[3];
    // Only what the viewer sees or hears: a slide with a diagram shows the picture, its body only reaches the caption.
    const shown = (s) => [s?.heading, s?.narration, ...(s?.diagram ? (s.diagram.items || []).map((it) => it?.label) : [s?.body])];
    const said = [s1?.narration, ...shown(s3)].filter((t) => typeof t === "string").join(" ");
    if (!LESSON_PRIVACY_RE.test(normalizeForChecks(said))) {
      errors.push(`${at}: the prompt pastes work text — slide 2's narration or slide 4 must say to remove or pseudonymise 社外秘・人の名前・社名 (A社・Bさん) before pasting, or to check 会社のルール first`);
    }
  }
  // The reel look shows the steps, not the 4 cards: its own screen and voice carry the same caution.
  if (look === "reel" || ep.reel !== undefined) {
    errors.push(...reelProblems(ep, at, typeof prompt === "string" && LESSON_PASTE_RE.test(normalizeForChecks(prompt))));
  }
  // A spreadsheet lesson that names a function (SUMIFS, IF …) is checked against the vendor's own help page.
  if (ep.pillar === "sheet" && lessonShownTexts(ep).some(([, v]) => /(?<![A-Za-z])(?!AI(?![A-Za-z]))[A-Z]{2,}[A-Z0-9]*(?![A-Za-z])/.test(v)) && !(ep.sources || []).some((s) => s?.official === true)) {
    errors.push(`${at}.sources: a spreadsheet lesson that names a function needs the vendor's official help page (official: true), e.g. Microsoft サポートの関数のページ`);
  }
  // The same 文例 twice (word for word, or reworded a little) — ledger and post records.
  if (prompt) {
    const earlier = [
      ...previous.map((e) => ({ date: e.date, prompt: lessonPrompt(e) })),
      ...posted.map((v) => ({ date: v.date, prompt: v.jev?.prompt })),
    ].filter((e) => typeof e.prompt === "string");
    for (const e of earlier) {
      const sim = promptSimilarity(prompt, e.prompt);
      if (sim >= LESSON_PROMPT_SIMILARITY_MAX) {
        errors.push(`${at}: the prompt is the same as the ${e.date} lesson's (similarity ${sim.toFixed(2)}) — write another request (or pick another stock lesson)`);
        break;
      }
    }
  }
  const last = previous.at(-1);
  if (last?.pillar && last.pillar === ep.pillar) warnings.push(`${at}.pillar: "${ep.pillar}" again after ${last.date} — rotate the pillars`);
  return { errors, warnings };
}

/** data/ai-lesson-stock.json: { lessons: [{ topic_key, pillar, topic, headline, hook, slides, sources }] }. */
export function loadLessonStock(root = rootDir) {
  const p = join(root, LESSON_STOCK_PATH);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : { lessons: [] };
}

/** A stock lesson as today's episode. */
export function stockEpisode(lesson, date) {
  return { ...structuredClone(lesson), date, genre: LESSON_GENRE, trial: LESSON_TRIAL, kind: "lesson" };
}

/** Stock lessons not aired yet (ledger + post records), the next pillar first. */
export function unusedStock(stock, episodes, history, today) {
  const before = (episodes || []).filter((e) => e?.date < today);
  const used = new Set(before.map((e) => e.topic_key));
  const aired = before.map((e) => ({ date: e.date, prompt: lessonPrompt(e), pillar: e.pillar }));
  for (const v of history?.videos || []) {
    if (v?.genre !== LESSON_GENRE || !v.jev || v.skip || v.date >= today) continue;
    used.add(v.jev.topicKey);
    aired.push({ date: v.date, prompt: v.jev.prompt, pillar: v.jev.pillar });
  }
  const lastPillar = aired.filter((a) => a.pillar).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.pillar;
  // A stock lesson whose prompt already aired in other words could never pass the check.
  const left = (stock?.lessons || []).filter((l) => !used.has(l.topic_key) && !aired.some((a) => typeof a.prompt === "string" && promptSimilarity(lessonPrompt(l), a.prompt) >= LESSON_PROMPT_SIMILARITY_MAX));
  return [...left.filter((l) => l.pillar !== lastPillar), ...left.filter((l) => l.pillar === lastPillar)];
}

/**
 * 08:15 with no valid lesson for today (routine PR unmerged, or rejected):
 * the next unused stock lesson, checked like any episode. A re-run the same
 * day (the Instagram recovery) takes the lesson already posted that day.
 * @returns {{ episode, errors: [], warnings } | null}
 */
/** The day's stock post, if 08:15 (or a re-run) already put one out. */
export function stockPostOn(history, date) {
  return (history?.videos || []).find((v) => v?.genre === LESSON_GENRE && !v.skip && v.date === date && v.jev?.fallback) ?? null;
}

export function lessonFallback(file, stock, history, today) {
  const before = (file?.episodes || []).filter((e) => e?.date < today);
  const postedToday = stockPostOn(history, today);
  const candidates = postedToday
    ? (stock?.lessons || []).filter((l) => l.topic_key === postedToday.jev.topicKey)
    : unusedStock(stock, before, history, today);
  for (const lesson of candidates) {
    // The history's own entry for today is ignored by the checks (v.date < today).
    const r = validateEpisodes({ episodes: [...before, stockEpisode(lesson, today)] }, { date: today, today, history, series: SERIES.lesson });
    if (r.errors.length === 0) return r;
  }
  return null;
}

/** Every stock lesson checked as if aired one a day in file order (so repeats inside the stock fail too). */
export function stockProblems(stock) {
  const errors = [];
  const lessons = Array.isArray(stock?.lessons) ? stock.lessons : [];
  if (lessons.length === 0) return ["lessons: empty"];
  const dated = lessons.map((l, i) => stockEpisode(l, new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10)));
  dated.forEach((ep, i) => {
    const r = validateEpisodes({ episodes: dated.slice(0, i + 1) }, { date: ep.date, today: ep.date, series: SERIES.lesson });
    errors.push(...r.errors.map((e) => `stock[${i}] ${lessons[i].topic_key}: ${e}`));
  });
  return errors;
}

function sourceProblems(ep, previous, at, today, warnings, series) {
  const errors = [];
  const sources = ep.sources;
  const limits = series.sourceLimits ?? LIMITS.sources;
  if (sources.length < limits[0] || sources.length > limits[1]) errors.push(`${at}.sources: ${limits.join("-")} sources`);
  sources.forEach((s, i) => {
    const sat = `${at}.sources[${i}]`;
    errors.push(...urlProblems(s?.url, `${sat}.url`));
    if (!SOURCE_ROLES.includes(s?.role)) errors.push(`${sat}.role: one of ${SOURCE_ROLES.join(" / ")}`);
    const p = lengthProblem(s?.outlet, LIMITS.outlet, `${sat}.outlet`);
    if (p) errors.push(p);
    // The outlet is shown on screen and in the captions, where "@name" would
    // tag (notify) that account: X accounts are written "X typesafeai".
    errors.push(...textProblems(s?.outlet, `${sat}.outlet`).map((m) => (/@mention/.test(m) ? `${m} — write an X account as ${series.staged ? "\"X typesafeai\"" : "\"X accountname\""} (no @)` : m)));
    if (typeof s?.title !== "string" || !s.title.trim() || charLength(s.title) > 200 || CONTROL_CHARS_RE.test(s.title) || INVISIBLE_CHARS_RE.test(s.title)) {
      errors.push(`${sat}.title: the page title, one line, up to 200 chars`);
    }
    if (typeof s?.official !== "boolean") errors.push(`${sat}.official: true / false`);
    // Jev: only TypeSafe's own pages. News: true = the company's own announcement (no host list to check).
    else if (s.official && series.staged && !isOfficialUrl(s.url)) errors.push(`${sat}.official: ${hostOf(s.url)} is not a TypeSafe property`);
    if (s?.published_at === null) {
      if (s?.role !== "reference") errors.push(`${sat}.published_at: a ${s?.role} source needs its publication date`);
    } else if (!isRealDate(s?.published_at)) {
      errors.push(`${sat}.published_at: YYYY-MM-DD (null only for an undated reference page)`);
    } else if (s.published_at > today) {
      errors.push(`${sat}.published_at: ${s.published_at} is in the future`);
    } else if (series.staged && s.published_at < JEV_LAUNCH_DATE && s.role !== "reference") {
      warnings.push(`${sat}: published before Jev's launch (${JEV_LAUNCH_DATE}) — is it really about Jev?`);
    }
  });

  const role = PRIMARY_ROLE[ep.kind];
  if (role) {
    const primary = sources.filter((s) => s?.role === role);
    if (primary.length === 0) errors.push(`${at}.sources: a ${ep.kind} episode needs a source with role "${role}"`);
    if (ep.kind === "news" && !series.staged) {
      // The day's biggest story: recent, whatever was posted before (repeats are
      // caught by the topic / source checks).
      // From the episode's own date (= today in production; a dry run's sample keeps its own day).
      const since = new Date(Date.parse(`${ep.date}T00:00:00Z`) - NEWS_FRESH_DAYS * 86400000).toISOString().slice(0, 10);
      if (!primary.some((s) => isRealDate(s.published_at) && s.published_at >= since)) {
        errors.push(`${at}.sources: no news source published on/after ${since} (${NEWS_FRESH_DAYS} days before the episode) — pick a story from the last few days`);
      }
      for (const s of primary) {
        const host = hostOf(s?.url).replace(/^www\./, "");
        if (isBlockedNewsHost(host)) {
          errors.push(`${at}.sources: ${host} cannot carry the story — AI Trend Daily covers GitHub repositories; use the announcement or an article (the repository may be a "reference")`);
        }
      }
      // Fact check: the story is confirmed on two different sites (a GitHub page does not count as one).
      const sites = new Set(sources.map((s) => hostOf(s?.url)).filter((h) => h && !isBlockedNewsHost(h.replace(/^www\./, ""))).map(siteOf));
      if (sites.size < 2) errors.push(`${at}.sources: confirm the story on a second site (2+ different sites, e.g. the announcement and an independent article; subdomains of one site and GitHub do not count)`);
      if (!sources.some((s) => s?.official === false)) errors.push(`${at}.sources: at least one source must be an independent outlet (official: false), not only the company's own pages`);
      // Same story in new words (another outlet, another slug, a reworded headline):
      // the first two parts of topic_key (会社-中身) within NEWS_SAME_STORY_DAYS days.
      // A real follow-up names the episode it follows and the new fact.
      if (String(ep.topic_key).split("-").length < 3) errors.push(`${at}.topic_key: 会社-中身-出来事, 3+ parts (e.g. openai-gpt6-release) — the first two parts find the same story`);
      const weekAgo = new Date(Date.parse(`${ep.date}T00:00:00Z`) - NEWS_SAME_STORY_DAYS * 86400000).toISOString().slice(0, 10);
      const same = previous.filter((e) => e.date >= weekAgo && storyKey(e.topic_key) === storyKey(ep.topic_key));
      if (ep.follow_up_of != null) {
        const followed = previous.find((e) => e.date === ep.follow_up_of);
        if (!followed) errors.push(`${at}.follow_up_of: no earlier episode dated ${JSON.stringify(ep.follow_up_of)}`);
        else if (storyKey(followed.topic_key) !== storyKey(ep.topic_key)) errors.push(`${at}.follow_up_of: the ${ep.follow_up_of} episode ("${followed.topic_key}") is another story — a follow-up keeps its first two topic_key parts ("${storyKey(followed.topic_key)}")`);
        const p = lengthProblem(ep.research?.new_fact, LIMITS.reason, `${at}.research.new_fact`);
        if (p) errors.push(`${p} — a follow-up states, in one sentence, the new fact the ${ep.follow_up_of} episode did not have`);
      }
      if (same.length > 0 && !same.some((e) => e.date === ep.follow_up_of)) {
        errors.push(`${at}: "${ep.topic_key}" is the same story as ${same.map((e) => `${e.date} ("${e.topic_key}")`).join(", ")} (same "${storyKey(ep.topic_key)}" within ${NEWS_SAME_STORY_DAYS} days) — pick another story, or for real news on it set follow_up_of: "${same.at(-1).date}" and research.new_fact`);
      }
      // Same news twice: no page cited by an earlier news episode comes back, whatever its role.
      const earlier = new Map();
      for (const e of previous) for (const s of e.sources || []) if (s?.url) earlier.set(normalizeUrl(s.url), e.date);
      for (const s of sources) {
        const u = normalizeUrl(s?.url);
        if (earlier.has(u)) errors.push(`${at}.sources: ${s.url} was already cited on ${earlier.get(u)} — the news series never reuses a page (same story twice); find today's own sources`);
      }
    } else if (ep.kind === "news") {
      // New since the last Jev episode (inclusive: a story from later that day counts).
      // One day of slack: outlets date articles in their own (US) time, and the
      // previous routine ran at 07:30 JST = the evening before in California.
      // Repeats are still caught by the source / topic checks.
      const lastDate = previous.length > 0 ? previous[previous.length - 1].date : JEV_LAUNCH_DATE;
      const since = new Date(Date.parse(`${lastDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      if (!primary.some((s) => isRealDate(s.published_at) && s.published_at >= since)) {
        errors.push(`${at}.sources: no news source published on/after ${since} (the previous episode) — without new information, make it an explainer`);
      }
    }
  }
  for (const other of ["news", "usecase"].filter((r) => r !== role)) {
    if (sources.some((s) => s?.role === other)) errors.push(`${at}.sources: role "${other}" belongs to ${other} episodes; use "reference" here`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Video data + captions
// ---------------------------------------------------------------------------

// The channel covers AI in general; Jev is a feature on a model that is in
// the news right now (owner decision 2026-09-23). Nothing here may read as
// "this channel = Jev" — the closing lines speak for the whole channel.
export const JEV_FEATURE_LABEL = "いま話題の AI モデル Jev";
// Keep within 40 chars: the worst case (hook 40 + slides 300 + ending 40)
// has to fit the 58 s target (see LIMITS.narrationTotal).
export const JEV_ENDING_NARRATION = `${JEV_FEATURE_LABEL} の特集でした。保存とフォローをお願いします。`;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const KIND_LABEL = { intro: "Jev って何？", usecase: "Jev の使い道", news: "Jev 最新ニュース", explainer: "Jev 解説" };
const KIND_TAG = { intro: "話題のAI特集 Jev入門", usecase: "話題のAI特集 Jev活用例", news: "話題のAI特集 Jev最新", explainer: "話題のAI特集 Jev解説" };

export function outletsLabel(sources) {
  const outlets = [...new Set(sources.map((s) => s.outlet.trim()))];
  return outlets.length <= 2 ? outlets.join("・") : `${outlets.slice(0, 2).join("・")} ほか`;
}

/** output/trending-data.json for the Jev format (same frame as the pickup video). */
/**
 * The "第N回" of the opening label counts episodes of the same kind only, so a
 * filler explainer between two intros does not shift the numbers: intros by
 * their place in INTRO_TOPICS, use cases by `usecaseNumber` (validateEpisodes
 * returns it). News and explainers carry no number.
 */
export function kindOrdinal(ep, { usecaseNumber = null } = {}) {
  if (ep.kind === "intro") {
    const i = INTRO_TOPICS.findIndex((t) => t.key === ep.topic_key);
    return i >= 0 ? i + 1 : null;
  }
  if (ep.kind === "usecase") return Number.isInteger(usecaseNumber) ? usecaseNumber : null;
  return null;
}

export function toJevVideoData(ep, { usecaseNumber = null, series = SERIES.jev, fallback = false } = {}) {
  const [y, m, d] = ep.date.split("-").map(Number);
  const weekday = WEEKDAYS_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const shortDate = `${m}/${d}`;
  const kindLabel = series.kindLabel[ep.kind];
  // An evergreen lesson may cite nothing (then no source line).
  const sourceLine = ep.sources.length > 0 ? `出典: ${outletsLabel(ep.sources)}` : "";
  const count = ep.slides.length;
  const ordinal = kindOrdinal(ep, { usecaseNumber });
  const stageNote = ordinal ? `${kindLabel} 第${ordinal}回` : kindLabel;
  return {
    openingNarration: ep.hook.trim(),
    endingNarration: series.endingNarration,
    meta: {
      date: ep.date,
      dateLabel: `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${weekday})`,
      shortDate,
      // "jev" = the one-topic slide card layout (src JevSlideCard), shared by both series.
      mode: "jev",
      count,
      headline: ep.headline.trim(),
      titleTag: series.kindTag[ep.kind],
      // The day's headline on the opening: the first 1-2 s decide the swipe,
      // and every day must look different on the grid.
      kicker: ep.headline.trim(),
      bigLabel: series.bigLabel,
      openingSourceLabel: `${series.openingPrefix}${stageNote}`,
      sourceLabel: sourceLine,
      endingLines: series.endingLines ?? ["毎朝、AI の新しい動きを", "1分でお届け"],
      ...(fallback ? { fallback: true } : {}),
      method: ep.kind,
      genre: series.genre,
      trial: series.trial,
    },
    tools: ep.slides.map((s, i) => ({
      rank: i + 1,
      badge: `${i + 1}/${count}`,
      name: s.heading.trim(),
      heading: s.heading.trim(),
      body: s.body.trim(),
      claimSource: s.claim_source ? s.claim_source.trim() : null,
      diagram: videoDiagram(s),
      narration: s.narration.trim(),
      header: `${kindLabel}・${shortDate}`,
      sourceLine,
      image: null,
    })),
    jev: {
      stage: ep.stage,
      stageEpisode: ep.stage_episode,
      kind: ep.kind,
      topicKey: ep.topic_key,
      topic: ep.topic.trim(),
      sources: ep.sources.map((s) => ({ url: s.url, outlet: s.outlet, published_at: s.published_at, role: s.role, official: s.official })),
      // Lesson: the prompt goes into the post record (no 文例 twice) and the caption (copy it from there).
      ...(series.format === "lesson" ? { pillar: ep.pillar, prompt: lessonPrompt(ep) } : {}),
      ...(fallback ? { fallback: true } : {}),
    },
    // Lesson: the step-by-step screen script (the reel look; pipeline.mjs decides which look renders).
    ...(series.format === "lesson" && ep.reel ? { reel: structuredClone(ep.reel) } : {}),
  };
}

// General AI tags first; #Jev / #TypeSafeAI follow as the feature's topic tags.
export const JEV_IG_HASHTAGS = ["#AIニュース", "#生成AI", "#AI最新情報", "#Jev", "#TypeSafeAI"];
export const JEV_YT_HASHTAGS = ["#AIニュース", "#生成AI", "#Jev", "#TypeSafeAI", "#Shorts"];
export const JEV_YT_TAGS = ["AIニュース", "生成AI", "AIモデル", "Jev", "TypeSafe AI", "TypeSafe", "System One", "Shorts"];
export const CLAIM_NOTE = "※速度・料金・精度の数字や「ハルシネーションしない」は、断りのない限り開発元 TypeSafe AI の発表です（第三者の検証は出典を明記）。円の金額は概算です。";
const YT_TITLE_MAX = 100;

// Genre trial #3 (owner 2026-10-13): AI news in general, one story a day.
// Keep the ending within 40 chars (see LIMITS.narrationTotal).
export const NEWS_LABEL = "今日のAIニュース";
export const NEWS_ENDING_NARRATION = "今日の AI ニュースでした。保存とフォローをお願いします。";
export const NEWS_IG_HASHTAGS = ["#AIニュース", "#生成AI", "#AI最新情報", "#人工知能", "#テクノロジー"];
export const NEWS_YT_HASHTAGS = ["#AIニュース", "#生成AI", "#AI最新情報", "#Shorts"];
export const NEWS_YT_TAGS = ["AIニュース", "生成AI", "AI最新情報", "人工知能", "テクノロジー", "Shorts"];
export const NEWS_CLAIM_NOTE = "※性能・速度・料金などの数字は、断りのない限り各社の発表です（第三者の検証は出典を明記）。円の金額は概算です。";

// Genre trial #4 (owner 2026-10-22): AI for beginners at work, one tip a day.
// Keep the ending within 40 chars (see LIMITS.narrationTotal).
export const LESSON_LABEL = "今日のAI仕事術";
export const LESSON_ENDING_NARRATION = "今日の AI 仕事術でした。保存とフォローで、毎朝ひとつずつ。";
export const LESSON_IG_HASHTAGS = ["#AI活用", "#ChatGPT", "#生成AI", "#仕事術", "#業務効率化"];
export const LESSON_YT_HASHTAGS = ["#AI活用", "#ChatGPT", "#仕事術", "#Shorts"];
export const LESSON_YT_TAGS = ["AI活用", "ChatGPT", "生成AI", "仕事術", "業務効率化", "AIの使い方", "Shorts"];
export const LESSON_NOTE = "※AI の答えは一例で、聞くたびに少し変わります。数字・名前・日付は元の資料で確かめてください。会社の決まりで使えない情報は入れないでください。円の金額は概算です。";

/**
 * What differs between the ledger-driven series. Everything else (slide card,
 * diagram, yen-only rule, claim attribution, repeat checks) is shared.
 * Keyed by data/content-format.json "format".
 */
export const SERIES = {
  lesson: {
    format: "lesson",
    genre: LESSON_GENRE,
    trial: LESSON_TRIAL,
    name: "AI 仕事術（初心者向け）",
    episodesPath: LESSON_EPISODES_PATH,
    routinePrompt: "docs/routine-prompt-lesson.md",
    staged: false,
    kinds: ["lesson"],
    kindLabel: { lesson: LESSON_LABEL },
    kindTag: { lesson: "AI仕事術" },
    bigLabel: "LESSON",
    openingPrefix: "",
    endingNarration: LESSON_ENDING_NARRATION,
    endingLines: ["毎朝ひとつ、仕事で使える", "AI の頼み方"],
    attributionHint: '"OpenAI によると…" / "Google の説明では…"',
    claimSourceHint: '"OpenAI の説明" / "Google の説明"',
    claimNote: LESSON_NOTE,
    titleTemplate: "ai-lesson",
    ytFooter: "このチャンネルでは毎朝ひとつ、仕事で AI を使いこなすコツを1分で紹介します。ChatGPT・Gemini・Claude など、ふだん使っている AI にそのまま貼って試せる頼み方です。",
    igFooter: "毎朝ひとつ、仕事で使える AI の頼み方を1分で。保存して、明日の仕事で試してください。フォローすると毎朝届きます。",
    igHashtags: LESSON_IG_HASHTAGS,
    ytHashtags: LESSON_YT_HASHTAGS,
    ytTags: LESSON_YT_TAGS,
    sourceLimits: [0, 4],
    checkedLimits: [0, 30],
  },
  jev: {
    format: "jev",
    genre: JEV_GENRE,
    trial: JEV_TRIAL,
    name: "Jev の毎朝ニュース",
    episodesPath: EPISODES_PATH,
    routinePrompt: "docs/routine-prompt-jev.md",
    staged: true,
    kinds: ["intro", "usecase", "news", "explainer"],
    kindLabel: KIND_LABEL,
    kindTag: KIND_TAG,
    bigLabel: "Jev",
    openingPrefix: "特集｜",
    endingNarration: JEV_ENDING_NARRATION,
    attributionHint: '"TypeSafe によると…"',
    claimSourceHint: '"TypeSafe の発表" / "LiteLLM の検証"',
    claimNote: CLAIM_NOTE,
    titleTemplate: "jev",
    ytFooter: `${JEV_FEATURE_LABEL} の特集です。Jev は TypeSafe AI が 2026年9月に公開した、ソフトウェア向けの新しいAIモデルです。このチャンネルでは毎朝、AI の新しい動きを1分でお届けします。`,
    igFooter: `${JEV_FEATURE_LABEL} の特集です。毎朝、AI の新しい動きを1分で。保存してあとで見返してください。`,
    igHashtags: JEV_IG_HASHTAGS,
    ytHashtags: JEV_YT_HASHTAGS,
    ytTags: JEV_YT_TAGS,
  },
  news: {
    format: "news",
    genre: NEWS_GENRE,
    trial: NEWS_TRIAL,
    name: "AI ニュース 1 本解説",
    episodesPath: NEWS_EPISODES_PATH,
    routinePrompt: "docs/routine-prompt-news.md",
    staged: false,
    kinds: ["news"],
    kindLabel: { news: NEWS_LABEL },
    kindTag: { news: NEWS_LABEL },
    bigLabel: "NEWS",
    openingPrefix: "",
    endingNarration: NEWS_ENDING_NARRATION,
    attributionHint: '"OpenAI によると…" / "同社は…と説明しています"',
    claimSourceHint: '"OpenAI の発表" / "Google の発表"',
    claimNote: NEWS_CLAIM_NOTE,
    titleTemplate: "ai-news",
    ytFooter: "このチャンネルでは毎朝、その日いちばん大きい AI のニュースを 1 本、1分で順を追って説明します。",
    igFooter: "毎朝、AI のニュースを 1 本、1分で。保存してあとで見返してください。",
    igHashtags: NEWS_IG_HASHTAGS,
    ytHashtags: NEWS_YT_HASHTAGS,
    ytTags: NEWS_YT_TAGS,
  },
};

/** The series of a format ("pickup" and unknown → null). */
export function seriesOf(format) {
  return typeof format === "string" && Object.hasOwn(SERIES, format) ? SERIES[format] : null;
}

function clean(s) {
  return String(s ?? "").replace(new RegExp(CONTROL_CHARS_RE.source, "gu"), " ").replace(new RegExp(INVISIBLE_CHARS_RE.source, "gu"), "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

function slideLine(t) {
  return `・${clean(t.heading)}：${clean(t.body)}${t.claimSource ? `（${clean(t.claimSource)}）` : ""}`;
}

/**
 * Source list, shortest-last: level 0 = every URL, 1 = URLs of the day's
 * news / use case only, 2 = outlet and date only.
 */
function sourceLines(jev, level = 0) {
  return jev.sources.map((s) => {
    const withUrl = level === 0 || (level === 1 && s.role !== "reference");
    return `・${clean(s.outlet)}（${s.published_at ?? "日付なし"}）${withUrl ? s.url : ""}`;
  });
}

export const JEV_YT_DESCRIPTION_MAX_BYTES = 5000;
export const JEV_IG_CAPTION_MAX = 2200;

/** First level whose text fits; the last level always wins as a floor. */
function fitting(build, fits) {
  for (const level of [0, 1, 2]) {
    const text = build(level);
    if (fits(text) || level === 2) return text;
  }
}

export function buildJevCaptions(data) {
  const { meta, tools, jev } = data;
  const series = Object.values(SERIES).find((s) => s.genre === meta.genre) ?? SERIES.jev;
  const dateFull = meta.date.replace(/-/g, "/");
  let title = `【${meta.titleTag}】${clean(meta.headline).replace(/[<>]/g, "")}｜${dateFull} #Shorts`;
  if (Array.from(title).length > YT_TITLE_MAX || title.length > YT_TITLE_MAX) title = `【${meta.titleTag}】${dateFull} #Shorts`;
  const body = tools.map(slideLine);
  // Lesson: the request itself, near the top so it shows before 「…続きを読む」 and can be copied.
  const promptBlock = jev?.prompt ? ["▼ そのまま使える頼み方（コピーして使えます）", clean(jev.prompt), ""] : [];
  const sourceBlock = (level) => (jev.sources.length > 0 ? ["出典:", ...sourceLines(jev, level), ""] : []);
  const description = fitting((level) => [
    `${clean(meta.headline)}（${meta.shortDate}）`,
    "",
    ...promptBlock,
    ...body,
    "",
    series.claimNote,
    "",
    ...sourceBlock(level),
    series.ytFooter,
    "",
    series.ytHashtags.join(" "),
  ].join("\n"), (t) => Buffer.byteLength(t, "utf-8") <= JEV_YT_DESCRIPTION_MAX_BYTES);
  const instagram = fitting((level) => [
    `${clean(meta.headline)}（${meta.shortDate}）`,
    "",
    ...promptBlock,
    ...body,
    "",
    series.claimNote,
    "",
    ...sourceBlock(level),
    series.igFooter,
    "",
    series.igHashtags.join(" "),
  ].join("\n"), (t) => charLength(t) <= JEV_IG_CAPTION_MAX);
  return {
    date: { full: dateFull, compact: meta.date.replace(/-/g, "") },
    youtube: { title, titleTemplate: series.titleTemplate, description, tags: series.ytTags, categoryId: "28" },
    instagram,
  };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** "news", "jev" or "pickup". CONTENT_FORMAT overrides the file (verification runs). */
export function readContentFormat(root = rootDir, env = process.env) {
  const fromEnv = env.CONTENT_FORMAT;
  if (fromEnv) {
    if (!FORMATS.includes(fromEnv)) throw new Error(`CONTENT_FORMAT must be one of ${FORMATS.join(" / ")}, got ${JSON.stringify(fromEnv)}`);
    return fromEnv;
  }
  const p = join(root, FORMAT_PATH);
  if (!existsSync(p)) return "pickup";
  const format = JSON.parse(readFileSync(p, "utf-8")).format;
  if (!FORMATS.includes(format)) throw new Error(`${FORMAT_PATH}: "format" must be one of ${FORMATS.join(" / ")}, got ${JSON.stringify(format)}`);
  return format;
}

/**
 * 先輩のメイ on the video (src/components/May.tsx): only when the repo variable
 * MAY_CHARACTER is "on" and the video is a slide-card episode (Jev or news). Unset / anything else = off,
 * so a typo can never stop the morning post — it just leaves her out.
 */
export function mayCharacterOn(meta, env = process.env) {
  return String(env.MAY_CHARACTER || "").trim().toLowerCase() === "on" && meta?.mode === "jev";
}

/** JEV_EPISODES_PATH overrides the series' ledger (samples in dry runs, either series). */
export function resolveEpisodesPath(root = rootDir, env = process.env, series = SERIES.jev) {
  const p = env.JEV_EPISODES_PATH || series.episodesPath;
  return isAbsolute(p) ? p : join(root, p);
}

export function loadEpisodes(path) {
  if (!existsSync(path)) throw new Error(`${path} not found. The morning routine appends today's episode to the ledger of the current format (docs/routine-prompt.md).`);
  const { data, repaired } = parseEnrichedText(readFileSync(path, "utf-8"));
  if (repaired) console.warn("  JSON needed auto-repair (unescaped quotes) — tell the routine to escape them.");
  return data;
}

// ---------------------------------------------------------------------------
// PDCA numbers (IG views median / IG saves / IG follower change; YT separately)
// ---------------------------------------------------------------------------

function median(values) {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function jevPdcaReport(history, { today = todayJst(), series = SERIES.jev } = {}) {
  const videos = (history?.videos || []).filter((v) => v.genre === series.genre && !v.skip).sort((a, b) => a.date.localeCompare(b.date));
  const followers = (history?.account?.igFollowers || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const start = videos[0]?.date ?? null;
  const lines = [];
  lines.push(`## ジャンル試行 #${series.trial}（${series.name}）の状態 — ${today}`);
  lines.push("");
  if (!start) {
    lines.push("- まだ投稿がありません（初回投稿の日が開始日になります）。終了条件はオーナーの停止指示で、14 日ごとの判定はありません。");
    return lines.join("\n");
  }
  const igViews = videos.filter((v) => v.instagram?.views != null).map((v) => v.instagram.views);
  const saved = videos.reduce((sum, v) => sum + (v.instagram?.saved ?? 0), 0);
  const ytViews = videos.filter((v) => v.stats?.updatedAt).map((v) => v.stats.views ?? 0);
  const atStart = [...followers].reverse().find((f) => f.date <= start) ?? followers[0];
  const latest = followers.at(-1);
  const growth = atStart && latest ? latest.count - atStart.count : null;
  lines.push(`- 開始日 ${start} / 投稿 ${videos.length} 本 / 終了条件: オーナーの停止指示（判定日なし）`);
  lines.push(`- IG views 中央値 ${median(igViews) ?? "—"}（n=${igViews.length}）/ IG 保存合計 ${saved} / IG フォロワー増 ${growth == null ? "未取得" : `${growth >= 0 ? "+" : ""}${growth}（${atStart.date} ${atStart.count} → ${latest.date} ${latest.count}）`}`);
  lines.push(`- YT views 中央値 ${median(ytViews) ?? "—"}（n=${ytViews.length}。IG と合算しない）`);
  lines.push("- IG insights は最大 48 時間遅れる。前日・当日の値は暫定");
  lines.push("");
  lines.push("| 種類 | 本数 | IG views 中央値 | IG 保存合計 | YT views 中央値 |");
  lines.push("|---|---|---|---|---|");
  for (const kind of series.kinds) {
    const vs = videos.filter((v) => v.jev?.kind === kind);
    if (vs.length === 0) continue;
    lines.push(`| ${kind} | ${vs.length} | ${median(vs.filter((v) => v.instagram?.views != null).map((v) => v.instagram.views)) ?? "—"} | ${vs.reduce((s, v) => s + (v.instagram?.saved ?? 0), 0)} | ${median(vs.filter((v) => v.stats?.updatedAt).map((v) => v.stats.views ?? 0)) ?? "—"} |`);
  }
  lines.push("");
  lines.push("| 日付 | 段階-回 | 種類 | 話題 | IG views | IG 保存 | YT views |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const v of videos.slice(-14)) {
    lines.push(`| ${v.date} | ${series.staged ? `${v.jev?.stage ?? "?"}-${v.jev?.stageEpisode ?? "?"}` : "—"} | ${v.jev?.kind ?? "?"} | ${v.jev?.topicKey ?? "—"} | ${v.instagram?.views ?? "未取得"} | ${v.instagram?.saved ?? "—"} | ${v.stats?.updatedAt ? v.stats.views ?? 0 : "未取得"} |`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** The aired chain before `today` (redone entries left out). */
function chainBefore(episodes, today) {
  const before = episodes.filter((e) => e.date < today);
  const redone = new Set(before.map((e) => e.redo_of).filter(Boolean));
  return { before, chain: before.filter((e) => !redone.has(e.date)) };
}

/**
 * Today's slot for the routine, plus what to check if the latest episode did
 * not go out: `unrecorded` lists entries without a post record, and
 * `redoCandidate` is the only date that can be redone (the latest aired entry,
 * when it is unrecorded). The redo slot itself is printed only by aired-check.
 */
export function seriesState(episodes, history, today, series = SERIES.jev) {
  const { before, chain } = chainBefore(episodes, today);
  const unrecorded = unrecordedEpisodes(before, history, today, series.genre).map((e) => ({ date: e.date, topic_key: e.topic_key }));
  const latest = chain.at(-1);
  // News is never redone (a day-late story is stale), so it has no redo candidate.
  const redoCandidate = series.staged && unrecorded.some((u) => u.date === latest?.date) ? latest.date : null;
  return { ...nextSlot(chain, series), unrecorded, redoCandidate };
}

/**
 * aired-check as the routine runs it: always on the redo candidate, and the
 * redo slot (with `redo_of`) comes out only when that day reads not-posted.
 */
export function redoCheck(episodes, history, today, { check = airedCheck } = {}) {
  const { unrecorded, redoCandidate } = seriesState(episodes, history, today);
  if (!redoCandidate) return { date: null, verdict: null, reason: "no redo candidate (the latest episode has a post record or there is none)", unrecorded, redoSlot: null };
  const result = check(redoCandidate);
  const redoSlot = result.verdict === "not-posted" ? { ...nextSlot(chainBefore(episodes, today).chain.slice(0, -1)), redo_of: redoCandidate } : null;
  return { ...result, unrecorded, redoSlot };
}

/** JST calendar day of an ISO timestamp. */
function jstDay(iso) {
  return new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const ghRun = (args) => execFileSync("gh", args, { encoding: "utf-8", timeout: 120000, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const RUN_FIELDS = "databaseId,attempt,createdAt,event,status,conclusion";

/**
 * Did the given day's episode go out? Reads the logs of every attempt of that
 * day's posting runs on main (daily-video.yml and the Instagram recovery; a
 * re-run keeps its earlier attempts, and `gh run view --log` alone shows only
 * the last) with the gh CLI and looks for the upload success lines. Any
 * failure to read → "unknown" with the reason.
 */
export function airedCheck(date, { run = ghRun } = {}) {
  const attempts = [];
  const summary = () => attempts.map(({ log, ...a }) => ({ ...a, logChars: String(log ?? "").length }));
  try {
    for (const wf of ["daily-video.yml", "post-today-instagram.yml"]) {
      const list = JSON.parse(run(["run", "list", "--workflow", wf, "--branch", "main", "--limit", "40", "--json", RUN_FIELDS]));
      // The Instagram recovery can post an earlier day (its `date` input), so
      // its later runs count too when their "Using date:" names this day (or
      // cannot be read — then they count, on the safe side).
      const recovery = wf === "post-today-instagram.yml";
      for (const r of list.filter((r) => (recovery ? jstDay(r.createdAt) >= date : jstDay(r.createdAt) === date))) {
        const last = Math.max(1, Number(r.attempt) || 1);
        for (let n = 1; n <= last; n++) {
          // The list carries the latest attempt's state; earlier ones are asked for.
          const s = n === last ? r : JSON.parse(run(["run", "view", String(r.databaseId), "--attempt", String(n), "--json", "status,conclusion"]));
          const a = { workflow: wf, id: r.databaseId, attempt: n, event: r.event, status: s.status, conclusion: s.conclusion, log: "" };
          if (a.status === "completed") a.log = run(["run", "view", String(r.databaseId), "--attempt", String(n), "--log"]);
          const usedDate = recovery && jstDay(r.createdAt) !== date ? /Using date: (\d{8})/.exec(a.log)?.[1] : null;
          if (usedDate && usedDate !== date.replaceAll("-", "")) continue;
          attempts.push(a);
        }
      }
    }
  } catch (err) {
    return { date, verdict: "unknown", reason: ghFailure(err), runs: summary() };
  }
  return { date, ...classifyPostLogs(attempts), runs: summary() };
}

/**
 * Can this environment's gh read the posting runs and their logs? Reads the
 * latest finished daily-video.yml run on main (normally yesterday's post) and
 * returns one line for the routine's report.
 */
export function airedCheckSelfTest({ run = ghRun } = {}) {
  const line = (s) => `aired-check self-test: ${s}`;
  try {
    const list = JSON.parse(run(["run", "list", "--workflow", "daily-video.yml", "--branch", "main", "--limit", "10", "--json", RUN_FIELDS]));
    // The same reads aired-check makes (--attempt N --log), down to a success
    // line: a gh that drops step logs or a changed success line shows up here.
    const posts = list.filter((x) => x.status === "completed" && x.conclusion === "success" && x.event === "schedule").slice(0, 3);
    if (posts.length === 0) return { ok: false, line: line("NG — no-runs: no successful scheduled daily-video.yml run on main among the latest 10") };
    for (const r of posts) {
      const log = String(run(["run", "view", String(r.databaseId), "--attempt", String(Math.max(1, Number(r.attempt) || 1)), "--log"]));
      if (POSTED_LOG_RE.test(log)) return { ok: true, line: line(`OK — read run ${r.databaseId} (${jstDay(r.createdAt)}) and found its upload success line`) };
    }
    return { ok: false, line: line(`NG — no-success-line: read the latest ${posts.length} successful posting run(s) (${posts.map((r) => r.databaseId).join(", ")}) but none shows an upload success line (partial logs, or the success line changed)`) };
  } catch (err) {
    return { ok: false, line: line(`NG — ${ghFailure(err)}`) };
  }
}

/** --series=lesson|jev|news, else the committed format's series (Jev when the format is pickup). */
export function cliSeries(argv, root = rootDir, env = process.env) {
  const flag = argv.find((a) => a.startsWith("--series="));
  if (flag) {
    const s = seriesOf(flag.slice("--series=".length));
    if (!s) throw new Error(`--series must be ${Object.keys(SERIES).join(" / ")}`);
    return s;
  }
  return seriesOf(readContentFormat(root, env)) ?? SERIES.jev;
}

function cli(argv) {
  const cmd = argv[0] || "validate";
  const series = cliSeries(argv);
  const fileArg = argv.find((a) => a.startsWith("--file="));
  const path = fileArg ? fileArg.slice("--file=".length) : resolveEpisodesPath(rootDir, process.env, series);
  if (cmd === "pdca") {
    const hp = join(rootDir, "data", "performance-history.json");
    const history = existsSync(hp) ? JSON.parse(readFileSync(hp, "utf-8")) : { videos: [] };
    console.log(jevPdcaReport(history, { series }));
    return 0;
  }
  if (cmd === "validate-stock") {
    const stock = fileArg ? JSON.parse(readFileSync(fileArg.slice("--file=".length), "utf-8")) : loadLessonStock();
    const errors = stockProblems(stock);
    for (const e of errors) console.log(`NG ${e}`);
    if (errors.length === 0) console.log(`OK ${stock.lessons.length} stock lessons`);
    return errors.length > 0 ? 1 : 0;
  }
  const file = loadEpisodes(path);
  const hp = join(rootDir, "data", "performance-history.json");
  if (cmd === "next") {
    const today = todayJst();
    const history = !fileArg && existsSync(hp) ? JSON.parse(readFileSync(hp, "utf-8")) : null;
    const extra = series.staged ? { usecaseTarget: USECASE_TARGET, usecaseMin: USECASE_MIN } : {};
    if (series.format === "lesson") {
      // The stock lesson 08:15 would post if today's episode never reaches main, and how many are left.
      const left = unusedStock(loadLessonStock(), file.episodes || [], history, today);
      extra.stockLeft = left.length;
      extra.stockNext = left[0] ? { topic_key: left[0].topic_key, pillar: left[0].pillar, headline: left[0].headline } : null;
    }
    console.log(JSON.stringify({ today, series: series.format, ...seriesState(file.episodes || [], history, today, series), ...extra }, null, 2));
    return 0;
  }
  if (cmd === "aired-check" && !series.staged) {
    console.error(`aired-check is for the Jev series only: the ${series.format} series never redoes a day`);
    return 2;
  }
  if (cmd === "aired-check") {
    if (argv.includes("--self-test")) {
      const { ok, line } = airedCheckSelfTest();
      console.log(line);
      return ok ? 0 : 1;
    }
    // No date argument: it always checks the redo candidate, so a check of
    // another day can never unlock a redo of the latest one.
    if (argv.slice(1).some((a) => !a.startsWith("--"))) {
      console.error("usage: node scripts/jev.mjs aired-check [--self-test]   (no date: it checks the redo candidate from `next`)");
      return 2;
    }
    const history = !fileArg && existsSync(hp) ? JSON.parse(readFileSync(hp, "utf-8")) : null;
    console.log(JSON.stringify(redoCheck(file.episodes || [], history, todayJst()), null, 2));
    return 0;
  }
  const noDate = argv.includes("--no-date-check");
  const history = !noDate && !fileArg && existsSync(hp) ? JSON.parse(readFileSync(hp, "utf-8")) : null;
  // Production: a redo_of is re-checked live against that day's posting logs.
  const checkAired = !noDate && !fileArg ? airedCheck : null;
  const { errors, warnings, episode, slot } = validateEpisodes(file, { pickLatest: noDate, history, checkAired, series });
  for (const w of warnings) console.log(`WARN ${w}`);
  for (const e of errors) console.log(`NG ${e}`);
  if (errors.length > 0) return 1;
  if (!series.staged) {
    console.log(`OK ${episode.date}: ${series.format} episode ${slot.episode} "${episode.topic_key}"`);
    return 0;
  }
  console.log(`OK ${episode.date}: stage ${episode.stage}-${episode.stage_episode} ${episode.kind} "${episode.topic_key}"${slot ? ` (expected stage ${slot.stage})` : ""}`);
  return 0;
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isDirectRun) process.exit(cli(process.argv.slice(2)));
