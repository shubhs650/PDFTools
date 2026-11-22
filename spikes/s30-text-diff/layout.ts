// Spike S30 (M12-05): reading order, route 1 (D-63): PDFium's positioned
// characters → words → recursive XY-cut → lines in reading order. Pure: the
// input is the characters of one page (pdfium-text.ts), or OCR words.
//
// XY-cut: a region is cut at a vertical gutter when one exists (columns come
// first), otherwise at its widest horizontal gap, and each part is cut again.
// Largest gap first keeps a full-width heading above two columns from slicing
// the columns into strips. Atomic items (a recognised table) take part in the
// cut as one box, so they land at their place in the reading order.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- indices in range, in hot loops (spike code) */

import type { Char } from './pdfium-text.ts';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Word extends Box {
  text: string;
  size: number;
  bold: boolean;
  invisible: boolean;
  /** Has right-to-left letters. */
  rtl: boolean;
  /** Baseline y. */
  base: number;
  page: number;
}

export interface Line extends Box {
  words: Word[];
  size: number;
  bold: boolean;
  rtl: boolean;
  page: number;
  /** Index of an atomic item (a table) instead of words. */
  atom?: number;
}

const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u;
const SPACE = /^\s$/u;
const MARK = /^[\p{M}\u200c\u200d]$/u;

/** Groups a page's characters into words (content order, gaps, size and baseline). */
export function wordsOf(chars: readonly Char[], page: number): Word[] {
  const out: Word[] = [];
  let cur: Char[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    // Right-to-left letters drawn left to right (visual order): back to logical order.
    const hasRtl = cur.some((c) => RTL.test(c.ch));
    let cs = cur;
    if (hasRtl && cur.length > 1) {
      const first = cur[0]!;
      const last = cur[cur.length - 1]!;
      if (last.x0 > first.x0) cs = [...cur].reverse();
    }
    const text = cs.map((c) => c.ch).join('');
    const sizes = cur.map((c) => c.size).sort((a, b) => a - b);
    out.push({
      text,
      x0: Math.min(...cur.map((c) => c.x0)),
      y0: Math.min(...cur.map((c) => c.y0)),
      x1: Math.max(...cur.map((c) => c.x1)),
      y1: Math.max(...cur.map((c) => c.y1)),
      size: sizes[sizes.length >> 1] ?? 0,
      bold: cur.filter((c) => c.bold).length * 2 > cur.length,
      invisible: cur.every((c) => c.invisible),
      rtl: hasRtl,
      base: cur[0]?.oy ?? 0,
      page,
    });
    cur = [];
  };
  for (const c of chars) {
    // PDFium's generated spaces are left to the gap rule below: it adds them
    // inside unshaped Indic words (after ि), where they are wrong.
    if (c.generated) continue;
    if (SPACE.test(c.ch) || c.ch === ' ') {
      flush();
      continue;
    }
    if (Math.abs(c.angle) > 1 && Math.abs(c.angle - 360) > 1) {
      // Rotated text (stamps, vertical labels) is left out of the running text.
      flush();
      continue;
    }
    const p = cur[cur.length - 1];
    // Combining marks (Devanagari vowel signs, Arabic harakat) and joiners always
    // stay with their base: their glyphs may sit left of it (ि) or overlap it.
    if (p && !MARK.test(c.ch)) {
      const size = Math.max(p.size, c.size, 1);
      // Gap to the word so far (not the last glyph): Indic glyphs are reordered.
      const x0 = Math.min(...cur.map((q) => q.x0));
      const x1 = Math.max(...cur.map((q) => q.x1));
      const gap = Math.max(c.x0 - x1, x0 - c.x1);
      const shift = Math.abs(c.oy - p.oy);
      const sizeJump = Math.abs(c.size - p.size) > 0.2 * size;
      if (gap > 0.15 * size || shift > 0.15 * size || sizeJump) flush();
    }
    cur.push(c);
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

/** Gaps of a projection: [start, end] of every empty stretch between items. */
function gaps(items: readonly Item[], lo: (i: Item) => number, hi: (i: Item) => number) {
  const iv = items.map((i) => [lo(i), hi(i)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let end = iv[0]?.[1] ?? 0;
  for (const [a, b] of iv.slice(1)) {
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

/** Recursive XY-cut: the items in reading order, grouped by leaf. */
export function xyCut(items: readonly Item[], o: CutOptions = {}): Item[][] {
  const out: Item[][] = [];
  const rec = (its: readonly Item[]) => {
    if (its.length <= 1) {
      if (its.length) out.push([...its]);
      return;
    }
    const size = median(its.map((i) => i.size)) || 10;
    const top = Math.min(...its.map((i) => i.y0));
    const bottom = Math.max(...its.map((i) => i.y1));
    // Columns: a vertical gutter at least `gutter` × size wide, with text on both sides
    // over a good part of the region's height.
    const xg = gaps(
      its,
      (i) => i.x0,
      (i) => i.x1,
    ).filter(([a, b]) => b - a >= Math.max(6, (o.gutter ?? 0.9) * size));
    let best: [number, number] | null = null;
    for (const g of xg) {
      const mid = (g[0] + g[1]) / 2;
      const left = its.filter((i) => i.x1 <= mid);
      const right = its.filter((i) => i.x0 >= mid);
      const h = (s: Item[]) => Math.max(...s.map((i) => i.y1)) - Math.min(...s.map((i) => i.y0));
      const tall = Math.min(h(left), h(right)) >= 0.3 * (bottom - top);
      const lines = (s: Item[]) => new Set(s.map((i) => Math.round(i.y0 / (0.5 * size)))).size;
      // A narrow strip of numbers or bullets (hanging footnote or list marks) is not a column.
      const wide = (s: Item[]) =>
        Math.max(...s.map((i) => i.x1)) - Math.min(...s.map((i) => i.x0)) >= 3 * size;
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
export function linesOf(leaf: readonly Item[], page: number): Line[] {
  const atoms = leaf.filter((i) => i.atom !== undefined);
  const words = leaf.flatMap((i) => (i.word ? [i.word] : []));
  const out: Line[] = atoms.map((a) => ({
    x0: a.x0,
    y0: a.y0,
    x1: a.x1,
    y1: a.y1,
    words: [],
    size: a.size,
    bold: false,
    rtl: false,
    page,
    atom: a.atom!,
  }));
  const sorted = [...words].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const lines: Word[][] = [];
  for (const w of sorted) {
    const l = lines.find((ws) => {
      const y0 = Math.min(...ws.map((x) => x.y0));
      const y1 = Math.max(...ws.map((x) => x.y1));
      const ov = Math.min(y1, w.y1) - Math.max(y0, w.y0);
      return ov >= 0.5 * Math.min(y1 - y0, w.y1 - w.y0);
    });
    if (l) l.push(w);
    else lines.push([w]);
  }
  for (const ws of lines) {
    const rtl = ws.filter((w) => w.rtl).length * 2 > ws.length;
    ws.sort((a, b) => (rtl ? b.x1 - a.x1 : a.x0 - b.x0));
    const main = ws.filter((w) => w.size >= 0.8 * Math.max(...ws.map((x) => x.size)));
    out.push({
      x0: Math.min(...ws.map((w) => w.x0)),
      y0: Math.min(...ws.map((w) => w.y0)),
      x1: Math.max(...ws.map((w) => w.x1)),
      y1: Math.max(...ws.map((w) => w.y1)),
      words: ws,
      size: median(main.map((w) => w.size)),
      bold: main.every((w) => w.bold),
      rtl,
      page,
    });
  }
  return out.sort((a, b) => a.y0 - b.y0);
}

/** A page's lines in reading order (XY-cut leaves, then lines inside each). */
export function readingOrder(
  words: readonly Word[],
  atoms: readonly Box[],
  page: number,
  o: CutOptions = {},
): Line[] {
  const items: Item[] = [
    ...words.map((w) => ({ x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, size: w.size, word: w })),
    ...atoms.map((a, i) => ({ ...a, size: 10, atom: i })),
  ];
  const rtl = o.rtl ?? words.filter((w) => w.rtl).length * 2 > words.length;
  return xyCut(items, { ...o, rtl }).flatMap((leaf) => linesOf(leaf, page));
}

/** Words in content-stream order joined into lines naively (the baseline for comparison). */
export function streamLines(words: readonly Word[], page: number): Line[] {
  const out: Line[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({
      x0: Math.min(...cur.map((w) => w.x0)),
      y0: Math.min(...cur.map((w) => w.y0)),
      x1: Math.max(...cur.map((w) => w.x1)),
      y1: Math.max(...cur.map((w) => w.y1)),
      words: cur,
      size: median(cur.map((w) => w.size)),
      bold: cur.every((w) => w.bold),
      rtl: false,
      page,
    });
    cur = [];
  };
  for (const w of words) {
    const p = cur[cur.length - 1];
    if (p && (Math.abs(w.base - p.base) > 0.5 * w.size || w.x0 < p.x0 - w.size)) flush();
    cur.push(w);
  }
  flush();
  return out;
}
