import React from "react";
import { AbsoluteFill, Audio, Series, staticFile, useCurrentFrame } from "remotion";
import { Opening } from "../components/Opening";
import { ToolCard } from "../components/ToolCard";
import { Ending } from "../components/Ending";
import { JevSlideCard } from "../components/JevSlideCard";
import { May, MayPose, MAY_SAFE_BOTTOM, MAY_SUBTITLE_LEFT } from "../components/May";
import { Subtitle, SubtitleData } from "../components/Subtitle";
import {
  VideoCard,
  VideoMeta,
  AudioDurations,
  SubtitleMap,
  defaultDurations,
  defaultMeta,
  calculateFrameDurations,
} from "../data";

export interface Props {
  tools: VideoCard[];
  meta?: VideoMeta;
  audioDurations?: AudioDurations;
  subtitles?: SubtitleMap;
  /** 先輩のメイ on screen (Jev videos only — ignored for pickup tool cards). Off unless the pipeline turns it on. */
  may?: boolean;
}

/** Pose per scene: surprised hook, explain / point alternating over the slides, nod on the outro. */
export function mayPoseFor(scene: "opening" | "ending" | number): MayPose {
  if (scene === "opening") return "surprise";
  if (scene === "ending") return "nod";
  return scene % 2 === 0 ? "explain" : "point";
}

export const AiToolsVideo: React.FC<Props> = ({ tools, meta = defaultMeta, audioDurations, subtitles, may: mayProp = false }) => {
  const frames = calculateFrameDurations(audioDurations || defaultDurations);
  const sub = (key: string): SubtitleData | undefined => subtitles?.[key] as SubtitleData | undefined;
  // Jev videos only: the pickup tool cards have no room reserved for her.
  const may = mayProp && tools.every((t) => "heading" in t);
  // While May stands bottom-left: content ends above her head, subtitles sit to her right.
  const bottom = may ? MAY_SAFE_BOTTOM : undefined;
  const subPos = may ? { left: MAY_SUBTITLE_LEFT, maxChars: 12 } : {};

  return (
    <AbsoluteFill>
      {/* BGM - low volume ambient pad under narration */}
      <Audio src={staticFile("audio/bgm.wav")} volume={0.12} />

      <Series>
        {frames.opening > 0 && (
          <Series.Sequence durationInFrames={frames.opening}>
            <Opening meta={meta} bottom={bottom} />
            {may && <May pose={mayPoseFor("opening")} audio="audio/opening.mp3" />}
            <Subtitle data={sub("opening")} {...subPos} />
            <Audio src={staticFile("audio/opening.mp3")} volume={1} />
          </Series.Sequence>
        )}

        {tools.map((tool, i) => (
          <Series.Sequence key={tool.rank} durationInFrames={frames.tools[i] || frames.tools[0]}>
            {"heading" in tool ? (
              <JevSlideCard slide={tool} bottom={bottom} />
            ) : (
              <ToolCardWrapper tool={tool} totalTools={tools.length} headline={meta.headline} />
            )}
            {may && <May pose={mayPoseFor(i)} audio={`audio/tool-${i + 1}.mp3`} />}
            <Subtitle data={sub(`tool-${i + 1}`)} {...subPos} />
            <Audio src={staticFile(`audio/tool-${i + 1}.mp3`)} volume={1} />
          </Series.Sequence>
        ))}

        <Series.Sequence durationInFrames={frames.ending}>
          <Ending lines={meta.endingLines} bottom={bottom} />
          {may && <May pose={mayPoseFor("ending")} audio="audio/ending.mp3" />}
          <Subtitle data={sub("ending")} {...subPos} />
          <Audio src={staticFile("audio/ending.mp3")} volume={1} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

const ToolCardWrapper: React.FC<{ tool: Exclude<VideoCard, { heading: string }>; totalTools: number; headline: string }> = (props) => {
  const localFrame = useCurrentFrame();
  return <ToolCard {...props} localFrame={localFrame} />;
};
