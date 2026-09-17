// Shared look for the AI tools TOP5 video (1080×1920).
// Type scale follows the sns-hub vertical-slide rules: title 78-82 / emphasis
// 46-48 / pill labels 36-38 / body ≥ 30 / credits 22-24 (exception).

import type { Pricing } from "../data";

export const FONT_FAMILY = "'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', sans-serif";

export const COLORS = {
  background: "#0b0b14",
  panel: "#161622",
  border: "rgba(255,255,255,0.10)",
  text: "#ffffff",
  textSub: "rgba(255,255,255,0.88)",
  textMuted: "rgba(255,255,255,0.58)",
  accent: "#8B7CFF",
  accentLight: "#C9C2FF",
};

export const ACCENT_GRADIENT = "linear-gradient(90deg, #8B7CFF, #C9C2FF)";

// Horizontal safe area: YT Shorts action buttons take ~140px on the right,
// IG Reels a little less; symmetric 120px keeps cards centred and clear.
export const SAFE_X = 120;
// Vertical safe area: platform header on top, caption/title UI + our
// subtitle band (bottom: 340px) at the bottom.
export const SAFE_TOP = 220;
export const SAFE_BOTTOM = 470;

// Colour lives on the pill border; label text stays white for contrast.
export const PRICING_BORDER: Record<Pricing, string> = {
  free: "#34D399",
  freemium: "#34D399",
  trial: "#FBBF24",
  paid: "#FB7185",
  unknown: "rgba(255,255,255,0.45)",
};
