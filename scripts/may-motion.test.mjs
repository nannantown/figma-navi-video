import test from "node:test";
import assert from "node:assert/strict";
import { loudnessPerFrame, mouthFor, isBlinking, smoothLevels } from "../src/components/mayMotion.ts";

test("mouth follows the narration's loudness and shuts in silence", () => {
  const rate = 3000, fps = 30, per = rate / fps;
  // frame 0 silent, frame 1 loud, frame 2 quiet (a third of the peak)
  const samples = new Float32Array(per * 3);
  for (let i = per; i < per * 2; i++) samples[i] = i % 2 ? 0.6 : -0.6;
  for (let i = per * 2; i < per * 3; i++) samples[i] = i % 2 ? 0.2 : -0.2;
  const levels = loudnessPerFrame(samples, rate, fps);
  assert.equal(levels.length, 3);
  assert.deepEqual(levels.map(mouthFor), ["closed", "open", "half"]);
  assert.deepEqual(loudnessPerFrame(new Float32Array(per), rate, fps).map(mouthFor), ["closed"]);
});

test("smoothing removes one-frame flicker but keeps pauses shut", () => {
  const flicker = smoothLevels([1, 0, 1, 0, 1]).map(mouthFor);
  assert.ok(flicker.every((m) => m !== "closed"), flicker.join());
  assert.deepEqual(smoothLevels([0, 0, 0, 0]).map(mouthFor), ["closed", "closed", "closed", "closed"]);
});

test("blinks are short, regular, the same on every render and differ per scene", () => {
  const run = (seed) => Array.from({ length: 30 * 30 }, (_, f) => isBlinking(f, 30, seed));
  const frames = run("audio/tool-1.mp3");
  const starts = frames.filter((b, f) => b && !frames[f - 1]).length;
  assert.ok(starts >= 8 && starts <= 10, `blinks in 30 s: ${starts}`);
  assert.equal(frames.filter(Boolean).length, starts * 3);
  assert.deepEqual(frames, run("audio/tool-1.mp3"));
  assert.notDeepEqual(frames, run("audio/tool-2.mp3"));
});
