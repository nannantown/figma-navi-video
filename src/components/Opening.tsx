import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { VideoMeta } from "../data";
import { ACCENT_GRADIENT, COLORS, FONT_FAMILY, SAFE_BOTTOM, SAFE_TOP, SAFE_X } from "./theme";

/**
 * ~3 s hook: date → "新作AIツール" + "TOP5" (ranking) or "3選" (pickup) → source.
 * Everything is fully visible by frame 30 because pipeline.mjs grabs the
 * Instagram/YouTube cover still at frame 60.
 */
export const Opening: React.FC<{ meta: VideoMeta }> = ({ meta }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const dateOpacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const titleOpacity = interpolate(frame, [4, 14], [0, 1], { extrapolateRight: "clamp" });
  const titleY = spring({ frame: Math.max(0, frame - 4), fps, config: { damping: 13, stiffness: 120 }, from: 50, to: 0 });
  const topScale = spring({ frame: Math.max(0, frame - 10), fps, config: { damping: 10, stiffness: 150 }, from: 0.6, to: 1 });
  const topOpacity = interpolate(frame, [10, 18], [0, 1], { extrapolateRight: "clamp" });
  const sourceOpacity = interpolate(frame, [18, 28], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: COLORS.background,
        fontFamily: FONT_FAMILY,
        padding: `${SAFE_TOP}px ${SAFE_X}px ${SAFE_BOTTOM}px`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 260,
          right: -220,
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.accent}66 0%, transparent 60%)`,
          opacity: 0.35,
        }}
      />

      <div style={{ opacity: dateOpacity, fontSize: 40, fontWeight: 600, color: COLORS.textMuted, letterSpacing: "2px" }}>
        {meta.dateLabel}
      </div>

      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          marginTop: 28,
          fontSize: 112,
          fontWeight: 900,
          color: COLORS.text,
          lineHeight: 1.05,
          letterSpacing: "-2px",
        }}
      >
        新作AIツール
      </div>

      <div
        style={{
          opacity: topOpacity,
          transform: `scale(${topScale})`,
          transformOrigin: "left center",
          fontSize: 230,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "-6px",
          background: ACCENT_GRADIENT,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          alignSelf: "flex-start",
        }}
      >
        {meta.bigLabel}
      </div>

      <div
        style={{
          opacity: sourceOpacity,
          marginTop: 44,
          alignSelf: "flex-start",
          fontSize: 36,
          fontWeight: 700,
          color: COLORS.text,
          background: "rgba(255,255,255,0.06)",
          border: `3px solid ${COLORS.accent}`,
          borderRadius: 999,
          padding: "10px 32px",
        }}
      >
        {meta.openingSourceLabel}
      </div>
    </AbsoluteFill>
  );
};
