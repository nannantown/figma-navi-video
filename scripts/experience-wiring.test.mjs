// 実体験の語り (owner 2026-10-24): today's episode check runs the experience guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERIES, validateEpisodes, stockEpisode } from "./jev.mjs";

const STOCK = JSON.parse(readFileSync(new URL("../data/ai-lesson-stock.json", import.meta.url), "utf8"));
const errorsOf = (ep) => validateEpisodes({ episodes: [ep] }, { date: ep.date, today: ep.date, series: SERIES.lesson }).errors.join("\n");

test("lesson: an unbacked 「試してみたら」 is stopped; the feature wording passes", () => {
  const ok = stockEpisode(STOCK.lessons[1], "2026-10-25");
  assert.equal(errorsOf(ok), "");
  const told = structuredClone(ok);
  told.slides[2].narration = "わたしも実際に試してみたら、本当に3行で返ってきました。";
  assert.match(errorsOf(told), /slides\[2\]\.narration: "てみた" tells it as our own experience, with no record/);
  const plain = structuredClone(ok);
  plain.slides[2].narration = "長い文章を、結論・理由・次にやることの3行にまとめてもらえます。";
  assert.equal(errorsOf(plain), "");
});
