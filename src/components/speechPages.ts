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

/** Each word's display text: the word plus the punctuation around it in the full narration. */
export function attachPunctuation(text: string, words: Word[]): string[] {
  const pieces = words.map((w) => w.text);
  let cursor = 0;
  let prev = -1;
  words.forEach((w, i) => {
    const at = text.indexOf(w.text, cursor);
    // Not found (or a jump past other words): keep the bare word.
    if (at < 0 || at - cursor > 6) return;
    const gap = text.slice(cursor, at);
    const open = gap.replace(new RegExp(`^[^${OPENERS}]*`), "");
    const close = gap.slice(0, gap.length - open.length);
    if (prev >= 0 && prev === i - 1) pieces[prev] += close;
    pieces[i] = open + w.text;
    cursor = at + w.text.length;
    prev = i;
  });
  if (prev === words.length - 1) pieces[prev] += text.slice(cursor).trimEnd();
  return pieces;
}

/** Split the narration into bubble pages of at most `maxChars` characters. */
export function speechPages(text: string, words: Word[], maxChars: number): SpeechPage[] {
  if (!words.length) return [];
  const pieces = attachPunctuation(text, words);
  const groups: number[][] = [];
  let cur: number[] = [];
  const len = (g: number[]) => g.reduce((n, i) => n + pieces[i].trim().length, 0);

  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    const paused = prev !== undefined && w.offset - (words[prev].offset + words[prev].duration) >= SENTENCE_PAUSE_SEC;
    if (cur.length && (paused || len(cur) + pieces[i].trim().length > maxChars)) {
      // Too long: cut after the last "、" if that leaves a reasonable first page.
      let comma = -1;
      if (!paused) for (let k = 0; k < cur.length; k++) if (COMMA_END.test(pieces[cur[k]])) comma = k;
      if (comma >= 0 && comma < cur.length - 1 && len(cur.slice(0, comma + 1)) >= maxChars * 0.4) {
        groups.push(cur.slice(0, comma + 1));
        cur = cur.slice(comma + 1);
      } else {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(i);
    if (SENTENCE_END.test(pieces[i])) {
      groups.push(cur);
      cur = [];
    }
  });
  if (cur.length) groups.push(cur);

  return groups.map((g) => {
    const last = words[g[g.length - 1]];
    return { pieces: g.map((i) => pieces[i]), start: words[g[0]].offset, end: last.offset + last.duration };
  });
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
