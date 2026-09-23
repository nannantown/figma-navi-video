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
 * Which format the pipeline runs is data/content-format.json ("jev" / "pickup").
 *
 * CLI (the routine runs this before committing):
 *   node scripts/jev.mjs validate [--file=path] [--no-date-check]
 *   node scripts/jev.mjs next     # which stage / episode / topic comes next (+ unrecorded / redoCandidate)
 *   node scripts/jev.mjs aired-check   # did the redo candidate go out? (posting runs' logs via gh; prints redoSlot only if not)
 *   node scripts/jev.mjs aired-check --self-test   # can this environment's gh read the posting runs' logs? (one line)
 *   node scripts/jev.mjs pdca     # numbers for docs/pdca/$TODAY.md
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
export const FORMATS = ["jev", "pickup"];

// ---------------------------------------------------------------------------
// Series plan (docs/jev-format.md is the prose version — keep them in sync)
// ---------------------------------------------------------------------------

/** Stage 1: "Jev とは何か", posted in exactly this order. */
export const INTRO_TOPICS = [
  { key: "intro-what-is-jev", theme: "Jev って何？ 誰が作った、どんな AI か" },
  { key: "intro-no-text", theme: "文章を書かない AI — 答えを「型」と確信度で返す" },
  { key: "intro-vs-llm", theme: "ChatGPT のような LLM と何が違う？ 得意と不得意" },
  { key: "intro-speed-claim", theme: "「速い」と言う理由 — TypeSafe の主張と第三者の測定" },
  { key: "intro-cost-claim", theme: "料金のしくみ — 入力 100 万トークン $0.042 を計算してみる" },
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
const CLAIM_RE = new RegExp(
  [
    `${NUM}\\s*(?:[〜~\\-–]\\s*${NUM}\\s*)?倍`, // 40〜200倍 / 数十倍 / 十倍
    `${NUM}\\s*分の\\s*[1一]`, // 100分の1
    `${NUM}\\s*割\\s*(?:安|減|速|削減|少な)`, // 9割安く
    `\\d+(?:\\.\\d+)?\\s*%\\s*(?:安|減|削減|速|高速|少な|の?精度|正確)`, // 96%減
    "(?:精度|正答率|正解率)\\s*(?:は|が)?\\s*\\d+(?:\\.\\d+)?\\s*%", // 精度は100%
    "最速|業界(?:最|一)|世界(?:最|一)",
    "数学的",
    `(?:ハルシネーション|幻覚|型エラー|間違い|間違え|ミス|誤り|嘘|うそ)[^。！？]{0,12}?${NEGATION}`,
  ].join("|"),
  "u"
);
// Who says so, named, in the same sentence: "TypeSafe によると",
// "LiteLLM の検証では", "同社は…と説明しています", "日経新聞によると".
// A bare "比較では" / "テストによると" names nobody and does not count.
const SOURCE_NAME = "(?:TypeSafe(?:\\s*AI)?|タイプセーフ|同社|開発元|開発会社|[A-Za-z][A-Za-z0-9.&'\\- ]{1,40}|[\\u4E00-\\u9FFF\\u30A0-\\u30FF]{1,12}(?:社|新聞|誌|紙|通信))";
const ATTRIBUTION_RE = new RegExp(
  `${SOURCE_NAME}(?:さん|氏|CEO)?\\s*(?:の(?:検証|測定|計測|テスト|比較|発表|調査|評価|ベンチマーク|まとめ|記事|投稿|ポスト)(?:では|によると|によれば)|によると|によれば|の主張|は[^。！？]*?(?:と主張|と説明|と発表|としています|とうたって|と話して|と述べて))`,
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
export function nextSlot(previous) {
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
export function unrecordedEpisodes(episodes, history, date) {
  if (!history || !Array.isArray(history.videos)) return [];
  const recorded = history.videos.filter((v) => v?.genre === JEV_GENRE && !v.skip).map((v) => v.date);
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

/** Minimal shape every ledger entry needs for the order and repeat checks. */
function ledgerProblems(ep, i) {
  const at = `episodes[${i}]`;
  const errors = [];
  if (!ep || typeof ep !== "object") return [`${at}: must be an object`];
  if (!isRealDate(ep.date)) errors.push(`${at}.date: must be YYYY-MM-DD`);
  if (![1, 2, 3].includes(ep.stage)) errors.push(`${at}.stage: must be 1, 2 or 3`);
  if (!(KINDS_BY_STAGE[ep.stage] || []).includes(ep.kind)) {
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
export function validateEpisodes(file, { date = todayJst(), today = todayJst(), pickLatest = false, history = null, checkAired = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!file || typeof file !== "object" || !Array.isArray(file.episodes)) {
    return { errors: ['top level must be { "episodes": [...] }'], warnings, episode: null, slot: null };
  }
  const eps = file.episodes;
  eps.forEach((ep, i) => errors.push(...ledgerProblems(ep, i)));
  if (errors.length > 0) return { errors, warnings, episode: null, slot: null };

  for (let i = 1; i < eps.length; i++) {
    if (!(eps[i - 1].date < eps[i].date)) errors.push(`episodes[${i}].date: dates must be unique and ascending (${eps[i - 1].date} → ${eps[i].date})`);
  }

  const index = pickLatest ? eps.length - 1 : eps.findIndex((e) => e.date === date);
  if (index < 0) {
    errors.push(`no episode for ${date} (the routine appends today's episode to ${EPISODES_PATH})`);
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
    const postedThatDay = (history?.videos || []).some((v) => v?.genre === JEV_GENRE && !v.skip && v.date === ep.redo_of);
    if (postedThatDay) errors.push(`${at}.redo_of: ${ep.redo_of} is recorded as posted in performance-history.json — redoing it would post it twice`);
    // The CLI passes the live gh check: the redone day itself must read not-posted.
    if (checkAired) {
      const r = checkAired(ep.redo_of);
      if (r?.verdict !== "not-posted") errors.push(`${at}.redo_of: aired-check ${ep.redo_of} says ${r?.verdict ?? "nothing"}${r?.reason ? ` (${r.reason})` : ""} — only a day whose posting logs say not-posted can be redone`);
    }
  }
  for (const e of unrecordedEpisodes(eps.slice(0, index), history, ep.date)) {
    warnings.push(`${e.date} "${e.topic_key}" has no post record — counted as aired; run "node scripts/jev.mjs aired-check" and redo only with the redoSlot it prints`);
  }

  // Series order. Every aired entry is checked against the ones before it,
  // so a ledger edited out of order fails too (not just today's entry).
  chain.forEach((e, i) => errors.push(...orderProblems(e, chain.slice(0, i), `episode ${e.date}`)));
  const slot = nextSlot(previous);

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
  const posted = (history?.videos || []).filter((v) => v?.genre === JEV_GENRE && !v.skip && v.jev && v.date < ep.date);
  const ownPrimary = new Set(primaryUrls(ep));
  for (const v of posted) {
    const kept = eps.find((e) => e.date === v.date);
    if (!kept || kept.topic_key !== v.jev.topicKey) {
      errors.push(`ledger: the ${v.date} episode ("${v.jev.topicKey}") was posted but is missing or changed in ${EPISODES_PATH} — restore it (past episodes are never rewritten)`);
    }
    if (v.jev.topicKey === ep.topic_key) errors.push(`${at}: topic_key "${ep.topic_key}" was already posted on ${v.date}`);
    for (const s of v.jev.sources || []) {
      if (s.role === PRIMARY_ROLE[v.jev.kind] && ownPrimary.has(normalizeUrl(s.url))) errors.push(`${at}: source ${s.url} was already posted on ${v.date}`);
    }
  }

  // Today's episode: full content check.
  if (!pickLatest && ep.date !== today) errors.push(`${at}: date is not today (${today})`);
  if (ep.genre !== JEV_GENRE) errors.push(`${at}.genre: must be "${JEV_GENRE}"`);
  if (ep.trial !== JEV_TRIAL) errors.push(`${at}.trial: must be ${JEV_TRIAL}`);
  for (const [field, limits] of [["topic", LIMITS.topic], ["headline", LIMITS.headline], ["hook", LIMITS.hook]]) {
    const p = lengthProblem(ep[field], limits, `${at}.${field}`);
    if (p) errors.push(p);
    errors.push(...textProblems(ep[field], `${at}.${field}`));
  }
  for (const u of unattributedClaims(ep.hook ?? "")) errors.push(`${at}.hook: claim without its source — "${u}" (write "TypeSafe によると…")`);
  if (hasClaim(ep.headline ?? "")) errors.push(`${at}.headline: no speed/cost/"no hallucination" claim in the headline (put it on a slide with claim_source)`);

  errors.push(...slideProblems(ep, at));
  errors.push(...sourceProblems(ep, previous, at, today, warnings));

  const r = ep.research;
  if (!r || typeof r !== "object" || !Array.isArray(r.checked)) {
    errors.push(`${at}.research.checked: list the URLs you checked today`);
  } else {
    if (r.checked.length < LIMITS.checked[0] || r.checked.length > LIMITS.checked[1]) errors.push(`${at}.research.checked: ${r.checked.length} URLs (allowed ${LIMITS.checked.join("-")})`);
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

function slideProblems(ep, at) {
  const errors = [];
  const slides = ep.slides;
  if (!Array.isArray(slides) || slides.length < LIMITS.slides[0] || slides.length > LIMITS.slides[1]) {
    return [`${at}.slides: ${LIMITS.slides.join("-")} slides`];
  }
  let total = 0;
  slides.forEach((s, i) => {
    const sat = `${at}.slides[${i}]`;
    for (const [field, limits] of [["heading", LIMITS.heading], ["body", LIMITS.body], ["narration", LIMITS.narration]]) {
      const p = lengthProblem(s?.[field], limits, `${sat}.${field}`);
      if (p) errors.push(p);
      errors.push(...textProblems(s?.[field], `${sat}.${field}`));
    }
    total += charLength(s?.narration ?? "");
    for (const u of unattributedClaims(s?.narration ?? "")) errors.push(`${sat}.narration: claim without its source — "${u}" (write "TypeSafe によると…")`);
    // Screen text is too short for "TypeSafe によると", so the card carries a
    // "whose claim" label instead.
    const onScreenClaim = hasClaim(s?.heading ?? "") || hasClaim(s?.body ?? "");
    if (s?.claim_source != null) {
      const p = lengthProblem(s.claim_source, LIMITS.claimSource, `${sat}.claim_source`);
      if (p) errors.push(p);
      errors.push(...textProblems(s.claim_source, `${sat}.claim_source`));
      if (hasClaim(s.claim_source)) errors.push(`${sat}.claim_source: a label says whose claim it is, not the claim itself (e.g. "TypeSafe の発表")`);
    } else if (onScreenClaim) {
      errors.push(`${sat}: the screen text states a claim — set claim_source (e.g. "TypeSafe の発表" / "LiteLLM の検証")`);
    }
  });
  if (total > LIMITS.narrationTotal) errors.push(`${at}.slides: narration total ${total} chars (max ${LIMITS.narrationTotal}, the video must stay under 60 s)`);
  return errors;
}

function sourceProblems(ep, previous, at, today, warnings) {
  const errors = [];
  const sources = ep.sources;
  if (sources.length < LIMITS.sources[0] || sources.length > LIMITS.sources[1]) errors.push(`${at}.sources: ${LIMITS.sources.join("-")} sources`);
  sources.forEach((s, i) => {
    const sat = `${at}.sources[${i}]`;
    errors.push(...urlProblems(s?.url, `${sat}.url`));
    if (!SOURCE_ROLES.includes(s?.role)) errors.push(`${sat}.role: one of ${SOURCE_ROLES.join(" / ")}`);
    const p = lengthProblem(s?.outlet, LIMITS.outlet, `${sat}.outlet`);
    if (p) errors.push(p);
    // The outlet is shown on screen and in the captions, where "@name" would
    // tag (notify) that account: X accounts are written "X typesafeai".
    errors.push(...textProblems(s?.outlet, `${sat}.outlet`).map((m) => (/@mention/.test(m) ? `${m} — write an X account as "X typesafeai" (no @)` : m)));
    if (typeof s?.title !== "string" || !s.title.trim() || charLength(s.title) > 200 || CONTROL_CHARS_RE.test(s.title) || INVISIBLE_CHARS_RE.test(s.title)) {
      errors.push(`${sat}.title: the page title, one line, up to 200 chars`);
    }
    if (typeof s?.official !== "boolean") errors.push(`${sat}.official: true / false`);
    else if (s.official && !isOfficialUrl(s.url)) errors.push(`${sat}.official: ${hostOf(s.url)} is not a TypeSafe property`);
    if (s?.published_at === null) {
      if (s?.role !== "reference") errors.push(`${sat}.published_at: a ${s?.role} source needs its publication date`);
    } else if (!isRealDate(s?.published_at)) {
      errors.push(`${sat}.published_at: YYYY-MM-DD (null only for an undated reference page)`);
    } else if (s.published_at > today) {
      errors.push(`${sat}.published_at: ${s.published_at} is in the future`);
    } else if (s.published_at < JEV_LAUNCH_DATE && s.role !== "reference") {
      warnings.push(`${sat}: published before Jev's launch (${JEV_LAUNCH_DATE}) — is it really about Jev?`);
    }
  });

  const role = PRIMARY_ROLE[ep.kind];
  if (role) {
    const primary = sources.filter((s) => s?.role === role);
    if (primary.length === 0) errors.push(`${at}.sources: a ${ep.kind} episode needs a source with role "${role}"`);
    if (ep.kind === "news") {
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

export const JEV_ENDING_NARRATION = "Jev の続きは毎朝ここで。保存とフォローでチェックしてください。";
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const KIND_LABEL = { intro: "Jev って何？", usecase: "Jev の使い道", news: "Jev 最新ニュース", explainer: "Jev 解説" };
const KIND_TAG = { intro: "Jev入門", usecase: "Jev活用例", news: "Jev最新", explainer: "Jev解説" };

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

export function toJevVideoData(ep, { usecaseNumber = null } = {}) {
  const [y, m, d] = ep.date.split("-").map(Number);
  const weekday = WEEKDAYS_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const shortDate = `${m}/${d}`;
  const kindLabel = KIND_LABEL[ep.kind];
  const sourceLine = `出典: ${outletsLabel(ep.sources)}`;
  const count = ep.slides.length;
  const ordinal = kindOrdinal(ep, { usecaseNumber });
  const stageNote = ordinal ? `${kindLabel} 第${ordinal}回` : kindLabel;
  return {
    openingNarration: ep.hook.trim(),
    endingNarration: JEV_ENDING_NARRATION,
    meta: {
      date: ep.date,
      dateLabel: `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${weekday})`,
      shortDate,
      mode: "jev",
      count,
      headline: ep.headline.trim(),
      titleTag: KIND_TAG[ep.kind],
      // The day's headline on the opening: the first 1-2 s decide the swipe,
      // and every day must look different on the grid.
      kicker: ep.headline.trim(),
      bigLabel: "Jev",
      openingSourceLabel: stageNote,
      sourceLabel: sourceLine,
      endingLines: ["毎朝、AIモデル Jev の", "いまを1分でお届け"],
      method: ep.kind,
      genre: JEV_GENRE,
      trial: JEV_TRIAL,
    },
    tools: ep.slides.map((s, i) => ({
      rank: i + 1,
      badge: `${i + 1}/${count}`,
      name: s.heading.trim(),
      heading: s.heading.trim(),
      body: s.body.trim(),
      claimSource: s.claim_source ? s.claim_source.trim() : null,
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
    },
  };
}

export const JEV_IG_HASHTAGS = ["#Jev", "#TypeSafeAI", "#AIニュース", "#生成AI", "#AI最新情報"];
export const JEV_YT_HASHTAGS = ["#Jev", "#TypeSafeAI", "#AIニュース", "#Shorts"];
export const JEV_YT_TAGS = ["Jev", "TypeSafe AI", "TypeSafe", "System One", "AIモデル", "AIニュース", "生成AI", "Shorts"];
export const CLAIM_NOTE = "※速度・料金・精度の数字や「ハルシネーションしない」は、断りのない限り開発元 TypeSafe AI の発表です（第三者の検証は出典を明記）。";
const YT_TITLE_MAX = 100;

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
  const dateFull = meta.date.replace(/-/g, "/");
  let title = `【${meta.titleTag}】${clean(meta.headline).replace(/[<>]/g, "")}｜${dateFull} #Shorts`;
  if (Array.from(title).length > YT_TITLE_MAX || title.length > YT_TITLE_MAX) title = `【${meta.titleTag}】${dateFull} #Shorts`;
  const body = tools.map(slideLine);
  const description = fitting((level) => [
    `${clean(meta.headline)}（${meta.shortDate}）`,
    "",
    ...body,
    "",
    CLAIM_NOTE,
    "",
    "出典:",
    ...sourceLines(jev, level),
    "",
    "Jev は TypeSafe AI が 2026年9月に公開した、ソフトウェア向けの新しいAIモデルです。毎朝その最新情報をお届けします。",
    "",
    JEV_YT_HASHTAGS.join(" "),
  ].join("\n"), (t) => Buffer.byteLength(t, "utf-8") <= JEV_YT_DESCRIPTION_MAX_BYTES);
  const instagram = fitting((level) => [
    `${clean(meta.headline)}（${meta.shortDate}）`,
    "",
    ...body,
    "",
    CLAIM_NOTE,
    "",
    "出典:",
    ...sourceLines(jev, level),
    "",
    "毎朝、AIモデル Jev の最新情報を1分で。保存してあとで見返してください。",
    "",
    JEV_IG_HASHTAGS.join(" "),
  ].join("\n"), (t) => charLength(t) <= JEV_IG_CAPTION_MAX);
  return {
    date: { full: dateFull, compact: meta.date.replace(/-/g, "") },
    youtube: { title, titleTemplate: "jev", description, tags: JEV_YT_TAGS, categoryId: "28" },
    instagram,
  };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** "jev" or "pickup". CONTENT_FORMAT overrides the file (verification runs). */
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

export function resolveEpisodesPath(root = rootDir, env = process.env) {
  const p = env.JEV_EPISODES_PATH || EPISODES_PATH;
  return isAbsolute(p) ? p : join(root, p);
}

export function loadEpisodes(path) {
  if (!existsSync(path)) throw new Error(`${path} not found. The morning routine appends today's episode to ${EPISODES_PATH} (docs/routine-prompt-jev.md).`);
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

export function jevPdcaReport(history, { today = todayJst() } = {}) {
  const videos = (history?.videos || []).filter((v) => v.genre === JEV_GENRE && !v.skip).sort((a, b) => a.date.localeCompare(b.date));
  const followers = (history?.account?.igFollowers || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const start = videos[0]?.date ?? null;
  const lines = [];
  lines.push(`## ジャンル試行 #${JEV_TRIAL}（Jev の毎朝ニュース）の状態 — ${today}`);
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
  for (const kind of ["intro", "usecase", "news", "explainer"]) {
    const vs = videos.filter((v) => v.jev?.kind === kind);
    if (vs.length === 0) continue;
    lines.push(`| ${kind} | ${vs.length} | ${median(vs.filter((v) => v.instagram?.views != null).map((v) => v.instagram.views)) ?? "—"} | ${vs.reduce((s, v) => s + (v.instagram?.saved ?? 0), 0)} | ${median(vs.filter((v) => v.stats?.updatedAt).map((v) => v.stats.views ?? 0)) ?? "—"} |`);
  }
  lines.push("");
  lines.push("| 日付 | 段階-回 | 種類 | 話題 | IG views | IG 保存 | YT views |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const v of videos.slice(-14)) {
    lines.push(`| ${v.date} | ${v.jev?.stage ?? "?"}-${v.jev?.stageEpisode ?? "?"} | ${v.jev?.kind ?? "?"} | ${v.jev?.topicKey ?? "—"} | ${v.instagram?.views ?? "未取得"} | ${v.instagram?.saved ?? "—"} | ${v.stats?.updatedAt ? v.stats.views ?? 0 : "未取得"} |`);
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
export function seriesState(episodes, history, today) {
  const { before, chain } = chainBefore(episodes, today);
  const unrecorded = unrecordedEpisodes(before, history, today).map((e) => ({ date: e.date, topic_key: e.topic_key }));
  const latest = chain.at(-1);
  const redoCandidate = unrecorded.some((u) => u.date === latest?.date) ? latest.date : null;
  return { ...nextSlot(chain), unrecorded, redoCandidate };
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

function cli(argv) {
  const cmd = argv[0] || "validate";
  const fileArg = argv.find((a) => a.startsWith("--file="));
  const path = fileArg ? fileArg.slice("--file=".length) : resolveEpisodesPath();
  if (cmd === "pdca") {
    const hp = join(rootDir, "data", "performance-history.json");
    const history = existsSync(hp) ? JSON.parse(readFileSync(hp, "utf-8")) : { videos: [] };
    console.log(jevPdcaReport(history));
    return 0;
  }
  const file = loadEpisodes(path);
  const hp = join(rootDir, "data", "performance-history.json");
  if (cmd === "next") {
    const today = todayJst();
    const history = !fileArg && existsSync(hp) ? JSON.parse(readFileSync(hp, "utf-8")) : null;
    console.log(JSON.stringify({ today, ...seriesState(file.episodes || [], history, today), usecaseTarget: USECASE_TARGET, usecaseMin: USECASE_MIN }, null, 2));
    return 0;
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
  const { errors, warnings, episode, slot } = validateEpisodes(file, { pickLatest: noDate, history, checkAired });
  for (const w of warnings) console.log(`WARN ${w}`);
  for (const e of errors) console.log(`NG ${e}`);
  if (errors.length > 0) return 1;
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
