// 見本（参考リール型）: 進み具合のバー + Step 見出し + アプリの窓（打たれる文字・動くカーソル・ファイルの札）
// + 今言っている語の字幕 + 保存の誘い。投稿しない。台本は data/ref-reel-sample.json、
// 書き出しは scripts/ref-reel-sample.mjs。
// 文字の大きさ（1080×1920）: 見出し 64 / 字幕 48 / 窓の中 32 / Step 32。見出し÷字幕 = 1.33。
// 根拠は coffee-daily-video docs/typography-scale.md（日本語 SNS の表紙はジャンプ率ほぼ 1.0〜1.4、本文は最低 30〜40px）。
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Series,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FONT_FAMILY } from "../components/theme";

type Word = { offset: number; duration: number; text: string };
export type RefScene = {
  kind: "hook" | "step" | "recap" | "save";
  step?: number;
  heading: [string, string, string];
  narration: string;
  accents: string[];
  audio: string;
  duration: number;
  words: Word[];
};
export type RefReelProps = {
  app: string;
  prompt: string;
  file: string;
  answer: { head: string; lines: string[] }[];
  scenes: RefScene[];
  recap: string[];
};

export const REF_FPS = 30;
const C = {
  bg: "#FBF8F4",
  ink: "#231F1B",
  sub: "#7D7369",
  faint: "#A79D93",
  accent: "#D2643A",
  accentSoft: "rgba(210,100,58,0.10)",
  rail: "#E8DFD5",
  line: "#ECE4DA",
  field: "#F6F2EC",
};
const STEPS = 5;
const WIN = { x: 100, y: 540, w: 880, h: 760, bar: 72 };
const INPUT = { x: 28, h: 200 }; // 窓の中の入力欄（下端から 28px）
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.33, 0, 0.2, 1);
const ramp = (t: number, a: number, b: number) => interpolate(t, [a, b], [0, 1], { ...clamp, easing: ease });

// 語の時刻（秒）。見つからなければ fallback。
const cue = (words: Word[], text: string, fallback: number) =>
  words.find((w) => w.text.includes(text))?.offset ?? fallback;

// ---------- 背景・バー・見出し ----------

const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 60% at 50% 100%, #F6E4DA 0%, rgba(246,228,218,0) 60%), ${C.bg}`,
    }}
  />
);

const ProgressBar: React.FC<{ filled: number; growFrom: number; t: number }> = ({ filled, growFrom, t }) => {
  const gap = 12;
  const w = (1080 - 160 - gap * (STEPS - 1)) / STEPS;
  return (
    <div style={{ position: "absolute", left: 80, top: 210, display: "flex", gap }}>
      {Array.from({ length: STEPS }, (_, i) => {
        const p = i < growFrom ? 1 : i < filled ? ramp(t, 0.05, 0.45) : 0;
        return (
          <div key={i} style={{ width: w, height: 6, borderRadius: 3, background: C.rail, overflow: "hidden" }}>
            <div style={{ width: `${p * 100}%`, height: "100%", background: C.accent }} />
          </div>
        );
      })}
    </div>
  );
};

const Accented: React.FC<{ parts: [string, string, string] }> = ({ parts: [a, b, c] }) => (
  <>
    {a}
    <span style={{ color: C.accent, fontWeight: 900 }}>{b}</span>
    {c}
  </>
);

const Header: React.FC<{ scene: RefScene; t: number; dur: number }> = ({ scene, t, dur }) => {
  const inP = ramp(t, 0, 0.35);
  const out = 1 - ramp(t, dur - 0.2, dur);
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        top: 248,
        opacity: inP * out,
        transform: `translateY(${(1 - inP) * 16}px)`,
      }}
    >
      {scene.step ? (
        <div style={{ fontSize: 32, fontWeight: 700, color: C.accent, marginBottom: 6 }}>Step {scene.step}</div>
      ) : (
        <div style={{ height: 50 }} />
      )}
      <div style={{ fontSize: 64, fontWeight: 700, color: C.ink, letterSpacing: "0.02em" }}>
        <Accented parts={scene.heading} />
      </div>
    </div>
  );
};

// ---------- 字幕（今言っている語。1〜数語、1 語だけオレンジ） ----------

const isKana = (s: string) => /^[ぁ-ゟー]+$/.test(s);
type Chunk = { text: string; start: number };
const chunksOf = (words: Word[], narration: string): Chunk[] => {
  const out: Chunk[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    const attach =
      last &&
      (isKana(w.text) || /^\d+$/.test(w.text)) &&
      last.text.length + w.text.length <= 9 &&
      !narration.includes(`${last.text}、${w.text}`); // 読点の後ろの語はつなげない（「分けて、と」）
    if (attach) last.text += w.text;
    else out.push({ text: w.text, start: w.offset });
  }
  return out;
};

const Caption: React.FC<{ scene: RefScene; t: number }> = ({ scene, t }) => {
  const chunks = chunksOf(scene.words, scene.narration);
  const i = chunks.filter((c) => c.start <= t + 0.03).length - 1;
  if (i < 0) return null;
  const { text, start } = chunks[i];
  const acc = scene.accents.find((a) => text.includes(a));
  const at = acc ? text.indexOf(acc) : -1;
  const pop = ramp(t, start, start + 0.12);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 1400,
        textAlign: "center",
        fontSize: 48,
        fontWeight: 700,
        color: C.ink,
        opacity: 0.8 + 0.2 * pop,
        transform: `translateY(${(1 - pop) * 6}px)`,
      }}
    >
      {at < 0 ? text : <Accented parts={[text.slice(0, at), acc!, text.slice(at + acc!.length)]} />}
    </div>
  );
};

// ---------- 窓・カーソル・部品 ----------

const Spark: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 40 40">
    <path d="M20 2 C22 14 26 18 38 20 C26 22 22 26 20 38 C18 26 14 22 2 20 C14 18 18 14 20 2 Z" fill={C.accent} />
  </svg>
);

const DocIcon: React.FC<{ size?: number }> = ({ size = 30 }) => (
  <svg width={size} height={size * 1.2} viewBox="0 0 30 36">
    <path d="M3 3 h16 l8 8 v22 h-24 z" fill="#fff" stroke={C.accent} strokeWidth={2.5} strokeLinejoin="round" />
    <path d="M19 3 v8 h8" fill="none" stroke={C.accent} strokeWidth={2.5} strokeLinejoin="round" />
    <path d="M8 18 h14 M8 24 h14" stroke={C.accent} strokeWidth={2.5} strokeLinecap="round" />
  </svg>
);

const Chip: React.FC<{ children: React.ReactNode; tone?: "file" | "note"; style?: React.CSSProperties }> = ({
  children,
  tone = "file",
  style,
}) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      height: 56,
      padding: "0 20px",
      borderRadius: 14,
      fontSize: 30,
      fontWeight: 700,
      color: tone === "file" ? C.ink : C.accent,
      background: tone === "file" ? "#fff" : C.accentSoft,
      border: `2px solid ${tone === "file" ? C.line : "rgba(210,100,58,0.35)"}`,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

const SendButton: React.FC<{ press: number; active: boolean }> = ({ press, active }) => (
  <div
    style={{
      width: 68,
      height: 68,
      borderRadius: 34,
      background: active ? C.accent : "#E4DCD3",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transform: `scale(${1 - 0.12 * press})`,
      boxShadow: active ? `0 0 0 ${10 * press}px rgba(210,100,58,0.18)` : "none",
    }}
  >
    <svg width={30} height={30} viewBox="0 0 30 30">
      <path d="M15 25 V6 M7 13 L15 5 L23 13" stroke="#fff" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

// 窓の左上を (0,0) とした座標のカーソル。keys の時刻（秒）の間をなめらかに動く。
type Key = { t: number; x: number; y: number };
const Cursor: React.FC<{ t: number; keys: Key[]; clicks: number[]; show?: number }> = ({ t, keys, clicks, show = 1 }) => {
  // 語が見つからず cue() の既定の秒数が混ざっても、時刻は必ず増える順に（interpolate は逆順で例外）
  const ts: number[] = [];
  keys.forEach((k, i) => ts.push(i === 0 ? k.t : Math.max(k.t, ts[i - 1] + 0.01)));
  const x = interpolate(t, ts, keys.map((k) => k.x), { ...clamp, easing: ease });
  const y = interpolate(t, ts, keys.map((k) => k.y), { ...clamp, easing: ease });
  const c = clicks.find((ct) => t >= ct && t < ct + 0.45);
  const p = c === undefined ? 1 : (t - c) / 0.45;
  return (
    <div style={{ position: "absolute", left: WIN.x + x, top: WIN.y + y, opacity: show, zIndex: 10 }}>
      {c !== undefined && (
        <div
          style={{
            position: "absolute",
            left: -36 * p - 4,
            top: -36 * p - 4,
            width: 72 * p + 8,
            height: 72 * p + 8,
            borderRadius: "50%",
            border: `4px solid ${C.accent}`,
            opacity: 1 - p,
          }}
        />
      )}
      <svg width={46} height={56} viewBox="0 0 23 28" style={{ transform: `scale(${c === undefined ? 1 : 0.9 + 0.1 * p})`, transformOrigin: "0 0" }}>
        <path d="M2 2 L2 22 L7 17.5 L10.5 25.5 L14 24 L10.6 16 L17.5 16 Z" fill={C.ink} stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const Window: React.FC<{ app: string; enter: number; opacity?: number; children: React.ReactNode }> = ({
  app,
  enter,
  opacity = 1,
  children,
}) => (
  <div
    style={{
      position: "absolute",
      left: WIN.x,
      top: WIN.y,
      width: WIN.w,
      height: WIN.h,
      borderRadius: 30,
      background: "#fff",
      border: `2px solid ${C.line}`,
      boxShadow: "0 30px 80px rgba(120,80,50,0.12)",
      overflow: "hidden",
      opacity: enter * opacity,
      transform: `translateY(${(1 - enter) * 40}px) scale(${0.96 + 0.04 * enter})`,
    }}
  >
    <div
      style={{
        height: WIN.bar,
        borderBottom: `2px solid ${C.line}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", left: 28, display: "flex", gap: 12 }}>
        {["#EE8C7E", "#F2C46D", "#8FCB8F"].map((c) => (
          <div key={c} style={{ width: 18, height: 18, borderRadius: 9, background: c }} />
        ))}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: C.sub }}>{app}</div>
    </div>
    <div style={{ position: "relative", height: WIN.h - WIN.bar, overflow: "hidden" }}>{children}</div>
  </div>
);

// 頼み方の文は読点で改行する（語の途中で折り返さない）。
const breakAtComma = (s: string) => s.replace("、", "、\n");

const BODY_H = WIN.h - WIN.bar;
const INPUT_TOP = BODY_H - 28 - INPUT.h;

// 入力欄。chips = ファイルの札など、text = 打たれた文字。
const InputBox: React.FC<{
  chips?: React.ReactNode;
  text?: string;
  caret?: boolean;
  t: number;
  press?: number;
  sendActive?: boolean;
}> = ({ chips, text, caret, t, press = 0, sendActive = false }) => (
  <div
    style={{
      position: "absolute",
      left: INPUT.x,
      right: INPUT.x,
      top: INPUT_TOP,
      height: INPUT.h,
      borderRadius: 24,
      background: C.field,
      border: `2px solid ${C.line}`,
      padding: "20px 110px 20px 24px",
      boxSizing: "border-box",
    }}
  >
    {chips && <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>{chips}</div>}
    <div style={{ fontSize: 32, lineHeight: 1.45, color: text ? C.ink : C.faint, fontWeight: 500, whiteSpace: "pre-wrap" }}>
      {text ? breakAtComma(text) : null}
      <span
        style={{
          display: "inline-block",
          width: 3,
          height: 36,
          background: C.accent,
          margin: "0 3px",
          verticalAlign: "-6px",
          opacity: caret && Math.floor(t * 2.2) % 2 === 0 ? 1 : 0,
        }}
      />
      {text ? null : "メッセージを入力"}
    </div>
    <div style={{ position: "absolute", right: 20, bottom: 20 }}>
      <SendButton press={press} active={sendActive} />
    </div>
  </div>
);

const Greeting: React.FC<{ opacity: number }> = ({ opacity }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      right: 0,
      top: 150,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 22,
      opacity,
    }}
  >
    <Spark size={64} />
    <div style={{ fontSize: 36, fontWeight: 700, color: C.ink }}>何をお手伝いしましょう？</div>
  </div>
);

const NewChatPill: React.FC<{ flash: number }> = ({ flash }) => (
  <div
    style={{
      position: "absolute",
      left: 28,
      top: 24,
      height: 56,
      padding: "0 22px",
      borderRadius: 28,
      border: `2px solid ${flash > 0 ? C.accent : C.line}`,
      background: flash > 0 ? C.accent : "#fff",
      color: flash > 0 ? "#fff" : C.ink,
      fontSize: 30,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
    }}
  >
    ＋ 新しいチャット
  </div>
);

const FileChip: React.FC<{ name: string }> = ({ name }) => (
  <Chip>
    <DocIcon size={24} />
    {name}
  </Chip>
);

// 答え（3 つに分かれた議事録）。shown = 出した行数、marks = チェックを付けた行数、hi = 枠で囲む見出し。
const Answer: React.FC<{
  answer: RefReelProps["answer"];
  t: number;
  from: number;
  marks?: number;
  hi?: string | null;
  note?: { head: string; text: string; opacity: number };
}> = ({ answer, t, from, marks = 0, hi = null, note }) => {
  let row = 0;
  return (
    <div style={{ display: "flex", gap: 18 }}>
      <div style={{ paddingTop: 4 }}>
        <Spark size={36} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
        {answer.map((sec) => {
          const secRow = row++;
          const lines = sec.lines.map((l) => ({ l, r: row++ }));
          const vis = (r: number) => ramp(t, from + r * 0.22, from + r * 0.22 + 0.25);
          const isHi = hi === sec.head;
          return (
            <div
              key={sec.head}
              style={{
                borderRadius: 16,
                padding: "6px 14px",
                margin: "-6px -14px",
                background: isHi ? C.accentSoft : "transparent",
                outline: isHi ? `3px solid ${C.accent}` : "3px solid transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48, opacity: vis(secRow) }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: C.accent }}>■ {sec.head}</span>
                {note?.head === sec.head && note.opacity > 0 && (
                  <Chip tone="note" style={{ height: 48, fontSize: 30, opacity: note.opacity }}>
                    {note.text}
                  </Chip>
                )}
              </div>
              {lines.map(({ l, r }) => (
                <div
                  key={l}
                  style={{
                    fontSize: 32,
                    fontWeight: 500,
                    color: C.ink,
                    lineHeight: 1.45,
                    opacity: vis(r),
                    display: "flex",
                    justifyContent: "space-between",
                    transform: `translateY(${(1 - vis(r)) * 8}px)`,
                  }}
                >
                  <span>{l}</span>
                  {r < marks && <span style={{ color: C.accent, fontWeight: 900 }}>✓</span>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const UserBubble: React.FC<{ file: string; prompt: string; opacity: number }> = ({ file, prompt, opacity }) => (
  <div style={{ display: "flex", justifyContent: "flex-end", opacity }}>
    <div
      style={{
        maxWidth: 700,
        background: C.accentSoft,
        borderRadius: 24,
        padding: "18px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <FileChip name={file} />
      <div style={{ fontSize: 30, lineHeight: 1.45, color: C.ink, fontWeight: 500, whiteSpace: "pre-wrap" }}>
        {breakAtComma(prompt)}
      </div>
    </div>
  </div>
);

// ---------- 場面 ----------

const SceneView: React.FC<{ scene: RefScene; props: RefReelProps }> = ({ scene, props }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const dur = scene.duration;
  const w = scene.words;
  const { app, file, prompt, answer } = props;
  const answerRows = answer.reduce((n, s) => n + 1 + s.lines.length, 0);
  const send = { x: WIN.w - INPUT.x - 20 - 34, y: WIN.bar + INPUT_TOP + INPUT.h - 20 - 34 };

  let body: React.ReactNode = null;
  if (scene.kind === "hook") {
    const p = spring({ frame, fps, config: { damping: 200 } });
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: 80,
            right: 80,
            top: 660,
            textAlign: "center",
            opacity: p,
            transform: `translateY(${(1 - p) * 20}px)`,
          }}
        >
          <div style={{ fontSize: 64, fontWeight: 700, color: C.ink, lineHeight: 1.4 }}>
            {scene.heading[0]}
            <br />
            <span style={{ color: C.accent, fontWeight: 900 }}>{scene.heading[1]}</span>
            {scene.heading[2]}
          </div>
          <div style={{ marginTop: 40, display: "flex", justifyContent: "center", gap: 14, opacity: ramp(t, cue(w, "5つ", 3) - 0.1, cue(w, "5つ", 3) + 0.3) }}>
            {Array.from({ length: STEPS }, (_, i) => (
              <div key={i} style={{ width: 64, height: 6, borderRadius: 3, background: C.accent, opacity: ramp(t, cue(w, "5つ", 3) + i * 0.08, cue(w, "5つ", 3) + i * 0.08 + 0.2) }} />
            ))}
          </div>
        </div>
        <Caption scene={scene} t={t} />
      </>
    );
  }

  if (scene.kind === "save") {
    const cs = cue(w, "保存", 3.5);
    const drop = spring({ frame: frame - Math.round((cs - 0.2) * fps), fps, config: { damping: 200 }, durationInFrames: 14 });
    return (
      <>
        <div style={{ position: "absolute", left: 80, right: 80, top: 560, textAlign: "center", opacity: ramp(t, 0, 0.35) }}>
          <div style={{ fontSize: 64, fontWeight: 700, color: C.ink }}>
            <Accented parts={scene.heading} />
          </div>
          <div style={{ marginTop: 18, fontSize: 34, fontWeight: 500, color: C.sub }}>手順は、この動画の中に</div>
        </div>
        <svg
          width={150}
          height={190}
          viewBox="0 0 150 190"
          style={{
            position: "absolute",
            left: 465,
            top: 830,
            opacity: Math.min(1, drop * 1.5),
            transform: `translateY(${(1 - drop) * -60}px)`,
          }}
        >
          <path d="M10 10 H140 V180 L75 135 L10 180 Z" fill={C.accent} />
        </svg>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 1110,
            textAlign: "center",
            fontSize: 34,
            fontWeight: 700,
            color: C.ink,
            opacity: ramp(t, cs + 0.6, cs + 1.0),
          }}
        >
          フォローすると、ほかの仕事術も届きます
        </div>
        <Caption scene={scene} t={t} />
      </>
    );
  }

  const step = scene.step ?? STEPS;
  let filled = step;
  let growFrom = step - 1;
  if (scene.kind === "recap") {
    filled = STEPS;
    growFrom = STEPS;
  }

  if (scene.kind === "recap") {
    body = (
      <div
        style={{
          position: "absolute",
          left: WIN.x,
          top: WIN.y,
          width: WIN.w,
          height: WIN.h,
          borderRadius: 30,
          background: "#fff",
          border: `2px solid ${C.line}`,
          boxShadow: "0 30px 80px rgba(120,80,50,0.12)",
          padding: "70px 64px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 38,
          justifyContent: "center",
          opacity: ramp(t, 0, 0.25),
        }}
      >
        {props.recap.map((r, i) => {
          const v = ramp(t, 0.1 + i * 0.14, 0.35 + i * 0.14);
          return (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 26, opacity: v, transform: `translateX(${(1 - v) * -16}px)` }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  background: C.accent,
                  color: "#fff",
                  fontSize: 32,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </div>
              <div style={{ fontSize: 40, fontWeight: 700, color: C.ink }}>{r}</div>
            </div>
          );
        })}
      </div>
    );
  } else if (step === 1) {
    const enter = spring({ frame, fps, config: { damping: 200 } });
    const click = cue(w, "新しい", 3.9);
    const pill = { x: 28 + 150, y: WIN.bar + 24 + 28 };
    body = (
      <>
        <Window app={app} enter={enter}>
          <NewChatPill flash={t >= click && t < click + 0.35 ? 1 : 0} />
          <Greeting
            opacity={
              t < click + 0.2
                ? (0.35 + 0.65 * ramp(t, 0.4, 0.9)) * (1 - ramp(t, click + 0.05, click + 0.2))
                : ramp(t, click + 0.3, click + 0.7)
            }
          />
          <InputBox t={t} />
        </Window>
        <Cursor
          t={t}
          keys={[
            { t: 0, x: 700, y: 560 },
            { t: 0.6, x: 700, y: 560 },
            { t: click - 0.1, x: pill.x, y: pill.y },
            { t: dur, x: pill.x + 40, y: pill.y + 160 },
          ]}
          clicks={[click]}
          show={ramp(t, 0.4, 0.7)}
        />
      </>
    );
  } else if (step === 2) {
    // 順番: メモの札が出る → 「仮名に」の札が付く（貼る前に仮名にする）→ つかんで入力欄へ落とす
    const kana = cue(w, "仮名", 2.8);
    const grab = Math.max(kana + 0.6, cue(w, "会議", 4.0) - 0.2);
    const drop = Math.max(grab + 0.7, cue(w, "貼り", 4.6) + 0.1);
    const from = { x: 330, y: WIN.bar + 300 }; // つかむ点（札の左上から 30,20）
    const to = { x: 70, y: WIN.bar + INPUT_TOP + 20 };
    const d = ramp(t, grab + 0.2, drop);
    const landed = t >= drop;
    const end1 = { x: 28 + 150 + 40, y: WIN.bar + 24 + 28 + 160 }; // 手順 1 の終わりのカーソル
    body = (
      <>
        <Window app={app} enter={1}>
          <Greeting opacity={1 - 0.6 * ramp(t, 0, 0.4)} />
          <InputBox
            t={t}
            chips={
              landed ? (
                <>
                  <FileChip name={file} />
                  <Chip tone="note">仮名にしてある</Chip>
                </>
              ) : undefined
            }
          />
          {!landed && (
            <div
              style={{
                position: "absolute",
                left: interpolate(d, [0, 1], [from.x, to.x]) - 30,
                top: interpolate(d, [0, 1], [from.y - WIN.bar, to.y - WIN.bar]) - 20,
                opacity: ramp(t, 0.3, 0.6),
                transform: `scale(${t > grab ? 1.03 : 1})`,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <div style={{ borderRadius: 14, boxShadow: t > grab ? "0 14px 30px rgba(120,80,50,0.18)" : "none" }}>
                <FileChip name={file} />
              </div>
              <Chip tone="note" style={{ opacity: ramp(t, kana - 0.1, kana + 0.2) }}>
                名前は仮名に（Aさん・B社）
              </Chip>
            </div>
          )}
        </Window>
        <Cursor
          t={t}
          keys={[
            { t: 0, x: end1.x, y: end1.y },
            { t: grab - 0.3, x: from.x, y: from.y },
            { t: grab + 0.2, x: from.x, y: from.y },
            { t: drop, x: to.x, y: to.y },
            { t: dur, x: 520, y: WIN.bar + 360 },
          ]}
          clicks={[grab, drop]}
        />
      </>
    );
  } else if (step === 3) {
    const start = cue(w, "決まっ", 1.6) - 0.1;
    const end = Math.max(start + 1.5, cue(w, "指定", 5.5));
    const n = Math.floor(prompt.length * ramp(t, start, end));
    body = (
      <>
        <Window app={app} enter={1}>
          <Greeting opacity={0.4} />
          <InputBox t={t} chips={<FileChip name={file} />} text={prompt.slice(0, n)} caret={t > start - 0.3} sendActive={n > 0} />
        </Window>
        <Cursor t={t} keys={[{ t: 0, x: 520, y: WIN.bar + 360 }, { t: dur, x: 600, y: WIN.bar + 330 }]} clicks={[]} show={1 - ramp(t, 0.2, 0.6)} />
      </>
    );
  } else if (step === 4) {
    const click = cue(w, "送信", 1.6);
    const ans = cue(w, "3つ", 2.9) - 0.2;
    const sent = t >= click + 0.12;
    const press = t >= click && t < click + 0.3 ? 1 - Math.abs((t - click) / 0.15 - 1) : 0;
    const scroll = ramp(t, ans - 0.2, ans + 0.3) * -150;
    body = (
      <>
        <Window app={app} enter={1}>
          {!sent && <Greeting opacity={0.4} />}
          {sent && (
            <div style={{ position: "absolute", left: 28, right: 28, top: 28 + scroll, display: "flex", flexDirection: "column", gap: 28 }}>
              <UserBubble file={file} prompt={prompt} opacity={ramp(t, click + 0.12, click + 0.4)} />
              {t < ans ? (
                <div style={{ display: "flex", gap: 12, paddingLeft: 6, opacity: ramp(t, click + 0.4, click + 0.6) }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ width: 14, height: 14, borderRadius: 7, background: C.faint, opacity: 0.35 + 0.65 * ((Math.floor(t * 4) + i) % 3 === 0 ? 1 : 0) }} />
                  ))}
                </div>
              ) : (
                <Answer answer={answer} t={t} from={ans} />
              )}
            </div>
          )}
          {sent ? (
            <InputBox t={t} press={press} sendActive={press > 0} />
          ) : (
            <InputBox t={t} chips={<FileChip name={file} />} text={prompt} press={press} sendActive />
          )}
        </Window>
        <Cursor
          t={t}
          keys={[
            { t: 0, x: 600, y: WIN.bar + 330 },
            { t: 0.3, x: 600, y: WIN.bar + 330 },
            { t: click - 0.1, x: send.x, y: send.y },
            { t: dur, x: send.x - 60, y: send.y - 120 },
          ]}
          clicks={[click]}
          show={ramp(t, 0, 0.3)}
        />
      </>
    );
  } else {
    const date = cue(w, "日付", 1.6);
    const tanto = cue(w, "担当", 2.1);
    const check = cue(w, "確かめ", 4.0);
    const kana = cue(w, "仮名", 5.6);
    const hi = t >= tanto ? "宿題" : t >= date ? "期限" : null;
    const marks = Math.floor(answerRows * ramp(t, check - 0.2, check + 0.9));
    // 答えの並び: 見出し 46px・行 46px・区切り 14px。窓の上から 28 - 150 + 吹き出し(約 196) + 28。
    const top0 = WIN.bar + 28 - 150 + 196 + 28;
    const rowY = { 期限: top0 + 46 * 4 + 14 * 2 + 46 + 6, 宿題: top0 + 46 * 2 + 14 + 23 };
    const target = hi === "期限" ? rowY.期限 : rowY.宿題;
    body = (
      <>
        <Window app={app} enter={1}>
          <div style={{ position: "absolute", left: 28, right: 28, top: 28 - 150, display: "flex", flexDirection: "column", gap: 28 }}>
            <UserBubble file={file} prompt={prompt} opacity={1} />
            <Answer
              answer={answer}
              t={t + 100}
              from={0}
              marks={marks}
              hi={hi}
              note={{ head: "宿題", text: "仮名 → 元の名前に", opacity: ramp(t, kana - 0.1, kana + 0.25) }}
            />
          </div>
          <InputBox t={t} />
        </Window>
        <Cursor
          t={t}
          keys={[
            { t: 0, x: send.x - 60, y: send.y - 120 },
            { t: Math.max(0.3, date - 0.5), x: send.x - 60, y: send.y - 120 },
            { t: date, x: 600, y: rowY.期限 },
            { t: tanto, x: 600, y: rowY.宿題 },
            { t: dur, x: 640, y: rowY.宿題 + 40 },
          ]}
          clicks={[date, tanto]}
        />
      </>
    );
  }

  return (
    <>
      <ProgressBar filled={filled} growFrom={growFrom} t={t} />
      <Header scene={scene} t={t} dur={dur} />
      {body}
      <Caption scene={scene} t={t} />
    </>
  );
};

export const refReelFrames = (scenes: RefScene[]) => scenes.reduce((n, s) => n + Math.round(s.duration * REF_FPS), 0);

// BGM は最後の 1 秒で音を下げて終える（途中でぷつっと切らない）。
const Bgm: React.FC<{ total: number }> = ({ total }) => (
  <Audio
    src={staticFile("audio/bgm.wav")}
    volume={(f) => interpolate(f, [0, Math.max(1, total - REF_FPS), Math.max(2, total)], [0.08, 0.08, 0], clamp)}
  />
);

export const RefReelSample: React.FC<RefReelProps> = (props) => (
  <AbsoluteFill style={{ fontFamily: FONT_FAMILY, color: C.ink }}>
    <Background />
    <Bgm total={refReelFrames(props.scenes)} />
    <Series>
      {props.scenes.map((s, i) => (
        <Series.Sequence key={i} durationInFrames={Math.round(s.duration * REF_FPS)}>
          <Audio src={staticFile(s.audio)} />
          <SceneView scene={s} props={props} />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
