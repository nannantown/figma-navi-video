/**
 * The YouTube thumbnail is the Instagram Reels cover — the same picture on both
 * (owner decision 2026-10-28: 「YouTube のサムネイル…インスタグラムのサムネイルと同じにしようか」).
 *
 * Instagram takes the cover from the uploaded video at `thumb_offset` (cover_url needs a
 * public image URL, which this private repo does not have). So the YouTube upload cuts the
 * frame at that same offset out of the same file with ffmpeg and sends it to thumbnails.set.
 * upload-instagram.mjs reads the offset from here too, so the two can never drift apart.
 *
 * Primary sources (read 2026-10-28):
 * - Instagram Graph API, IG User Media: thumb_offset is the "Location, in milliseconds, of the
 *   video or reel frame to be used as the cover thumbnail image" (default 0; cover_url wins).
 * - YouTube Data API thumbnails.set (page updated 2026-10-15): image/jpeg or image/png, up to
 *   50 MB; 403 forbidden when the user may not set custom thumbnails.
 * - YouTube Help answer/72431: Shorts thumbnails 9:16, at least 640 px high; the account must be
 *   verified. The 1080×1920 frame is already 9:16, so it is sent as is (no crop, no letterbox).
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, rmSync, statSync } from "node:fs";
import { FALLBACK_OFFSET_MS } from "./cover-frame.mjs";

export const YT_THUMBNAIL_MAX_BYTES = 50 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 60_000;
const SET_TIMEOUT_MS = 60_000;

// Where Instagram takes the cover (ms into the video).
//
// pipeline.mjs computes the exact offset from the day's audio durations and
// passes it in INSTAGRAM_THUMB_OFFSET_MS (see cover-frame.mjs) so the cover
// always lands on the first tool card — the part of the video that differs
// day to day. FALLBACK_OFFSET_MS covers callers that have no durations to
// hand (the post-today-instagram.yml recovery path, which re-posts an mp4
// downloaded from a Release); it is derived from the same rule rather than
// guessed, so a recovered post lands on the same card as the daily run.
// `||` not `??`: an empty INSTAGRAM_THUMB_OFFSET_MS (a workflow passing
// through an unset variable) would otherwise be Number("") = 0 = frame 0.
export function instagramThumbOffsetMs(env = process.env) {
  return Number(env.INSTAGRAM_THUMB_OFFSET_MS || FALLBACK_OFFSET_MS);
}

/**
 * Cut the frame at offsetMs out of video into out (JPEG). Returns its size in bytes.
 * Throws when ffmpeg fails or no frame came out (e.g. the offset is past the end).
 */
export function extractCoverFrame({ video, offsetMs, out, exec = execFileSync }) {
  if (!Number.isFinite(offsetMs) || offsetMs < 0) throw new Error(`invalid cover offset: ${offsetMs}`);
  rmSync(out, { force: true }); // a frame left by an earlier run must never be sent
  // -ss before -i seeks, then decodes up to the exact timestamp (frame-accurate when decoding).
  try {
    exec("ffmpeg", ["-y", "-v", "error", "-ss", (offsetMs / 1000).toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "2", out],
      { stdio: ["ignore", "inherit", "inherit"], timeout: FFMPEG_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`no frame at ${offsetMs} ms in ${video} (ffmpeg: ${String(err.message).split("\n")[0]})`);
  }
  const bytes = existsSync(out) ? statSync(out).size : 0;
  if (!bytes) throw new Error(`no frame at ${offsetMs} ms in ${video}`);
  return bytes;
}

// googleapis keeps the reasons on err.errors (gaxios 6) or only in the response body (gaxios 7).
function reasonsOf(err) {
  const list = [...(err?.errors ?? []), ...(err?.response?.data?.error?.errors ?? [])];
  return [...new Set(list.map((e) => e?.reason).filter(Boolean))];
}

/**
 * thumbnails.set with the Instagram cover frame. Never throws: a channel that may not set
 * custom thumbnails yet (403 forbidden) keeps YouTube's own frame, the upload still counts,
 * and the next run tries again — so it lines up by itself once the channel is allowed.
 * The return value is upload-result.json `thumbnail` (the run's record of whether it was set).
 */
export async function setThumbnailFromInstagramCover({
  youtube, videoId, video, offsetMs, out,
  extract = extractCoverFrame, log = console.log, logError = console.error,
}) {
  const base = { source: "instagram-cover", offsetMs };
  let bytes;
  try {
    bytes = extract({ video, offsetMs, out });
  } catch (err) {
    logError(`  Thumbnail: skipped (could not cut the Instagram cover frame: ${err.message})`);
    return { ...base, skipped: "no-frame" };
  }
  if (bytes > YT_THUMBNAIL_MAX_BYTES) {
    logError(`  Thumbnail: skipped (${bytes} bytes, limit ${YT_THUMBNAIL_MAX_BYTES})`);
    return { ...base, skipped: "too-large" };
  }
  try {
    // a POST is not retried and has no default timeout — cap it so a stuck call can't eat the job
    await youtube.thumbnails.set(
      { videoId, media: { mimeType: "image/jpeg", body: createReadStream(out) } },
      { timeout: SET_TIMEOUT_MS }
    );
    log(`  Thumbnail: set — the Instagram cover (frame at ${offsetMs} ms, ${bytes} bytes)`);
    return { ...base, set: true };
  } catch (err) {
    const reasons = reasonsOf(err);
    logError(`  Thumbnail: failed (non-blocking, the video is up): ${err.message}${reasons.length ? ` [${reasons.join(", ")}]` : ""}`);
    if (reasons.includes("forbidden")) {
      logError("  Thumbnail: this channel cannot set custom thumbnails on Shorts yet (account verification: youtube.com/verify). Every run tries again, so it starts matching Instagram by itself.");
    }
    return { ...base, error: err.message, reasons: reasons.join(", ") };
  }
}

/** Compact, history-friendly form of the result above. */
export function summarizeThumbnail(result) {
  if (!result || typeof result !== "object") return null;
  if (result.set) return "set";
  if (result.skipped) return `skipped:${result.skipped}`;
  if (result.error !== undefined) return result.reasons ? `error:${result.reasons}` : "error";
  return null;
}
