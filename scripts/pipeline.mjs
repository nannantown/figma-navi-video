/**
 * Full pipeline: load enriched data → generate audio → render video → post
 * Usage: node scripts/pipeline.mjs
 *
 * Figma Navi channel runs news-first (no scraper). The Claude Routine
 * writes data/enriched-design-news.json in advance; this pipeline
 * consumes it directly.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");

function run(cmd) {
  console.log(`\n>>> ${cmd}\n`);
  execSync(cmd, { cwd: rootDir, stdio: "inherit" });
}

function runSafe(cmd, label) {
  try {
    run(cmd);
  } catch (err) {
    console.error(`${label} failed (non-blocking): ${err.message}`);
  }
}

function main() {
  mkdirSync(outputDir, { recursive: true });

  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  // Step 0: Fetch past video stats & generate optimization hints
  console.log("=== Step 0: Fetch Stats & Optimize ===");
  runSafe("node scripts/fetch-stats.mjs", "fetch-stats");

  // Step 1: Generate Japanese data from enriched JSON (routine-provided)
  console.log("\n=== Step 1: Generate Data ===");
  run("node scripts/generate-data.mjs");

  // Step 2: Generate TTS audio + BGM
  console.log("\n=== Step 2: Generate Audio ===");
  run("node scripts/generate-audio.mjs --data=output/trending-data.json");
  run("node scripts/generate-bgm.mjs");

  // Step 3: Build input props for Remotion
  console.log("\n=== Step 3: Build Input Props ===");
  const trendingData = JSON.parse(
    readFileSync(join(outputDir, "trending-data.json"), "utf-8")
  );
  const audioDurations = JSON.parse(
    readFileSync(join(outputDir, "audio-durations.json"), "utf-8")
  );
  const subtitles = JSON.parse(
    readFileSync(join(outputDir, "subtitles.json"), "utf-8")
  );

  const inputProps = {
    projects: trendingData.projects,
    audioDurations,
    subtitles,
  };

  const propsPath = join(outputDir, "input-props.json");
  writeFileSync(propsPath, JSON.stringify(inputProps));
  console.log(`Input props → ${propsPath}`);

  // Step 4: Render video (to intermediate file — Remotion emits yuvj420p
  //         despite Config.setPixelFormat("yuv420p"); Instagram Reels rejects
  //         yuvj420p with ProcessingFailedError during media processing.
  //         Step 4b re-encodes to yuv420p as a guaranteed normalization pass.)
  const rawFile = `output/design-${dateStr}.raw.mp4`;
  const outputFile = `output/design-${dateStr}.mp4`;
  console.log(`\n=== Step 4: Render Video → ${rawFile} ===`);
  run(`npx remotion render FigmaNaviVideo "${rawFile}" --props="${propsPath}"`);

  console.log(`\n=== Step 4b: Normalize to yuv420p → ${outputFile} ===`);
  run(
    `ffmpeg -y -i "${rawFile}" -c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.0 -crf 20 -preset fast -c:a copy -movflags +faststart "${outputFile}"`
  );
  run(`rm -f "${rawFile}"`);

  // Step 4c: Render cover image for branded profile-grid thumbnail on IG.
  const coverFile = `output/design-${dateStr}-cover.jpg`;
  console.log(`\n=== Step 4c: Render Cover Image → ${coverFile} ===`);
  runSafe(
    `npx remotion still FigmaNaviVideo "${coverFile}" --frame=60 --props="${propsPath}"`,
    "render-cover"
  );

  // Step 5: Post to SNS (optional - skips if credentials not configured)
  const snsEnabled = process.env.SNS_POST_ENABLED === "true";
  if (snsEnabled) {
    console.log(`\n=== Step 5: Post to SNS ===`);
    run(`node scripts/post-sns.mjs --video="${outputFile}"`);
  } else {
    console.log(`\n=== Step 5: SNS posting skipped (set SNS_POST_ENABLED=true to enable) ===`);
  }

  // Step 6: Record upload for analytics tracking
  if (snsEnabled) {
    console.log(`\n=== Step 6: Record Upload ===`);
    runSafe("node scripts/record-upload.mjs", "record-upload");
  }

  console.log(`\n=== Done! ${outputFile} ===`);
}

main();
