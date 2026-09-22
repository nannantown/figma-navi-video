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
const IMAGE_STEP_KILL_MS = 150000; // fetch-tool-images.mjs budgets itself to STEP_BUDGET_MS (90 s)

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

function main() {
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
  };
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
  try {
    run(renderCmd);
  } catch (err) {
    // A broken image must not cost the day's post: retry with text-only cards.
    if (!inputProps.tools.some((t) => t.image)) throw err;
    console.error(`Render failed (${err.message}) — retrying with text-only cards.`);
    inputProps.tools = inputProps.tools.map((t) => ({ ...t, image: null }));
    writeFileSync(propsPath, JSON.stringify(inputProps));
    rmSync(join(rootDir, "public", "tools"), { recursive: true, force: true });
    run(renderCmd);
  }

  // Convert the full-range (pc) frames to limited range (tv) explicitly:
  // `-pix_fmt yuv420p` alone keeps color_range=pc on newer ffmpeg (8.x), which
  // ffprobe still reports as yuvj420p — the format Instagram rejects.
  console.log(`\n=== Step 4b: Normalize to yuv420p (tv range) → ${outputFile} ===`);
  run(
    `ffmpeg -y -i "${rawFile}" -vf "scale=out_range=tv,format=yuv420p" -c:v libx264 -pix_fmt yuv420p -color_range tv -profile:v high -level 4.0 -crf 20 -preset fast -c:a copy -movflags +faststart "${outputFile}"`
  );
  rmSync(join(rootDir, rawFile), { force: true });

  // Step 4c: Cover still — the first tool card, so the day's tool name and
  //          logo are what the Instagram grid shows (see cover-frame.mjs).
  const frame = coverFrame(inputProps.audioDurations);
  const coverFile = `output/aitools-${dateStr}-cover.jpg`;
  console.log(`\n=== Step 4c: Render Cover Image → ${coverFile} (frame ${frame}) ===`);
  runSafe(`npx remotion still ${COMPOSITION_ID} "${coverFile}" --frame=${frame} --props="${propsPath}"`, "render-cover");

  // Step 5: Post to SNS
  if (snsEnabled) {
    // Instagram picks the Reels cover from this offset. Derived from the day's
    // real audio durations, so it tracks the first card wherever it starts.
    const offsetMs = coverOffsetMs(inputProps.audioDurations);
    process.env.INSTAGRAM_THUMB_OFFSET_MS = String(offsetMs);
    console.log(`\n=== Step 5: Post to SNS (IG thumb_offset ${offsetMs} ms) ===`);
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
  console.log(`\n=== Done! ${outputFile} (${seconds.toFixed(1)} s estimated) ===`);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
