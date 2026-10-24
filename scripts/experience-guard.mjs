// 実体験の語りは、裏付けの記録があるときだけ (owner order 2026-10-24).
// 「使ってみた」「試したら〜だった」「私は毎日こうしている」のような言い回しを、
// 動画・タイトル・キャプションに出る文から 1 文ずつ探す。見つかったら、その回の
// `evidence` に記録が要る。無ければ「〜できる機能です」「公式によると〜」に直す。
//
// evidence: [{ claim, kind, file, what }]   (today's file, top level — a stock entry never carries one)
//   claim — 実体験を語る文を、まるごとそのまま写す（文の一部だけでは通らない）
//   kind  — "log"（実行ログ・出力のコピー）/ "screenshot"（出力のスクショ）/ "measurement"（実測値）
//   file  — data/evidence/<放送日>/ の下に置いた、空でない本物のファイル（リンクは不可）
//   what  — 何をしてどうなったかを一言
//
// Same file in figma-navi-video / coffee-daily-video / kawagutsu-zukan-video
// (Option A: copied per repo, like upload-instagram.mjs). Fix one, port to all.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PAST_END = /(?:ました|でした|かった|った|んだ|いた|えた|れた|きた|した|せた|めた|けた|てた|ねた|げた|びた|じた)(?:よ|ね|よね|わ)?$/u;
// A sentence about history (1952年に〜してみたら…) is not us, unless it says 私 / うち / メイ.
const HISTORY = /[0-9]{3,4}年|年代|当時|かつて|創業|もともと|昔/u;
// Somebody else's experience, attributed: 「〜と言われます」「公式によると」.
const ATTRIBUTED = /と言われ|といわれ|と語られ|で知られ|と知られ|と発表|によると|とされ|と伝えられ|という人も|という声/u;
// 「自分」は入れない: 「自分で確かめましょう」「自分たちのいつもの書き方」は見る人の話。
const ME = "(?:私|わたし|僕|ぼく|俺|おれ|うち|メイ|筆者|当店|店主)(?:たち|達|ら|自身)?";
const ME_RE = new RegExp(ME, "u");
// 「〜が」 before the wording names who did it (「ですが、」 is a conjunction, not a subject).
const OTHER_SUBJECT = /[^\s、。,]\s?が(?![、,])/u;

// Each pattern is a way of saying "I did it and this happened", tested on one sentence.
// Invitations to the viewer (試してみましょう・やってみてください・試したい人は) and plain facts stay allowed.
export const EXPERIENCE_PATTERNS = [
  // 使ってみた・試してみました・飲んでみたら（〜てみたい・〜てみましょう は通す）
  /[てで]み(?:た(?![いく])|まし(?!ょう))/u,
  // 試した・試しました・試したら（試したい は通す）
  /試し(?:た(?![いく])|まし(?!ょう))/u,
  // 使ったところ、・1週間続けた結果・履いた感想（〜たところで・結果を・変わったところだけ は通す）
  /[ただ](?:ところ|結果)(?![でがをにはのもだまへかとや])|[ただ]感想/u,
  // 使ってみて分かった・半年履いて驚いた・使ってみての感想
  /[てで](?:みて)?(?:分か|わか|驚|気づ|気付)(?:った|りました|きました|いた)|[てで]みての感想/u,
  // 実際に使いました・実際に頼んだら
  /実際に(?:使|試|やっ|飲|淹れ|履|測|計|頼|入れ|比べ|聞い)[^。！？]{0,8}?(?:[ただ](?![いく])|まし(?!ょう))/u,
  // 私は毎日こうしている・僕もいつも・うちでは毎朝・個人的には・私の残業が減りました
  new RegExp(`(?:${ME}(?:は|も|が|では|の場合|、)|個人的には|個人的に)[^。！？]{0,24}?(?:毎日|毎朝|毎晩|毎回|いつも|よく|普段|ふだん|ずっと|愛用|愛飲|使って|試して|飲んで|淹れて|履いて|頼んで|ています|てます|てる(?:よ|ね)?$|ました|でした|できた)`, "u"),
  new RegExp(`${ME}の[^。！？]{0,20}?(?:ました|でした|かった)(?:よ|ね)?$`, "u"),
  // 主語なしの習慣: 毎朝これで淹れてます・10年履いた今も
  /(?:毎日|毎朝|毎晩|普段から|ふだんから|ずっと)[^。！？]{0,12}?(?:使っ|飲ん|淹れ|履い|続け|頼ん)て(?:い?ます|る)(?=[、。！？,.!?よね]|$)|[0-9０-９一二三四五六七八九十半]+(?:年|か月|ヶ月|カ月|週間|日)(?:間)?(?:ほど)?(?:履|使|飲|淹れ|続け)(?:い|っ|ん|き)?[ただ](?![いく])/u,
  // 体験談の言葉（「チャーチルが愛用した」「王室に愛用された」のような話は通す）
  /愛用(?:して|中)|愛飲|実体験|手放せません/u,
  // 〜たら / 〜てみると、…でした（過去の結果まで同じ文で言う）
  { sentence: (s) => /(?:[ただ]ら|[てで]みると|[てで]みて)[、,]?/u.test(s) && PAST_END.test(s) ? s.match(/(?:[ただ]ら|[てで]みると|[てで]みて)/u)[0] : null },
];

/** The sentences of a text, with quoted words (「…」『…』) blanked out: a quote is not our claim. */
function sentences(text) {
  const orig = String(text ?? "").normalize("NFKC");
  const t = orig.replace(/「[^」]*」|『[^』]*』/gu, (q) => "＿".repeat(q.length));
  const out = [];
  const re = /[^。！？!?\n]+/gu;
  for (let m; (m = re.exec(t)); ) {
    const core = m[0].trim();
    const start = m.index + m[0].indexOf(core);
    if (core) out.push({ core, shown: orig.slice(start, start + core.length) });
  }
  return out;
}

/** Experience wordings found in one text: [{ word, sentence }]. */
export function experienceClaims(text) {
  const out = [];
  for (const { core, shown } of sentences(text)) {
    if (ATTRIBUTED.test(core)) continue;
    if (HISTORY.test(core) && !ME_RE.test(core)) continue;
    for (const p of EXPERIENCE_PATTERNS) {
      const word = p.sentence ? p.sentence(core) : p.exec(core)?.[0];
      // Somebody else did it: 「LiteLLM がJevを試した」「職人が何度も試した」「兵士が履いた結果」.
      if (word && !ME_RE.test(core) && OTHER_SUBJECT.test(core.slice(0, core.indexOf(word)))) break;
      if (word) {
        out.push({ word, sentence: shown });
        break;
      }
    }
  }
  return out;
}

// Not our voice: the sources quote other pages, research / evidence are ours to keep, and a
// lesson's prompt box (what the viewer types: 「私は営業担当で…」) and answer box (the AI) are not us.
const SKIP_KEYS = new Set(["sources", "source", "research", "evidence", "reviews", "url", "urls"]);
const SKIP_TYPES = new Set(["prompt", "answer"]);

/** Every shown string of an episode with its path. */
export function shownStrings(value, at = "") {
  if (typeof value === "string") return [[at, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => shownStrings(v, `${at}[${i}]`));
  if (value && typeof value === "object") {
    if (SKIP_TYPES.has(value.type) && Array.isArray(value.items)) return [];
    return Object.entries(value).flatMap(([k, v]) => (SKIP_KEYS.has(k) ? [] : shownStrings(v, at ? `${at}.${k}` : k)));
  }
  return [];
}

export const EVIDENCE_KINDS = { log: [".txt", ".json", ".log", ".md"], screenshot: [".png", ".jpg", ".jpeg", ".webp"], measurement: [".json", ".csv", ".txt"] };
const EVIDENCE_DIR = "data/evidence";

function evidenceFileProblem(file, kind, date, root) {
  const dir = date ? `${EVIDENCE_DIR}/${date}/` : `${EVIDENCE_DIR}/`;
  if (typeof file !== "string" || !file.startsWith(dir) || file.split("/").includes("..")) return `file must be a path under ${dir}`;
  if (EVIDENCE_KINDS[kind] && !EVIDENCE_KINDS[kind].includes(path.extname(file).toLowerCase())) return `a ${kind} file is ${EVIDENCE_KINDS[kind].join(" / ")}`;
  try {
    const abs = path.join(root, file);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink() || !st.isFile() || st.size === 0) return `${file} must be a real, non-empty file (not a link)`;
    const real = fs.realpathSync(abs);
    if (!real.startsWith(fs.realpathSync(path.join(root, EVIDENCE_DIR)) + path.sep)) return `${file} must stay inside ${EVIDENCE_DIR}/`;
  } catch {
    return `${file} is not in the repo`;
  }
  return null;
}

const bare = (s) => String(s).normalize("NFKC").replace(/[\s。！？!?、,]+$/u, "").trim();

/**
 * Problems for one episode. `texts` = [[label, string]] (default: shownStrings(ep)),
 * `evidence` = today's records, `date` = the air date (records live under data/evidence/<date>/).
 * Experience wording passes only when a record with a real file quotes its whole sentence.
 */
export function experienceProblems(ep, { at = "", texts = shownStrings(ep), evidence = ep?.evidence, date = ep?.date, root = REPO_ROOT } = {}) {
  const problems = [];
  const records = Array.isArray(evidence) ? evidence : evidence == null ? [] : null;
  if (records === null) return [`${at}evidence: must be an array of { claim, kind, file, what }`];
  const good = [];
  records.forEach((r, i) => {
    const bad = [];
    if (typeof r?.claim !== "string" || bare(r.claim).length < 8) bad.push("claim (the whole sentence, copied as shown)");
    if (!Object.hasOwn(EVIDENCE_KINDS, r?.kind ?? "")) bad.push(`kind (${Object.keys(EVIDENCE_KINDS).join(" / ")})`);
    if (typeof r?.what !== "string" || !r.what.trim()) bad.push("what (what was done and what happened)");
    const fp = evidenceFileProblem(r?.file, r?.kind, date, root);
    if (fp) bad.push(fp);
    if (bad.length) problems.push(`${at}evidence[${i}]: needs ${bad.join(", ")}`);
    else good.push(bare(r.claim));
  });
  for (const [label, value] of texts) {
    for (const { word, sentence } of experienceClaims(value)) {
      const core = bare(sentence);
      if (!good.some((c) => c.includes(core))) {
        problems.push(`${at}${label}: "${word}" tells it as our own experience, with no record — write it as what the feature does (「〜できます」「公式によると〜」「〜と言われます」), or keep a record in ${EVIDENCE_DIR}/<放送日>/ and quote the whole sentence in evidence (docs: 実体験の語り): ${sentence}`);
      }
    }
  }
  return problems;
}
