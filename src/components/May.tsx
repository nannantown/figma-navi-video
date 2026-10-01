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

/** On-screen box (1080x1920; Codex's pictures are 2:3). Bottom edge = the subtitle band's
 *  bottom (y 1580); below that is the platforms' caption / username UI. Left side: no
 *  platform buttons there. */
export const MAY_HEIGHT = 480;
export const MAY_WIDTH = 320;
export const MAY_LEFT = 24;
export const MAY_BOTTOM = 340;
/** Bottom padding for the slide content while May is on screen: content ends above her head. */
export const MAY_SAFE_BOTTOM = MAY_BOTTOM + MAY_HEIGHT;
/** Subtitle band starts right of her. */
export const MAY_SUBTITLE_LEFT = MAY_LEFT + MAY_WIDTH + 16;

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
  const lean = Math.sin((t * Math.PI * 2) / 5.6) * 1.6; // degrees, around her waist
  const nod = pose === "nod" ? Math.pow(Math.max(0, Math.sin((t * Math.PI * 2) / 1.6)), 6) * 10 : 0;
  const talk = level * 4;
  const src = (variant: string) => staticFile(`may/${pose}_${variant}.png`);
  const layer: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

  return (
    <div
      style={{
        position: "absolute",
        left: MAY_LEFT,
        bottom: MAY_BOTTOM,
        width: MAY_WIDTH,
        height: MAY_HEIGHT,
        transformOrigin: "50% 100%",
        transform: `translateY(${breathe * 4 + nod - talk}px) rotate(${lean}deg) scale(${pop}, ${pop * (1 + breathe * 0.006)})`,
        // Her body is cut at the canvas bottom: fade it out instead of a hard edge mid-screen.
        maskImage: "linear-gradient(to bottom, black 86%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 86%, transparent 100%)",
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
