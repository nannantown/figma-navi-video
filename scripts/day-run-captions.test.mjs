import { test } from "node:test";
import assert from "node:assert/strict";
import { runsOfDay } from "./day-run-captions.mjs";

test("runsOfDay keeps the stamp's JST day, newest first", () => {
  const runs = [
    { number: 205, createdAt: "2026-10-26T01:08:52Z" },
    { number: 204, createdAt: "2026-10-25T02:08:59Z" },
    { number: 203, createdAt: "2026-10-25T01:08:57Z" },
    { number: 202, createdAt: "2026-10-24T15:30:00Z" }, // 00:30 JST on the 25th
    { number: 201, createdAt: "2026-10-24T01:34:11Z" },
  ];
  assert.deepEqual(runsOfDay(runs, "20261025").map((r) => r.number), [204, 203, 202]);
  assert.deepEqual(runsOfDay(runs, "20261027"), []);
});
