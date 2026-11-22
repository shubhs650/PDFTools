// Matching two revisions of a document (M12-17, D-63, spike S30). Pure code.
//
// 1. Units (paragraphs) are matched by their whole key: unique units as
//    anchors, then Myers between them (myers.ts).
// 2. Between two matched units, what is left on each side is compared word by
//    word as one stream, so a paragraph split or joined by reflow, a column
//    or a page break costs nothing.
// 3. A deleted block and an inserted block elsewhere that are the same or
//    nearly the same become one **move**, with the edits inside it.
// 4. A number replaced by a number gets its percent change.
//
// M12-18 adds headers and footers, table rows, figures, clause renumbering
// and the OCR labels on top of this.
import { WORD_RTL } from './layout';
import type { HfGroup } from './headers';
import { Interner, diff, matches, type Hunk } from './myers';
import { tokenCount, unitCount, type TextDoc } from './document';
import { kindCode, percentChange } from './tokens';

const KIND_WORD = kindCode('word');
const KIND_CHAR = kindCode('char');
const KIND_PUNCT = kindCode('punct');

export type TextChangeKind = 'inserted' | 'deleted' | 'replaced' | 'moved' | 'header' | 'footer';

/** Where a change sits on a page: displayed space, pt. */
export interface TextRect {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A stretch of one revision's text. */
export interface TextSpan {
  /** The side page it starts on. */
  page: number;
  /** As read; paragraphs joined with " ¶ ". */
  text: string;
  /** Its tokens: from t0 to t1 − 1 in the document's token order (−1 for a header or footer). */
  t0: number;
  t1: number;
  /** One rectangle per line it covers (the view's marks, M12-19). */
  rects: TextRect[];
}

export interface TextChange {
  kind: TextChangeKind;
  /** The old text (Document A). */
  a?: TextSpan;
  /** The new text (Document B). */
  b?: TextSpan;
  /** Percent change, for a number replaced by a number. */
  pct?: number;
  /** The edits inside a moved block. */
  inner?: TextChange[];
}

export interface TextMatchOptions {
  /** Detect moves (default true). */
  moves?: boolean;
  /** Report a changed header or footer once (default true; the documents leave them out). */
  headersFooters?: boolean;
  /** Smallest block, in tokens, that can be a move (default 8). */
  minMove?: number;
  /** Called between pieces of work (cancel). */
  checkpoint?: () => void;
}

export interface TextComparison {
  /** In the new revision's reading order (deletions where they would have been). */
  changes: TextChange[];
  /**
   * Content sync points (D-64): per paragraph matched whole, its first line on
   * each side: page A, y A, page B, y B.
   */
  sync: Float32Array;
  /** Pages with no text on each side: "limited support". */
  limited: { a: number[]; b: number[] };
  stats: {
    units: [number, number];
    tokens: [number, number];
    /** Paragraphs matched whole. */
    matched: number;
    ms: number;
  };
}

const MIN_MOVE = 8;
/** Words in a stretch (both sides) up to which it is compared exactly. */
const EXACT_WORDS = 6000;
const MOVE_SIMILARITY = 0.6;
/** Near neighbours that grow a moved block (a moved section whose text was edited). */
const NEAR_BLOCK = 0.5;

/** A change while it is being found: its tokens on each side and its place in B. */
interface Raw {
  change: TextChange;
  ta: Int32Array;
  tb: Int32Array;
  /** The gap it was found in (moves join two gaps); -1 inside a move. */
  gap: number;
  /** B's token index where it sits; A's for ties. */
  atB: number;
  atA: number;
}

/** Unit of each token. */
function tokenUnits(d: TextDoc): Int32Array {
  const out = new Int32Array(tokenCount(d));
  for (let u = 0; u < unitCount(d); u++) out.fill(u, d.unitTok[u] ?? 0, d.unitTok[u + 1] ?? 0);
  return out;
}

interface Side {
  d: TextDoc;
  unitOf: Int32Array;
}

/** A span from increasing token indexes. */
function spanOf(s: Side, toks: ArrayLike<number>): TextSpan {
  const n = toks.length;
  if (n === 0) return { page: 0, text: '', t0: 0, t1: 0, rects: [] };
  const { d, unitOf } = s;
  const parts: string[] = [];
  const rects: TextRect[] = [];
  let line = -1;
  let i = 0;
  while (i < n) {
    const t = toks[i] ?? 0;
    const u = unitOf[t] ?? 0;
    let j = i;
    while (j + 1 < n && unitOf[toks[j + 1] ?? 0] === u && (toks[j + 1] ?? 0) === (toks[j] ?? 0) + 1)
      j++;
    const last = toks[j] ?? 0;
    parts.push((d.unitText[u] ?? '').slice(d.tokStart[t] ?? 0, d.tokEnd[last] ?? 0));
    // The words the tokens cover, each cut to the part the tokens cover.
    for (let k = i; k <= j; k++) {
      const tk = toks[k] ?? 0;
      const s0 = d.tokStart[tk] ?? 0;
      const s1 = d.tokEnd[tk] ?? 0;
      const wEnd = d.unitWord[u + 1] ?? 0;
      for (let w = d.tokWord[tk] ?? 0; w < wEnd; w++) {
        const off = d.wordOff[w] ?? 0;
        const len = d.wordLen[w] ?? 0;
        if (off >= s1) break;
        const c0 = Math.max(s0, off);
        const c1 = Math.min(s1, off + len);
        if (c1 <= c0 && len > 0) continue;
        let x0 = d.wordBox[w * 4] ?? 0;
        const y0 = d.wordBox[w * 4 + 1] ?? 0;
        let x1 = d.wordBox[w * 4 + 2] ?? 0;
        const y1 = d.wordBox[w * 4 + 3] ?? 0;
        if (len > 0 && (c0 > off || c1 < off + len)) {
          // Part of a word (a character of a script without spaces): its share of the width.
          const f0 = (c0 - off) / len;
          const f1 = (c1 - off) / len;
          const wd = x1 - x0;
          if ((d.wordFlags[w] ?? 0) & WORD_RTL) {
            [x0, x1] = [x1 - f1 * wd, x1 - f0 * wd];
          } else [x0, x1] = [x0 + f0 * wd, x0 + f1 * wd];
        }
        const ln = d.wordLine[w] ?? -1;
        const prev = rects[rects.length - 1];
        if (prev && ln === line) {
          prev.x0 = Math.min(prev.x0, x0);
          prev.y0 = Math.min(prev.y0, y0);
          prev.x1 = Math.max(prev.x1, x1);
          prev.y1 = Math.max(prev.y1, y1);
        } else rects.push({ page: d.wordPage[w] ?? 0, x0, y0, x1, y1 });
        line = ln;
      }
    }
    i = j + 1;
  }
  const first = toks[0] ?? 0;
  return {
    page: d.wordPage[d.tokWord[first] ?? 0] ?? 0,
    text: parts.join(' ¶ '),
    t0: first,
    t1: (toks[n - 1] ?? 0) + 1,
    rects,
  };
}

/** Tokens split where their paragraph changes. */
function byUnit(unitOf: Int32Array, toks: Int32Array): Int32Array[] {
  const out: Int32Array[] = [];
  let from = 0;
  for (let k = 1; k <= toks.length; k++)
    if (k === toks.length || unitOf[toks[k] ?? 0] !== unitOf[toks[k - 1] ?? 0]) {
      out.push(toks.subarray(from, k));
      from = k;
    }
  return out;
}

function dice(a: Int32Array, b: Int32Array): number {
  if (!a.length || !b.length) return 0;
  const m = new Map<number, number>();
  for (const k of a) m.set(k, (m.get(k) ?? 0) + 1);
  let common = 0;
  for (const k of b) {
    const c = m.get(k) ?? 0;
    if (c > 0) {
      common++;
      m.set(k, c - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

/** Keys of the number-like tokens (numbers, values, tags, dates) of two streams. */
function numericKeys(A: TextDoc, fa: Int32Array, B: TextDoc, fb: Int32Array): Set<number> {
  const out = new Set<number>();
  const wordish = (k: number): boolean => k === KIND_WORD || k === KIND_CHAR || k === KIND_PUNCT;
  for (const t of fa) if (!wordish(A.tokKind[t] ?? 0)) out.add(A.tokKey[t] ?? -1);
  for (const t of fb) if (!wordish(B.tokKind[t] ?? 0)) out.add(B.tokKey[t] ?? -1);
  return out;
}

const keysOf = (d: TextDoc, toks: Int32Array): Int32Array => toks.map((t) => d.tokKey[t] ?? -1);

/** Percent change: a single number against a single number. */
function labelNumbers(c: TextChange, A: TextDoc, B: TextDoc, ta: Int32Array, tb: Int32Array): void {
  if (ta.length !== 1 || tb.length !== 1) return;
  const x = A.tokNum[ta[0] ?? 0] ?? Number.NaN;
  const y = B.tokNum[tb[0] ?? 0] ?? Number.NaN;
  if (Number.isNaN(x) || Number.isNaN(y)) return;
  const p = percentChange(x, y);
  if (p !== undefined) c.pct = Math.round(p * 100) / 100;
}

/** Tokens of units, in order. */
function tokensOfUnits(d: TextDoc, units: readonly number[]): Int32Array {
  let n = 0;
  for (const u of units) n += (d.unitTok[u + 1] ?? 0) - (d.unitTok[u] ?? 0);
  const out = new Int32Array(n);
  let k = 0;
  for (const u of units)
    for (let t = d.unitTok[u] ?? 0; t < (d.unitTok[u + 1] ?? 0); t++) out[k++] = t;
  return out;
}

class Matcher {
  readonly A: Side;
  readonly B: Side;
  readonly o: TextMatchOptions;

  constructor(A: TextDoc, B: TextDoc, o: TextMatchOptions) {
    this.A = { d: A, unitOf: tokenUnits(A) };
    this.B = { d: B, unitOf: tokenUnits(B) };
    this.o = o;
  }

  /**
   * Word-level changes between two token streams. `endB` is B's token index
   * where the stream ends (where a deletion at its end sits).
   */
  words(fa: Int32Array, fb: Int32Array, gap: number, endB: number, out: Raw[]): void {
    const { A, B } = this;
    // A short stretch gets the true longest common subsequence; a long one is
    // cut at unique words first (bounded time). Numbers are never anchors: a
    // renumbered clause keeps its old number unique on the other side.
    const exact = fa.length + fb.length <= EXACT_WORDS;
    const hs: Hunk[] = diff(
      keysOf(A.d, fa),
      keysOf(B.d, fb),
      exact ? { anchors: false } : { noAnchor: numericKeys(A.d, fa, B.d, fb) },
    );
    const posB = (k: number): number => (k < fb.length ? (fb[k] ?? 0) : endB);
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      if (!h || h.op === '=') continue;
      const nx = hs[i + 1];
      if (h.op === '-' && nx?.op === '+') {
        const ta = fa.subarray(h.a0, h.a1);
        const tb = fb.subarray(nx.b0, nx.b1);
        // A replacement across paragraphs (neighbouring cells of a table read
        // as text) is one change a paragraph when both sides have as many.
        const pa = byUnit(A.unitOf, ta);
        const pb = byUnit(B.unitOf, tb);
        const parts: [Int32Array, Int32Array][] =
          pa.length > 1 && pa.length === pb.length
            ? pa.map((x, k): [Int32Array, Int32Array] => [x, pb[k] ?? tb])
            : [[ta, tb]];
        for (const [xa, xb] of parts) {
          const change: TextChange = { kind: 'replaced', a: spanOf(A, xa), b: spanOf(B, xb) };
          labelNumbers(change, A.d, B.d, xa, xb);
          out.push({ change, ta: xa, tb: xb, gap, atB: xb[0] ?? posB(nx.b0), atA: xa[0] ?? 0 });
        }
        i++;
      } else if (h.op === '-') {
        const ta = fa.subarray(h.a0, h.a1);
        out.push({
          change: { kind: 'deleted', a: spanOf(A, ta) },
          ta,
          tb: new Int32Array(0),
          gap,
          atB: posB(h.b0),
          atA: ta[0] ?? 0,
        });
      } else {
        const tb = fb.subarray(h.b0, h.b1);
        out.push({
          change: { kind: 'inserted', b: spanOf(B, tb) },
          ta: new Int32Array(0),
          tb,
          gap,
          atB: tb[0] ?? 0,
          atA: fa[h.a0] ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }

  /** The edits inside a move, in order. */
  inner(ta: Int32Array, tb: Int32Array): TextChange[] {
    const raw: Raw[] = [];
    this.words(ta, tb, -1, (tb[tb.length - 1] ?? 0) + 1, raw);
    return raw.map((r) => r.change);
  }

  run(): TextComparison {
    const t0 = performance.now();
    const { A, B, o } = this;
    const ka = A.d.unitKey;
    const kb = B.d.unitKey;
    const um = matches(ka, kb);
    const raw: Raw[] = [];
    const blocks = o.moves === false ? [] : moveBlocks(A.d, B.d, um, o.minMove ?? MIN_MOVE);
    const movedA = new Set(blocks.flatMap((b) => b.a));
    const movedB = new Set(blocks.flatMap((b) => b.b));
    let gap = 0;
    const gapOf = (a0: number, a1: number, b0: number, b1: number): void => {
      if (a1 <= a0 && b1 <= b0) return;
      const ia: number[] = [];
      const ib: number[] = [];
      for (let i = a0; i < a1; i++) if (!movedA.has(i)) ia.push(i);
      for (let j = b0; j < b1; j++) if (!movedB.has(j)) ib.push(j);
      if (!ia.length && !ib.length) return;
      o.checkpoint?.();
      const endB = B.d.unitTok[b1] ?? tokenCount(B.d);
      this.words(tokensOfUnits(A.d, ia), tokensOfUnits(B.d, ib), gap, endB, raw);
      gap++;
    };
    let pa = 0;
    let pb = 0;
    for (const [i, j] of um) {
      gapOf(pa, i, pb, j);
      pa = i + 1;
      pb = j + 1;
    }
    gapOf(pa, unitCount(A.d), pb, unitCount(B.d));

    let out: Raw[] = raw;
    if (o.moves !== false) out = this.findMoves(raw, o.minMove ?? MIN_MOVE);
    for (const blk of blocks) {
      const ta = tokensOfUnits(A.d, blk.a);
      const tb = tokensOfUnits(B.d, blk.b);
      out.push({
        change: { kind: 'moved', a: spanOf(A, ta), b: spanOf(B, tb), inner: this.inner(ta, tb) },
        ta,
        tb,
        gap: -1,
        atB: tb[0] ?? 0,
        atA: ta[0] ?? 0,
      });
    }
    if (o.headersFooters !== false) out.push(...hfChanges(A.d.hf, B.d.hf));
    out.sort((x, y) => x.atB - y.atB || x.atA - y.atA);

    // Content sync points: each paragraph matched whole, its first word on both sides.
    const sync = new Float32Array(um.length * 4);
    um.forEach(([i, j], k) => {
      const wa = A.d.unitWord[i] ?? 0;
      const wb = B.d.unitWord[j] ?? 0;
      sync.set(
        [
          A.d.wordPage[wa] ?? 0,
          A.d.wordBox[wa * 4 + 1] ?? 0,
          B.d.wordPage[wb] ?? 0,
          B.d.wordBox[wb * 4 + 1] ?? 0,
        ],
        k * 4,
      );
    });
    return {
      changes: out.map((r) => r.change),
      sync,
      limited: { a: A.d.empty, b: B.d.empty },
      stats: {
        units: [unitCount(A.d), unitCount(B.d)],
        tokens: [tokenCount(A.d), tokenCount(B.d)],
        matched: um.length,
        ms: performance.now() - t0,
      },
    };
  }

  /** A long deleted run and a long inserted run in another gap, nearly the same: one move. */
  findMoves(raw: Raw[], minMove: number): Raw[] {
    const { A, B } = this;
    const dels = raw.filter((r) => r.ta.length >= minMove);
    const ins = raw.filter((r) => r.tb.length >= minMove);
    const cand: { d: Raw; i: Raw; s: number }[] = [];
    for (const d of dels) {
      const ka = keysOf(A.d, d.ta);
      for (const i of ins) {
        if (i === d || i.gap === d.gap) continue;
        const nb = i.tb.length;
        if (nb > 2 * d.ta.length || d.ta.length > 2 * nb) continue;
        const s = dice(ka, keysOf(B.d, i.tb));
        if (s >= MOVE_SIMILARITY) cand.push({ d, i, s });
      }
    }
    if (cand.length === 0) return raw;
    cand.sort((x, y) => y.s - x.s);
    const used = new Set<Raw>();
    const moves: Raw[] = [];
    const none = new Int32Array(0);
    for (const { d, i } of cand) {
      if (used.has(d) || used.has(i)) continue;
      used.add(d);
      used.add(i);
      moves.push({
        change: {
          kind: 'moved',
          a: spanOf(A, d.ta),
          b: spanOf(B, i.tb),
          inner: this.inner(d.ta, i.tb),
        },
        ta: d.ta,
        tb: i.tb,
        gap: -1,
        atB: i.atB,
        atA: d.atA,
      });
      // What the replaced halves leave behind stays a change of its own.
      if (d.change.kind === 'replaced' && d.tb.length)
        moves.push({
          change: { kind: 'inserted', b: spanOf(B, d.tb) },
          ta: none,
          tb: d.tb,
          gap: d.gap,
          atB: d.atB,
          atA: d.atA,
        });
      if (i.change.kind === 'replaced' && i.ta.length)
        moves.push({
          change: { kind: 'deleted', a: spanOf(A, i.ta) },
          ta: i.ta,
          tb: none,
          gap: i.gap,
          atB: i.atB,
          atA: i.atA,
        });
    }
    return [...raw.filter((r) => !used.has(r)), ...moves];
  }
}

/**
 * Paragraphs that are the same in both revisions but out of order (the unit
 * match could not keep them), in blocks of consecutive paragraphs, each block
 * grown by the nearly identical paragraphs next to it (a moved section whose
 * text was also edited). Blocks shorter than `minMove` tokens are left to the
 * word level.
 */
export function moveBlocks(
  A: TextDoc,
  B: TextDoc,
  um: readonly [number, number][],
  minMove: number,
): { a: number[]; b: number[] }[] {
  const mA = new Set(um.map((m) => m[0]));
  const mB = new Set(um.map((m) => m[1]));
  const freeB = new Map<number, number[]>();
  for (let j = 0; j < unitCount(B); j++) {
    if (mB.has(j)) continue;
    const k = B.unitKey[j] ?? -1;
    const list = freeB.get(k);
    if (list) list.push(j);
    else freeB.set(k, [j]);
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < unitCount(A); i++) {
    if (mA.has(i)) continue;
    const j = freeB.get(A.unitKey[i] ?? -1)?.shift();
    if (j !== undefined) pairs.push([i, j]);
  }
  // The gap of a unit: the matched units before it. A block that stays in its
  // gap is not a move (repeated paragraphs paired across the gap): the word
  // level compares it in place.
  const gapOf = (matched: Set<number>, n: number): Int32Array => {
    const g = new Int32Array(n);
    let k = 0;
    for (let u = 0; u < n; u++) {
      if (matched.has(u)) k++;
      g[u] = k;
    }
    return g;
  };
  const gapA = gapOf(mA, unitCount(A));
  const gapB = gapOf(mB, unitCount(B));
  const usedA = new Set(pairs.map((p) => p[0]));
  const usedB = new Set(pairs.map((p) => p[1]));
  const blocks: { a: number[]; b: number[] }[] = [];
  for (const [i, j] of pairs) {
    const last = blocks[blocks.length - 1];
    if (last?.a[last.a.length - 1] === i - 1 && last.b[last.b.length - 1] === j - 1) {
      last.a.push(i);
      last.b.push(j);
    } else blocks.push({ a: [i], b: [j] });
  }
  const unitKeys = (d: TextDoc, u: number): Int32Array =>
    d.tokKey.subarray(d.unitTok[u] ?? 0, d.unitTok[u + 1] ?? 0);
  const near = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= unitCount(A) || j >= unitCount(B)) return false;
    if (mA.has(i) || mB.has(j) || usedA.has(i) || usedB.has(j)) return false;
    return dice(unitKeys(A, i), unitKeys(B, j)) >= NEAR_BLOCK;
  };
  for (const b of blocks) {
    for (;;) {
      const i = (b.a[0] ?? 0) - 1;
      const j = (b.b[0] ?? 0) - 1;
      if (!near(i, j)) break;
      b.a.unshift(i);
      b.b.unshift(j);
      usedA.add(i);
      usedB.add(j);
    }
    for (;;) {
      const i = (b.a[b.a.length - 1] ?? 0) + 1;
      const j = (b.b[b.b.length - 1] ?? 0) + 1;
      if (!near(i, j)) break;
      b.a.push(i);
      b.b.push(j);
      usedA.add(i);
      usedB.add(j);
    }
  }
  // Blocks next to each other on both sides (after growing) join.
  const joined: { a: number[]; b: number[] }[] = [];
  for (const b of blocks.sort((x, y) => (x.a[0] ?? 0) - (y.a[0] ?? 0))) {
    const last = joined[joined.length - 1];
    if (
      last?.a[last.a.length - 1] === (b.a[0] ?? 0) - 1 &&
      last.b[last.b.length - 1] === (b.b[0] ?? 0) - 1
    ) {
      last.a.push(...b.a);
      last.b.push(...b.b);
    } else joined.push({ a: [...b.a], b: [...b.b] });
  }
  const size = (d: TextDoc, us: number[]): number =>
    us.reduce((s, u) => s + (d.unitTok[u + 1] ?? 0) - (d.unitTok[u] ?? 0), 0);
  const inPlace = (b: { a: number[]; b: number[] }): boolean =>
    gapA[b.a[0] ?? 0] === gapB[b.b[0] ?? 0];
  return joined.filter((b) => size(A, b.a) >= minMove && !inPlace(b));
}

/**
 * Changed headers and footers, once each (not on every page): the groups'
 * templates of each band compared word by word. They head the list.
 */
function hfChanges(ga: readonly HfGroup[], gb: readonly HfGroup[]): Raw[] {
  const out: Raw[] = [];
  const none = new Int32Array(0);
  for (const band of ['top', 'bottom'] as const) {
    const kind = band === 'top' ? 'header' : 'footer';
    const sa = ga.filter((g) => g.band === band).sort((x, y) => x.y - y.y);
    const sb = gb.filter((g) => g.band === band).sort((x, y) => x.y - y.y);
    const ta = sa.flatMap((g) => g.template);
    const tb = sb.flatMap((g) => g.template);
    const intern = new Interner();
    const hs = diff(
      ta.map((k) => intern.id(k)),
      tb.map((k) => intern.id(k)),
    );
    const span = (gs: readonly HfGroup[], text: string): TextSpan => {
      const g = gs[0];
      const [x0, y0, x1, y1] = g?.box ?? [0, 0, 0, 0];
      return {
        page: g?.page ?? 0,
        text,
        t0: -1,
        t1: -1,
        rects: g ? [{ page: g.page, x0, y0, x1, y1 }] : [],
      };
    };
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i];
      if (!h || h.op === '=') continue;
      const nx = hs[i + 1];
      const change: TextChange = { kind };
      if (h.op === '-') change.a = span(sa, ta.slice(h.a0, h.a1).join(' '));
      if (h.op === '-' && nx?.op === '+') {
        change.b = span(sb, tb.slice(nx.b0, nx.b1).join(' '));
        i++;
      } else if (h.op === '+') change.b = span(sb, tb.slice(h.b0, h.b1).join(' '));
      out.push({ change, ta: none, tb: none, gap: -2, atB: -1, atA: band === 'top' ? -2 : -1 });
    }
  }
  return out;
}

/** Compares two revisions (D-63): the changes in B's reading order. */
export function matchText(A: TextDoc, B: TextDoc, o: TextMatchOptions = {}): TextComparison {
  return new Matcher(A, B, o).run();
}
