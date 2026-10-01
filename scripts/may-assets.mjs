// Copy Codex's 先輩のメイ animation parts into public/may for the video (src/components/May.tsx).
// Source of truth: assets/brand/may-2026-09-30/a-senpai/motion (Codex's files, untouched).
// No drawing here — only:
//  - resize 1024x1536 -> 640x960 (she is drawn 320x480 on the 1080x1920 frame; 2x stays sharp)
//  - <pose>_eyes.png: Codex's blink picture kept only where it differs from the closed-mouth
//    picture (= the closed eyes; feathered edge), transparent elsewhere — so a blink can sit on
//    top of any mouth without covering it.
// Needs ImageMagick 7 (magick). Usage: node scripts/may-assets.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "assets/brand/may-2026-09-30/a-senpai/motion");
const out = join(root, "public/may");
const tmp = mkdtempSync(join(tmpdir(), "may-"));
const magick = (...args) => execFileSync("magick", args);
mkdirSync(out, { recursive: true });

for (const pose of ["explain", "surprise", "nod", "point"]) {
  for (const v of ["closed", "half", "open"]) {
    magick(join(src, `${pose}_${v}.png`), "-resize", "640x960", join(out, `${pose}_${v}.png`));
  }
  const closed = join(src, `${pose}_closed.png`);
  const blink = join(src, `${pose}_blink.png`);
  const mask = join(tmp, "mask.png");
  const alpha = join(tmp, "alpha.png");
  magick(closed, blink, "-alpha", "off", "-compose", "difference", "-composite", "-separate",
    "-evaluate-sequence", "max", "-threshold", "3%", "-morphology", "Dilate", "Disk:5", "-blur", "0x3", mask);
  magick(blink, "-alpha", "extract", mask, "-compose", "multiply", "-composite", alpha);
  magick(blink, alpha, "-alpha", "off", "-compose", "CopyOpacity", "-composite", "-resize", "640x960", join(out, `${pose}_eyes.png`));
}
rmSync(tmp, { recursive: true });
console.log(`May parts → ${out}`);
