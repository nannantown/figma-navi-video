import React from "react";
import { Composition } from "remotion";
import { AiToolsVideo, Props } from "./compositions/AiToolsVideo";
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
    </>
  );
};
