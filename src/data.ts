export interface Project {
  rank: number;
  name: string;
  fullName: string;
  description: string;
  detail: string;
  narration: string;
  category?: string;
  url: string;
}

// Preview-only defaults for Remotion Studio. Production reads from
// trending-data.json (built by generate-data.mjs from enriched-design-news.json).
export const defaultProjects: Project[] = [
  {
    rank: 1,
    name: "Figma 新機能発表",
    fullName: "Figma News",
    description: "今日のデザインニュース",
    detail: "",
    narration:
      "今日のデザインニュース。Figma が新機能を発表しました。デザイナーの作業を大きく変える可能性があります。",
    category: "design",
    url: "",
  },
  {
    rank: 2,
    name: "詳しく",
    fullName: "Figma News",
    description: "具体的に何が変わる",
    detail: "",
    narration:
      "この機能を使うと、これまで手作業で数分かかっていた部分が、一瞬で終わります。プロトタイピングの速度が大幅に改善されます。",
    category: "design",
    url: "",
  },
  {
    rank: 3,
    name: "おすすめ",
    fullName: "Figma News",
    description: "試す価値あり",
    detail: "",
    narration:
      "ぜひ今日のうちに試してみてください。Figmaナビと組み合わせれば更に効率化できます。",
    category: "design",
    url: "",
  },
];

// Narrations for opening and ending
export const openingNarration = "毎朝のデザインニュースをお届けします。";
export const endingNarration =
  "以上、今日のデザインニュースでした。フォローといいねで、毎日の情報をチェックしましょう。";

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

// Audio durations (seconds per audio file)
// Keys: "project-1" .. "project-N", "ending". "opening" is optional —
// figma-navi-video skips the brand intro entirely to reduce drop-off
// on IG Reels / YT Shorts (viewers bounce during the title call).
export interface AudioDurations {
  opening?: number;
  ending: number;
  [key: string]: number | undefined;
}

// Default durations for local dev (3 sections: hook, origin, recommend).
// opening is 0 — the video starts straight with the main content.
export const defaultDurations: AudioDurations = {
  opening: 0,
  "project-1": 12.0,
  "project-2": 18.0,
  "project-3": 8.0,
  ending: 6.0,
};

const FPS = 30;
const PADDING = 15; // 0.5s padding after audio
const ENDING_EXTRA = 30; // 1s extra for ending

export function getProjectCount(d: AudioDurations): number {
  let count = 0;
  while (d[`project-${count + 1}`] !== undefined) count++;
  return Math.max(count, 1);
}

export function calculateFrameDurations(d: AudioDurations) {
  // Opening is optional: 0 duration (or missing) → skipped entirely.
  const openingSec = d.opening ?? 0;
  const opening = openingSec > 0 ? Math.ceil(openingSec * FPS) + PADDING : 0;
  const count = getProjectCount(d);
  const projects: number[] = [];
  for (let i = 1; i <= count; i++) {
    const dur = d[`project-${i}`];
    projects.push(Math.ceil(((dur as number) || 10) * FPS) + PADDING);
  }
  const ending = Math.ceil(d.ending * FPS) + ENDING_EXTRA;
  const total = opening + projects.reduce((a, b) => a + b, 0) + ending;
  return { opening, projects, ending, total };
}
