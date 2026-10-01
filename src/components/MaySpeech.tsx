import React, { useMemo } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { SubtitleData } from "./Subtitle";
import { pageAt, speechPages, textWidth } from "./speechPages";
import { FONT_FAMILY } from "./theme";
import { MAY_BUBBLE, MayPose, mayMouthTip } from "./May";

/**
 * The subtitle while 先輩のメイ is on screen: a speech bubble on her chest with the tail on her
 * mouth, so the words read as hers (owner, 2026-10-01; layout from Codex's reference
 * docs/may-preview/layout/layout-ref.png). Every character full colour on a solid white bubble —
 * no greyed-out "not yet spoken" words — and a page never ends mid-word (speechPages.ts).
 * Used instead of <Subtitle> only when May is on; with May off the old band is untouched.
 */
export const MaySpeech: React.FC<{ data?: SubtitleData; pose: MayPose }> = ({ data, pose }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pages = useMemo(
    () => (data?.words?.length ? speechPages(data.text ?? "", data.words, MAY_BUBBLE.maxChars) : []),
    [data],
  );
  const t = frame / fps;
  const i = pageAt(pages, t);
  if (i < 0) return null;

  const { left, width, top, fontSize, fill, text, border } = MAY_BUBBLE;
  // The bubble fades in with its first page; later pages only swap the text inside it. Not before
  // 0.15 s: May's pose-change pop (May.tsx) has her mouth up to ~40 px lower in the first frames.
  const from = Math.max(pages[0].start - 0.1, 0.15);
  const appear = interpolate(t, [from, from + 0.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const [tipX, tipY] = mayMouthTip(pose);
  // Keep the point off her lips: the nod, breathing and talk bob move her mouth down up to ~18 px.
  const tipGap = 26;
  const baseL = tipX - 78;
  const baseR = tipX - 8;

  return (
    <div style={{ position: "absolute", inset: 0, opacity: appear }}>
      <div
        style={{
          position: "absolute",
          left,
          width,
          top,
          display: "flex",
          justifyContent: "center",
          transform: `scale(${0.94 + 0.06 * appear})`,
          transformOrigin: `${tipX - left}px 0`,
        }}
      >
        <div
          style={{
            minWidth: 380,
            maxWidth: width,
            boxSizing: "border-box",
            background: fill,
            border: `4px solid ${border}`,
            borderRadius: 40,
            padding: "20px 36px",
            boxShadow: `0 0 28px rgba(139,124,255,0.45), 0 14px 36px rgba(0,0,0,0.4)`,
            textAlign: "center",
            // Two lines of about equal length (no lone "でした。" on line 2); pieces never split.
            textWrap: "balance",
          }}
        >
          {page(pages[i].pieces, fontSize, text)}
        </div>
      </div>
      {/* Tail: from the bubble's top edge up to just under her mouth. The fill runs 6 px into the
          bubble to hide its border there; only the two slanted sides are stroked. */}
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0 }}>
        <polygon points={`${baseL},${top + 6} ${tipX},${tipY + tipGap} ${baseR},${top + 6}`} fill={fill} />
        <polyline
          points={`${baseL},${top + 2} ${tipX},${tipY + tipGap} ${baseR},${top + 2}`}
          fill="none"
          stroke={border}
          strokeWidth={4}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

/** One unbreakable box per piece; a space after a piece ("Cherry ") goes between the boxes so it
 *  neither widens a box nor shifts the centring. A piece too long for one line (a URL-like run)
 *  may wrap inside instead of running out of the bubble. */
function page(pieces: string[], fontSize: number, color: string) {
  return pieces.map((p, k) => {
    const word = p.trimEnd();
    const long = textWidth(word) > 14;
    return (
      <React.Fragment key={k}>
        <span
          style={{
            display: "inline-block",
            maxWidth: "100%",
            fontFamily: FONT_FAMILY,
            fontSize,
            fontWeight: 800,
            lineHeight: 1.36,
            color,
            whiteSpace: long ? "normal" : "pre",
            overflowWrap: "anywhere",
          }}
        >
          {word}
        </span>
        {word !== p ? " " : null}
      </React.Fragment>
    );
  });
}
