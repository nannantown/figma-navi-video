// 実体験の語りは、裏付けの記録があるときだけ (owner order 2026-10-24).
// 「使ってみた」「試したら〜だった」「私は毎日こうしている」のような言い回しを、
// 動画・タイトル・キャプションに出る文から探す。見つかったら、その回の
// `evidence` に記録が要る。無ければ「〜できる機能です」「公式によると〜」に直す。
//
// evidence: [{ claim, kind, file, what }]
//   claim — 実体験を語る文の一部を、そのまま写す（その文の中の言い回しを覆う）
//   kind  — "log"（実行ログ・出力のコピー）/ "screenshot"（出力のスクショ）/ "measurement"（実測値）
//   file  — data/evidence/<放送日>/ の下に置いた、空でないファイル（リポに残る証拠）
//   what  — 何をしてどうなったかを一言
//
// Same file in figma-navi-video / coffee-daily-video / kawagutsu-zukan-video
// (Option A: copied per repo, like upload-instagram.mjs). Fix one, port to all.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Each pattern is a way of saying "I did it and this happened". Invitations to the
// viewer (試してみましょう・やってみてください・試したい人は) and plain facts stay allowed.
export const EXPERIENCE_PATTERNS = [
  // 使ってみた・試してみました・飲んでみたら（〜てみたい・〜てみましょう は通す）
  /[てで]み(?:た(?![いく])|まし(?!ょう))/u,
  // 試した・試しました・試したら・試した結果
  /試し(?:た(?![いく])|まし(?!ょう))/u,
  // 使ったところ・頼んだ結果
  /(?:使った|やった|頼んだ|入れた|飲んだ|淹れた|履いた|聞いた|測った|計った|比べた)(?:ところ|結果)/u,
  // 実際に使いました・実際に飲んだら
  /実際に(?:使|試|やっ|飲|淹れ|履|測|計|頼|入れ|比べ|聞い)[^。！？]{0,8}?(?:[ただ](?![いく])|まし(?!ょう))/u,
  // 私は毎日こうしている・僕もいつも使っています・うちでは毎朝
  /(?:私|わたし|僕|ぼく|俺|うち|メイ)(?:たち)?(?:は|も|が|では)[^。！？]{0,20}?(?:毎日|毎朝|毎回|いつも|普段|ふだん|ずっと|愛用|使って|試して|飲んで|淹れて|履いて|頼んで|てい(?:ます|る))/u,
  // 体験談の言葉（「履き込むと色が変わる」のような品物の説明は通す）
  /愛用|実体験|体験談|手放せな/u,
];

/** Experience wordings found in one text: [{ word, index }]. */
export function experienceClaims(text) {
  const t = String(text ?? "").normalize("NFKC");
  const out = [];
  for (const re of EXPERIENCE_PATTERNS) {
    const g = new RegExp(re.source, "gu");
    for (let m; (m = g.exec(t)); ) out.push({ word: m[0], index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

// Fields that are not shown as our own voice: the sources quote other pages, the
// research notes and the evidence itself are ours to keep.
const SKIP_KEYS = new Set(["sources", "source", "research", "evidence", "reviews", "url", "urls"]);

/** Every shown string of an episode with its path (skips sources / research / evidence). */
export function shownStrings(value, at = "") {
  if (typeof value === "string") return [[at, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => shownStrings(v, `${at}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => (SKIP_KEYS.has(k) ? [] : shownStrings(v, at ? `${at}.${k}` : k)));
  }
  return [];
}

export const EVIDENCE_KINDS = ["log", "screenshot", "measurement"];
const EVIDENCE_DIR = "data/evidence/";

function evidenceFileProblem(file, root) {
  if (typeof file !== "string" || !file.startsWith(EVIDENCE_DIR) || file.split("/").includes("..")) return `file must be a path under ${EVIDENCE_DIR}`;
  try {
    const st = fs.statSync(path.join(root, file));
    if (!st.isFile() || st.size === 0) return `${file} is empty or not a file`;
  } catch {
    return `${file} is not in the repo`;
  }
  return null;
}

/**
 * Problems for one episode. `texts` = [[label, string]] (default: shownStrings(ep)),
 * `evidence` = ep.evidence. Experience wording passes only when an evidence entry with
 * a real file quotes the sentence around it.
 */
export function experienceProblems(ep, { at = "", texts = shownStrings(ep), evidence = ep?.evidence, root = REPO_ROOT } = {}) {
  const problems = [];
  const records = Array.isArray(evidence) ? evidence : evidence == null ? [] : null;
  if (records === null) return [`${at}evidence: must be an array of { claim, kind, file, what }`];
  const good = [];
  records.forEach((r, i) => {
    const bad = [];
    if (typeof r?.claim !== "string" || !r.claim.trim()) bad.push("claim (the sentence, copied as shown)");
    if (!EVIDENCE_KINDS.includes(r?.kind)) bad.push(`kind (${EVIDENCE_KINDS.join(" / ")})`);
    if (typeof r?.what !== "string" || !r.what.trim()) bad.push("what (what was done and what happened)");
    const fp = evidenceFileProblem(r?.file, root);
    if (fp) bad.push(fp);
    if (bad.length) problems.push(`${at}evidence[${i}]: needs ${bad.join(", ")}`);
    else good.push(r.claim.normalize("NFKC"));
  });
  for (const [label, value] of texts) {
    const t = String(value).normalize("NFKC");
    for (const { word, index } of experienceClaims(t)) {
      const covered = good.some((c) => {
        for (let k = t.indexOf(c); k !== -1; k = t.indexOf(c, k + 1)) if (k <= index && index + word.length <= k + c.length) return true;
        return false;
      });
      if (!covered) problems.push(`${at}${label}: "${word}" tells it as our own experience, with no record — write it as what the feature does (「〜できます」「公式によると〜」), or keep a record in ${EVIDENCE_DIR} and list it in evidence (docs: 実体験の語り)`);
    }
  }
  return problems;
}
