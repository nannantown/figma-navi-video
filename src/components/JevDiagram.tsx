import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { JevDiagram as Diagram } from "../data";
import { COLORS } from "./theme";

/**
 * The top half of a Jev slide as a picture in order (owner 2026-10-06: "the top is text too, so there is
 * too much to read — explain in order"). Rebuilt from Codex's references in docs/jev-diagram/ and filled
 * every morning from slides[].diagram (scripts/jev.mjs videoDiagram). Words only: May's bubble says the
 * sentence. Boxes appear one after another in reading order, all drawn by localFrame ~40 (the first slide
 * is the Instagram cover, taken at frame 60); in `steps` the lit step then walks 1 → 2 → 3 over the slide.
 */
type Item = Diagram["items"][number];

const LABEL = { fontWeight: 800, lineHeight: 1.25, wordBreak: "auto-phrase", textWrap: "balance" } as unknown as React.CSSProperties;
// White text stays ≥ 3:1 on both ends (large bold text), unlike the light pill gradient.
const LIT = "linear-gradient(90deg, #5B4BE0, #8B7CFF)";
const OUTLINE = `3px solid rgba(139,124,255,0.6)`;
const REVEAL_START = 12;
const REVEAL_STEP = 8;

function useReveal(i: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = REVEAL_START + i * REVEAL_STEP;
  const opacity = interpolate(frame, [start, start + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = spring({ frame: Math.max(0, frame - start), fps, config: { damping: 14, stiffness: 120 }, from: 24, to: 0 });
  return { opacity, transform: `translateY(${y}px)` };
}

/** Filled arrow between two boxes; appears with the box after it. */
const Arrow: React.FC<{ dir: "down" | "right"; i: number }> = ({ dir, i }) => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", ...useReveal(i) }}>
    {dir === "down" ? (
      <svg width={40} height={26} viewBox="0 0 40 26">
        <path d="M14 0 H26 V10 H38 L20 26 L2 10 H14 Z" fill={COLORS.accent} />
      </svg>
    ) : (
      <svg width={34} height={36} viewBox="0 0 34 36">
        <path d="M0 12 H16 V2 L34 18 L16 34 V24 H0 Z" fill={COLORS.accent} />
      </svg>
    )}
  </div>
);

/** steps: the lit step follows the narration's order — equal shares of the slide after the reveal. */
const Steps: React.FC<{ items: Item[]; durationInFrames: number }> = ({ items, durationInFrames }) => {
  const frame = useCurrentFrame();
  const from = REVEAL_START + items.length * REVEAL_STEP;
  const progress = interpolate(frame, [from, Math.max(from + 1, durationInFrames - 15)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lit = Math.min(items.length - 1, Math.floor(progress * items.length));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Arrow dir="down" i={i} />}
          <Step label={it.label} i={i} lit={i === lit} />
        </React.Fragment>
      ))}
    </div>
  );
};

const Step: React.FC<{ label: string; i: number; lit: boolean }> = ({ label, i, lit }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 26,
      padding: "14px 28px",
      borderRadius: 22,
      border: lit ? "3px solid transparent" : OUTLINE,
      background: lit ? LIT : COLORS.panel,
      boxShadow: lit ? "0 0 32px rgba(139,124,255,0.45)" : "none",
      ...useReveal(i),
    }}
  >
    <div
      style={{
        flex: "0 0 62px",
        height: 62,
        borderRadius: "50%",
        border: `3px solid ${COLORS.text}`,
        background: lit ? COLORS.background : "transparent",
        color: COLORS.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 36,
        fontWeight: 900,
      }}
    >
      {i + 1}
    </div>
    <div style={{ fontSize: 46, color: COLORS.text, ...LABEL }}>{label}</div>
  </div>
);

/** flow: input → process → output; the middle box (usually Jev) is lit. */
const Flow: React.FC<{ items: Item[] }> = ({ items }) => (
  <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
    {items.map((it, i) => (
      <React.Fragment key={i}>
        {i > 0 && (
          <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", paddingTop: 50 }}>
            <Arrow dir="right" i={i} />
          </div>
        )}
        <FlowBox item={it} i={i} lit={i === 1} />
      </React.Fragment>
    ))}
  </div>
);

const FlowBox: React.FC<{ item: Item; i: number; lit: boolean }> = ({ item, i, lit }) => (
  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12, ...useReveal(i) }}>
    <div style={{ fontSize: 32, fontWeight: 700, color: COLORS.textMuted, textAlign: "center", minHeight: 38 }}>{item.note ?? ""}</div>
    <div
      style={{
        minHeight: 180,
        padding: "18px 14px",
        borderRadius: 22,
        border: lit ? "3px solid transparent" : OUTLINE,
        background: lit ? LIT : COLORS.panel,
        boxShadow: lit ? "0 0 32px rgba(139,124,255,0.45)" : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: lit ? 50 : 42,
        color: COLORS.text,
        ...LABEL,
      }}
    >
      {item.label}
    </div>
  </div>
);

/** compare: two columns, title band on top (`note`), the value big; the right column (after / the answer) is lit. */
const Compare: React.FC<{ items: Item[] }> = ({ items }) => (
  <div style={{ display: "flex", alignItems: "stretch", gap: 24 }}>
    {items.map((it, i) => (
      <CompareCard key={i} item={it} i={i} lit={i === 1} />
    ))}
  </div>
);

const CompareCard: React.FC<{ item: Item; i: number; lit: boolean }> = ({ item, i, lit }) => (
  <div
    style={{
      flex: 1,
      minWidth: 0,
      borderRadius: 22,
      overflow: "hidden",
      border: lit ? `3px solid ${COLORS.accent}` : OUTLINE,
      background: COLORS.panel,
      boxShadow: lit ? "0 0 32px rgba(139,124,255,0.35)" : "none",
      display: "flex",
      flexDirection: "column",
      ...useReveal(i),
    }}
  >
    <div
      style={{
        background: lit ? LIT : "rgba(255,255,255,0.08)",
        color: COLORS.text,
        fontSize: 34,
        fontWeight: 800,
        textAlign: "center",
        padding: "12px 12px",
      }}
    >
      {item.note}
    </div>
    <div
      style={{
        flex: 1,
        minHeight: 140,
        padding: "20px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: 52,
        color: lit ? COLORS.accentLight : COLORS.text,
        ...LABEL,
      }}
    >
      {item.label}
    </div>
  </div>
);

export const JevDiagram: React.FC<{ diagram: Diagram; durationInFrames: number }> = ({ diagram, durationInFrames }) => {
  if (diagram.type === "steps") return <Steps items={diagram.items} durationInFrames={durationInFrames} />;
  if (diagram.type === "flow") return <Flow items={diagram.items} />;
  return <Compare items={diagram.items} />;
};
