import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { JevDiagram as Diagram } from "../data";
import { ACCENT_GRADIENT, COLORS } from "./theme";

/**
 * The top half of a Jev slide as a picture in order (owner 2026-10-06: "the top is text too, so there is
 * too much to read — explain in order"). Rebuilt from Codex's references in docs/jev-diagram/; filled every
 * morning from slides[].diagram (scripts/jev.mjs videoDiagram). Boxes appear one after another in reading
 * order, all drawn by localFrame ~40 (the first slide is the Instagram cover, taken at frame 60).
 * Words only: May's bubble says the sentence.
 */
const LABEL = { color: COLORS.text, fontWeight: 800, lineHeight: 1.25, wordBreak: "auto-phrase", textWrap: "balance" } as unknown as React.CSSProperties;
const NOTE = { fontSize: 32, fontWeight: 700, color: COLORS.accentLight, lineHeight: 1.2 };
const BOX = { background: COLORS.panel, border: `3px solid rgba(139,124,255,0.55)`, borderRadius: 24 };
const ACCENT_BOX = { background: ACCENT_GRADIENT, border: "3px solid transparent", borderRadius: 24 };

function useReveal(i: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = 12 + i * 8;
  const opacity = interpolate(frame, [start, start + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = spring({ frame: Math.max(0, frame - start), fps, config: { damping: 14, stiffness: 120 }, from: 24, to: 0 });
  return { opacity, transform: `translateY(${y}px)` };
}

/** Arrow between two boxes; appears with the box after it. */
const Arrow: React.FC<{ dir: "down" | "right"; i: number }> = ({ dir, i }) => {
  const style = useReveal(i);
  const down = dir === "down";
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", ...style }}>
      <svg width={down ? 44 : 40} height={down ? 30 : 44} viewBox={down ? "0 0 44 30" : "0 0 40 44"}>
        <path d={down ? "M4 4 L22 26 L40 4" : "M6 4 L34 22 L6 40"} fill="none" stroke={COLORS.accent} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const Steps: React.FC<{ items: Diagram["items"] }> = ({ items }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    {items.map((it, i) => (
      <React.Fragment key={i}>
        {i > 0 && <Arrow dir="down" i={i} />}
        <Step label={it.label} i={i} />
      </React.Fragment>
    ))}
  </div>
);

const Step: React.FC<{ label: string; i: number }> = ({ label, i }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 24, ...useReveal(i) }}>
    <div
      style={{
        flex: "0 0 72px",
        height: 72,
        borderRadius: "50%",
        background: ACCENT_GRADIENT,
        color: COLORS.background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 40,
        fontWeight: 900,
      }}
    >
      {i + 1}
    </div>
    <div style={{ ...BOX, flex: 1, padding: "16px 28px", fontSize: 44, ...LABEL }}>{label}</div>
  </div>
);

const Flow: React.FC<{ items: Diagram["items"] }> = ({ items }) => (
  <div style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
    {items.map((it, i) => (
      <React.Fragment key={i}>
        {i > 0 && <Arrow dir="right" i={i} />}
        <FlowBox item={it} i={i} accent={i === 1} />
      </React.Fragment>
    ))}
  </div>
);

const FlowBox: React.FC<{ item: Diagram["items"][number]; i: number; accent: boolean }> = ({ item, i, accent }) => (
  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12, ...useReveal(i) }}>
    <div style={{ ...NOTE, textAlign: "center", minHeight: 38 }}>{item.note ?? ""}</div>
    <div
      style={{
        ...(accent ? ACCENT_BOX : BOX),
        flex: 1,
        minHeight: 170,
        padding: "18px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontSize: 38,
        ...LABEL,
        ...(accent ? { color: COLORS.background } : {}),
      }}
    >
      {item.label}
    </div>
  </div>
);

const Compare: React.FC<{ items: Diagram["items"] }> = ({ items }) => (
  <div style={{ display: "flex", gap: 28 }}>
    {items.map((it, i) => (
      <CompareCard key={i} item={it} i={i} />
    ))}
  </div>
);

/** The right-hand column (after / the answer) carries the accent. */
const CompareCard: React.FC<{ item: Diagram["items"][number]; i: number }> = ({ item, i }) => (
  <div
    style={{
      ...BOX,
      ...(i === 1 ? { border: `3px solid ${COLORS.accent}` } : {}),
      flex: 1,
      minWidth: 0,
      padding: "26px 22px 30px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 18,
      textAlign: "center",
      ...useReveal(i),
    }}
  >
    <div style={{ ...NOTE, color: i === 1 ? COLORS.accentLight : COLORS.textMuted }}>{item.note}</div>
    <div style={{ width: 64, height: 4, borderRadius: 2, background: i === 1 ? COLORS.accent : COLORS.border }} />
    <div style={{ fontSize: 48, ...LABEL }}>{item.label}</div>
  </div>
);

export const JevDiagram: React.FC<{ diagram: Diagram }> = ({ diagram }) => {
  if (diagram.type === "steps") return <Steps items={diagram.items} />;
  if (diagram.type === "flow") return <Flow items={diagram.items} />;
  return <Compare items={diagram.items} />;
};
