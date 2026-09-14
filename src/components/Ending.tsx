import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ACCENT_GRADIENT, COLORS, FONT_FAMILY, SAFE_BOTTOM, SAFE_TOP, SAFE_X } from "./theme";

/** Save-first CTA: IG saves are the trial's judgement metric. */
export const Ending: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const headY = spring({ frame, fps, config: { damping: 13, stiffness: 110 }, from: 40, to: 0 });
  const subOpacity = interpolate(frame, [12, 24], [0, 1], { extrapolateRight: "clamp" });
  const ctaScale = spring({ frame: Math.max(0, frame - 20), fps, config: { damping: 10, stiffness: 140 }, from: 0.7, to: 1 });
  const ctaOpacity = interpolate(frame, [20, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: COLORS.background,
        fontFamily: FONT_FAMILY,
        padding: `${SAFE_TOP}px ${SAFE_X}px ${SAFE_BOTTOM}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 420,
          left: 40,
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.accent}55 0%, transparent 60%)`,
          opacity: 0.3,
        }}
      />

      <div style={{ opacity: headOpacity, transform: `translateY(${headY}px)` }}>
        <div style={{ fontSize: 60, fontWeight: 800, color: COLORS.text }}>気になったら</div>
        <div
          style={{
            marginTop: 8,
            fontSize: 132,
            fontWeight: 900,
            lineHeight: 1.1,
            background: ACCENT_GRADIENT,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          保存しよう
        </div>
      </div>

      <div style={{ opacity: subOpacity, marginTop: 36, fontSize: 38, fontWeight: 600, color: COLORS.textMuted, lineHeight: 1.6 }}>
        毎朝、使える新作AIツールを
        <br />
        1分で紹介しています
      </div>

      <div
        style={{
          opacity: ctaOpacity,
          transform: `scale(${ctaScale})`,
          marginTop: 56,
          background: ACCENT_GRADIENT,
          borderRadius: 999,
          padding: "22px 72px",
          fontSize: 44,
          fontWeight: 800,
          color: "#0b0b14",
        }}
      >
        保存 ＆ フォロー
      </div>
    </AbsoluteFill>
  );
};
