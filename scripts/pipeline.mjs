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

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");

const COMPOSITION_ID = "AiToolsTop5"; // src/Root.tsx
const FPS = 30; // keep in sync with calculateFrameDurations() in src/data.ts
const PADDING_FRAMES = 15;
const ENDING_EXTRA_FRAMES = 30;
const TARGET_MAX_SECONDS = 58; // Instagram Reels rejects > 60 s
const HARD_MAX_SECONDS = 59.5;

function run(cmd, opts = {}) {
  console.log(`\n>>> ${cmd}\n`);
  execSync(cmd, { cwd: rootDir, stdio: "inherit", ...opts });
}

function runSafe(cmd, label) {
  try {
    run(cmd);
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
    frames += Math.ceil(sec * FPS) + (key === "ending" ? ENDING_EXTRA_FRAMES : PADDING_FRAMES);
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

  // Step 1b: Logos / screenshots (best effort, never blocks)
  console.log("\n=== Step 1b: Tool Images ===");
  runSafe("node scripts/fetch-tool-images.mjs", "fetch-tool-images");

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

  console.log(`\n=== Step 4b: Normalize to yuv420p → ${outputFile} ===`);
  run(
    `ffmpeg -y -i "${rawFile}" -c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.0 -crf 20 -preset fast -c:a copy -movflags +faststart "${outputFile}"`
  );
  rmSync(join(rootDir, rawFile), { force: true });

  // Step 4c: Cover still (frame 60 = the opening title card)
  const coverFile = `output/aitools-${dateStr}-cover.jpg`;
  console.log(`\n=== Step 4c: Render Cover Image → ${coverFile} ===`);
  runSafe(`npx remotion still ${COMPOSITION_ID} "${coverFile}" --frame=60 --props="${propsPath}"`, "render-cover");

  // Step 5: Post to SNS
  if (snsEnabled) {
    console.log(`\n=== Step 5: Post to SNS ===`);
    run(`node scripts/post-sns.mjs --video="${outputFile}"`);
  } else {
    console.log(`\n=== Step 5: SNS posting skipped (${dryRun ? "DRY_RUN=1" : "set SNS_POST_ENABLED=true to enable"}) ===`);
    // Still produce captions so a dry run shows exactly what would be posted.
    runSafe("node scripts/generate-caption.mjs", "generate-caption");
  }

  // Step 6: Record upload for analytics tracking
  if (snsEnabled) {
    console.log(`\n=== Step 6: Record Upload ===`);
    runSafe("node scripts/record-upload.mjs", "record-upload");
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
