import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCoverFrame, instagramThumbOffsetMs, setThumbnailFromInstagramCover, summarizeThumbnail } from "./ig-cover.mjs";
import { FALLBACK_OFFSET_MS } from "./cover-frame.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const noFfmpeg = hasFfmpeg ? false : "ffmpeg is not installed";

// ---- per-repo wiring -------------------------------------------------------
const SCRIPTS = ["upload-youtube.mjs", "ig-cover.mjs", "cover-frame.mjs"];
const CAPTIONS = { youtube: { title: "t", description: "d", tags: [], categoryId: "28" } };
// pipeline.mjs exports the day's computed cover point before post-sns runs both uploads
const ENV = { INSTAGRAM_THUMB_OFFSET_MS: "1500" };
const COVER_MS = 1500;
// ----------------------------------------------------------------------------

/** Red for 1 s, then blue for 2 s — the frame at 1500 ms is blue, at 500 ms red. */
function twoColourVideo(path) {
  execFileSync("ffmpeg", ["-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=red:s=108x192:r=30:d=1",
    "-f", "lavfi", "-i", "color=c=blue:s=108x192:r=30:d=2",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

function colourOf(image) {
  const [r, g, b] = execFileSync("ffmpeg", ["-v", "error", "-i", image, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  if (r > 200 && g < 60 && b < 60) return "red";
  if (b > 200 && r < 60 && g < 60) return "blue";
  return `rgb(${r},${g},${b})`;
}

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "ig-cover-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// a real client reads the image; a fake must too, or the open file handle outlives the test
const drain = async (req) => { for await (const _ of req.media.body); };

const forbidden = () => Object.assign(
  new Error("The authenticated user doesn't have permissions to upload and set custom video thumbnails."),
  { response: { status: 403, data: { error: { errors: [{ reason: "forbidden" }] } } } }
);

test("the cover offset is the one upload-instagram.mjs sends as thumb_offset", () => {
  assert.equal(instagramThumbOffsetMs({ INSTAGRAM_THUMB_OFFSET_MS: "2500" }), 2500);
  // empty = unset (a workflow passing an unset variable through), never frame 0
  assert.equal(instagramThumbOffsetMs({ INSTAGRAM_THUMB_OFFSET_MS: "" }), FALLBACK_OFFSET_MS);
  assert.equal(instagramThumbOffsetMs({}), FALLBACK_OFFSET_MS);
  const ig = readFileSync(join(here, "upload-instagram.mjs"), "utf8");
  assert.match(ig, /import \{ instagramThumbOffsetMs \} from "\.\/ig-cover\.mjs"/);
  assert.match(ig, /THUMB_OFFSET_MS = instagramThumbOffsetMs\(\)/);
  assert.doesNotMatch(ig, /DEFAULT_THUMB_OFFSET_MS|FALLBACK_OFFSET_MS/, "no second copy of the rule");
});

test("extractCoverFrame cuts exactly the frame at the offset", { skip: noFfmpeg }, (t) => {
  const dir = tempDir(t);
  const video = join(dir, "v.mp4");
  twoColourVideo(video);
  const out = join(dir, "thumb.jpg");
  assert.ok(extractCoverFrame({ video, offsetMs: 1500, out }) > 0);
  assert.equal(colourOf(out), "blue");
  extractCoverFrame({ video, offsetMs: 500, out });
  assert.equal(colourOf(out), "red");
});

test("extractCoverFrame throws past the end and leaves no stale frame behind", { skip: noFfmpeg }, (t) => {
  const dir = tempDir(t);
  const video = join(dir, "v.mp4");
  twoColourVideo(video);
  const out = join(dir, "thumb.jpg");
  writeFileSync(out, "yesterday's frame");
  assert.throws(() => extractCoverFrame({ video, offsetMs: 9000, out }), /no frame at 9000 ms/);
  assert.equal(existsSync(out), false);
  assert.throws(() => extractCoverFrame({ video, offsetMs: Number.NaN, out }), /invalid cover offset/);
});

test("a channel that may not set thumbnails (403) does not throw — the upload still counts", async (t) => {
  const out = join(tempDir(t), "thumb.jpg");
  const calls = [];
  const youtube = { thumbnails: { set: async (req) => { calls.push(req); await drain(req); throw forbidden(); } } };
  const result = await setThumbnailFromInstagramCover({
    youtube, videoId: "vid", video: "v.mp4", offsetMs: 1500, out,
    extract: () => { writeFileSync(out, "jpeg"); return 4; }, log: () => {}, logError: () => {},
  });
  assert.equal(calls[0].videoId, "vid");
  assert.equal(calls[0].media.mimeType, "image/jpeg");
  assert.deepEqual({ ...result, error: undefined }, { source: "instagram-cover", offsetMs: 1500, error: undefined, reasons: "forbidden" });
  assert.equal(summarizeThumbnail(result), "error:forbidden");
});

test("no frame → skipped without calling YouTube; success → set", async (t) => {
  const out = join(tempDir(t), "thumb.jpg");
  let called = 0;
  const youtube = { thumbnails: { set: async (req) => { called++; await drain(req); } } };
  const quiet = { log: () => {}, logError: () => {} };
  const skipped = await setThumbnailFromInstagramCover({ youtube, videoId: "v", video: "v.mp4", offsetMs: 1500, out,
    extract: () => { throw new Error("ffmpeg failed"); }, ...quiet });
  assert.equal(called, 0);
  assert.equal(summarizeThumbnail(skipped), "skipped:no-frame");
  const set = await setThumbnailFromInstagramCover({ youtube, videoId: "v", video: "v.mp4", offsetMs: 1500, out,
    extract: () => { writeFileSync(out, "jpeg"); return 4; }, ...quiet });
  assert.equal(called, 1);
  assert.deepEqual(set, { source: "instagram-cover", offsetMs: 1500, set: true });
  assert.equal(summarizeThumbnail(set), "set");
  assert.equal(summarizeThumbnail(null), null);
});

/** Run the real upload-youtube.mjs against a mocked googleapis (no network). */
function runUpload(t, thumbnailReply) {
  const root = tempDir(t);
  for (const dir of ["scripts", "output"]) mkdirSync(join(root, dir));
  symlinkSync(join(here, "..", "node_modules"), join(root, "node_modules"));
  for (const name of SCRIPTS) cpSync(join(here, name), join(root, "scripts", name));
  const video = join(root, "output", "day.mp4");
  twoColourVideo(video);
  writeFileSync(join(root, "output", "captions.json"), JSON.stringify(CAPTIONS));
  const preloader = join(root, "mock-youtube.mjs");
  writeFileSync(preloader, `
    import { google } from "googleapis";
    import { writeFileSync } from "node:fs";
    globalThis.fetch = () => { throw new Error("Real network is forbidden in this test"); };
    google.auth.OAuth2 = class { setCredentials() {} };
    google.youtube = () => ({
      videos: { insert: async () => ({ data: { id: "mock-video-id" } }) },
      thumbnails: { set: async ({ videoId, media }) => {
        const chunks = [];
        for await (const c of media.body) chunks.push(c);
        writeFileSync("output/sent.jpg", Buffer.concat(chunks));
        writeFileSync("output/sent.json", JSON.stringify({ videoId, mimeType: media.mimeType }));
        if (process.env.MOCK_THUMBNAIL === "forbidden") {
          throw Object.assign(new Error("forbidden"), { response: { status: 403, data: { error: { errors: [{ reason: "forbidden" }] } } } });
        }
        return { data: {} };
      } },
    });
  `);
  const run = spawnSync(process.execPath, ["--import", preloader, "scripts/upload-youtube.mjs", `--video=${video}`], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, ...ENV, YOUTUBE_CLIENT_ID: "mock", YOUTUBE_CLIENT_SECRET: "mock", YOUTUBE_REFRESH_TOKEN: "mock", MOCK_THUMBNAIL: thumbnailReply },
  });
  const read = (name) => JSON.parse(readFileSync(join(root, "output", name), "utf8"));
  return { run, result: read("upload-result.json"), sent: read("sent.json"), colour: colourOf(join(root, "output", "sent.jpg")) };
}

test("upload-youtube sends the Instagram cover frame as the thumbnail", { skip: noFfmpeg }, (t) => {
  const { run, result, sent, colour } = runUpload(t, "ok");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(sent.videoId, "mock-video-id");
  assert.equal(sent.mimeType, "image/jpeg");
  assert.equal(colour, "blue", `the frame at ${COVER_MS} ms, where Instagram takes its cover`);
  assert.deepEqual(result.thumbnail, { source: "instagram-cover", offsetMs: COVER_MS, set: true });
});

test("upload-youtube still succeeds when the channel may not set thumbnails (403)", { skip: noFfmpeg }, (t) => {
  const { run, result } = runUpload(t, "forbidden");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(result.videoId, "mock-video-id");
  assert.equal(result.thumbnail.reasons, "forbidden");
  assert.match(run.stdout + run.stderr, /YouTube upload complete/);
});
