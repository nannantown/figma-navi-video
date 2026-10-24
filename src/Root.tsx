import React from "react";
import { Composition } from "remotion";
import { AiToolsVideo, Props } from "./compositions/AiToolsVideo";
import { RefReelSample, RefReelProps, refReelFrames, REF_FPS } from "./compositions/RefReelSample";
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
      {/* 見本（参考リール型）。投稿しない。scripts/ref-reel-sample.mjs が props を渡して書き出す */}
      <Composition
        id="RefReelSample"
        component={RefReelSample as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={1}
        fps={REF_FPS}
        width={1080}
        height={1920}
        defaultProps={{ app: "ChatGPT", prompt: "", file: "", answer: [], scenes: [], recap: [] }}
        calculateMetadata={async ({ props }) => ({
          durationInFrames: Math.max(1, refReelFrames((props as unknown as RefReelProps).scenes)),
        })}
      />
    </>
  );
};
