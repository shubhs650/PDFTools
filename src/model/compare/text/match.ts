// Matching two revisions of a document (M12-17, M12-18, D-63, spike S30).
// Pure code.
//
// 1. Units (paragraphs, table rows, figures) are matched by their whole key:
//    unique units as anchors, then Myers between them (myers.ts); with
//    renumbering, also units equal or nearly equal once their clause numbers
//    are masked (renumber.ts).
// 2. Between two matched units, the paragraphs left on each side are compared
//    word by word as one stream, so a paragraph split or joined by reflow, a
//    column or a page break costs nothing; table rows are matched by their
//    name, then cell by cell; figures as pictures.
// 3. A deleted block and an inserted block elsewhere that are the same or
//    nearly the same become one **move**, with the edits inside it.
// 4. A number replaced by a number gets its percent change; text read by OCR
//    is labelled, and a difference that is only a typical OCR confusion is a
//    "possible OCR error" (never hidden).
// 5. Headers and footers are reported once; clause renumbering is folded
//    into one entry per run of clauses, with the references that do not
//    follow it (experimental).
import { WORD_CELL, WORD_RTL } from './layout';
import type { HfGroup } from './headers';
import { Interner, diff, matches, type Hunk } from './myers';
import {
  UNIT_FIGURE,
  UNIT_OCR,
  UNIT_PARA,
  UNIT_ROW,
  tokenCount,
  unitCount,
  type TextDoc,
} from './document';
import {
  alignUnits,
  clausesOf,
  isOwn,
  clauseText,
  mapped,
  pairsOf,
  renumbering,
  type ClausePair,
  type UnitAlignment,
} from './renumber';
import { kindCode, ocrFold, percentChange } from './tokens';

const KIND_WORD = kindCode('word');
const KIND_CHAR = kindCode('char');
const KIND_PUNCT = kindCode('punct');

export type TextChangeKind =
  | 'inserted'
  | 'deleted'
  | 'replaced'
  | 'moved'
  | 'header'
  | 'footer'
  /** A changed figure: a picture replaced by another (D-63). */
  | 'figure'
  /** Clauses renumbered alike, reported once (experimental). */
  | 'renumbered'
  /** A cross-reference that does not follow the renumbering. */
  | 'reference';

/** Where a change in a table sits (D-63, Q30). */
export interface TableAt {
  /** The row's name (its first cell; with the next when the first is a short item number). */
  row: string;
  /** A header row of the table. */
  head?: boolean;
  /** The changed cell's column (0-based) and its name from the header rows; none: the whole row. */
  column?: number;
  col?: string;
}

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
  /** A change inside a table: its row, and its cell's column. */
  table?: TableAt;
  /** On text read by OCR ('ocr'), or only a typical OCR confusion ('ocr-error'). */
  ocr?: 'ocr' | 'ocr-error';
  /** A figure: how different the two pictures look (thumbnails, mean difference 0–255). */
  figure?: { diff?: number };
  /** Renumbered: own numbers shifted and cross-references that follow, in the whole comparison. */
  renumber?: { shifted: number; follow: number };
  /** A reference that does not follow: what it should cite under the renumbering. */
  reference?: { expected: string };
}

export interface TextMatchOptions {
  /** Detect moves (default true). */
  moves?: boolean;
  /** Report a changed header or footer once (default true; the documents leave them out). */
  headersFooters?: boolean;
  /** Fold clause renumbering into one entry (default true; experimental). */
  renumbering?: boolean;
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
  /** Of those, the scans OCR could read (offered when Compare is pressed, D-63, Q29). */
  scanned: { a: number[]; b: number[] };
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
        if (len > 0 && !((d.wordFlags[w] ?? 0) & WORD_CELL) && (c0 > off || c1 < off + len)) {
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

/** Mean absolute difference of two thumbnails (0–255). */
function thumbDiff(a: Uint8Array, b: Uint8Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return n ? s / n : 0;
}

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
          this.labelOcr(change, xa, xb);
          out.push({ change, ta: xa, tb: xb, gap, atB: xb[0] ?? posB(nx.b0), atA: xa[0] ?? 0 });
        }
        i++;
      } else if (h.op === '-') {
        const ta = fa.subarray(h.a0, h.a1);
        const change: TextChange = { kind: 'deleted', a: spanOf(A, ta) };
        this.labelOcr(change, ta, ta.subarray(0, 0));
        out.push({
          change,
          ta,
          tb: new Int32Array(0),
          gap,
          atB: posB(h.b0),
          atA: ta[0] ?? 0,
        });
      } else {
        const tb = fb.subarray(h.b0, h.b1);
        const change: TextChange = { kind: 'inserted', b: spanOf(B, tb) };
        this.labelOcr(change, tb.subarray(0, 0), tb);
        out.push({
          change,
          ta: new Int32Array(0),
          tb,
          gap,
          atB: tb[0] ?? 0,
          atA: fa[h.a0] ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }

  /**
   * "From OCR" when either side's text was read by OCR; "possible OCR error"
   * when the two texts are the same under the typical confusions (0 and O,
   * 1 and l, rn and m, …; spacing ignored).
   */
  labelOcr(c: TextChange, ta: Int32Array, tb: Int32Array): void {
    const { A, B } = this;
    const ocrA =
      ta.length > 0 && ((A.d.unitFlags[A.unitOf[ta[0] ?? 0] ?? 0] ?? 0) & UNIT_OCR) !== 0;
    const ocrB =
      tb.length > 0 && ((B.d.unitFlags[B.unitOf[tb[0] ?? 0] ?? 0] ?? 0) & UNIT_OCR) !== 0;
    if (!ocrA && !ocrB) return;
    c.ocr = 'ocr';
    const fold = (t?: TextSpan): string => ocrFold((t?.text ?? '').replace(/[\s¶]+/gu, ''));
    if (c.a && c.b && fold(c.a) === fold(c.b)) c.ocr = 'ocr-error';
  }

  /**
   * Table rows of a gap (D-63, Q30): matched by their name, then by likeness
   * in order; a matched row's cells compared in place, each changed cell one
   * change with its row and column; a row left over is one change.
   */
  rows(ia: readonly number[], ib: readonly number[], gap: number, endB: number, out: Raw[]): void {
    const { A, B } = this;
    const intern = new Interner();
    const name = (d: TextDoc, u: number): number => {
      const r = d.rows.get(u);
      return intern.id(r?.head ? `H:${r.cells.join('|')}` : `L:${r?.cells[0] ?? ''}`);
    };
    const pairs: [number, number][] = matches(
      ia.map((u) => name(A.d, u)),
      ib.map((u) => name(B.d, u)),
    ).map(([x, y]) => [ia[x] ?? 0, ib[y] ?? 0]);
    const usedA = new Set(pairs.map((p) => p[0]));
    const usedB = new Set(pairs.map((p) => p[1]));
    const keys = (d: TextDoc, u: number): Int32Array =>
      d.tokKey.subarray(d.unitTok[u] ?? 0, d.unitTok[u + 1] ?? 0);
    for (const i of ia) {
      if (usedA.has(i)) continue;
      let best = -1;
      let bs = 0.5;
      for (const j of ib) {
        if (usedB.has(j)) continue;
        const sc = dice(keys(A.d, i), keys(B.d, j));
        if (sc > bs) {
          bs = sc;
          best = j;
        }
      }
      if (best >= 0) {
        pairs.push([i, best]);
        usedA.add(i);
        usedB.add(best);
      }
    }
    const range = (from: number, to: number): Int32Array => {
      const r = new Int32Array(Math.max(0, to - from));
      for (let k = 0; k < r.length; k++) r[k] = from + k;
      return r;
    };
    for (const [i, j] of pairs) {
      const ra = A.d.rows.get(i);
      const rb = B.d.rows.get(j);
      if (!ra || !rb) continue;
      const n = Math.max(ra.cells.length, rb.cells.length);
      for (let col = 0; col < n; col++) {
        const ta = range(ra.cellTok[col * 2] ?? 0, ra.cellTok[col * 2 + 1] ?? 0);
        const tb = range(rb.cellTok[col * 2] ?? 0, rb.cellTok[col * 2 + 1] ?? 0);
        const ka = keysOf(A.d, ta);
        const kb = keysOf(B.d, tb);
        if (ka.length === kb.length && ka.every((k, x) => k === kb[x])) continue;
        const name = rb.header[col] ?? ra.header[col];
        const change: TextChange = {
          kind: ta.length && tb.length ? 'replaced' : ta.length ? 'deleted' : 'inserted',
          table: {
            row: rb.label || ra.label,
            ...(rb.head || ra.head ? { head: true } : {}),
            column: col,
            ...(name ? { col: name } : {}),
          },
        };
        if (ta.length) change.a = spanOf(A, ta);
        if (tb.length) change.b = spanOf(B, tb);
        labelNumbers(change, A.d, B.d, ta, tb);
        this.labelOcr(change, ta, tb);
        out.push({
          change,
          ta,
          tb,
          gap,
          atB: tb[0] ?? B.d.unitTok[j] ?? endB,
          atA: ta[0] ?? A.d.unitTok[i] ?? 0,
        });
      }
    }
    const none = new Int32Array(0);
    for (const i of ia)
      if (!usedA.has(i)) {
        const r = A.d.rows.get(i);
        const ta = range(A.d.unitTok[i] ?? 0, A.d.unitTok[i + 1] ?? 0);
        const change: TextChange = {
          kind: 'deleted',
          a: spanOf(A, ta),
          table: { row: r?.label ?? '', ...(r?.head ? { head: true } : {}) },
        };
        this.labelOcr(change, ta, none);
        out.push({ change, ta, tb: none, gap, atB: endB, atA: ta[0] ?? 0 });
      }
    for (const j of ib)
      if (!usedB.has(j)) {
        const r = B.d.rows.get(j);
        const tb = range(B.d.unitTok[j] ?? 0, B.d.unitTok[j + 1] ?? 0);
        const change: TextChange = {
          kind: 'inserted',
          b: spanOf(B, tb),
          table: { row: r?.label ?? '', ...(r?.head ? { head: true } : {}) },
        };
        this.labelOcr(change, none, tb);
        out.push({ change, ta: none, tb, gap, atB: tb[0] ?? endB, atA: Number.MAX_SAFE_INTEGER });
      }
  }

  /** Figures of a gap, in order (D-63): a changed figure, or one added or removed. */
  figures(
    ia: readonly number[],
    ib: readonly number[],
    gap: number,
    endB: number,
    out: Raw[],
  ): void {
    const { A, B } = this;
    const none = new Int32Array(0);
    const span = (d: TextDoc, u: number): TextSpan => {
      const f = d.figures.get(u);
      const [x0, y0, x1, y1] = f?.box ?? [0, 0, 0, 0];
      const page = f?.page ?? d.unitPage[u] ?? 0;
      return { page, text: '', t0: -1, t1: -1, rects: [{ page, x0, y0, x1, y1 }] };
    };
    const n = Math.max(ia.length, ib.length);
    for (let k = 0; k < n; k++) {
      const i = ia[k];
      const j = ib[k];
      const change: TextChange = {
        kind:
          i !== undefined && j !== undefined ? 'figure' : i !== undefined ? 'deleted' : 'inserted',
        figure: {},
      };
      if (i !== undefined) change.a = span(A.d, i);
      if (j !== undefined) change.b = span(B.d, j);
      const fa = i !== undefined ? A.d.figures.get(i) : undefined;
      const fb = j !== undefined ? B.d.figures.get(j) : undefined;
      if (fa && fb) change.figure = { diff: Math.round(thumbDiff(fa.thumb, fb.thumb) * 10) / 10 };
      // Placed by the units around it: the next word after it on each side.
      const atB = j !== undefined ? (B.d.unitTok[j] ?? endB) : endB;
      const atA = i !== undefined ? (A.d.unitTok[i] ?? 0) : Number.MAX_SAFE_INTEGER;
      out.push({ change, ta: none, tb: none, gap, atB, atA });
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
    const al: UnitAlignment = alignUnits(A.d, B.d);
    const bounds = [...al.exact, ...al.relabelled, ...al.near].sort((x, y) => x[0] - y[0]);
    // Pairs compared word by word: renumbered and edited; and, with the
    // renumbering switch off, every renumbered clause (each number shows).
    const fold = o.renumbering !== false;
    const nearA = new Set([...al.near, ...(fold ? [] : al.relabelled)].map((p) => p[0]));
    const raw: Raw[] = [];
    const blocks = o.moves === false ? [] : moveBlocks(A.d, B.d, bounds, o.minMove ?? MIN_MOVE);
    const movedA = new Set(blocks.flatMap((b) => b.a));
    const movedB = new Set(blocks.flatMap((b) => b.b));
    let gap = 0;
    const gapOf = (a0: number, a1: number, b0: number, b1: number): void => {
      if (a1 <= a0 && b1 <= b0) return;
      const ia: number[][] = [[], [], []];
      const ib: number[][] = [[], [], []];
      for (let i = a0; i < a1; i++) if (!movedA.has(i)) ia[A.d.unitKind[i] ?? 0]?.push(i);
      for (let j = b0; j < b1; j++) if (!movedB.has(j)) ib[B.d.unitKind[j] ?? 0]?.push(j);
      if (!ia.some((x) => x.length) && !ib.some((x) => x.length)) return;
      o.checkpoint?.();
      const endB = B.d.unitTok[b1] ?? tokenCount(B.d);
      const pa = ia[UNIT_PARA] ?? [];
      const pb = ib[UNIT_PARA] ?? [];
      if (pa.length || pb.length)
        this.words(tokensOfUnits(A.d, pa), tokensOfUnits(B.d, pb), gap, endB, raw);
      const ra = ia[UNIT_ROW] ?? [];
      const rb = ib[UNIT_ROW] ?? [];
      if (ra.length || rb.length) this.rows(ra, rb, gap, endB, raw);
      const fa = ia[UNIT_FIGURE] ?? [];
      const fb = ib[UNIT_FIGURE] ?? [];
      if (fa.length || fb.length) this.figures(fa, fb, gap, endB, raw);
      gap++;
    };
    let pa = 0;
    let pb = 0;
    for (const [i, j] of bounds) {
      gapOf(pa, i, pb, j);
      // A renumbered clause that was also edited: its words, as a pair.
      if (nearA.has(i)) gapOf(i, i + 1, j, j + 1);
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
    if (fold) out = this.foldRenumbering(out, al);
    out.sort((x, y) => x.atB - y.atB || x.atA - y.atA);

    // Content sync points: each paragraph matched whole, its first word on both sides.
    const synced = [...al.exact, ...al.relabelled].sort((x, y) => x[0] - y[0]);
    const sync = new Float32Array(synced.length * 4);
    synced.forEach(([i, j], k) => {
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
      scanned: { a: A.d.scanned, b: B.d.scanned },
      stats: {
        units: [unitCount(A.d), unitCount(B.d)],
        tokens: [tokenCount(A.d), tokenCount(B.d)],
        matched: synced.length,
        ms: performance.now() - t0,
      },
    };
  }

  /**
   * Clause renumbering (experimental, renumber.ts): number changes that
   * follow the map leave the list; each run of clauses shifted alike is one
   * entry; references that do not follow are listed, also in unchanged text.
   */
  foldRenumbering(changes: Raw[], al: UnitAlignment): Raw[] {
    const { A, B } = this;
    const fromChanges = new Map<Raw, ClausePair>();
    for (const r of changes) {
      const c = r.change;
      if (c.kind !== 'replaced' || c.table || r.ta.length !== 1 || r.tb.length !== 1) continue;
      const ta = r.ta[0] ?? 0;
      const tb = r.tb[0] ?? 0;
      const i = A.unitOf[ta] ?? 0;
      const j = B.unitOf[tb] ?? 0;
      if (!clausesOf(A.d, i).includes(ta) || !clausesOf(B.d, j).includes(tb)) continue;
      fromChanges.set(r, {
        a: clauseText(A.d, ta),
        b: clauseText(B.d, tb),
        i,
        j,
        ta,
        tb,
        own: isOwn(A.d, i, ta),
      });
    }
    const all = [
      ...al.relabelled.flatMap(([i, j]) => pairsOf(A.d, B.d, i, j)),
      ...fromChanges.values(),
    ];
    const rn = renumbering(all);
    if (!rn) return changes;
    const out = changes.filter((r) => {
      const p = fromChanges.get(r);
      return !(p && rn.follows(p.a, p.b));
    });
    for (const g of rn.groups) {
      const f = g[0];
      const l = g[g.length - 1];
      if (!f || !l) continue;
      const a = spanOf(
        A,
        Int32Array.from(g, (p) => p.ta),
      );
      const b = spanOf(
        B,
        Int32Array.from(g, (p) => p.tb),
      );
      a.text = g.length > 1 ? `${f.a}–${l.a}` : f.a;
      b.text = g.length > 1 ? `${f.b}–${l.b}` : f.b;
      out.push({
        change: { kind: 'renumbered', a, b, renumber: { shifted: rn.shifted, follow: rn.follow } },
        ta: new Int32Array(0),
        tb: new Int32Array(0),
        gap: -1,
        atB: f.tb,
        atA: f.ta,
      });
    }
    const reference = (p: ClausePair, expected: string): Raw => ({
      change: {
        kind: 'reference',
        a: spanOf(A, Int32Array.of(p.ta)),
        b: spanOf(B, Int32Array.of(p.tb)),
        reference: { expected },
      },
      ta: new Int32Array(0),
      tb: new Int32Array(0),
      gap: -1,
      atB: p.tb,
      atA: p.ta,
    });
    // References that do not follow, in renumbered or changed units.
    for (const p of all)
      if (!p.own && !rn.follows(p.a, p.b)) out.push(reference(p, mapped(rn.map, p.a) ?? p.a));
    // References in text that did not change at all.
    for (const [i, j] of al.exact) {
      const ca = clausesOf(A.d, i);
      const cb = clausesOf(B.d, j);
      ca.forEach((ta, k) => {
        if (k === 0 && isOwn(A.d, i, ta)) return;
        const a = clauseText(A.d, ta);
        const to = mapped(rn.map, a);
        if (to === undefined || to === a) return;
        out.push(reference({ a, b: a, i, j, ta, tb: cb[k] ?? ta, own: false }, to));
      });
    }
    return out;
  }

  /** A long deleted run and a long inserted run in another gap, nearly the same: one move. */
  findMoves(raw: Raw[], minMove: number): Raw[] {
    const { A, B } = this;
    const text = (r: Raw): boolean => !r.change.table && !r.change.figure;
    const dels = raw.filter((r) => r.ta.length >= minMove && text(r));
    const ins = raw.filter((r) => r.tb.length >= minMove && text(r));
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
    if (mB.has(j) || B.unitKind[j] !== UNIT_PARA) continue;
    const k = B.unitKey[j] ?? -1;
    const list = freeB.get(k);
    if (list) list.push(j);
    else freeB.set(k, [j]);
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < unitCount(A); i++) {
    if (mA.has(i) || A.unitKind[i] !== UNIT_PARA) continue;
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
    if (A.unitKind[i] !== UNIT_PARA || B.unitKind[j] !== UNIT_PARA) return false;
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
