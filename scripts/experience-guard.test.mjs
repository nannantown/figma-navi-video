// 実体験の語りは記録があるときだけ (owner order 2026-10-24). Same file in
// figma-navi-video / coffee-daily-video / kawagutsu-zukan-video.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { experienceClaims, experienceProblems, shownStrings } from "./experience-guard.mjs";

const words = (t) => experienceClaims(t).map((c) => c.word);

test("experience wordings are found", () => {
  for (const t of [
    "ChatGPTで使ってみたら、3分で要約が終わりました。",
    "実際に試してみました。",
    "この頼み方を試したら、答えがはっきりしました。",
    "試した結果、こちらのほうが速かったです。",
    "社内の資料で使ったところ、ミスが減りました。",
    "実際に頼んだら、表が返ってきました。",
    "私は毎日この頼み方をしています。",
    "僕もいつもこの式を使っています。",
    "うちでは毎朝この比率で淹れています。",
    "メイは毎朝これで要約しています。",
    "92度で淹れてみると…いえ、淹れてみたら苦みが出ました。",
    "店で試し履きしてみたら、驚くほど軽い一足でした。",
    "長年愛用している一足です。",
    "使ってみると便利でした。",
    "ChatGPTに頼んだら3行で返ってきました。",
    "このやり方で、私の残業が減りました。",
    "私、毎朝これをやっています。",
    "個人的には毎日使っています。",
    "毎朝これで淹れてます、おすすめです。",
    "10年履いた今も現役です。",
    "試着したところ、ぴったりでした。",
    "1週間続けた結果、肩こりが減りました。",
    "使ってみて分かったのは、順番の大切さです。",
    "半年履いて驚いたのは、底の減りの少なさです。",
    "履いた感想は、とにかく軽いことです。",
    "私たちが飲み比べた結果、浅煎りが合いました。",
    "便利そうですが、試してみたら手間が増えました。",
  ]) assert.ok(words(t).length > 0, t);
});

test("feature descriptions, invitations and plain facts pass", () => {
  for (const t of [
    "長い文章を3行にまとめられる機能です。",
    "公式によると、ファイルを読みこんで要約できます。",
    "この文を貼って、中身を自分の仕事に書きかえてください。",
    "明日の仕事で試してみましょう。",
    "まずは一度やってみてください。",
    "試したい人は、保存しておきましょう。",
    "答えは自分で確かめましょう。",
    "すると、短い3行にまとまって返ってきます。",
    "1952年、狩りや野外で過ごす人のために作られました。",
    "働く人が履き込んで擦れた所の色の変化は、作り手の狙いです。",
    "湯温を下げると、苦みがおだやかになります。",
    "AIの答えは一例です。",
    "すると、変わったところだけが並んで返ってきます。",
    "文の言い回しが、自分たちのいつもの書き方とずれることがあります。",
    "チャーチルが愛用したことで知られます。",
    "王室に愛用されてきました。",
    "「使ってみた感想」の欄を分類してもらう頼み方です。",
    "使ってみると便利だった、という声も多い機能です。",
    "1961年、試作を重ねてみたら、短靴が生まれました。",
    "1日目に淹れた結果と比べてみましょう。",
    "体験談を書いてもらう頼み方です。",
    "LiteLLM がAIの振り分け役にJevを試した。",
    "職人が何度も試した末に生まれた木型です。",
    "英国軍の兵士が履いた結果、改良が進みました。",
  ]) assert.deepEqual(words(t), [], t);
});

test("shownStrings skips sources, research, evidence and the prompt / answer boxes (they are not our voice)", () => {
  const labels = shownStrings({
    hook: "a",
    sources: [{ title: "使ってみた" }],
    research: { note: "試した" },
    evidence: [{ claim: "x" }],
    slides: [{ body: "b", diagram: { type: "prompt", items: [{ label: "私は営業担当で、毎日メールを書いています。" }] } }, { diagram: { type: "answer", items: [{ label: "…" }] } }, { diagram: { type: "steps", items: [{ label: "c" }] } }],
  }).map(([l]) => l);
  assert.deepEqual(labels, ["hook", "slides[0].body", "slides[2].diagram.type", "slides[2].diagram.items[0].label"]);
});

test("experience wording needs an evidence record with a real file under data/evidence/", () => {
  const root = mkdtempSync(join(tmpdir(), "exp-guard-"));
  mkdirSync(join(root, "data/evidence/2026-10-25"), { recursive: true });
  writeFileSync(join(root, "data/evidence/2026-10-25/run.txt"), "prompt: …\nanswer: …\n");
  writeFileSync(join(root, "data/evidence/2026-10-25/empty.txt"), "");
  mkdirSync(join(root, "data/evidence/2026-10-01"), { recursive: true });
  writeFileSync(join(root, "data/evidence/2026-10-01/old.txt"), "old run\n");
  symlinkSync("/etc/hosts", join(root, "data/evidence/2026-10-25/link.txt"));
  const ep = { date: "2026-10-25", hook: "ChatGPTで試してみたら、3行で返ってきました。", slides: [{ body: "要約できる機能です。" }] };
  const record = { claim: "ChatGPTで試してみたら、3行で返ってきました", kind: "log", file: "data/evidence/2026-10-25/run.txt", what: "頼み方を送り、3行の答えを写した" };

  assert.match(experienceProblems(ep, { root }).join("\n"), /hook: "てみた" tells it as our own experience, with no record/);
  assert.deepEqual(experienceProblems({ ...ep, evidence: [record] }, { root }), []);
  // the record must quote the sentence around the wording, and point at a real, non-empty file in the repo
  assert.match(experienceProblems({ ...ep, evidence: [{ ...record, claim: "3行で返ってきました" }] }, { root }).join("\n"), /no record/);
  assert.match(experienceProblems({ ...ep, evidence: [{ ...record, file: "data/evidence/2026-10-25/missing.txt" }] }, { root }).join("\n"), /is not in the repo/);
  assert.match(experienceProblems({ ...ep, evidence: [{ ...record, file: "data/evidence/2026-10-25/empty.txt" }] }, { root }).join("\n"), /real, non-empty file/);
  assert.match(experienceProblems({ ...ep, evidence: [{ ...record, file: "data/evidence/../../etc/passwd" }] }, { root }).join("\n"), /under data\/evidence\//);
  assert.match(experienceProblems({ ...ep, evidence: [{ ...record, kind: "memo" }] }, { root }).join("\n"), /kind/);
  // a record that quotes only the wording would cover every sentence: the whole sentence is required
  assert.match(experienceProblems({ ...ep, evidence: [{ ...record, claim: "試してみたら" }] }, { root }).join("\n"), /claim \(the whole sentence/);
  assert.match(experienceProblems({ ...ep, hook: `${ep.hook}うちの部長も使ってみたら便利でした。`, evidence: [record] }, { root }).join("\n"), /うちの部長も使ってみたら便利でした/);
  // the record is today's (data/evidence/<air date>/), a real file of the kind's type, not a link
  assert.match(experienceProblems({ ...ep, evidence: [{ ...record, file: "data/evidence/2026-10-01/old.txt" }] }, { root }).join("\n"), /under data\/evidence\/2026-10-25\//);
  assert.match(experienceProblems({ ...ep, evidence: [{ ...record, file: "data/evidence/2026-10-25/link.txt" }] }, { root }).join("\n"), /not a link/);
  assert.match(experienceProblems({ ...ep, evidence: [{ ...record, kind: "screenshot" }] }, { root }).join("\n"), /a screenshot file is \.png/);
  assert.match(experienceProblems({ ...ep, evidence: "run.txt" }, { root }).join("\n"), /must be an array/);
  // no experience wording → no record needed
  assert.deepEqual(experienceProblems({ hook: "公式によると、3行に要約できます。" }, { root }), []);
});
