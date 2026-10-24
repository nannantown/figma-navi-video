/**
 * Full pipeline: routine data → tool images → audio → render → post
 * Usage: node scripts/pipeline.mjs
 *
 * Genre trial #1 "新作AIツール TOP5 (Product Hunt)". The Claude Routine
 * (07:30 JST) writes data/enriched-ai-tools.json from the Product Hunt
 * snapshot (data/product-hunt-daily.json, fetched by fetch-product-hunt.yml);
 * this pipeline turns it into a < 60 s vertical video and posts it.
 *
 * Verification (never posts, never needs today's routine output):
 *   DRY_RUN=1 ENRICHED_PATH=data/samples/enriched-ai-tools.sample.json ALLOW_STALE_DATE=1 node scripts/pipeline.mjs
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { reportSkip, reportSkipStreak } from "./skip-report.mjs";
import { loadHistory } from "./history.mjs";
import { mayCharacterOn, readLessonLook } from "./jev.mjs";
import { reelScenes, voiceScenes, reelSeconds, reelCoverOffsetMs, REEL_RATES, REEL_FPS, REEL_COMPOSITION_ID } from "./reel.mjs";
import { renderWithFallback } from "./render-fallback.mjs";
import {
  ENDING_EXTRA_FRAMES,
  FPS,
  MIN_OPENING_FRAMES,
  PADDING_FRAMES,
  coverFrame,
  coverOffsetMs,
} from "./cover-frame.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");

const COMPOSITION_ID = "AiToolsTop5"; // src/Root.tsx
// Frame arithmetic (FPS / PADDING_FRAMES / ENDING_EXTRA_FRAMES /
// MIN_OPENING_FRAMES) lives in cover-frame.mjs, next to the cover rule that
// depends on it. Keep it in sync with calculateFrameDurations() in src/data.ts.
const TARGET_MAX_SECONDS = 58; // Instagram Reels rejects > 60 s
const HARD_MAX_SECONDS = 59.5;
const REEL_MAX_SECONDS = 59; // the owner's Instagram limit for the reel look
const REEL_VOICE_BUDGET_MS = 4 * 60 * 1000; // all reel voice clips, every rate tried
const REEL_RENDER_KILL_MS = 8 * 60 * 1000; // the reel render; the cards still fit in the 20-minute job after it
const IMAGE_STEP_KILL_MS =150000; // fetch-tool-images.mjs budgets itself to STEP_BUDGET_MS (90 s)

function run(cmd, opts = {}) {
  console.log(`\n>>> ${cmd}\n`);
  execSync(cmd, { cwd: rootDir, stdio: "inherit", ...opts });
}

function runSafe(cmd, label, opts = {}) {
  try {
    run(cmd, opts);
    return true;
  } catch (err) {
    console.error(`${label} failed (non-blocking): ${err.message}`);
    return false;
  }
}

function readJson(name) {
  return JSON.parse(readFileSync(join(outputDir, name), "utf-8"));
}

/** Same arithmetic as calculateFrameDurations() in src/data.ts. */
function videoSeconds(durations) {
  let frames = 0;
  for (const [key, sec] of Object.entries(durations)) {
    if (!sec) continue;
    let f = Math.ceil(sec * FPS) + (key === "ending" ? ENDING_EXTRA_FRAMES : PADDING_FRAMES);
    if (key === "opening") f = Math.max(f, MIN_OPENING_FRAMES);
    frames += f;
  }
  return frames / FPS;
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const dryRun = process.env.DRY_RUN === "1";
  const snsEnabled = process.env.SNS_POST_ENABLED === "true" && !dryRun;

  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  // Step 0: Fetch past video stats (YouTube + Instagram insights)
  console.log("=== Step 0: Fetch Stats ===");
  runSafe("node scripts/fetch-stats.mjs", "fetch-stats");

  // Step 1: Routine data → output/trending-data.json (hard error if missing/stale/invalid)
  console.log("\n=== Step 1: Generate Data ===");
  run("node scripts/generate-data.mjs");
  const skipPath = join(outputDir, "skip.json");
  if (existsSync(skipPath)) {
    // The routine found fewer new launches than the minimum: no video today, by
    // design — but never silently: warning annotation, job summary, history entry.
    const skip = JSON.parse(readFileSync(skipPath, "utf-8"));
    console.log(`\n=== Skipped ${skip.date}: ${skip.reason} (fresh candidates: ${skip.fresh_candidates}) — no video, no post ===`);
    reportSkip(skip);
    // Record the pause itself whenever this is a real run: a paused day has to
    // stay visible to pdca-summary even while posting is switched off, or the
    // 14-day window silently counts it as a day that never existed.
    if (!dryRun) {
      console.log(`\n=== Record Skip Day ===`);
      runSafe("node scripts/record-upload.mjs --skip", "record-upload --skip");
    }
    // Pausing twice in a row is not "no launches today" any more — it means the
    // supply stopped. Fail the run so somebody looks, instead of staying green
    // with nothing posted.
    if (reportSkipStreak(loadHistory(rootDir)?.videos || [], skip)) {
      process.exitCode = 1;
    }
    return;
  }

  // Step 1b: Logos / screenshots (best effort, never blocks). Jev slides are
  //          text-only (genre trial #2), so there is nothing to fetch.
  console.log("\n=== Step 1b: Tool Images ===");
  // The script keeps its own time budget; the kill is only a backstop (cards stay text-only).
  if (readJson("trending-data.json").meta?.mode === "jev") console.log("  Jev format — no images");
  else runSafe("node scripts/fetch-tool-images.mjs", "fetch-tool-images", { timeout: IMAGE_STEP_KILL_MS, killSignal: "SIGKILL" });

  // Steps 2-4c: the lesson's step-by-step reel (data/content-format.json "lessonLook": "reel"),
  // or the slide cards. A reel that cannot be made must not cost the day's post: the same
  // episode goes out as cards instead, with a warning on the run.
  const data = readJson("trending-data.json");
  let result = null;
  if (data.reel && readLessonLook(rootDir) === "reel") {
    try {
      result = await renderReel(data, dateStr);
    } catch (err) {
      console.log(`::warning title=参考リール型で作れなかった::いつもの 4 枚の見た目で作ります。理由: ${String(err.message || err).split("\n")[0]}`);
    }
  }
  if (!result) result = renderCards(dateStr);
  const { outputFile, seconds } = result;
  // record-upload.mjs keeps the look, length and Reels cover point with the day.
  writeFileSync(join(outputDir, "render.json"), JSON.stringify({ look: result.look, seconds: +seconds.toFixed(2), coverOffsetMs: result.coverOffsetMs }));

  // Step 5: Post to SNS
  if (snsEnabled) {
    // Instagram picks the Reels cover from this offset. Derived from the day's
    // real audio durations, so it tracks the cover scene wherever it starts.
    // An offset set in the environment wins, so the workflow keeps a usable
    // override; `!` rather than `??=` so an empty string does not count as set
    // (Number("") is 0, i.e. the first frame of the video).
    const offsetMs = result.coverOffsetMs;
    if (!process.env.INSTAGRAM_THUMB_OFFSET_MS) {
      process.env.INSTAGRAM_THUMB_OFFSET_MS = String(offsetMs);
    }
    const usedOffset = process.env.INSTAGRAM_THUMB_OFFSET_MS;
    console.log(
      `\n=== Step 5: Post to SNS (${result.look}, IG thumb_offset ${usedOffset} ms` +
        `${usedOffset === String(offsetMs) ? "" : ` — overridden, computed ${offsetMs}`}) ===`
    );
    try {
      run(`node scripts/post-sns.mjs --video="${outputFile}"`);
    } finally {
      // Step 6: Record whatever did get posted — even when the other platform
      // failed — so the trial's history (genre start date, 30-day repeat list,
      // IG insights) never loses a live post. post-sns's failure still fails
      // the run afterwards.
      console.log(`\n=== Step 6: Record Upload ===`);
      runSafe("node scripts/record-upload.mjs", "record-upload");
    }
  } else {
    console.log(`\n=== Step 5: SNS posting skipped (${dryRun ? "DRY_RUN=1" : "set SNS_POST_ENABLED=true to enable"}) ===`);
    // Still produce captions so a dry run shows exactly what would be posted.
    // Fatal like the real run (post-sns stops before any upload when captions
    // fail), so a green verification run means the captions work too.
    run("node scripts/generate-caption.mjs");
  }

  if (!existsSync(join(rootDir, outputFile))) throw new Error(`${outputFile} was not produced`);
  console.log(`\n=== Done! ${outputFile} (${result.look}, ${seconds.toFixed(1)} s) ===`);
}

/** Remotion's yuvj420p → yuv420p (tv range); Instagram Reels rejects the former (ProcessingFailedError). */
function normalizeVideo(rawFile, outputFile) {
  // Convert the full-range (pc) frames to limited range (tv) explicitly:
  // `-pix_fmt yuv420p` alone keeps color_range=pc on newer ffmpeg (8.x), which
  // ffprobe still reports as yuvj420p — the format Instagram rejects.
  console.log(`\n=== Step 4b: Normalize to yuv420p (tv range) → ${outputFile} ===`);
  run(
    `ffmpeg -y -i "${rawFile}" -vf "scale=out_range=tv,format=yuv420p" -c:v libx264 -pix_fmt yuv420p -color_range tv -profile:v high -level 4.0 -crf 20 -preset fast -c:a copy -movflags +faststart "${outputFile}"`
  );
  rmSync(join(rootDir, rawFile), { force: true });
}

/**
 * The lesson as a step-by-step reel (src/compositions/LessonReel.tsx, docs/lesson-format.md §6):
 * one voice clip per scene with its word timings, faster only when the day would pass 58 s.
 */
async function renderReel(data, dateStr) {
  console.log("\n=== Step 2: Reel Script + Voice (lessonLook = reel) ===");
  const script = reelScenes(data.reel, data.jev?.prompt);
  if (!script.prompt) throw new Error("no prompt on the lesson (slide 2)");
  let scenes = null;
  let seconds = Infinity;
  // The job has 20 minutes (daily-video.yml): the reel gets a budget, so a slow day still
  // leaves time to make the cards instead.
  const voiceDeadline = Date.now() + REEL_VOICE_BUDGET_MS;
  for (const rate of REEL_RATES) {
    scenes = await voiceScenes(script.scenes, { root: rootDir, rate, deadline: voiceDeadline });
    seconds = reelSeconds(scenes);
    console.log(`  Reel length at ${rate}: ${seconds.toFixed(1)} s (${scenes.length} scenes)`);
    if (seconds <= TARGET_MAX_SECONDS) break;
  }
  if (seconds > REEL_MAX_SECONDS) throw new Error(`reel would be ${seconds.toFixed(1)} s (> ${REEL_MAX_SECONDS} s) even at the fastest rate`);
  run("node scripts/generate-bgm.mjs");

  console.log("\n=== Step 3: Reel Props ===");
  const props = { ...script, scenes };
  const propsPath = join(outputDir, "reel-props.json");
  writeFileSync(propsPath, JSON.stringify(props));

  const rawFile = `output/aitools-${dateStr}.raw.mp4`;
  const outputFile = `output/aitools-${dateStr}.mp4`;
  console.log(`\n=== Step 4: Render Reel → ${rawFile} ===`);
  run(`npx remotion render ${REEL_COMPOSITION_ID} "${rawFile}" --props="${propsPath}"`, { timeout: REEL_RENDER_KILL_MS, killSignal: "SIGKILL" });
  normalizeVideo(rawFile, outputFile);
  const probed = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${outputFile}"`, { cwd: rootDir }).toString());
  if (!(probed > 0 && probed <= REEL_MAX_SECONDS)) throw new Error(`rendered reel is ${probed} s (0-${REEL_MAX_SECONDS} s allowed)`);
  console.log(`  mp4 ${probed.toFixed(2)} s`);

  // Cover: the hook's title with its step bars (the same point Instagram's thumb_offset uses).
  const coverOffsetMs = reelCoverOffsetMs(scenes);
  const coverFile = `output/aitools-${dateStr}-cover.jpg`;
  const frame = Math.round((coverOffsetMs / 1000) * REEL_FPS);
  console.log(`\n=== Step 4c: Render Cover Image → ${coverFile} (frame ${frame}) ===`);
  runSafe(`npx remotion still ${REEL_COMPOSITION_ID} "${coverFile}" --frame=${frame} --props="${propsPath}"`, "render-cover", { timeout: 120000, killSignal: "SIGKILL" });
  return { look: "reel", outputFile, seconds: probed, coverOffsetMs };
}

/** The slide cards (AiToolsTop5): Steps 2-4c as before. */
function renderCards(dateStr) {
  // Step 2: TTS + BGM, keeping the video under 60 s
  console.log("\n=== Step 2: Generate Audio ===");
  const rates = ["+30%", "+40%", "+50%"];
  let seconds = Infinity;
  for (const rate of rates) {
    run(`node scripts/generate-audio.mjs --data=output/trending-data.json --rate=${rate}`);
    seconds = videoSeconds(readJson("audio-durations.json"));
    console.log(`  Estimated video length at ${rate}: ${seconds.toFixed(1)} s`);
    if (seconds <= TARGET_MAX_SECONDS) break;
  }
  if (seconds > HARD_MAX_SECONDS) {
    throw new Error(`Video would be ${seconds.toFixed(1)} s (> ${HARD_MAX_SECONDS} s) even at the fastest rate — narration too long.`);
  }
  run("node scripts/generate-bgm.mjs");

  // Step 3: Build input props for Remotion
  console.log("\n=== Step 3: Build Input Props ===");
  const videoData = readJson("trending-data.json");
  const inputProps = {
    tools: videoData.tools,
    meta: videoData.meta,
    audioDurations: readJson("audio-durations.json"),
    subtitles: readJson("subtitles.json"),
    may: mayCharacterOn(videoData.meta),
  };
  console.log(`先輩のメイ: ${inputProps.may ? "on" : "off"} (repo variable MAY_CHARACTER)`);
  const propsPath = join(outputDir, "input-props.json");
  writeFileSync(propsPath, JSON.stringify(inputProps));
  console.log(`Input props → ${propsPath}`);

  // Step 4: Render (intermediate file — Remotion emits yuvj420p despite
  //         Config.setPixelFormat("yuv420p"); Instagram Reels rejects it with
  //         ProcessingFailedError. Step 4b re-encodes to yuv420p.)
  const rawFile = `output/aitools-${dateStr}.raw.mp4`;
  const outputFile = `output/aitools-${dateStr}.mp4`;
  console.log(`\n=== Step 4: Render Video → ${rawFile} ===`);
  const renderCmd = `npx remotion render ${COMPOSITION_ID} "${rawFile}" --props="${propsPath}"`;
  // A broken image or 先輩のメイ's layer must not cost the day's post: one retry without them
  // (render-fallback.mjs). The cover below uses the props that rendered.
  const rendered = renderWithFallback(inputProps, (props) => {
    writeFileSync(propsPath, JSON.stringify(props));
    if (props !== inputProps && inputProps.tools.some((t) => t.image)) {
      rmSync(join(rootDir, "public", "tools"), { recursive: true, force: true });
    }
    run(renderCmd);
  });

  normalizeVideo(rawFile, outputFile);

  // Step 4c: Cover still — the first tool card, so the day's tool name and
  //          logo are what the Instagram grid shows (see cover-frame.mjs).
  const frame = coverFrame(inputProps.audioDurations, inputProps.tools.length);
  const coverFile = `output/aitools-${dateStr}-cover.jpg`;
  console.log(`\n=== Step 4c: Render Cover Image → ${coverFile} (frame ${frame}) ===`);
  // Best effort, as before; a failure with 先輩のメイ is retried once without her.
  try {
    renderWithFallback(rendered, (props) => {
      writeFileSync(propsPath, JSON.stringify(props));
      run(`npx remotion still ${COMPOSITION_ID} "${coverFile}" --frame=${frame} --props="${propsPath}"`);
    });
  } catch (err) {
    console.error(`render-cover failed (non-blocking): ${err.message}`);
  }
  return { look: "cards", outputFile, seconds, coverOffsetMs: coverOffsetMs(inputProps.audioDurations, inputProps.tools.length) };
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
