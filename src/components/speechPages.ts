// Pure text timing for 先輩のメイ's speech bubble (MaySpeech.tsx); tested by scripts/speech-pages.test.mjs.
//
// Edge TTS word boundaries carry no punctuation, so the old subtitle band cut lines anywhere
// ("同社自身も実際の効果とし"). Here every word gets its punctuation back from the narration's
// full text, and a bubble page ends at a sentence end, or at a "、" when it would get too long.

export interface Word {
  offset: number;
  duration: number;
  text: string;
}

export interface SpeechPage {
  /** Words with their punctuation / spaces re-attached; render each as one unbreakable piece. */
  pieces: string[];
  start: number;
  end: number;
}

const OPENERS = "「『（(【";
const SENTENCE_END = /[。？！?!]\s*[」』）)]*\s*$/;
const COMMA_END = /[、,]\s*$/;
// Fallback when the text could not be matched: the voice pauses ~0.67 s at "。".
const SENTENCE_PAUSE_SEC = 0.4;

/** Each word's display text: the word plus the punctuation around it in the full narration.
 *  All or nothing: if the words do not walk the text exactly (a word missing, or letters between
 *  two words), every word stays bare — never a doubled or dropped phrase — and pages then split
 *  on the voice's pauses instead of "。". */
export function attachPunctuation(text: string, words: Word[]): string[] {
  const bare = words.map((w) => w.text);
  const pieces = [...bare];
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const at = text.indexOf(words[i].text, cursor);
    const gap = at < 0 ? "" : text.slice(cursor, at);
    if (at < 0 || !PUNCT_ONLY.test(gap)) return bare;
    const open = gap.replace(new RegExp(`^[^${OPENERS}]*`), "");
    if (i > 0) pieces[i - 1] += gap.slice(0, gap.length - open.length);
    pieces[i] = open + words[i].text;
    cursor = at + words[i].text.length;
  }
  const rest = text.slice(cursor);
  if (!PUNCT_ONLY.test(rest)) return bare;
  if (pieces.length) pieces[pieces.length - 1] += rest.trimEnd();
  return pieces;
}

const PUNCT_ONLY = /^[\s〜~、。，．,.？！?!「」『』（）()【】…・:：;；"'“”]*$/;

/** Display width in full-width characters: Latin letters, digits and spaces count about half. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s.trim()) w += ch.charCodeAt(0) < 0x2000 ? 0.55 : 1;
  return w;
}

/** Split the narration into bubble pages of at most `maxChars` full-width characters (textWidth). */
export function speechPages(text: string, words: Word[], maxChars: number): SpeechPage[] {
  if (!words.length) return [];
  const pieces = attachPunctuation(text, words);
  const size = (i: number) => textWidth(pieces[i]);

  // 1. Sentences: end at "。？！" (or, when the text could not be matched, at a long pause).
  const sentences: number[][] = [];
  let cur: number[] = [];
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (prev !== undefined && w.offset - (words[prev].offset + words[prev].duration) >= SENTENCE_PAUSE_SEC) {
      sentences.push(cur);
      cur = [];
    }
    cur.push(i);
    if (SENTENCE_END.test(pieces[i])) {
      sentences.push(cur);
      cur = [];
    }
  });
  if (cur.length) sentences.push(cur);

  // 2. A sentence longer than a page splits into pages of about equal length, cut where a reader
  //    would pause: after "、", else after a particle, never inside a verb ending ("書い|て").
  const groups: number[][] = [];
  for (let s of sentences) {
    while (s.length > 1) {
      const total = s.reduce((n, i) => n + size(i), 0);
      if (total <= maxChars) break;
      const target = total / Math.ceil(total / maxChars);
      let best = -1;
      let bestCost = Infinity;
      let c = 0;
      for (let k = 0; k < s.length - 1; k++) {
        c += size(s[k]);
        if (c > maxChars) break;
        const cost = Math.abs(c - target) - cutBonus(pieces[s[k]], pieces[s[k + 1]]);
        if (cost < bestCost) [best, bestCost] = [k, cost];
      }
      if (best < 0) best = 0; // one piece longer than a page: it gets a page of its own
      groups.push(s.slice(0, best + 1));
      s = s.slice(best + 1);
    }
    groups.push(s);
  }

  return groups.map((g) => {
    const last = words[g[g.length - 1]];
    return { pieces: g.map((i) => pieces[i]), start: words[g[0]].offset, end: last.offset + last.duration };
  });
}

const PARTICLE_END = /(は|が|を|に|で|と|も|へ|の|から|より|まで|ので|けど|ては|では|として)\s*$/;
const BOUND_START = /^(て|た|だ|ます|まし|です|でし|い|う|る|ない|ん|ず|ば|れ|られ|せ|させ)[。、？！]*$/
/** How good a cut between two pieces is (higher = better), in characters of imbalance it is worth. */
function cutBonus(before: string, after: string): number {
  if (COMMA_END.test(before)) return 8;
  if (BOUND_START.test(after.trim())) return -6;
  return PARTICLE_END.test(before) ? 3 : 0;
}

/** The page on screen at `t` s. A page stays up through short pauses until the next one starts
 *  (no flicker between pages), and for `tail` s after the last word. */
export function pageAt(pages: SpeechPage[], t: number, lead = 0.1, tail = 0.4): number {
  for (let i = pages.length - 1; i >= 0; i--) {
    if (t >= pages[i].start - lead) {
      const until = i + 1 < pages.length ? pages[i + 1].start - lead : pages[i].end + tail;
      return t < Math.max(until, pages[i].end + 0.05) ? i : -1;
    }
  }
  return -1;
}
