import React from "react";
import { Composition } from "remotion";
import { AiToolsVideo, Props } from "./compositions/AiToolsVideo";
import { LessonReel, LessonReelProps, reelFrames, REEL_FPS } from "./compositions/LessonReel";
import { defaultTools, defaultMeta, defaultDurations, calculateFrameDurations, FPS } from "./data";

// Composition id is referenced by scripts/pipeline.mjs and package.json.
export const COMPOSITION_ID = "AiToolsTop5";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id={COMPOSITION_ID}
        component={AiToolsVideo as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={calculateFrameDurations(defaultDurations).total}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          tools: defaultTools,
          meta: defaultMeta,
          audioDurations: defaultDurations,
        }}
        calculateMetadata={async ({ props }) => {
          const p = props as unknown as Props;
          const d = p.audioDurations || defaultDurations;
          return { durationInFrames: calculateFrameDurations(d).total };
        }}
      />
      {/* 教育動画の参考リール型（lessonLook "reel"）。scripts/pipeline.mjs が scripts/reel.mjs の props で書き出す */}
      <Composition
        id="LessonReel"
        component={LessonReel as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={1}
        fps={REEL_FPS}
        width={1080}
        height={1920}
        defaultProps={{ app: "AIチャット", prompt: "", file: null, answer: [], notes: { paste: "", done: "", check: "" }, steps: 3, scenes: [], recap: [] }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: Math.max(1, reelFrames((props as unknown as LessonReelProps).scenes)),
        })}
      />
    </>
  );
};
