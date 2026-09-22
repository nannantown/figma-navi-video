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

/** Frames the first tool card occupies. */
export function firstToolFrames(durations) {
  const sec = durations["tool-1"] ?? 0;
  if (!(sec > 0)) return 0;
  return Math.ceil(sec * FPS) + PADDING_FRAMES;
}

/**
 * Absolute frame to grab the cover from: inside the first tool card, after its
 * entrance animation. A card shorter than the offset (never seen in
 * production, but a 1 s narration would do it) falls back to its midpoint so
 * the cover can never spill into the next card.
 */
export function coverFrame(durations) {
  const opening = openingFrames(durations);
  const first = firstToolFrames(durations);
  if (first === 0) return opening; // no tool audio: nothing better than the opening
  const into = first > COVER_FRAMES_INTO_CARD ? COVER_FRAMES_INTO_CARD : Math.floor(first / 2);
  return opening + into;
}

/** The same point expressed as Instagram's thumb_offset (milliseconds). */
export function coverOffsetMs(durations) {
  return Math.round((coverFrame(durations) / FPS) * 1000);
}
