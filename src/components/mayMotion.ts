import { random } from "remotion";

// Pure timing for 先輩のメイ (May.tsx); tested by scripts/may-motion.test.mjs.

// Loudness relative to the clip's loudest frame. Below CLOSED the mouth is shut (pauses,
// breaths, the silent tail after the narration).
const CLOSED = 0.14;
const HALF = 0.42;

/** RMS loudness per video frame, 0..1 relative to the loudest frame of the clip. */
export function loudnessPerFrame(samples: Float32Array, sampleRate: number, fps: number): number[] {
  const per = Math.round(sampleRate / fps);
  const out: number[] = [];
  for (let start = 0; start < samples.length; start += per) {
    const end = Math.min(samples.length, start + per);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    out.push(Math.sqrt(sum / (end - start)));
  }
  const max = out.reduce((a, b) => Math.max(a, b), 1e-6);
  return out.map((v) => v / max);
}

/** Mean of each frame and its neighbours: the mouth no longer flips state every frame. */
export function smoothLevels(levels: number[]): number[] {
  return levels.map((_, i) => {
    const w = levels.slice(Math.max(0, i - 1), i + 2);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
}

export function mouthFor(level: number): "closed" | "half" | "open" {
  return level < CLOSED ? "closed" : level < HALF ? "half" : "open";
}

/** Blink 3 frames once every 3.2 s at a seeded-random moment (same on every render;
 *  `seed` = the scene, so scenes don't all blink at the same offsets). */
export function isBlinking(frame: number, fps: number, seed = ""): boolean {
  const period = Math.round(fps * 3.2);
  const n = Math.floor(frame / period);
  const at = Math.floor(fps * 0.4 + random(`may-blink-${seed}-${n}`) * (period - fps * 0.8));
  const f = frame - n * period;
  return f >= at && f < at + 3;
}
