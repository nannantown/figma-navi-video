// 参考リール型の教育動画（data/content-format.json "lessonLook": "reel"）。台本は episode.reel、
// scripts/reel.mjs が場面と声（語ごとの時刻）にして渡す。仕様: docs/lesson-format.md §6。
// 進み具合のバー + 「Step N」と見出し + 自前の AI の窓（開く / 貼る / 打つ / 送る / 確かめる）
// + 今言っている語の字幕 + まとめ + 保存の誘い。本物の会社の画面は写さない（窓の名前は「AIチャット」）。
// 文字の大きさ（1080×1920）: 見出し 64 / 字幕 48 / 窓の中 30〜32 / Step 32。見出し÷字幕 = 1.33。
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
export type ReelAction = "open" | "paste" | "type" | "send" | "check";
export type ReelScene = {
  kind: "hook" | "step" | "recap" | "save";
  action?: ReelAction;
  step?: number;
  heading: [string, string, string];
  narration: string;
  accents: string[];
  focus?: string[];
  audio: string;
  duration: number;
  words: Word[];
};
export type LessonReelProps = {
  app: string;
  prompt: string;
  file: string | null;
  answer: { head: string; lines: string[] }[];
  notes: { paste: string; done: string; check: string };
  steps: number;
  scenes: ReelScene[];
  recap: string[];
};

export const REEL_FPS = 30; // scripts/reel.mjs REEL_FPS
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
const WIN = { x: 100, y: 540, w: 880, h: 760, bar: 72 };
const BODY_H = WIN.h - WIN.bar;
const PAD = 28; // 窓の中の余白
const INPUT_MIN = 200; // 入力欄（下に固定、文字が増えると上へ伸びる）
const INPUT_TOP_EMPTY = BODY_H - PAD - INPUT_MIN;
// 会話（吹き出し + 答え）は入力欄の上に下ぞろえで積む。はみ出た上は窓が隠す（ふつうのチャットと同じ）。
const CONV_BOTTOM = WIN.bar + INPUT_TOP_EMPTY - PAD; // 窓の座標
const ROW = { head: 48, line: 46, gap: 14 }; // 答えの行の高さ（固定なので位置を計算できる）
const JA = { lang: "ja" } as const; // word-break: auto-phrase は lang="ja" が要る（Chrome 119+）
const PHRASE: React.CSSProperties = { wordBreak: "auto-phrase", lineBreak: "strict" };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.33, 0, 0.2, 1);
// interpolate は増える順の 2 点が要る。時刻が逆転・同じになっても例外にしない。
const ramp = (t: number, a: number, b: number) => interpolate(t, [a, Math.max(b, a + 0.01)], [0, 1], { ...clamp, easing: ease });

// 語の時刻（秒）。どれかを含む最初の語。見つからなければ fallback。
const cue = (words: Word[], texts: string[], fallback: number) =>
  words.find((w) => texts.some((x) => w.text.includes(x)))?.offset ?? fallback;

// 「ステップN。」を言い終えた時刻（その次の語の頭）。
const afterPrefix = (words: Word[], n: number, fallback: number) => {
  let acc = "";
  for (let i = 0; i < words.length; i++) {
    acc += words[i].text;
    if (acc.includes(`ステップ${n}`) || acc.includes(`ステップ${String.fromCharCode(0xff10 + n)}`)) return words[i + 1]?.offset ?? fallback;
    if (acc.length > 12) break;
  }
  return fallback;
};

// ---------- 背景・バー・見出し ----------

const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 60% at 50% 100%, #F6E4DA 0%, rgba(246,228,218,0) 60%), ${C.bg}`,
    }}
  />
);

const ProgressBar: React.FC<{ steps: number; filled: number; growFrom: number; t: number }> = ({ steps, filled, growFrom, t }) => {
  const gap = 12;
  const w = (1080 - 160 - gap * (steps - 1)) / steps;
  return (
    <div style={{ position: "absolute", left: 80, top: 210, display: "flex", gap }}>
      {Array.from({ length: steps }, (_, i) => {
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

const Header: React.FC<{ scene: ReelScene; t: number; dur: number }> = ({ scene, t, dur }) => {
  const inP = ramp(t, 0, 0.35);
  const out = 1 - ramp(t, dur - 0.2, dur);
  return (
    <div style={{ position: "absolute", left: 80, top: 248, opacity: inP * out, transform: `translateY(${(1 - inP) * 16}px)` }}>
      {scene.step ? (
        <div style={{ fontSize: 32, fontWeight: 700, color: C.accent, marginBottom: 6 }}>Step {scene.step}</div>
      ) : (
        <div style={{ height: 50 }} />
      )}
      <div style={{ fontSize: 64, fontWeight: 700, color: C.ink, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
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
  // 1 字だけのかな（読点の後の「と」など）は、ひとりで出さずに次の語の頭に付ける
  return out.reduce<Chunk[]>((acc, c, i) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.text.length === 1 && isKana(prev.text) && i > 0) {
      prev.text += c.text;
      return acc;
    }
    acc.push({ ...c });
    return acc;
  }, []);
};

const Caption: React.FC<{ scene: ReelScene; t: number }> = ({ scene, t }) => {
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

const Chip: React.FC<{ children: React.ReactNode; tone?: "file" | "note"; style?: React.CSSProperties }> = ({ children, tone = "file", style }) => (
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
      boxSizing: "border-box",
      ...style,
    }}
  >
    {children}
  </div>
);

const FileChip: React.FC<{ name: string }> = ({ name }) => (
  <Chip>
    <DocIcon size={24} />
    {name}
  </Chip>
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
type Pt = { x: number; y: number };
type Key = Pt & { t: number };
const Cursor: React.FC<{ t: number; keys: Key[]; clicks: number[]; show?: number }> = ({ t, keys, clicks, show = 1 }) => {
  // 語が見つからず既定の秒数が混ざっても、時刻は必ず増える順に（interpolate は逆順で例外）
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

const Window: React.FC<{ app: string; enter: number; children: React.ReactNode }> = ({ app, enter, children }) => (
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
      opacity: enter,
      transform: `translateY(${(1 - enter) * 40}px) scale(${0.96 + 0.04 * enter})`,
    }}
  >
    <div style={{ height: WIN.bar, borderBottom: `2px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <div style={{ position: "absolute", left: 28, display: "flex", gap: 12 }}>
        {["#EE8C7E", "#F2C46D", "#8FCB8F"].map((c) => (
          <div key={c} style={{ width: 18, height: 18, borderRadius: 9, background: c }} />
        ))}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: C.sub }}>{app}</div>
    </div>
    <div style={{ position: "relative", height: BODY_H, overflow: "hidden" }}>{children}</div>
  </div>
);

// 入力欄。下に固定し、打った文字が増えると上へ伸びる。chips = ファイルの札など。
const InputBox: React.FC<{ chips?: React.ReactNode; text?: string; caret?: boolean; t: number; press?: number; sendActive?: boolean }> = ({
  chips,
  text,
  caret,
  t,
  press = 0,
  sendActive = false,
}) => (
  <div
    style={{
      position: "absolute",
      left: PAD,
      right: PAD,
      bottom: PAD,
      minHeight: INPUT_MIN,
      borderRadius: 24,
      background: C.field,
      border: `2px solid ${C.line}`,
      padding: "20px 110px 20px 24px",
      boxSizing: "border-box",
    }}
  >
    {chips && <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>{chips}</div>}
    <div {...JA} style={{ fontSize: 32, lineHeight: 1.45, color: text ? C.ink : C.faint, fontWeight: 500, ...PHRASE }}>
      {text || null}
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
  <div style={{ position: "absolute", left: 0, right: 0, top: 150, display: "flex", flexDirection: "column", alignItems: "center", gap: 22, opacity }}>
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

// 答えの縦の並び（行の高さは固定なので、見出しの位置を計算でき、カーソルが正しく指せる）。
const answerLayout = (answer: LessonReelProps["answer"]) => {
  let y = 0;
  const heads = answer.map((sec, i) => {
    if (i > 0) y += ROW.gap;
    const top = y;
    y += ROW.head + ROW.line * sec.lines.length;
    return { head: sec.head, center: top + ROW.head / 2 };
  });
  return { heads, height: y };
};

// 答え。vis(r) = r 行目の出方（0〜1、行の高さもそれに合わせて伸びる）、marks = チェックを付けた行数、hi = 囲む見出し。
const Answer: React.FC<{
  answer: LessonReelProps["answer"];
  vis: (r: number) => number;
  marks?: number;
  hi?: string | null;
  note?: { head: string; text: string; opacity: number };
}> = ({ answer, vis, marks = 0, hi = null, note }) => {
  let row = 0;
  return (
    <div style={{ position: "relative", paddingLeft: 54 }}>
      <div style={{ position: "absolute", left: 0, top: 6, opacity: vis(0) }}>
        <Spark size={36} />
      </div>
      {answer.map((sec, i) => {
        const secRow = row++;
        const lines = sec.lines.map((l) => ({ l, r: row++ }));
        const isHi = hi === sec.head;
        const hv = vis(secRow);
        return (
          <div
            key={`${i}-${sec.head}`}
            style={{
              borderRadius: 16,
              padding: "0 14px",
              margin: `${i > 0 ? ROW.gap * hv : 0}px -14px 0`,
              background: isHi ? C.accentSoft : "transparent",
              outline: isHi ? `3px solid ${C.accent}` : "3px solid transparent",
              outlineOffset: 2,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: ROW.head * hv, opacity: hv, overflow: "hidden" }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: C.accent, whiteSpace: "nowrap" }}>■ {sec.head}</span>
              {note?.head === sec.head && note.opacity > 0 && (
                <Chip tone="note" style={{ height: 44, fontSize: 28, padding: "0 16px", opacity: note.opacity }}>
                  {note.text}
                </Chip>
              )}
            </div>
            {lines.map(({ l, r }) => {
              const v = vis(r);
              return (
                <div
                  key={r}
                  style={{
                    height: ROW.line * v,
                    overflow: "hidden",
                    fontSize: 32,
                    fontWeight: 500,
                    color: C.ink,
                    lineHeight: `${ROW.line}px`,
                    opacity: v,
                    display: "flex",
                    justifyContent: "space-between",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{l}</span>
                  {r < marks && <span style={{ color: C.accent, fontWeight: 900, marginLeft: 12 }}>✓</span>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

const UserBubble: React.FC<{ file: string | null; prompt: string; opacity: number }> = ({ file, prompt, opacity }) => (
  <div style={{ display: "flex", justifyContent: "flex-end", opacity }}>
    <div style={{ maxWidth: 700, background: C.accentSoft, borderRadius: 24, padding: "18px 24px", display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
      {file && <FileChip name={file} />}
      <div {...JA} style={{ fontSize: 30, lineHeight: 1.45, color: C.ink, fontWeight: 500, ...PHRASE }}>
        {prompt}
      </div>
    </div>
  </div>
);

// 会話（吹き出し + 考え中の点か答え）。入力欄の上に下ぞろえ。
const Conversation: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: "absolute", left: PAD, right: PAD, bottom: BODY_H - (CONV_BOTTOM - WIN.bar), display: "flex", flexDirection: "column", gap: 28 }}>
    {children}
  </div>
);

// ---------- カーソルの通り道（前の手順の終わりから次の手順が始まる） ----------

const PILL: Pt = { x: 28 + 150, y: WIN.bar + 24 + 28 };
const SEND: Pt = { x: WIN.w - PAD - 20 - 34, y: WIN.bar + BODY_H - PAD - 20 - 34 };
const START: Pt = { x: 700, y: 560 };
const END: Record<ReelAction, Pt> = {
  open: { x: PILL.x + 40, y: PILL.y + 160 },
  paste: { x: 520, y: WIN.bar + 360 },
  type: { x: 600, y: WIN.bar + 330 },
  send: { x: SEND.x - 60, y: SEND.y - 120 },
  check: { x: 640, y: WIN.bar + 360 },
};

// ---------- 場面 ----------

const SceneView: React.FC<{ scene: ReelScene; prev: ReelScene[]; props: LessonReelProps }> = ({ scene, prev, props }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const dur = scene.duration;
  const w = scene.words;
  const { app, prompt, answer, notes, steps } = props;

  if (scene.kind === "hook") {
    const p = spring({ frame, fps, config: { damping: 200 } });
    const n = cue(w, [`${steps}つ`], Math.min(3, dur * 0.6));
    return (
      <>
        <div style={{ position: "absolute", left: 80, right: 80, top: 660, textAlign: "center", opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>
          <div style={{ fontSize: 64, fontWeight: 700, color: C.ink, lineHeight: 1.4 }}>
            {scene.heading[0]}
            <br />
            <span style={{ color: C.accent, fontWeight: 900 }}>{scene.heading[1]}</span>
            {scene.heading[2]}
          </div>
          <div style={{ marginTop: 40, display: "flex", justifyContent: "center", gap: 14, opacity: ramp(t, n - 0.1, n + 0.3) }}>
            {Array.from({ length: steps }, (_, i) => (
              <div key={i} style={{ width: 64, height: 6, borderRadius: 3, background: C.accent, opacity: ramp(t, n + i * 0.08, n + i * 0.08 + 0.2) }} />
            ))}
          </div>
        </div>
        <Caption scene={scene} t={t} />
      </>
    );
  }

  if (scene.kind === "save") {
    const cs = cue(w, ["保存"], dur * 0.7);
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
          style={{ position: "absolute", left: 465, top: 830, opacity: Math.min(1, drop * 1.5), transform: `translateY(${(1 - drop) * -60}px)` }}
        >
          <path d="M10 10 H140 V180 L75 135 L10 180 Z" fill={C.accent} />
        </svg>
        <div style={{ position: "absolute", left: 0, right: 0, top: 1110, textAlign: "center", fontSize: 34, fontWeight: 700, color: C.ink, opacity: ramp(t, cs + 0.6, cs + 1.0) }}>
          フォローすると、ほかの仕事術も届きます
        </div>
        <Caption scene={scene} t={t} />
      </>
    );
  }

  if (scene.kind === "recap") {
    return (
      <>
        <ProgressBar steps={steps} filled={steps} growFrom={steps} t={t} />
        <Header scene={scene} t={t} dur={dur} />
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
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 26, opacity: v, transform: `translateX(${(1 - v) * -16}px)` }}>
                <div
                  style={{
                    flex: "none",
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
                <div style={{ fontSize: 40, fontWeight: 700, color: C.ink, whiteSpace: "nowrap" }}>{r}</div>
              </div>
            );
          })}
        </div>
        <Caption scene={scene} t={t} />
      </>
    );
  }

  // ---- 手順の場面: 窓の中で 1 つのことをする ----
  const step = scene.step ?? 1;
  const before = prev.filter((s) => s.kind === "step").map((s) => s.action);
  const pasted = before.includes("paste");
  const file = pasted ? props.file : null;
  const last = before.at(-1);
  const from = last ? END[last] : START;
  const enter = step === 1 ? spring({ frame, fps, config: { damping: 200 } }) : 1;
  const fileChip = file ? <FileChip name={file} /> : undefined;
  let body: React.ReactNode = null;

  if (scene.action === "open") {
    const click = cue(w, ["新しい", "開き", "開く"], dur * 0.5);
    body = (
      <>
        <Window app={app} enter={enter}>
          <NewChatPill flash={t >= click && t < click + 0.35 ? 1 : 0} />
          <Greeting
            opacity={t < click + 0.2 ? (0.35 + 0.65 * ramp(t, 0.4, 0.9)) * (1 - ramp(t, click + 0.05, click + 0.2)) : ramp(t, click + 0.3, click + 0.7)}
          />
          <InputBox t={t} />
        </Window>
        <Cursor
          t={t}
          keys={[
            { t: 0, ...from },
            { t: 0.6, ...from },
            { t: click - 0.1, ...PILL },
            { t: dur, ...END.open },
          ]}
          clicks={[click]}
          show={step === 1 ? ramp(t, 0.4, 0.7) : 1}
        />
      </>
    );
  } else if (scene.action === "paste") {
    // 順番: メモの札が出る → 注意の札が付く（貼る前に仮名にする）→ つかんで入力欄へ落とす
    const pasteAt = cue(w, ["貼"], dur * 0.7);
    const kana = cue(w, ["仮名", "社外秘", "名前", "個人"], Math.max(0.6, pasteAt - 1.2));
    const grab = Math.min(Math.max(kana + 0.6, pasteAt - 0.9), dur - 1.0);
    const drop = Math.min(Math.max(grab + 0.7, pasteAt + 0.1), dur - 0.2);
    // つかむ点（札の左上から 30,20）。札の束があいさつ文（〜290）と入力欄（460〜）の間に収まる位置
    const grabPt = { x: 330, y: WIN.bar + 330 };
    const to = { x: 70, y: WIN.bar + INPUT_TOP_EMPTY + 20 };
    const d = ramp(t, grab + 0.2, drop);
    const landed = t >= drop;
    body = (
      <>
        <Window app={app} enter={enter}>
          <Greeting opacity={1 - 0.6 * ramp(t, 0, 0.4)} />
          <InputBox
            t={t}
            chips={
              landed ? (
                <>
                  <FileChip name={props.file ?? ""} />
                  {notes.done && <Chip tone="note">{notes.done}</Chip>}
                </>
              ) : undefined
            }
          />
          {!landed && (
            <div
              style={{
                position: "absolute",
                left: interpolate(d, [0, 1], [grabPt.x, to.x]) - 30,
                top: interpolate(d, [0, 1], [grabPt.y - WIN.bar, to.y - WIN.bar]) - 20,
                opacity: ramp(t, 0.3, 0.6),
                transform: `scale(${t > grab ? 1.03 : 1})`,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <div style={{ borderRadius: 14, boxShadow: t > grab ? "0 14px 30px rgba(120,80,50,0.18)" : "none" }}>
                <FileChip name={props.file ?? ""} />
              </div>
              {notes.paste && (
                <Chip tone="note" style={{ opacity: ramp(t, kana - 0.1, kana + 0.2) }}>
                  {notes.paste}
                </Chip>
              )}
            </div>
          )}
        </Window>
        <Cursor
          t={t}
          keys={[
            { t: 0, ...from },
            { t: grab - 0.3, ...grabPt },
            { t: grab + 0.2, ...grabPt },
            { t: drop, ...to },
            { t: dur, ...END.paste },
          ]}
          clicks={[grab, drop]}
          show={step === 1 ? ramp(t, 0.4, 0.7) : 1}
        />
      </>
    );
  } else if (scene.action === "type") {
    const start = afterPrefix(w, step, 1.0) - 0.1;
    const end = Math.max(start + 1.5, dur - 0.9);
    const chars = Array.from(prompt);
    const n = Math.floor(chars.length * ramp(t, start, end));
    body = (
      <>
        <Window app={app} enter={enter}>
          <Greeting opacity={0.4} />
          <InputBox t={t} chips={fileChip} text={chars.slice(0, n).join("")} caret={t > start - 0.3} sendActive={n > 0} />
        </Window>
        <Cursor t={t} keys={[{ t: 0, ...from }, { t: dur, ...END.type }]} clicks={[]} show={1 - ramp(t, 0.2, 0.6)} />
      </>
    );
  } else if (scene.action === "send") {
    const click = cue(w, ["送信", "送り", "送っ", "送る", "送"], dur * 0.3);
    const ans = click + 1.1;
    const sent = t >= click + 0.12;
    const press = t >= click && t < click + 0.3 ? 1 - Math.abs((t - click) / 0.15 - 1) : 0;
    body = (
      <>
        <Window app={app} enter={enter}>
          {!sent && <Greeting opacity={0.4} />}
          {sent && (
            <Conversation>
              <UserBubble file={file} prompt={prompt} opacity={ramp(t, click + 0.12, click + 0.4)} />
              {t < ans ? (
                <div style={{ display: "flex", gap: 12, paddingLeft: 6, height: 36, alignItems: "center", opacity: ramp(t, click + 0.4, click + 0.6) }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ width: 14, height: 14, borderRadius: 7, background: C.faint, opacity: 0.35 + 0.65 * ((Math.floor(t * 4) + i) % 3 === 0 ? 1 : 0) }} />
                  ))}
                </div>
              ) : (
                <Answer answer={answer} vis={(r) => ramp(t, ans + r * 0.22, ans + r * 0.22 + 0.25)} />
              )}
            </Conversation>
          )}
          {sent ? <InputBox t={t} press={press} sendActive={press > 0} /> : <InputBox t={t} chips={fileChip} text={prompt} press={press} sendActive />}
        </Window>
        <Cursor
          t={t}
          keys={[
            { t: 0, ...from },
            { t: 0.3, ...from },
            { t: click - 0.1, ...SEND },
            { t: dur, ...END.send },
          ]}
          clicks={[click]}
          show={ramp(t, 0, 0.3)}
        />
      </>
    );
  } else {
    // check: 答えの見出しを順に囲み、チェックを付ける（注意の札があれば最初に囲んだ見出しに）
    const layout = answerLayout(answer);
    const focus = (scene.focus?.length ? scene.focus : answer.slice(0, 2).map((s) => s.head)).slice(0, 2);
    const times: number[] = [];
    focus.forEach((f, i) => {
      const at = cue(w, [f], dur * (0.25 + 0.2 * i));
      times.push(i === 0 ? at : Math.max(at, times[i - 1] + 0.6));
    });
    const hiIndex = times.filter((x) => t >= x).length - 1;
    const hi = hiIndex >= 0 ? focus[hiIndex] : null;
    const checkAt = cue(w, ["確かめ", "確認", "見比べ", "見直"], dur * 0.55);
    const rows = answer.reduce((n, s) => n + 1 + s.lines.length, 0);
    const marks = Math.floor(rows * ramp(t, checkAt - 0.2, checkAt + 0.9));
    const noteAt = cue(w, ["仮名", "元に", "戻"], dur * 0.7);
    const top = CONV_BOTTOM - layout.height;
    const yOf = (head: string) => top + (layout.heads.find((h) => h.head === head)?.center ?? 0);
    const keys: Key[] = [
      { t: 0, ...from },
      { t: Math.max(0.3, (times[0] ?? 1) - 0.5), ...from },
      ...focus.map((f, i) => ({ t: times[i], x: 600, y: yOf(f) })),
      { t: dur, x: 640, y: yOf(focus.at(-1) ?? answer[0].head) + 40 },
    ];
    body = (
      <>
        <Window app={app} enter={enter}>
          <Conversation>
            <UserBubble file={file} prompt={prompt} opacity={1} />
            <Answer
              answer={answer}
              vis={() => 1}
              marks={marks}
              hi={hi}
              note={notes.check ? { head: focus[0], text: notes.check, opacity: ramp(t, noteAt - 0.1, noteAt + 0.25) } : undefined}
            />
          </Conversation>
          <InputBox t={t} />
        </Window>
        <Cursor t={t} keys={keys} clicks={times} />
      </>
    );
  }

  return (
    <>
      <ProgressBar steps={steps} filled={step} growFrom={step - 1} t={t} />
      <Header scene={scene} t={t} dur={dur} />
      {body}
      <Caption scene={scene} t={t} />
    </>
  );
};

export const reelFrames = (scenes: ReelScene[]) => scenes.reduce((n, s) => n + Math.round(s.duration * REEL_FPS), 0);

// BGM は最後の 1 秒で音を下げて終える（途中でぷつっと切らない）。
const Bgm: React.FC<{ total: number }> = ({ total }) => (
  <Audio src={staticFile("audio/bgm.wav")} volume={(f) => interpolate(f, [0, Math.max(1, total - REEL_FPS), Math.max(2, total)], [0.08, 0.08, 0], clamp)} />
);

export const LessonReel: React.FC<LessonReelProps> = (props) => (
  <AbsoluteFill style={{ fontFamily: FONT_FAMILY, color: C.ink }}>
    <Background />
    <Bgm total={reelFrames(props.scenes)} />
    <Series>
      {props.scenes.map((s, i) => (
        <Series.Sequence key={i} durationInFrames={Math.round(s.duration * REEL_FPS)}>
          <Audio src={staticFile(s.audio)} />
          <SceneView scene={s} prev={props.scenes.slice(0, i)} props={props} />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
