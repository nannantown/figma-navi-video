// 先輩のメイ motion preview for the owner (docs/may-preview/): a ~19 s cut of one real episode with
// MAY on — surprise (opening) → explain (slide 1) → point (slide 2) → nod (ending).
// Not part of the daily pipeline. Needs the episode's audio first, same steps as the pipeline:
//   ALLOW_STALE_DATE=1 node scripts/generate-data.mjs
//   node scripts/generate-audio.mjs --data=output/trending-data.json --rate=+30%
//   node scripts/generate-bgm.mjs
//   node scripts/may-preview.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateFrameDurations, FPS } from "../src/data.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "output");
const docs = join(root, "docs/may-preview");
const read = (f) => JSON.parse(readFileSync(join(out, f), "utf-8"));
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });

const data = read("trending-data.json");
const audioDurations = read("audio-durations.json");
const propsPath = join(out, "may-preview-props.json");
writeFileSync(propsPath, JSON.stringify({ tools: data.tools, meta: data.meta, audioDurations, subtitles: read("subtitles.json"), may: true }));

const f = calculateFrameDurations(audioDurations);
const s1 = f.opening;
const s2 = s1 + f.tools[0];
const endStart = f.total - f.ending;
const sec = (s) => Math.round(s * FPS);
// [first, last] frame of each excerpt
const cuts = [
  [0, f.opening - 1],
  [s1, s1 + sec(5) - 1],
  [s2 + sec(4.5), s2 + sec(9.5) - 1],
  [endStart, f.total - 1],
];

mkdirSync(out, { recursive: true });
const parts = cuts.map(([a, b], i) => {
  const file = join(out, `may-preview-${i}.mp4`);
  sh("npx", ["remotion", "render", "AiToolsTop5", file, `--props=${propsPath}`, `--frames=${a}-${b}`]);
  return file;
});

const mp4 = join(docs, "may-preview.mp4");
const n = parts.length;
const filter = parts.map((_, i) => `[${i}:v][${i}:a]`).join("") + `concat=n=${n}:v=1:a=1[v][a]`;
sh("npx", ["remotion", "ffmpeg", "-y", "-loglevel", "error", ...parts.flatMap((p) => ["-i", p]),
  "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "fast", "-c:a", "aac", "-movflags", "+faststart", mp4]);

// Board cards take images only: a moving webp of the same cut (540 px wide, 12 fps) and 4 stills.
// Remotion's bundled ffmpeg has no webp encoder: frames out as PNG, ImageMagick assembles the webp.
const frameDir = join(out, "may-webp-frames");
rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir);
sh("npx", ["remotion", "ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-vf", "fps=12,scale=540:-2", join(frameDir, "f%04d.png")]);
const frames = readdirSync(frameDir).sort().map((p) => join(frameDir, p));
sh("magick", ["-delay", "100x1200", ...frames, "-loop", "0", "-quality", "70", join(docs, "may-preview.webp")]);
const stills = parts.map((p, i) => {
  const png = join(out, `may-still-${i}.png`);
  const mid = (cuts[i][1] - cuts[i][0]) / 2 / FPS;
  sh("npx", ["remotion", "ffmpeg", "-y", "-loglevel", "error", "-ss", String(mid), "-i", p, "-frames:v", "1", "-vf", "scale=540:-2", png]);
  return png;
});
sh("magick", [...stills, "+append", join(docs, "may-preview-stills.png")]);
console.log(`preview → ${mp4}`);
