import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { JevSlide } from "../data";
import { ACCENT_GRADIENT, COLORS, FONT_FAMILY, SAFE_BOTTOM, SAFE_TOP, SAFE_X } from "./theme";

/**
 * One point of a Jev episode (genre trial #2): header band → heading → body →
 * "whose claim" label → sources. Same background, glow and header band as the
 * tool card, so the series keeps one look. Everything is drawn by localFrame
 * ~42: the first slide is the Instagram cover (scripts/cover-frame.mjs takes
 * it 60 frames into the first card), and its heading changes every day.
 */
function fadeUp(frame: number, start: number, fps: number) {
  const opacity = interpolate(frame, [start, start + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = spring({ frame: Math.max(0, frame - start), fps, config: { damping: 14, stiffness: 110 }, from: 28, to: 0 });
  return { opacity, transform: `translateY(${y}px)` };
}

export const JevSlideCard: React.FC<{ slide: JevSlide }> = ({ slide }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const glow = interpolate(frame % 150, [0, 75, 150], [0.18, 0.3, 0.18]);
  const headingLength = Array.from(slide.heading).length;
  const headingSize = headingLength <= 10 ? 88 : headingLength <= 14 ? 80 : 72;

  return (
    <AbsoluteFill
      lang="ja"
      style={{
        background: COLORS.background,
        fontFamily: FONT_FAMILY,
        padding: `${SAFE_TOP}px ${SAFE_X}px ${SAFE_BOTTOM}px`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -200,
          left: -160,
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.accent}55 0%, transparent 62%)`,
          opacity: glow,
        }}
      />

      {/* Header: series label + progress */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, ...fadeUp(frame, 0, fps) }}>
        <div
          style={{
            background: ACCENT_GRADIENT,
            color: COLORS.background,
            borderRadius: 999,
            padding: "10px 30px",
            fontSize: 36,
            fontWeight: 800,
          }}
        >
          {slide.header}
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, color: COLORS.textMuted }}>{slide.badge}</div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div
          style={{
            fontSize: headingSize,
            fontWeight: 900,
            color: COLORS.text,
            lineHeight: 1.18,
            letterSpacing: "-1px",
            ...fadeUp(frame, 4, fps),
          }}
        >
          {slide.heading}
        </div>

        <div
          style={{
            marginTop: 40,
            paddingLeft: 28,
            borderLeft: `6px solid ${COLORS.accent}`,
            fontSize: 46,
            fontWeight: 600,
            color: COLORS.textSub,
            lineHeight: 1.5,
            ...fadeUp(frame, 14, fps),
          }}
        >
          {slide.body}
        </div>

        {slide.claimSource && (
          <div
            style={{
              marginTop: 36,
              alignSelf: "flex-start",
              background: "#FBBF24",
              color: "#1a1204",
              borderRadius: 999,
              padding: "8px 28px",
              fontSize: 36,
              fontWeight: 800,
              ...fadeUp(frame, 24, fps),
            }}
          >
            {slide.claimSource}
          </div>
        )}
      </div>

      <div style={{ fontSize: 26, fontWeight: 600, color: COLORS.textMuted, ...fadeUp(frame, 28, fps) }}>{slide.sourceLine}</div>
    </AbsoluteFill>
  );
};
