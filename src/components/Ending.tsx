import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const Ending: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
    from: 0.6,
    to: 1,
  });

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  const subOpacity = interpolate(frame, [25, 45], [0, 1], {
    extrapolateRight: "clamp",
  });

  const subY = spring({
    frame: Math.max(0, frame - 25),
    fps,
    config: { damping: 12, stiffness: 80 },
    from: 30,
    to: 0,
  });

  const ctaOpacity = interpolate(frame, [45, 65], [0, 1], {
    extrapolateRight: "clamp",
  });

  const ctaScale = spring({
    frame: Math.max(0, frame - 45),
    fps,
    config: { damping: 10, stiffness: 180 },
    from: 0.8,
    to: 1,
  });

  const glowPulse = interpolate(frame % 90, [0, 45, 90], [0.4, 0.8, 0.4]);

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0a0a1a 0%, #141429 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily:
          "'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "45%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(125, 120, 255, 0.25) 0%, transparent 65%)",
          opacity: glowPulse,
        }}
      />

      <div
        style={{
          opacity: titleOpacity,
          transform: `scale(${titleScale})`,
          textAlign: "center",
          marginBottom: 28,
        }}
      >
        <div
          style={{
            fontSize: 88,
            fontWeight: 900,
            letterSpacing: "-2px",
            lineHeight: 1.1,
          }}
        >
          <span style={{ color: "#fff" }}>明日も</span>
          <br />
          <span
            style={{
              background: "linear-gradient(90deg, #7D78FF, #B8B5FF)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            チェックしよう
          </span>
        </div>
      </div>

      <div
        style={{
          opacity: subOpacity,
          transform: `translateY(${subY}px)`,
          fontSize: 32,
          color: "rgba(255,255,255,0.5)",
          fontWeight: 400,
          marginBottom: 64,
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        毎日デザインニュースを
        <br />
        お届けします
      </div>

      <div
        style={{
          opacity: ctaOpacity,
          transform: `scale(${ctaScale})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            background: "linear-gradient(90deg, #7D78FF, #B8B5FF)",
            borderRadius: 100,
            padding: "24px 72px",
            fontSize: 36,
            fontWeight: 800,
            color: "#0a0a1a",
            letterSpacing: "1px",
          }}
        >
          フォロー & いいね
        </div>
        <div
          style={{
            fontSize: 24,
            color: "rgba(255,255,255,0.35)",
            fontWeight: 400,
          }}
        >
          プロフィールから Figmaナビ を試せます
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 80,
          opacity: 0.3,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            fontSize: 24,
            color: "#ffffff",
            fontWeight: 600,
            letterSpacing: "2px",
          }}
        >
          FIGMA NAVI
        </span>
      </div>
    </AbsoluteFill>
  );
};
