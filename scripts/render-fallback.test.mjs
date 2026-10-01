import test from "node:test";
import assert from "node:assert/strict";
import { fallbackProps, renderWithFallback } from "./render-fallback.mjs";

const jev = { tools: [{ heading: "h", body: "b" }], may: true };

test("a render that fails with 先輩のメイ is retried once with may:false, and the log says so", () => {
  const calls = [];
  const logs = [];
  const used = renderWithFallback(
    jev,
    (props) => {
      calls.push(props.may);
      if (props.may) throw new Error("delayRender() timed out (useAudioData)");
    },
    (line) => logs.push(line),
  );
  assert.deepEqual(calls, [true, false]);
  assert.equal(used.may, false, "the cover is then drawn without her too");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /delayRender\(\) timed out.*retrying once without 先輩のメイ \(may:false\)/);
});

test("only one retry: if the plain render fails too, the error stands", () => {
  let n = 0;
  assert.throws(() => renderWithFallback(jev, () => { n++; throw new Error(`fail ${n}`); }, () => {}), /fail 2/);
  assert.equal(n, 2);
});

test("nothing to drop (May off, no images): no retry", () => {
  let n = 0;
  assert.throws(() => renderWithFallback({ ...jev, may: false }, () => { n++; throw new Error("boom"); }, () => {}), /boom/);
  assert.equal(n, 1);
  assert.equal(fallbackProps({ tools: [{ image: null }], may: false }), null);
});

test("a success never retries; pickup images still fall back to text-only cards", () => {
  let n = 0;
  assert.equal(renderWithFallback(jev, () => { n++; }, () => {}), jev);
  assert.equal(n, 1);
  const pickup = { tools: [{ name: "x", image: "tools/x.png" }], may: false };
  assert.deepEqual(fallbackProps(pickup), { tools: [{ name: "x", image: null }], may: false });
});
