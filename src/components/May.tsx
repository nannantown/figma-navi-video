import React, { useMemo } from "react";
import { useAudioData } from "@remotion/media-utils";
import { Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { isBlinking, loudnessPerFrame, mouthFor, smoothLevels } from "./mayMotion";

/**
 * 先輩のメイ — the guide character, drawn by Codex (assets/brand/may-2026-09-30/a-senpai/motion,
 * copied to public/may by scripts/may-assets.mjs). This file only moves Codex's pictures:
 * - mouth: closed / half / open picked from the narration's loudness (smoothed over 3 frames)
 * - blink: `<pose>_eyes.png` (only the closed eyes of Codex's blink picture, transparent elsewhere)
 *   laid over the current mouth picture for 3 frames
 * - body: breathing bob, slow lean (首かしげ), a pop when the pose changes, a dip for "nod"
 * Within a pose Codex's pictures are pixel-identical outside the mouth / eyes, so swapping
 * them never jitters.
 *
 * Place it inside a <Sequence> next to that sequence's narration <Audio>: frame 0 = audio start.
 */
export type MayPose = "explain" | "surprise" | "nod" | "point";

/**
 * Layout (owner 2026-10-01: "bigger, more in the middle, as if she is the one talking"), rebuilt from
 * Codex's reference docs/may-preview/layout/layout-ref.png on the 1080x1920 frame:
 * - she stands in the middle (centre x 510, a little left of the platforms' right-hand buttons),
 *   head just under the slide content, body fading out above the platforms' caption UI (y 1580)
 * - her words are a speech bubble on her chest with the tail on her mouth (MaySpeech.tsx)
 * Codex's pictures are 2:3; the figure fills them (hair top at 5% of the height).
 */
export const MAY_HEIGHT = 1120;
export const MAY_WIDTH = Math.round((MAY_HEIGHT * 2) / 3);
export const MAY_LEFT = 510 - Math.round(MAY_WIDTH / 2);
export const MAY_TOP = 781;
/** Slide content padding while she is on screen: content ends at y 850, just above her hair. */
export const MAY_CONTENT_TOP = 200;
export const MAY_CONTENT_BOTTOM = 1920 - 850;
/** Fully visible down to y 1450, gone by 1640 (the caption UI starts at 1580). */
const fadeAt = (y: number) => `${(((y - MAY_TOP) / MAY_HEIGHT) * 100).toFixed(1)}%`;
const FADE = `linear-gradient(to bottom, black ${fadeAt(1450)}, transparent ${fadeAt(1640)})`;

/** Mouth box per pose in Codex's 1024x1536 pictures (<pose>.parts.json): centre x, bottom y. */
const MOUTH: Record<MayPose, [number, number]> = {
  explain: [550, 560],
  surprise: [543, 581],
  nod: [543, 626],
  point: [573, 571],
};
/** Where the bubble's tail points (just under her mouth), in frame px. */
export function mayMouthTip(pose: MayPose): [number, number] {
  const [x, y] = MOUTH[pose];
  return [MAY_LEFT + (x / 1024) * MAY_WIDTH, MAY_TOP + (y / 1536) * MAY_HEIGHT];
}

/** The speech bubble: 48 px bold, at most two lines of ~15 characters, above the caption UI. */
export const MAY_BUBBLE = {
  left: 120,
  width: 800,
  top: 1320,
  maxChars: 24,
  fontSize: 48,
  fill: "#ffffff",
  text: "#0b0b14",
  border: "#8B7CFF",
};

export const May: React.FC<{ pose: MayPose; audio: string }> = ({ pose, audio }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(staticFile(audio));
  const levels = useMemo(
    () => (audioData ? smoothLevels(loudnessPerFrame(audioData.channelWaveforms[0], audioData.sampleRate, fps)) : []),
    [audioData, fps],
  );
  const level = levels[frame] ?? 0;
  const mouth = mouthFor(level);
  const t = frame / fps;

  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 160 }, from: 0.94, to: 1 });
  const breathe = Math.sin((t * Math.PI * 2) / 3.4);
  // Degrees around the bottom of her box: ±0.9° moves her head ~17 px at this size.
  const lean = Math.sin((t * Math.PI * 2) / 5.6) * 0.9;
  const nod = pose === "nod" ? Math.pow(Math.max(0, Math.sin((t * Math.PI * 2) / 1.6)), 6) * 10 : 0;
  const talk = level * 4;
  const src = (variant: string) => staticFile(`may/${pose}_${variant}.png`);
  const layer: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

  return (
    <div
      style={{
        position: "absolute",
        left: MAY_LEFT,
        top: MAY_TOP,
        width: MAY_WIDTH,
        height: MAY_HEIGHT,
        transformOrigin: "50% 100%",
        transform: `translateY(${breathe * 4 + nod - talk}px) rotate(${lean}deg) scale(${pop}, ${pop * (1 + breathe * 0.006)})`,
        // Her body fades out above the platforms' caption UI instead of ending in a hard edge.
        maskImage: FADE,
        WebkitMaskImage: FADE,
      }}
    >
      {/* Every layer stays mounted (loaded once); only opacity changes. */}
      {(["closed", "half", "open"] as const).map((m) => (
        <Img key={m} src={src(m)} style={{ ...layer, opacity: m === mouth ? 1 : 0 }} />
      ))}
      <Img src={src("eyes")} style={{ ...layer, opacity: isBlinking(frame, fps, audio) ? 1 : 0 }} />
    </div>
  );
};
