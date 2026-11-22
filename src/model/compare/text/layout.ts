// Reading order for the text comparison (M12-17, D-63, spike S30 route 1):
// a page's positioned characters (PageText, from the Work worker) → words →
// recursive XY-cut → lines in reading order, kept in typed arrays
// (PageLayout: S30 measured 250 MB for two 500-page documents as objects).
// Pure code.
//
// XY-cut: a region is cut at a vertical gutter when one exists (columns come
// first), otherwise at its widest horizontal gap, and each part is cut again.
// Largest gap first keeps a full-width heading above two columns from slicing
// the columns into strips. Atomic items (a recognised table or figure, M12-18)
// take part in the cut as one box, so they land at their place in the order.
import { TEXT_BOLD, TEXT_GENERATED, TEXT_INVISIBLE, type PageText } from '../material';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bits of a word's or line's flags. */
export const WORD_BOLD = 1;
/** From an OCR layer (invisible text). */
export const WORD_INVISIBLE = 2;
/** Has right-to-left letters. */
export const WORD_RTL = 4;

export interface Word extends Box {
  text: string;
  size: number;
  /** Baseline y. */
  base: number;
  flags: number;
}

export interface Line extends Box {
  words: Word[];
  size: number;
  flags: number;
  /** Index of an atomic item (a table, a figure) instead of words. */
  atom?: number;
}

const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u;
const MARK = /^[\p{M}‌‍]$/u;
const SPACE = /^\s$/u;

/** The extent of the word being read. */
interface Run {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Groups a page's characters into words (content order, gaps, size and baseline). */
export function wordsOf(t: PageText): Word[] {
  const out: Word[] = [];
  const n = t.codes.length;
  let cur: number[] = [];
  let run: Run | null = null;
  const flush = (): void => {
    if (!run || cur.length === 0) {
      cur = [];
      run = null;
      return;
    }
    let text = cur.map((i) => String.fromCodePoint(t.codes[i] ?? 32)).join('');
    const rtl = RTL.test(text);
    // Right-to-left letters drawn left to right (visual order): back to logical order.
    if (rtl && cur.length > 1) {
      const first = cur[0] ?? 0;
      const last = cur[cur.length - 1] ?? 0;
      if ((t.boxes[last * 4] ?? 0) > (t.boxes[first * 4] ?? 0))
        text = [...cur]
          .reverse()
          .map((i) => String.fromCodePoint(t.codes[i] ?? 32))
          .join('');
    }
    const sizes = cur.map((i) => t.sizes[i] ?? 0).sort((a, b) => a - b);
    let bold = 0;
    let invisible = true;
    for (const i of cur) {
      const f = t.flags[i] ?? 0;
      if (f & TEXT_BOLD) bold++;
      if (!(f & TEXT_INVISIBLE)) invisible = false;
    }
    out.push({
      text,
      x0: run.x0,
      y0: run.y0,
      x1: run.x1,
      y1: run.y1,
      size: sizes[sizes.length >> 1] ?? 0,
      base: t.origins[(cur[0] ?? 0) * 2 + 1] ?? 0,
      flags:
        (bold * 2 > cur.length ? WORD_BOLD : 0) |
        (invisible ? WORD_INVISIBLE : 0) |
        (rtl ? WORD_RTL : 0),
    });
    cur = [];
    run = null;
  };
  for (let i = 0; i < n; i++) {
    const code = t.codes[i] ?? 32;
    // PDFium's generated spaces are left to the gap rule below: it adds them
    // inside unshaped Indic words (after ि), where they are wrong.
    if ((t.flags[i] ?? 0) & TEXT_GENERATED) continue;
    const ch = String.fromCodePoint(code);
    if (code === 32 || SPACE.test(ch)) {
      flush();
      continue;
    }
    // Rotated text (stamps, vertical labels) is left out of the running text.
    if (Math.abs(t.angles[i] ?? 0) > 1) {
      flush();
      continue;
    }
    const x0 = t.boxes[i * 4] ?? 0;
    const y0 = t.boxes[i * 4 + 1] ?? 0;
    const x1 = t.boxes[i * 4 + 2] ?? 0;
    const y1 = t.boxes[i * 4 + 3] ?? 0;
    const p = cur[cur.length - 1];
    const r: Run | null = run;
    // Combining marks (Devanagari vowel signs, Arabic harakat) and joiners always
    // stay with their base: their glyphs may sit left of it (ि) or overlap it.
    if (p !== undefined && r && !MARK.test(ch)) {
      const ps = t.sizes[p] ?? 0;
      const cs = t.sizes[i] ?? 0;
      const size = Math.max(ps, cs, 1);
      // Gap to the word so far (not the last glyph): Indic glyphs are reordered.
      const gap = Math.max(x0 - r.x1, r.x0 - x1);
      const shift = Math.abs((t.origins[i * 2 + 1] ?? 0) - (t.origins[p * 2 + 1] ?? 0));
      const sizeJump = Math.abs(cs - ps) > 0.2 * size;
      if (gap > 0.15 * size || shift > 0.15 * size || sizeJump) flush();
    }
    cur.push(i);
    if (run) {
      const w: Run = run;
      w.x0 = Math.min(w.x0, x0);
      w.y0 = Math.min(w.y0, y0);
      w.x1 = Math.max(w.x1, x1);
      w.y1 = Math.max(w.y1, y1);
    } else run = { x0, y0, x1, y1 };
  }
  flush();
  return out;
}

export interface Item extends Box {
  /** A word, or an atomic item (index into the caller's list). */
  word?: Word;
  atom?: number;
  size: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
}

/** Extent of items: [min of lo, max of hi]. */
function extent(items: readonly Item[], lo: (i: Item) => number, hi: (i: Item) => number) {
  let a = Infinity;
  let b = -Infinity;
  for (const i of items) {
    a = Math.min(a, lo(i));
    b = Math.max(b, hi(i));
  }
  return [a, b] as const;
}

/** Gaps of a projection: [start, end] of every empty stretch between items. */
function gaps(
  items: readonly Item[],
  lo: (i: Item) => number,
  hi: (i: Item) => number,
): [number, number][] {
  const iv = items.map((i) => [lo(i), hi(i)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let end = iv[0]?.[1] ?? 0;
  for (let k = 1; k < iv.length; k++) {
    const [a, b] = iv[k] ?? [0, 0];
    if (a > end) out.push([end, a]);
    end = Math.max(end, b);
  }
  return out;
}

export interface CutOptions {
  /** Smallest gutter between columns, in multiples of the font size. */
  gutter?: number;
  /** Right-to-left page: columns are read right to left. */
  rtl?: boolean;
}

const X0 = (i: Item): number => i.x0;
const X1 = (i: Item): number => i.x1;
const Y0 = (i: Item): number => i.y0;
const Y1 = (i: Item): number => i.y1;

/** Recursive XY-cut: the items in reading order, grouped by leaf. */
export function xyCut(items: readonly Item[], o: CutOptions = {}): Item[][] {
  const out: Item[][] = [];
  const rec = (its: readonly Item[]): void => {
    if (its.length <= 1) {
      if (its.length) out.push([...its]);
      return;
    }
    const size = median(its.map((i) => i.size)) || 10;
    const [top, bottom] = extent(its, Y0, Y1);
    // Columns: a vertical gutter at least `gutter` × size wide, with text on
    // both sides over a good part of the region's height.
    const xg = gaps(its, X0, X1).filter(([a, b]) => b - a >= Math.max(6, (o.gutter ?? 0.9) * size));
    let best: [number, number] | null = null;
    for (const g of xg) {
      const mid = (g[0] + g[1]) / 2;
      const left = its.filter((i) => i.x1 <= mid);
      const right = its.filter((i) => i.x0 >= mid);
      const h = (s: Item[]): number => {
        const [a, b] = extent(s, Y0, Y1);
        return b - a;
      };
      const tall = Math.min(h(left), h(right)) >= 0.3 * (bottom - top);
      const lines = (s: Item[]): number =>
        new Set(s.map((i) => Math.round(i.y0 / (0.5 * size)))).size;
      // A narrow strip of numbers or bullets (hanging footnote or list marks) is not a column.
      const wide = (s: Item[]): boolean => {
        const [a, b] = extent(s, X0, X1);
        return b - a >= 3 * size;
      };
      if (
        tall &&
        wide(left) &&
        wide(right) &&
        lines(left) >= 2 &&
        lines(right) >= 2 &&
        (!best || g[1] - g[0] > best[1] - best[0])
      )
        best = g;
    }
    if (best) {
      const mid = (best[0] + best[1]) / 2;
      const left = its.filter((i) => (i.x0 + i.x1) / 2 < mid);
      const right = its.filter((i) => (i.x0 + i.x1) / 2 >= mid);
      if (o.rtl) {
        rec(right);
        rec(left);
      } else {
        rec(left);
        rec(right);
      }
      return;
    }
    // Rows: the widest horizontal gap (the topmost of equals).
    const yg = gaps(
      its,
      (i) => i.y0 + 0.1 * i.size,
      (i) => i.y1 - 0.1 * i.size,
    );
    let wide: [number, number] | null = null;
    for (const g of yg) if (!wide || g[1] - g[0] > wide[1] - wide[0] + 0.5) wide = g;
    if (wide) {
      const mid = (wide[0] + wide[1]) / 2;
      rec(its.filter((i) => (i.y0 + i.y1) / 2 < mid));
      rec(its.filter((i) => (i.y0 + i.y1) / 2 >= mid));
      return;
    }
    out.push([...its]);
  };
  rec(items);
  return out;
}

/** Lines of one leaf: words sharing most of their height, ordered by direction. */
export function linesOf(leaf: readonly Item[]): Line[] {
  const out: Line[] = [];
  for (const a of leaf)
    if (a.atom !== undefined)
      out.push({
        x0: a.x0,
        y0: a.y0,
        x1: a.x1,
        y1: a.y1,
        words: [],
        size: a.size,
        flags: 0,
        atom: a.atom,
      });
  const words: Word[] = [];
  for (const i of leaf) if (i.word) words.push(i.word);
  words.sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const lines: { y0: number; y1: number; words: Word[] }[] = [];
  for (const w of words) {
    const l = lines.find((x) => {
      const ov = Math.min(x.y1, w.y1) - Math.max(x.y0, w.y0);
      return ov >= 0.5 * Math.min(x.y1 - x.y0, w.y1 - w.y0);
    });
    if (l) {
      l.words.push(w);
      l.y0 = Math.min(l.y0, w.y0);
      l.y1 = Math.max(l.y1, w.y1);
    } else lines.push({ y0: w.y0, y1: w.y1, words: [w] });
  }
  for (const { words: ws } of lines) {
    let rtlCount = 0;
    for (const w of ws) if (w.flags & WORD_RTL) rtlCount++;
    const rtl = rtlCount * 2 > ws.length;
    ws.sort((a, b) => (rtl ? b.x1 - a.x1 : a.x0 - b.x0));
    let maxSize = 0;
    for (const w of ws) maxSize = Math.max(maxSize, w.size);
    const main = ws.filter((w) => w.size >= 0.8 * maxSize);
    const [x0, x1] = extent(ws, X0, X1);
    const [y0, y1] = extent(ws, Y0, Y1);
    out.push({
      x0,
      y0,
      x1,
      y1,
      words: ws,
      size: median(main.map((w) => w.size)),
      flags: (main.every((w) => w.flags & WORD_BOLD) ? WORD_BOLD : 0) | (rtl ? WORD_RTL : 0),
    });
  }
  return out.sort((a, b) => a.y0 - b.y0);
}

/** A page's lines in reading order (XY-cut leaves, then lines inside each). */
export function readingOrder(
  words: readonly Word[],
  atoms: readonly Box[] = [],
  o: CutOptions = {},
): Line[] {
  const items: Item[] = [
    ...words.map((w) => ({ x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, size: w.size, word: w })),
    ...atoms.map((a, i) => ({ x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1, size: 10, atom: i })),
  ];
  let rtlCount = 0;
  for (const w of words) if (w.flags & WORD_RTL) rtlCount++;
  const rtl = o.rtl ?? rtlCount * 2 > words.length;
  return xyCut(items, { ...o, rtl }).flatMap((leaf) => linesOf(leaf));
}

/**
 * A page's words in reading order, line by line, in typed arrays: what the
 * Compare worker keeps of a page for a text comparison instead of its
 * characters (about a fifth of the size).
 */
export interface PageLayout {
  width: number;
  height: number;
  /** The words' text, one after the other; word k is text[wordStart[k], wordStart[k + 1]). */
  text: string;
  wordStart: Int32Array;
  /** x0, y0, x1, y1 per word (displayed space, pt). */
  wordBox: Float32Array;
  wordSize: Float32Array;
  wordBase: Float32Array;
  wordFlags: Uint8Array;
  /** Line k holds words lineStart[k] … lineStart[k + 1] − 1. */
  lineStart: Int32Array;
  lineBox: Float32Array;
  lineSize: Float32Array;
  lineFlags: Uint8Array;
}

/** Bytes a page layout holds (for the store's accounting). */
export function layoutBytes(l: PageLayout): number {
  return (
    l.text.length * 2 +
    l.wordStart.byteLength +
    l.wordBox.byteLength +
    l.wordSize.byteLength +
    l.wordBase.byteLength +
    l.wordFlags.byteLength +
    l.lineStart.byteLength +
    l.lineBox.byteLength +
    l.lineSize.byteLength +
    l.lineFlags.byteLength +
    64
  );
}

/** Lines (in reading order) → a page layout. Atoms are left out (M12-18). */
export function packLayout(width: number, height: number, lines: readonly Line[]): PageLayout {
  const ls = lines.filter((l) => l.atom === undefined && l.words.length > 0);
  let nw = 0;
  for (const l of ls) nw += l.words.length;
  const wordStart = new Int32Array(nw + 1);
  const wordBox = new Float32Array(nw * 4);
  const wordSize = new Float32Array(nw);
  const wordBase = new Float32Array(nw);
  const wordFlags = new Uint8Array(nw);
  const lineStart = new Int32Array(ls.length + 1);
  const lineBox = new Float32Array(ls.length * 4);
  const lineSize = new Float32Array(ls.length);
  const lineFlags = new Uint8Array(ls.length);
  const parts: string[] = [];
  let off = 0;
  let k = 0;
  ls.forEach((l, li) => {
    lineStart[li] = k;
    lineBox.set([l.x0, l.y0, l.x1, l.y1], li * 4);
    lineSize[li] = l.size;
    lineFlags[li] = l.flags;
    for (const w of l.words) {
      wordStart[k] = off;
      parts.push(w.text);
      off += w.text.length;
      wordBox.set([w.x0, w.y0, w.x1, w.y1], k * 4);
      wordSize[k] = w.size;
      wordBase[k] = w.base;
      wordFlags[k] = w.flags;
      k++;
    }
  });
  wordStart[nw] = off;
  lineStart[ls.length] = nw;
  return {
    width,
    height,
    text: parts.join(''),
    wordStart,
    wordBox,
    wordSize,
    wordBase,
    wordFlags,
    lineStart,
    lineBox,
    lineSize,
    lineFlags,
  };
}

/** A page's characters → its layout: words, reading order, lines. */
export function pageLayout(t: PageText, o: CutOptions = {}): PageLayout {
  return packLayout(t.frame.width, t.frame.height, readingOrder(wordsOf(t), [], o));
}
