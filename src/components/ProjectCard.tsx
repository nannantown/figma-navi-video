import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion";
import { Project } from "../data";

interface Props {
  project: Project;
  localFrame: number;
  totalSections?: number;
}

const categoryColors: Record<string, string> = {
  産地: "#D4A574",
  精製方法: "#8CB4A0",
  焙煎: "#C97B4B",
  品種: "#A68B6B",
  知識: "#7B9DB8",
  default: "#D4A574",
};

export const ProjectCard: React.FC<Props> = ({ project, localFrame, totalSections = 3 }) => {
  const { fps } = useVideoConfig();

  // --- Animations ---

  // Section badge pop in
  const rankScale = spring({
    frame: localFrame,
    fps,
    config: { damping: 10, stiffness: 200 },
    from: 0,
    to: 1,
  });

  // Card slide up
  const cardY = spring({
    frame: Math.max(0, localFrame - 8),
    fps,
    config: { damping: 14, stiffness: 90 },
    from: 100,
    to: 0,
  });
  const cardOpacity = interpolate(localFrame, [8, 25], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Title reveal
  const nameOpacity = interpolate(localFrame, [15, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Short description
  const descOpacity = interpolate(localFrame, [30, 50], [0, 1], {
    extrapolateRight: "clamp",
  });
  const descY = spring({
    frame: Math.max(0, localFrame - 30),
    fps,
    config: { damping: 12, stiffness: 80 },
    from: 20,
    to: 0,
  });

  // Detail text - reveals after short desc
  const detailOpacity = interpolate(localFrame, [60, 90], [0, 1], {
    extrapolateRight: "clamp",
  });
  const detailY = spring({
    frame: Math.max(0, localFrame - 60),
    fps,
    config: { damping: 14, stiffness: 70 },
    from: 25,
    to: 0,
  });

  // Category tag
  const tagOpacity = interpolate(localFrame, [40, 55], [0, 1], {
    extrapolateRight: "clamp",
  });

  const category = project.category || "default";
  const catColor = categoryColors[category] || categoryColors.default;

  // Background glow pulse
  const glowOpacity = interpolate(
    localFrame % 120,
    [0, 60, 120],
    [0.15, 0.3, 0.15]
  );

  return (
    <AbsoluteFill
      style={{
        background: "#1a0e08",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', sans-serif",
        // Safe area: YT Shorts action buttons occupy ~140px on the right,
        // title/channel UI occupies ~300px on the bottom. IG Reels is
        // slightly less strict. Using 120px symmetric horizontal padding
        // keeps the card visually centered while clearing both platforms'
        // UI overlays.
        padding: "0 120px",
      }}
    >
      {/* Background accent glow */}
      <div
        style={{
          position: "absolute",
          top: "35%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${catColor}22 0%, transparent 60%)`,
          opacity: glowOpacity,
        }}
      />

      {/* Section indicator */}
      <div
        style={{
          transform: `scale(${rankScale})`,
          marginBottom: 32,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${catColor}dd, ${catColor}77)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            fontWeight: 900,
            color: "#fff",
            boxShadow: `0 0 30px ${catColor}44`,
          }}
        >
          {project.rank}/{totalSections}
        </div>
      </div>

      {/* Main card */}
      <div
        style={{
          opacity: cardOpacity,
          transform: `translateY(${cardY}px)`,
          width: "100%",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 28,
          padding: "40px 44px",
        }}
      >
        {/* Section title */}
        <div style={{ opacity: nameOpacity, marginBottom: 16 }}>
          <div
            style={{
              fontSize: 54,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-1px",
              lineHeight: 1.15,
            }}
          >
            {project.name}
          </div>
        </div>

        {/* Category tag intentionally removed.
            The tag was sourced from data/coffee-knowledge.json's static
            `category` field (e.g. "産地"), which no longer matches what
            the Claude routine actually picks for today's topic (now
            decided freely each morning via PDCA). Keeping the tag made
            water-science posts show up with a "産地" label, etc.
            catColor is still used for the background glow + progress
            dots via the "default" fallback. */}

        {/* Short description */}
        <div
          style={{
            opacity: descOpacity,
            transform: `translateY(${descY}px)`,
            fontSize: 34,
            fontWeight: 600,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.4,
            marginBottom: 20,
          }}
        >
          {project.description}
        </div>

        {/* Detailed description */}
        {project.detail && (
          <div
            style={{
              opacity: detailOpacity,
              transform: `translateY(${detailY}px)`,
              fontSize: 27,
              fontWeight: 400,
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.6,
            }}
          >
            {project.detail}
          </div>
        )}
      </div>

      {/* Progress indicator */}
      <div
        style={{
          position: "absolute",
          bottom: 300,
          display: "flex",
          gap: 10,
        }}
      >
        {Array.from({ length: totalSections }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            style={{
              width: n === project.rank ? 40 : 14,
              height: 14,
              borderRadius: 7,
              background:
                n === project.rank
                  ? catColor
                  : n < project.rank
                    ? `${catColor}55`
                    : "rgba(255,255,255,0.15)",
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
