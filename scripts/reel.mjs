/**
 * The step-by-step "reel" look of a lesson (data/content-format.json "lessonLook": "reel"):
 * episode.reel → scenes (つかみ → ステップ 1..N → まとめ → 保存) → one Edge TTS clip per
 * scene with its word timings (the subtitle, the typing and the cursor follow the words)
 * → props for src/compositions/LessonReel.tsx. Spec: docs/lesson-format.md §6.
 */
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { synthesizeOnce } from "./edge-tts.mjs";
import { reelNotes, REEL_RECAP_NARRATION, REEL_SAVE_NARRATION } from "./jev.mjs";

export const REEL_COMPOSITION_ID = "LessonReel"; // src/Root.tsx
export const REEL_FPS = 30; // LessonReel's fps (src/compositions/LessonReel.tsx REEL_FPS)
export const REEL_VOICE = "ja-JP-NanamiNeural";
// The 見本's +12% first; faster only when a long day would pass 58 s.
export const REEL_RATES = ["+12%", "+20%", "+28%"];
export const REEL_TAIL_PAD = 0.45; // silence after each scene (s)
export const REEL_APP_NAME = "AIチャット"; // the window's own name: never a real product's screen

/** episode.reel + the copyable prompt (slide 2) → scenes without audio. */
export function reelScenes(reel, prompt) {
  const n = reel.steps.length;
  return {
    app: REEL_APP_NAME,
    prompt,
    file: reel.file ?? null,
    answer: reel.answer,
    notes: reelNotes(reel),
    steps: n,
    recap: reel.steps.map((s) => s.heading.join("")),
    scenes: [
      { kind: "hook", heading: [reel.title, `${n}ステップ`, ""], narration: reel.hook, accents: [`${n}つ`] },
      ...reel.steps.map((s, i) => ({
        kind: "step",
        action: s.action,
        step: i + 1,
        heading: s.heading,
        narration: s.narration,
        accents: s.accents?.length ? s.accents : [s.heading[1]],
        ...(s.focus ? { focus: s.focus } : {}),
      })),
      { kind: "recap", heading: ["これで", "完了", ""], narration: REEL_RECAP_NARRATION, accents: ["完了"] },
      { kind: "save", heading: ["", "保存", "して、見返す"], narration: REEL_SAVE_NARRATION, accents: ["保存"] },
    ],
  };
}

// audio-24khz-48kbitrate-mono-mp3 is a constant 48 kbps (same estimate as generate-audio.mjs).
const mp3Seconds = (buf) => (buf.length * 8) / 48000;

/** Frames of one scene / the whole video — the same rounding as LessonReel. */
export const sceneFrames = (s) => Math.round(s.duration * REEL_FPS);
export const reelSeconds = (scenes) => scenes.reduce((n, s) => n + sceneFrames(s), 0) / REEL_FPS;

/**
 * Reels cover: the hook's last moment — the day's title with its N step bars, all faded in.
 * Same point for the Remotion still and Instagram's thumb_offset.
 */
export function reelCoverOffsetMs(scenes) {
  const hook = sceneFrames(scenes[0]);
  return Math.round((Math.max(1, hook - 8) / REEL_FPS) * 1000);
}

// Edge TTS drops a request now and then (generate-audio.mjs retries the same way).
async function withRetry(fn, label, attempts = 4) {
  const errors = [];
  for (let a = 1; a <= attempts; a++) {
    try {
      return await fn();
    } catch (err) {
      errors.push(err.message);
      console.error(`  ${label}: TTS attempt ${a}/${attempts} failed: ${err.message}`);
      if (a < attempts) await new Promise((r) => setTimeout(r, 2000 * a));
    }
  }
  throw new Error(`${label}: TTS failed ${attempts} times — ${errors.join(" / ")}`);
}

/** Voice every scene into public/audio/reel/ (replaced each run). Returns the scenes with audio, duration, words. */
export async function voiceScenes(scenes, { root, rate, synthesize = synthesizeOnce }) {
  const dir = join(root, "public", "audio", "reel");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const [i, s] of scenes.entries()) {
    const { audio, words } = await withRetry(() => synthesize(s.narration, { voice: REEL_VOICE, rate, timeoutMs: 30000 }), `reel scene ${i}`);
    if (!audio?.length) throw new Error(`reel scene ${i} (${s.kind}): no audio from Edge TTS`);
    const file = `audio/reel/scene-${i}.mp3`;
    writeFileSync(join(root, "public", file), audio);
    out.push({ ...s, audio: file, duration: +(mp3Seconds(audio) + REEL_TAIL_PAD).toFixed(3), words: words || [] });
  }
  return out;
}
