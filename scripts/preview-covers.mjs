/**
 * Render the Instagram cover still for several days side by side, so you can
 * see what the profile grid will look like before a change lands.
 *
 * Usage:
 *   node scripts/preview-covers.mjs data/enriched-ai-tools.json data/samples/enriched-ai-tools.pickup.sample.json
 *   git show <sha>:data/enriched-ai-tools.json > /tmp/day.json   # an older day
 *
 * Output: output/cover-preview-<date>.jpg per input.
 *
 * Every day is rendered with the SAME audio durations on purpose: the cover
 * frame is then identical for all of them, so any difference between the
 * images comes from the day's data alone. Logos are not fetched here, so the
 * previews are the text-only variant of the card (production also draws the
 * tool's logo, which differs per day too).
 */

import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseEnrichedText, toVideoTools, buildMeta } from "./enriched-schema.mjs";
import { coverFrame } from "./cover-frame.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outputDir = join(rootDir, "output");
const COMPOSITION_ID = "AiToolsTop5";

// Representative production timings (opening 2.8 s, ~8.5 s per tool). One
// entry per tool of the day: getToolCount() counts these, so a short list
// would truncate the composition below the number of cards it renders.
function durationsFor(toolCount) {
  const d = { opening: 2.8, ending: 4.0 };
  for (let i = 1; i <= toolCount; i++) d[`tool-${i}`] = 8.5;
  return d;
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error("Usage: node scripts/preview-covers.mjs <enriched.json> [<enriched.json> ...]");
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

for (const input of inputs) {
  const { data } = parseEnrichedText(readFileSync(input, "utf-8"));
  if (data.skip) {
    console.log(`${input}: skip day, no video — nothing to preview`);
    continue;
  }
  const tools = toVideoTools(data).map((t) => ({ ...t, image: null }));
  const meta = buildMeta(data);
  const durations = durationsFor(tools.length);
  const frame = coverFrame(durations, tools.length);
  const props = { tools, meta, audioDurations: durations, subtitles: {} };

  const propsPath = join(outputDir, `cover-preview-${meta.date}.props.json`);
  writeFileSync(propsPath, JSON.stringify(props));
  const out = join(outputDir, `cover-preview-${meta.date}.jpg`);

  execFileSync(
    "npx",
    ["remotion", "still", COMPOSITION_ID, out, `--frame=${frame}`, `--props=${propsPath}`],
    { cwd: rootDir, stdio: "inherit" }
  );
  console.log(
    `${meta.date}: ${tools[0].name} — ${tools[0].description} ` +
      `(${tools.length} tools, cover frame ${frame}) → ${out}\n`
  );
}
