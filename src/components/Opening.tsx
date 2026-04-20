import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Brand opening. Disabled by default (opening duration = 0).
 * If enabled later, shows date → brand title → subtitle sequence.
 * Kept minimal to avoid retention drop observed with long sting intros.
 */
export const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const dateOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  const dateY = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100 },
    from: 40,
    to: 0,
  });

  const titleOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = spring({
    frame: Math.max(0, frame - 10),
    fps,
    config: { damping: 12, stiffness: 100 },
    from: 60,
    to: 0,
  });

  const lineScale = spring({
    frame: Math.max(0, frame - 20),
    fps,
    config: { damping: 15, stiffness: 120 },
    from: 0,
    to: 1,
  });

  const subtitleOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateRight: "clamp",
  });
  const subtitleY = spring({
    frame: Math.max(0, frame - 30),
    fps,
    config: { damping: 12, stiffness: 80 },
    from: 40,
    to: 0,
  });

  const glowOpacity = interpolate(frame, [0, 30, 60], [0, 0.6, 0.3]);

  const today = new Date();
  const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;

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
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(125, 120, 255, 0.25) 0%, transparent 70%)",
          opacity: glowOpacity,
        }}
      />

      <div
        style={{
          opacity: dateOpacity,
          transform: `translateY(${dateY}px)`,
          marginBottom: 48,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 68,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "6px",
          }}
        >
          {dateStr}
        </div>
      </div>

      <div
        style={{
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: "#E8E8FF",
            letterSpacing: "-1px",
            lineHeight: 1.1,
          }}
        >
          Design
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            background: "linear-gradient(90deg, #7D78FF, #B8B5FF)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-1px",
            lineHeight: 1.1,
          }}
        >
          Daily
        </div>
      </div>

      <div
        style={{
          width: 200 * lineScale,
          height: 3,
          background: "linear-gradient(90deg, #7D78FF, #B8B5FF)",
          borderRadius: 2,
          margin: "32px 0",
        }}
      />

      <div
        style={{
          opacity: subtitleOpacity,
          transform: `translateY(${subtitleY}px)`,
          fontSize: 42,
          fontWeight: 700,
          color: "rgba(232, 232, 255, 0.9)",
          letterSpacing: "2px",
        }}
      >
        毎朝のデザインニュース
      </div>
    </AbsoluteFill>
  );
};
