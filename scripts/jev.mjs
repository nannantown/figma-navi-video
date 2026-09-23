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
 *   node scripts/jev.mjs next     # which stage / episode / topic comes next
 *   node scripts/jev.mjs pdca     # numbers for docs/pdca/$TODAY.md
 */

import { readFileSync, existsSync, realpathSync } from "fs";
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

export const KINDS_BY_STAGE = { 1: ["intro"], 2: ["usecase"], 3: ["news", "explainer"] };
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
  `${SOURCE_NAME}\\s*(?:の(?:検証|測定|計測|テスト|比較|発表|調査|評価|ベンチマーク|まとめ|記事)(?:では|によると|によれば)|によると|によれば|の主張|は[^。！？]*?(?:と主張|と説明|と発表|としています|とうたって|と話して|と述べて))`,
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
  const done = new Set(previous.filter((e) => e.stage === 1).map((e) => e.topic_key));
  const nextIntro = INTRO_TOPICS.find((t) => !done.has(t.key));
  const usecaseCount = previous.filter((e) => e.stage === 2).length;
  if (nextIntro) {
    return {
      stage: 1,
      stageEpisode: INTRO_TOPICS.indexOf(nextIntro) + 1,
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
      stageEpisode: usecaseCount + 1,
      kinds: KINDS_BY_STAGE[2],
      usecaseCount,
      canAdvanceEarly: usecaseCount >= USECASE_MIN,
    };
  }
  return {
    stage: 3,
    stageEpisode: previous.filter((e) => e.stage === 3).length + 1,
    kinds: KINDS_BY_STAGE[3],
    usecaseCount,
    canAdvanceEarly: false,
  };
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
export function validateEpisodes(file, { date = todayJst(), today = todayJst(), pickLatest = false, history = null } = {}) {
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
  const previous = eps.slice(0, index);
  const at = `episode ${ep.date}`;

  // Series order. Every entry is checked against the ones before it, so a
  // ledger edited out of order fails too (not just today's entry).
  for (let i = 0; i <= index; i++) errors.push(...orderProblems(eps[i], eps.slice(0, i), `episodes[${i}] (${eps[i].date})`));
  const slot = nextSlot(previous);

  // No repeats: topic_key once, the day's primary source once.
  const seenKeys = new Map();
  const seenPrimary = new Map();
  for (let i = 0; i <= index; i++) {
    const e = eps[i];
    if (seenKeys.has(e.topic_key)) errors.push(`episodes[${i}] (${e.date}): topic_key "${e.topic_key}" was already used on ${seenKeys.get(e.topic_key)}`);
    else seenKeys.set(e.topic_key, e.date);
    for (const u of primaryUrls(e)) {
      if (seenPrimary.has(u)) errors.push(`episodes[${i}] (${e.date}): source ${u} already carried the ${seenPrimary.get(u)} episode — find something not posted yet`);
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
    if (p) errors.push(`${p} — an explainer day records why there was no new information`);
  }
  if (ep.stage === 3 && slot.stage === 2) {
    const p = lengthProblem(r?.stage2_exhausted_reason, LIMITS.reason, `${at}.research.stage2_exhausted_reason`);
    if (p) errors.push(`${p} — stage 3 before ${USECASE_TARGET} use cases needs the reason no unused example was found`);
  }

  return { errors, warnings, episode: ep, slot };
}

function orderProblems(ep, previous, at) {
  const slot = nextSlot(previous);
  if (slot.stage === 1) {
    if (ep.stage !== 1) return [`${at}: stage ${ep.stage} is not allowed yet — stage 1 continues with "${slot.topicKey}" (${slot.theme})`];
    if (ep.topic_key !== slot.topicKey) return [`${at}: stage 1 must post "${slot.topicKey}" next, got "${ep.topic_key}"`];
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
    errors.push(...textProblems(s?.outlet, `${sat}.outlet`));
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
export function toJevVideoData(ep) {
  const [y, m, d] = ep.date.split("-").map(Number);
  const weekday = WEEKDAYS_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const shortDate = `${m}/${d}`;
  const kindLabel = KIND_LABEL[ep.kind];
  const sourceLine = `出典: ${outletsLabel(ep.sources)}`;
  const count = ep.slides.length;
  const stageNote = ep.stage === 3 ? kindLabel : `${kindLabel} 第${ep.stage_episode}回`;
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
  if (cmd === "next") {
    const today = todayJst();
    const previous = (file.episodes || []).filter((e) => e.date < today);
    const slot = nextSlot(previous);
    console.log(JSON.stringify({ today, ...slot, usecaseTarget: USECASE_TARGET, usecaseMin: USECASE_MIN }, null, 2));
    return 0;
  }
  const noDate = argv.includes("--no-date-check");
  const hp = join(rootDir, "data", "performance-history.json");
  const history = !noDate && !fileArg && existsSync(hp) ? JSON.parse(readFileSync(hp, "utf-8")) : null;
  const { errors, warnings, episode, slot } = validateEpisodes(file, { pickLatest: noDate, history });
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
