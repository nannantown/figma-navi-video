export type Pricing = "free" | "freemium" | "trial" | "paid" | "unknown";

// One card of the "新作AIツール N選" video (pickup mode is the production format
// since the owner decision of 2026-09-15). Production values come from
// output/trending-data.json (scripts/generate-data.mjs ← data/enriched-ai-tools.json).
export interface Tool {
  rank: number;
  /** Card badge: "1/5" in pickup mode, "1".."5" in ranking mode (API opt-in only) */
  badge: string;
  /** "Product Hunt 新着" (pickup) / "Product Hunt 9/13 総合9位" (ranking) */
  sourceNote: string;
  name: string;
  /** 一言: what it does (6-30 chars, 10-24 preferred) */
  description: string;
  /** 誰向け */
  who: string;
  pricing: Pricing;
  pricingLabel: string;
  website: string;
  domain: string;
  narration: string;
  /** Path under public/ for staticFile(), or null for a text-only card */
  image?: string | null;
  imageSize?: { width: number; height: number } | null;
  // Written by toVideoTools() as the source of the card; the captions and the
  // logo fetcher read them, the components do not.
  /** Product Hunt page, no trailing slash */
  phUrl?: string;
  /** Last path segment of phUrl */
  slug?: string;
  /** Product Hunt rank — always null in pickup mode */
  phRank?: number | null;
  /** The feed's <published>: when the post was created, not when it launched */
  phPublishedAt?: string | null;
  /** Logo / screenshot candidate, before fetch-tool-images downloads it */
  imageUrl?: string | null;
}

/**
 * One slide of a Jev episode (genre trial #2, scripts/jev.mjs toJevVideoData).
 * Rendered in the same Series slot as a tool card, so the audio keys
 * (tool-1..N), the frame maths and the cover frame are shared.
 */
export interface JevSlide {
  rank: number;
  badge: string;
  /** Same as heading; record-upload / logs read `name` */
  name: string;
  heading: string;
  body: string;
  /** "TypeSafe の発表" etc. when the screen text states a claim */
  claimSource: string | null;
  narration: string;
  /** "Jev って何？・9/24" */
  header: string;
  /** "出典: TechCrunch・TypeSafe" */
  sourceLine: string;
  image?: null;
}

export type VideoCard = Tool | JevSlide;

export interface VideoMeta {
  date: string;
  /** "2026.09.15 (火)" */
  dateLabel: string;
  /** "9/15" */
  shortDate: string;
  mode: "ranking" | "pickup" | "jev";
  count: number;
  /** "新作AIツール TOP5" (ranking) / "新作AIツール 3選" (pickup — never "TOP") */
  headline: string;
  /** Small line above the big word; "新作AIツール" when unset */
  kicker?: string;
  /** Ending copy under "保存しよう"; the tools copy when unset */
  endingLines?: string[];
  /** Big opening word: "TOP5" / "3選" */
  bigLabel: string;
  /** Caption/description attribution */
  sourceLabel: string;
  /** Opening pill: "Product Hunt 9/13 の AI ツール上位" / "Product Hunt の新着から厳選" */
  openingSourceLabel: string;
  /** "新作AIツール3選" — used by generate-caption.mjs, not by the components */
  titleTag?: string;
  /** How the tools were found (discovery.method), for the PDCA report */
  method?: string | null;
}

// Preview-only data for Remotion Studio. Fictional tools on purpose.
export const defaultTools: Tool[] = [
  {
    rank: 1,
    badge: "1/5",
    sourceNote: "Product Hunt 新着",
    name: "Sample Notes AI",
    description: "会議メモを自動で要約",
    who: "会社員・PM",
    pricing: "freemium",
    pricingLabel: "無料プランあり",
    website: "https://example.com",
    domain: "example.com",
    narration: "会議の要点を自動でまとめるAIツールです。議事録づくりの時間がほぼゼロになります。",
    image: null,
  },
  {
    rank: 2,
    badge: "2/5",
    sourceNote: "Product Hunt 新着",
    name: "Draft Buddy",
    description: "文章の下書きを数秒で作成",
    who: "ライター・営業",
    pricing: "free",
    pricingLabel: "無料",
    website: "https://example.org",
    domain: "example.org",
    narration: "文章の下書きを数秒で作るAIアシスタントです。メールの書き出しで迷わなくなります。",
    image: null,
  },
  {
    rank: 3,
    badge: "3/5",
    sourceNote: "Product Hunt 新着",
    name: "Clean Shot Magic",
    description: "写真の不要物をワンタップで消去",
    who: "SNS運用者",
    pricing: "trial",
    pricingLabel: "無料トライアルあり",
    website: "https://example.net",
    domain: "example.net",
    narration: "画像から不要な物を消せるAI編集ツールです。ブラウザだけで手軽に試せます。",
    image: null,
  },
  {
    rank: 4,
    badge: "4/5",
    sourceNote: "Product Hunt 新着",
    name: "PDF Digest",
    description: "長いPDFを3行で要約",
    who: "学生・研究者",
    pricing: "paid",
    pricingLabel: "月$8〜",
    website: "https://example.com/pdf",
    domain: "example.com",
    narration: "資料をアップするだけで要約してくれるツールです。長いPDFも3行でつかめます。",
    image: null,
  },
  {
    rank: 5,
    badge: "5/5",
    sourceNote: "Product Hunt 新着",
    name: "Flow Builder",
    description: "定型業務をノーコードで自動化",
    who: "バックオフィス",
    pricing: "unknown",
    pricingLabel: "料金は公式サイトで確認",
    website: "https://example.com/flow",
    domain: "example.com",
    narration: "作業の自動化をノーコードで組めるサービスです。定型業務を毎日の手間から外せます。",
    image: null,
  },
];

export const defaultMeta: VideoMeta = {
  date: "2026-09-15",
  dateLabel: "2026.09.15 (火)",
  shortDate: "9/15",
  mode: "pickup",
  count: 5,
  headline: "新作AIツール 5選",
  bigLabel: "5選",
  sourceLabel: "Product Hunt の直近48時間の新着から厳選",
  openingSourceLabel: "Product Hunt の新着から厳選",
};

// Subtitle data (word boundaries from Edge TTS)
export interface WordBoundary {
  offset: number;
  duration: number;
  text: string;
}

export interface SubtitleEntry {
  text: string;
  words: WordBoundary[];
}

export interface SubtitleMap {
  [key: string]: SubtitleEntry;
}

// Audio durations (seconds per audio file).
// Keys: "opening", "tool-1" .. "tool-N", "ending".
export interface AudioDurations {
  opening?: number;
  ending: number;
  [key: string]: number | undefined;
}

// Default durations for Remotion Studio preview.
export const defaultDurations: AudioDurations = {
  opening: 2.8,
  "tool-1": 8.5,
  "tool-2": 8.5,
  "tool-3": 8.5,
  "tool-4": 8.5,
  "tool-5": 8.5,
  ending: 4.0,
};

// Keep in sync with scripts/pipeline.mjs (videoSeconds) — it uses the same
// arithmetic to keep the video under Instagram's 60 s limit before rendering.
export const FPS = 30;
const PADDING = 15; // 0.5s padding after each narration
const ENDING_EXTRA = 30; // 1s extra hold on the ending
// Floor on the opening hook so a routine cannot shrink it to nothing.
// (It used to also guarantee the cover still landed on the title card; since
// 2026-09-22 the cover is the first tool card — see scripts/cover-frame.mjs.)
const MIN_OPENING = 90;

export function getToolCount(d: AudioDurations): number {
  let count = 0;
  while (d[`tool-${count + 1}`] !== undefined) count++;
  return Math.max(count, 1);
}

export function calculateFrameDurations(d: AudioDurations) {
  // Opening is optional: 0 duration (or missing) → skipped entirely.
  const openingSec = d.opening ?? 0;
  const opening = openingSec > 0 ? Math.max(Math.ceil(openingSec * FPS) + PADDING, MIN_OPENING) : 0;
  const count = getToolCount(d);
  const tools: number[] = [];
  for (let i = 1; i <= count; i++) {
    const dur = d[`tool-${i}`];
    tools.push(Math.ceil(((dur as number) || 8) * FPS) + PADDING);
  }
  const ending = Math.ceil(d.ending * FPS) + ENDING_EXTRA;
  const total = opening + tools.reduce((a, b) => a + b, 0) + ending;
  return { opening, tools, ending, total };
}
