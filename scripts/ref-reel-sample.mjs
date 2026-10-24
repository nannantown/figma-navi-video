/**
 * 見本動画（参考リール型: ステップ + 進み具合のバー + アプリの窓 + 1 語字幕 + 保存の誘い）。
 * 投稿しない。data/ref-reel-sample.json の台本から、場面ごとに Edge TTS で声と語の時刻を取り、
 * Remotion の RefReelSample を output/ref-reel/ref-reel-sample.mp4 に書き出す。
 *
 *   node scripts/ref-reel-sample.mjs            # 音声 + 書き出し
 *   node scripts/ref-reel-sample.mjs --no-render
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { synthesizeOnce } from "./edge-tts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = JSON.parse(readFileSync(join(root, "data/ref-reel-sample.json"), "utf-8"));
const audioDir = join(root, "public/audio/ref-reel");
const outDir = join(root, "output/ref-reel");
mkdirSync(audioDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const MAX_SEC = 59; // Instagram は 60 秒を超えると投稿できない
const TAIL_PAD = 0.45; // 場面の終わりの間（秒）
// audio-24khz-48kbitrate-mono-mp3 = 固定 48 kbps
const mp3Seconds = (buf) => (buf.length * 8) / 48000;

const scenes = [];
for (const [i, s] of script.scenes.entries()) {
  const { audio, words } = await synthesizeOnce(s.narration, { voice: script.voice, rate: script.rate });
  const file = `audio/ref-reel/scene-${i}.mp3`;
  writeFileSync(join(root, "public", file), audio);
  const sec = mp3Seconds(audio);
  scenes.push({ ...s, audio: file, duration: +(sec + TAIL_PAD).toFixed(3), words });
  console.log(`scene ${i} (${s.kind}) ${sec.toFixed(2)}s, ${words.length} words`);
}

const total = scenes.reduce((a, s) => a + s.duration, 0);
console.log(`total ${total.toFixed(2)}s`);
if (total > MAX_SEC) throw new Error(`見本が ${total.toFixed(1)} 秒で ${MAX_SEC} 秒を超える。台本を削る`);

if (!existsSync(join(root, "public/audio/bgm.wav"))) {
  execFileSync("node", [join(root, "scripts/generate-bgm.mjs")], { stdio: "inherit" });
}

const props = { ...script, scenes };
const propsPath = join(outDir, "props.json");
writeFileSync(propsPath, JSON.stringify(props, null, 2));

if (!process.argv.includes("--no-render")) {
  const raw = join(outDir, "ref-reel-sample.raw.mp4");
  execFileSync("npx", ["remotion", "render", "RefReelSample", raw, `--props=${propsPath}`], { cwd: root, stdio: "inherit" });
  // pipeline.mjs Step 4b と同じ: Remotion は yuvj420p を出すので、Instagram が受け付ける yuv420p（tv）に直す
  execFileSync(
    "ffmpeg",
    ["-y", "-v", "error", "-i", raw, "-vf", "scale=out_range=tv,format=yuv420p", "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-color_range", "tv", "-profile:v", "high", "-level", "4.0", "-crf", "20", "-preset", "fast", "-c:a", "copy",
      "-movflags", "+faststart", join(outDir, "ref-reel-sample.mp4")],
    { stdio: "inherit" },
  );
  const sec = Number(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(outDir, "ref-reel-sample.mp4")]),
  );
  if (!(sec > 0 && sec <= MAX_SEC)) throw new Error(`書き出した mp4 の尺が ${sec} 秒（0〜${MAX_SEC} 秒であるべき）`);
  console.log(`mp4 ${sec.toFixed(2)}s → ${join(outDir, "ref-reel-sample.mp4")}`);
}
