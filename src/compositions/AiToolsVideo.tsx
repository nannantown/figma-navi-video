import React from "react";
import { AbsoluteFill, Audio, Series, staticFile, useCurrentFrame } from "remotion";
import { Opening } from "../components/Opening";
import { ToolCard } from "../components/ToolCard";
import { Ending } from "../components/Ending";
import { Subtitle, SubtitleData } from "../components/Subtitle";
import {
  Tool,
  VideoMeta,
  AudioDurations,
  SubtitleMap,
  defaultDurations,
  defaultMeta,
  calculateFrameDurations,
} from "../data";

export interface Props {
  tools: Tool[];
  meta?: VideoMeta;
  audioDurations?: AudioDurations;
  subtitles?: SubtitleMap;
}

export const AiToolsVideo: React.FC<Props> = ({ tools, meta = defaultMeta, audioDurations, subtitles }) => {
  const frames = calculateFrameDurations(audioDurations || defaultDurations);
  const sub = (key: string): SubtitleData | undefined => subtitles?.[key] as SubtitleData | undefined;

  return (
    <AbsoluteFill>
      {/* BGM - low volume ambient pad under narration */}
      <Audio src={staticFile("audio/bgm.wav")} volume={0.12} />

      <Series>
        {frames.opening > 0 && (
          <Series.Sequence durationInFrames={frames.opening}>
            <Opening meta={meta} />
            <Subtitle data={sub("opening")} />
            <Audio src={staticFile("audio/opening.mp3")} volume={1} />
          </Series.Sequence>
        )}

        {tools.map((tool, i) => (
          <Series.Sequence key={tool.rank} durationInFrames={frames.tools[i] || frames.tools[0]}>
            <ToolCardWrapper tool={tool} totalTools={tools.length} sourceLabel={meta.sourceLabel} />
            <Subtitle data={sub(`tool-${i + 1}`)} />
            <Audio src={staticFile(`audio/tool-${i + 1}.mp3`)} volume={1} />
          </Series.Sequence>
        ))}

        <Series.Sequence durationInFrames={frames.ending}>
          <Ending />
          <Subtitle data={sub("ending")} />
          <Audio src={staticFile("audio/ending.mp3")} volume={1} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};

const ToolCardWrapper: React.FC<{ tool: Tool; totalTools: number; sourceLabel: string }> = (props) => {
  const localFrame = useCurrentFrame();
  return <ToolCard {...props} localFrame={localFrame} />;
};
