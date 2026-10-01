import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attachPunctuation, pageAt, speechPages, textWidth } from "../src/components/speechPages.ts";

const w = (texts, gap = 0.05) => {
  let t = 0;
  return texts.map((text) => {
    const word = { offset: t, duration: 0.2, text };
    t += 0.2 + gap;
    return word;
  });
};

test("punctuation and brackets go back onto the words", () => {
  const words = w(["その", "速さ", "の", "数字", "誰", "が", "測っ", "た", "か"]);
  assert.deepEqual(attachPunctuation("その「速さ」の数字、誰が測ったか？", words), [
    "その", "「速さ」", "の", "数字、", "誰", "が", "測っ", "た", "か？",
  ]);
  assert.deepEqual(attachPunctuation("Cherry Creek Newsは", w(["Cherry", "Creek", "News", "は"])), ["Cherry ", "Creek ", "News", "は"]);
  // The words do not walk the text: all bare — never doubled ("ジェブ「Jev」") or dropped text.
  assert.deepEqual(attachPunctuation("ジェブ「Jev」は速い。", w(["ジェブ", "は", "速い"])), ["ジェブ", "は", "速い"]);
  assert.deepEqual(attachPunctuation("これはとても長い説明ですがXです。", w(["これ", "は", "X", "です"])), ["これ", "は", "X", "です"]);
  assert.deepEqual(attachPunctuation("AとB。", w(["A", "X", "B"])), ["A", "X", "B"]);
});

test("Latin letters count about half a character", () => {
  assert.ok(Math.abs(textWidth("ChatGPT") - 3.85) < 1e-9);
  assert.equal(textWidth("数字、"), 3);
});

test("a page ends at a sentence end and prefers a comma when too long", () => {
  const text = "この数字は、同社が用意した課題で、判断1回分の答えが返る時間です。同社自身も高めだと書いています。";
  const words = w(["この", "数字", "は", "同社", "が", "用意", "し", "た", "課題", "で", "判断", "1回分", "の", "答え", "が", "返る", "時間", "です", "同社", "自身", "も", "高め", "だ", "と", "書い", "て", "い", "ます"]);
  const pages = speechPages(text, words, 20).map((p) => p.pieces.join(""));
  assert.deepEqual(pages, ["この数字は、同社が用意した課題で、", "判断1回分の答えが返る時間です。", "同社自身も高めだと書いています。"]);
  for (const p of pages) assert.ok(p.length <= 20, p);
});

test("the bubble stays up between pages and goes away after the last word", () => {
  const pages = [
    { pieces: ["a"], start: 0, end: 1 },
    { pieces: ["b"], start: 1.6, end: 2 },
  ];
  assert.equal(pageAt(pages, -0.5), -1);
  assert.equal(pageAt(pages, 1.3), 0); // pause between pages: still page 0
  assert.equal(pageAt(pages, 1.55), 1);
  assert.equal(pageAt(pages, 2.3), 1);
  assert.equal(pageAt(pages, 2.5), -1);
});

test("real narration (sample): no page longer than the limit, nothing lost", () => {
  const subs = JSON.parse(readFileSync(new URL("../data/samples/may-subtitles.sample.json", import.meta.url), "utf-8"));
  for (const { text, words } of Object.values(subs)) {
    const pages = speechPages(text, words, 24);
    const joined = pages.map((p) => p.pieces.join("")).join("");
    assert.equal(joined.replace(/\s/g, ""), text.replace(/\s/g, ""));
    for (const p of pages) assert.ok(textWidth(p.pieces.join("")) <= 24, p.pieces.join(""));
  }
});

test("real narration: a long sentence splits evenly at a pause point, never inside a verb ending", () => {
  const subs = JSON.parse(readFileSync(new URL("../data/samples/may-subtitles.sample.json", import.meta.url), "utf-8"));
  const all = Object.values(subs).flatMap(({ text, words }) => speechPages(text, words, 24).map((p) => p.pieces.join("")));
  assert.ok(all.includes("同社自身も、実際の効果としては"), all.join(" / "));
  assert.ok(all.includes("高めの数字だと書いています。"), all.join(" / "));
  for (const p of all) assert.doesNotMatch(p, /^(て|た|ます|です)/, p);
});
