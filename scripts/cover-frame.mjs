/**
 * Where the Instagram Reels cover (and the archived cover still) is taken from.
 *
 * Until 2026-09-22 the cover was frame 60 / thumb_offset 2000 ms — inside the
 * opening title card. That card is brand-constant ("新作AIツール" + "N選" +
 * the source pill); only the small date label changes, so every day landed on
 * the profile grid as the same picture. Owner decision 2026-09-22: the grid
 * must show that each day talks about something different.
 *
 * The fix moves the cover onto the FIRST TOOL CARD, which carries the day's
 * tool name (78-96 px) and its logo while keeping the background, accent glow
 * and header band of the series. The video itself is untouched.
 *
 * Frame arithmetic is the same as calculateFrameDurations() in src/data.ts.
 */

export const FPS = 30;
export const PADDING_FRAMES = 15; // 0.5 s padding after each narration
export const ENDING_EXTRA_FRAMES = 30; // 1 s extra hold on the ending
// Floor on the opening hook. Kept from the title-card era so a routine cannot
// shrink the hook to nothing; the cover no longer depends on it.
export const MIN_OPENING_FRAMES = 90;

// How far into the first tool card the cover is taken. ToolCard's last element
// starts its fade at localFrame 30 and settles ~12 frames later, so everything
// is fully drawn by 42; 60 leaves a margin and still sits well inside the
// shortest realistic card.
export const COVER_FRAMES_INTO_CARD = 60;

/** Frames the opening sequence occupies (0 when there is no opening audio). */
export function openingFrames(durations) {
  const sec = durations.opening ?? 0;
  if (!(sec > 0)) return 0;
  return Math.max(Math.ceil(sec * FPS) + PADDING_FRAMES, MIN_OPENING_FRAMES);
}

/**
 * Frames the first tool card occupies. There is always a first card:
 * calculateFrameDurations() floors the tool count at 1 and falls back to an
 * 8 s card when the audio duration is missing — mirrored here, or the cover
 * would drift off that card in exactly the case the fallback covers.
 */
export const MISSING_TOOL_FALLBACK_SEC = 8;

export function firstToolFrames(durations) {
  const sec = durations["tool-1"] || MISSING_TOOL_FALLBACK_SEC;
  return Math.ceil(sec * FPS) + PADDING_FRAMES;
}

/**
 * Absolute frame to grab the cover from: inside the first tool card, after its
 * entrance animation. A card shorter than the offset (never seen in
 * production, but a 1 s narration would do it) falls back to its midpoint so
 * the cover can never spill into the next card.
 */
export function coverFrame(durations, toolCount) {
  // AiToolsVideo renders one Series.Sequence per entry of `tools`, but the
  // frame maths is driven by the audio durations. A day with durations but no
  // tool cards would put the cover on the ending; that day must never render
  // at all, so say so loudly instead of picking a frame.
  if (!Number.isInteger(toolCount) || toolCount < 1) {
    throw new Error(
      `coverFrame: the video needs at least one tool card, got toolCount=${JSON.stringify(toolCount)}`
    );
  }
  const opening = openingFrames(durations);
  const first = firstToolFrames(durations);
  // Clamp rather than halve: on a card shorter than the offset, the last frame
  // of the card is the most-drawn one available. Halving would land on
  // localFrame 30 for a 60-frame card — exactly where the last element starts
  // its fade at opacity 0.
  return opening + Math.min(COVER_FRAMES_INTO_CARD, first - 1);
}

/** The same point expressed as Instagram's thumb_offset (milliseconds). */
export function coverOffsetMs(durations, toolCount) {
  return Math.round((coverFrame(durations, toolCount) / FPS) * 1000);
}

/**
 * Last-resort offset, for a video whose real offset was never recorded — in
 * practice only a Release cut before 2026-09-22. Everything since records
 * `coverOffsetMs` in data/performance-history.json (record-upload.mjs), and
 * scripts/cover-offset-for.mjs hands that recorded value to the recovery post.
 *
 * THIS CONSTANT IS NOT SAFE FOR EVERY DAY, and cannot be: it is one number
 * standing in for a value that moves with the narration. Frame 150 is inside
 * the first tool card only while the opening sits at or below
 * FALLBACK_SAFE_MAX_OPENING_SEC; a longer opening pushes the first card past
 * it and the cover silently lands back on the brand-constant title card —
 * the exact bug this module exists to fix. cover-offset-for.mjs therefore
 * warns loudly whenever it has to fall back to this.
 */
export const FALLBACK_OFFSET_MS = Math.round(
  ((MIN_OPENING_FRAMES + COVER_FRAMES_INTO_CARD) / FPS) * 1000
);

/**
 * The opening length at which FALLBACK_OFFSET_MS stops being safe.
 * openingFrames() must stay <= MIN_OPENING_FRAMES + COVER_FRAMES_INTO_CARD,
 * i.e. ceil(sec * FPS) + PADDING_FRAMES <= 150 → sec <= 4.5.
 * An `opening_narration` of ~27 characters already exceeds it (enriched-schema
 * allows up to 30), so this is reachable, not theoretical.
 */
export const FALLBACK_SAFE_MAX_OPENING_SEC =
  (MIN_OPENING_FRAMES + COVER_FRAMES_INTO_CARD - PADDING_FRAMES) / FPS;
