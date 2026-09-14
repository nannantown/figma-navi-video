import React, { useState } from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useVideoConfig } from "remotion";
import { Tool } from "../data";
import {
  ACCENT_GRADIENT,
  COLORS,
  FONT_FAMILY,
  PRICING_BORDER,
  SAFE_BOTTOM,
  SAFE_TOP,
  SAFE_X,
} from "./theme";

interface Props {
  tool: Tool;
  localFrame: number;
  totalTools: number;
  sourceLabel: string;
}

const CONTENT_WIDTH = 1080 - SAFE_X * 2;

function fadeUp(frame: number, start: number, fps: number) {
  const opacity = interpolate(frame, [start, start + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = spring({ frame: Math.max(0, frame - start), fps, config: { damping: 14, stiffness: 110 }, from: 28, to: 0 });
  return { opacity, transform: `translateY(${y}px)` };
}

export const ToolCard: React.FC<Props> = ({ tool, localFrame, totalTools, sourceLabel }) => {
  const { fps } = useVideoConfig();
  const [imageFailed, setImageFailed] = useState(false);

  const badgeScale = spring({ frame: localFrame, fps, config: { damping: 11, stiffness: 190 }, from: 0.4, to: 1 });
  const badgeOpacity = interpolate(localFrame, [0, 6], [0, 1], { extrapolateRight: "clamp" });

  const hasImage = Boolean(tool.image) && !imageFailed;
  const ratio = tool.imageSize ? tool.imageSize.width / tool.imageSize.height : 1.9;
  const wideImage = hasImage && ratio >= 1.3;
  const logoImage = hasImage && !wideImage;

  const glow = interpolate(localFrame % 150, [0, 75, 150], [0.18, 0.3, 0.18]);

  // Long product names ("Perplexity Hybrid Compute") step down so they stay
  // within two lines next to the rest of the card.
  const nameLength = Array.from(tool.name).length;
  const nameSize = hasImage
    ? nameLength <= 14 ? 78 : nameLength <= 22 ? 66 : 56
    : nameLength <= 14 ? 96 : nameLength <= 22 ? 80 : 66;

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

      {/* Header: rank badge + source + progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 36 }}>
        <div
          style={{
            opacity: badgeOpacity,
            transform: `scale(${badgeScale})`,
            width: 112,
            height: 112,
            borderRadius: 28,
            background: ACCENT_GRADIENT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 68,
            fontWeight: 900,
            color: "#0b0b14",
            flexShrink: 0,
          }}
        >
          {tool.rank}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flexGrow: 1, opacity: badgeOpacity }}>
          <div style={{ fontSize: 36, fontWeight: 800, color: COLORS.text, letterSpacing: "1px" }}>
            新作AIツール TOP{totalTools}
          </div>
          <div style={{ fontSize: 24, fontWeight: 500, color: COLORS.textMuted }}>{sourceLabel}</div>
        </div>
        <div style={{ display: "flex", gap: 8, opacity: badgeOpacity }}>
          {Array.from({ length: totalTools }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              style={{
                width: n === tool.rank ? 30 : 12,
                height: 12,
                borderRadius: 6,
                background: n === tool.rank ? COLORS.accentLight : n < tool.rank ? `${COLORS.accent}88` : "rgba(255,255,255,0.18)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Body: flows from the top under an image, centred when text-only */}
      <div
        style={{
          flexGrow: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: hasImage ? "flex-start" : "center",
          paddingBottom: hasImage ? 0 : 60,
        }}
      >
      {/* Screenshot / banner (wide images) */}
      {wideImage && (
        <div
          style={{
            ...fadeUp(localFrame, 4, fps),
            width: CONTENT_WIDTH,
            height: 440,
            borderRadius: 28,
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            overflow: "hidden",
            marginBottom: 40,
            flexShrink: 0,
          }}
        >
          <Img
            src={staticFile(tool.image as string)}
            onError={() => setImageFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        </div>
      )}

      {/* Name (+ logo tile for square images) */}
      <div style={{ ...fadeUp(localFrame, 8, fps), display: "flex", alignItems: "center", gap: 32 }}>
        {logoImage && (
          <div
            style={{
              width: 180,
              height: 180,
              borderRadius: 36,
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <Img
              src={staticFile(tool.image as string)}
              onError={() => setImageFailed(true)}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </div>
        )}
        <div
          style={{
            fontSize: nameSize,
            fontWeight: 800,
            color: COLORS.text,
            lineHeight: 1.12,
            letterSpacing: "-1px",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "auto-phrase",
            overflowWrap: "anywhere",
            textWrap: "balance",
          }}
        >
          {tool.name}
        </div>
      </div>

      {/* 一言 */}
      <div
        style={{
          ...fadeUp(localFrame, 14, fps),
          marginTop: 24,
          fontSize: hasImage ? 46 : 54,
          fontWeight: 700,
          color: COLORS.textSub,
          lineHeight: 1.35,
          // Japanese phrase-aware wrapping (needs lang="ja"; Chrome ≥ 119,
          // Remotion's headless Chrome is 144): no "個 / 人情報" splits.
          wordBreak: "auto-phrase",
          overflowWrap: "anywhere",
          textWrap: "balance",
        }}
      >
        {tool.description}
      </div>

      {/* Spec rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: hasImage ? 40 : 64 }}>
        <SpecRow label="誰向け" style={fadeUp(localFrame, 20, fps)}>
          <span style={{ fontSize: 38, fontWeight: 700, color: COLORS.text }}>{tool.who}</span>
        </SpecRow>
        <SpecRow label="料金" style={fadeUp(localFrame, 25, fps)}>
          <span
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: COLORS.text,
              border: `3px solid ${PRICING_BORDER[tool.pricing] || PRICING_BORDER.unknown}`,
              background: "rgba(255,255,255,0.06)",
              borderRadius: 999,
              padding: "6px 26px",
            }}
          >
            {tool.pricingLabel}
          </span>
        </SpecRow>
        <SpecRow label="公式" style={fadeUp(localFrame, 30, fps)}>
          <span style={{ fontSize: 36, fontWeight: 600, color: COLORS.accentLight }}>{tool.domain}</span>
        </SpecRow>
      </div>
      </div>
    </AbsoluteFill>
  );
};

const SpecRow: React.FC<{ label: string; style: React.CSSProperties; children: React.ReactNode }> = ({
  label,
  style,
  children,
}) => (
  <div style={{ ...style, display: "flex", alignItems: "center", gap: 28 }}>
    <span style={{ width: 128, flexShrink: 0, fontSize: 30, fontWeight: 600, color: COLORS.textMuted }}>{label}</span>
    {children}
  </div>
);
