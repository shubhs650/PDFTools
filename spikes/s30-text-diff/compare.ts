// Spike S30 (M12-05): matching two revisions (D-63).
//
// 1. Units (paragraphs, table rows, figures) are matched by their whole key:
//    unique units as anchors, then Myers between them (myers.ts).
// 2. Between two matched units, what is left on each side is compared word by
//    word as one stream (so a paragraph split or joined by reflow costs
//    nothing), table rows row by row and cell by cell, figures as pictures.
// 3. A deleted run and an inserted run elsewhere that are nearly the same
//    become one move, with the edits inside it.
// 4. Headers and footers are compared once (their templates), clause
//    renumbering is folded into one entry (renumber.ts), numbers get their
//    percent change, OCR text is labelled.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- indices in range, in hot loops (spike code) */

import { Interner, diff, matches, uniqueMatches, type Hunk } from './myers.ts';
import type { DocText, Unit } from './doc.ts';
import { ocrFold, percentChange, type Token } from './tokens.ts';
import { foldRenumbering } from './renumber.ts';

export type Kind =
  | 'inserted'
  | 'deleted'
  | 'replaced'
  | 'moved'
  | 'figure'
  | 'header'
  | 'footer'
  | 'renumbered'
  | 'reference';

/** A stretch of tokens on one side: from (unit u0, token t0) to (u1, t1), end exclusive. */
export interface Side {
  u0: number;
  t0: number;
  u1: number;
  t1: number;
  text: string;
  page: number;
}

export interface Change {
  kind: Kind;
  a?: Side;
  b?: Side;
  /** A change inside a table: its row label and column name. */
  table?: { row: string; col?: string; whole?: 'row' };
  /** Percent change of a number. */
  pct?: number;
  ocr?: 'from OCR' | 'possible OCR error';
  /** The edits inside a move. */
  inner?: Change[];
  /** How different two figures are (mean absolute difference of thumbnails, 0–255). */
  pictureDiff?: number;
  note?: string;
}

export type DiffFn = (a: ArrayLike<number>, b: ArrayLike<number>) => Hunk[];

export interface CompareOptions {
  /** Report header and footer changes (once). Default true. */
  headersFooters?: boolean;
  /** Fold clause renumbering into one entry. Default true. */
  renumbering?: boolean;
  /** Detect moves. Default true. */
  moves?: boolean;
  /** Smallest run (tokens) that can be a move. */
  minMove?: number;
  /** Word-level difference routine (route 1 by default). */
  diff?: DiffFn;
}

interface Flat {
  u: number;
  t: number;
  tok: Token;
}

const MIN_MOVE = 8;
const MOVE_SIMILARITY = 0.6;

function sideOf(units: readonly Unit[], flat: readonly Flat[], i0: number, i1: number): Side {
  const f0 = flat[i0]!;
  const fl = flat[i1 - 1]!;
  // The text as read: each unit's stretch, units joined with ¶.
  const parts: string[] = [];
  let i = i0;
  while (i < i1) {
    const u = flat[i]!.u;
    let j = i;
    while (j + 1 < i1 && flat[j + 1]!.u === u) j++;
    const src = units[u]?.text ?? '';
    parts.push(src.slice(flat[i]!.tok.start, flat[j]!.tok.end));
    i = j + 1;
  }
  return {
    u0: f0.u,
    t0: f0.t,
    u1: fl.u,
    t1: fl.t + 1,
    text: parts.join(' ¶ '),
    page: units[f0.u]?.page ?? 0,
  };
}

/** A change without its internal gap number. */
function dropGap(c: Change & { gap: number }): Change {
  return Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'gap')) as Change;
}

function dice(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const m = new Map<string, number>();
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

function labelNumbers(c: Change, ta: readonly Token[], tb: readonly Token[]) {
  // Only a number against a number (one token each side).
  const na = ta.filter((t) => t.num !== undefined);
  const nb = tb.filter((t) => t.num !== undefined);
  if (ta.length === 1 && tb.length === 1 && na.length === 1 && nb.length === 1) {
    const p = percentChange(na[0]?.num ?? 0, nb[0]?.num ?? 0);
    if (p !== undefined) c.pct = Math.round(p * 100) / 100;
  }
}

function labelOcr(c: Change, ua: Unit | undefined, ub: Unit | undefined, ta: Token[], tb: Token[]) {
  if (!ua?.ocr && !ub?.ocr) return;
  c.ocr = 'from OCR';
  // Spacing is not a difference for this test ("5O0 mm" against "500mm").
  const fold = (ts: Token[]) => ocrFold(ts.map((t) => t.key).join(''));
  if (ta.length && tb.length && fold(ta) === fold(tb)) c.ocr = 'possible OCR error';
}

/** Word-level changes between two token streams. */
function wordChanges(
  A: DocText,
  B: DocText,
  fa: readonly Flat[],
  fb: readonly Flat[],
  intern: Interner,
  dfn: DiffFn,
  gap: number,
  out: (Change & { gap: number })[],
) {
  const ka = Int32Array.from(fa, (f) => intern.id(f.tok.key));
  const kb = Int32Array.from(fb, (f) => intern.id(f.tok.key));
  const hs = dfn(ka, kb);
  for (let i = 0; i < hs.length; i++) {
    const h = hs[i]!;
    if (h.op === '=') continue;
    const nx = hs[i + 1];
    let c: Change;
    if (h.op === '-' && nx?.op === '+') {
      c = {
        kind: 'replaced',
        a: sideOf(A.units, fa, h.a0, h.a1),
        b: sideOf(B.units, fb, nx.b0, nx.b1),
      };
      const ta = fa.slice(h.a0, h.a1).map((f) => f.tok);
      const tb = fb.slice(nx.b0, nx.b1).map((f) => f.tok);
      labelNumbers(c, ta, tb);
      labelOcr(c, A.units[c.a?.u0 ?? 0], B.units[c.b?.u0 ?? 0], ta, tb);
      i++;
    } else if (h.op === '-') {
      c = { kind: 'deleted', a: sideOf(A.units, fa, h.a0, h.a1) };
      labelOcr(c, A.units[c.a?.u0 ?? 0], undefined, [], []);
    } else {
      c = { kind: 'inserted', b: sideOf(B.units, fb, h.b0, h.b1) };
      labelOcr(c, undefined, B.units[c.b?.u0 ?? 0], [], []);
    }
    out.push({ ...c, gap });
  }
}

/** Rows of a gap: matched by label, then by likeness; cells compared in place. */
function rowChanges(
  A: DocText,
  B: DocText,
  ra: number[],
  rb: number[],
  intern: Interner,
  gap: number,
  out: (Change & { gap: number })[],
) {
  const label = (u: Unit) => u.row?.cells[0] ?? '';
  const ms = matches(
    ra.map((i) => intern.id(`L:${label(A.units[i]!)}`)),
    rb.map((j) => intern.id(`L:${label(B.units[j]!)}`)),
  );
  const pairs: [number, number][] = ms.map(([x, y]) => [ra[x]!, rb[y]!]);
  const usedA = new Set(pairs.map((p) => p[0]));
  const usedB = new Set(pairs.map((p) => p[1]));
  // Leftovers: pair by likeness, in order.
  for (const i of ra) {
    if (usedA.has(i)) continue;
    const ua = A.units[i]!;
    let best = -1;
    let bs = 0.5;
    for (const j of rb) {
      if (usedB.has(j)) continue;
      const s = dice(
        ua.tokens.map((t) => t.key),
        B.units[j]!.tokens.map((t) => t.key),
      );
      if (s > bs) {
        bs = s;
        best = j;
      }
    }
    if (best >= 0) {
      pairs.push([i, best]);
      usedA.add(i);
      usedB.add(best);
    }
  }
  for (const [i, j] of pairs) {
    const ua = A.units[i]!;
    const ub = B.units[j]!;
    const rA = ua.row;
    const rB = ub.row;
    if (!rA || !rB) continue;
    const n = Math.max(rA.cells.length, rB.cells.length);
    for (let c = 0; c < n; c++) {
      const [a0, a1] = rA.cellTok[c] ?? [ua.tokens.length, ua.tokens.length];
      const [b0, b1] = rB.cellTok[c] ?? [ub.tokens.length, ub.tokens.length];
      const ta = ua.tokens.slice(a0, a1);
      const tb = ub.tokens.slice(b0, b1);
      if (ta.map((t) => t.key).join(' ') === tb.map((t) => t.key).join(' ')) continue;
      const side = (u: number, t0: number, t1: number, text: string, page: number): Side => ({
        u0: u,
        t0,
        u1: u,
        t1,
        text,
        page,
      });
      const ch: Change = {
        kind: ta.length && tb.length ? 'replaced' : ta.length ? 'deleted' : 'inserted',
        table: {
          row: rB.label || rA.label,
          col: rB.header[c] ?? rA.header[c] ?? `column ${String(c + 1)}`,
        },
      };
      if (ta.length) ch.a = side(i, a0, a1, rA.cells[c] ?? '', ua.page);
      if (tb.length) ch.b = side(j, b0, b1, rB.cells[c] ?? '', ub.page);
      labelNumbers(ch, ta, tb);
      out.push({ ...ch, gap });
    }
  }
  const whole = (u: Unit, idx: number): Side => ({
    u0: idx,
    t0: 0,
    u1: idx,
    t1: u.tokens.length,
    text: u.text,
    page: u.page,
  });
  for (const i of ra)
    if (!usedA.has(i)) {
      const u = A.units[i]!;
      out.push({
        kind: 'deleted',
        a: whole(u, i),
        table: { row: u.row?.label ?? '', whole: 'row' },
        gap,
      });
    }
  for (const j of rb)
    if (!usedB.has(j)) {
      const u = B.units[j]!;
      out.push({
        kind: 'inserted',
        b: whole(u, j),
        table: { row: u.row?.label ?? '', whole: 'row' },
        gap,
      });
    }
}

function thumbDiff(a: Uint8Array, b: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return s / a.length;
}

export interface Comparison {
  changes: Change[];
  /** Units matched whole. */
  matchedUnits: number;
  ms: { units: number; words: number; moves: number; total: number };
}

export function compare(A: DocText, B: DocText, o: CompareOptions = {}): Comparison {
  const t0 = performance.now();
  const dfn: DiffFn = o.diff ?? ((a, b) => diff(a, b));
  const intern = new Interner();
  const ka = Int32Array.from(A.units, (u) => intern.id(u.key));
  const kb = Int32Array.from(B.units, (u) => intern.id(u.key));
  const { exact: um, relabelled, near } = alignUnits(A, B, ka, kb, intern, o.renumbering !== false);
  const t1 = performance.now();
  const raw: (Change & { gap: number })[] = [];
  // Moved blocks of units (exact matches out of order, grown by near ones).
  const blocks =
    o.moves === false
      ? []
      : moveBlocks(A, B, [...um, ...relabelled, ...near], o.minMove ?? MIN_MOVE);
  const movedA = new Set(blocks.flatMap((b) => b.a));
  const movedB = new Set(blocks.flatMap((b) => b.b));

  let pa = 0;
  let pb = 0;
  let gap = 0;
  const gapOf = (a0: number, a1: number, b0: number, b1: number) => {
    if (a1 <= a0 && b1 <= b0) return;
    const ia: number[] = [];
    const ib: number[] = [];
    for (let i = a0; i < a1; i++) if (!movedA.has(i)) ia.push(i);
    for (let j = b0; j < b1; j++) if (!movedB.has(j)) ib.push(j);
    if (!ia.length && !ib.length) return;
    const kind = (u: Unit) => u.kind;
    // Running text.
    const flat = (D: DocText, is: number[]): Flat[] =>
      is
        .filter((i) => kind(D.units[i]!) === 'para')
        .flatMap((i) => D.units[i]!.tokens.map((tok, t) => ({ u: i, t, tok })));
    const fa = flat(A, ia);
    const fb = flat(B, ib);
    if (fa.length || fb.length) wordChanges(A, B, fa, fb, intern, dfn, gap, raw);
    // Table rows.
    const rA = ia.filter((i) => kind(A.units[i]!) === 'row');
    const rB = ib.filter((j) => kind(B.units[j]!) === 'row');
    if (rA.length || rB.length) rowChanges(A, B, rA, rB, intern, gap, raw);
    // Figures, in order.
    const fA = ia.filter((i) => kind(A.units[i]!) === 'figure');
    const fB = ib.filter((j) => kind(B.units[j]!) === 'figure');
    const n = Math.max(fA.length, fB.length);
    for (let k = 0; k < n; k++) {
      const i = fA[k];
      const j = fB[k];
      const ua = i !== undefined ? A.units[i] : undefined;
      const ub = j !== undefined ? B.units[j] : undefined;
      const s = (u: Unit, idx: number): Side => ({
        u0: idx,
        t0: 0,
        u1: idx,
        t1: 0,
        text: '[figure]',
        page: u.page,
      });
      const c: Change = { kind: ua && ub ? 'figure' : ua ? 'deleted' : 'inserted' };
      if (ua && i !== undefined) c.a = s(ua, i);
      if (ub && j !== undefined) c.b = s(ub, j);
      if (ua?.figure && ub?.figure)
        c.pictureDiff = Math.round(thumbDiff(ua.figure.thumb, ub.figure.thumb) * 10) / 10;
      raw.push({ ...c, gap });
    }
    gap++;
  };
  const nearA = new Set(near.map((p) => p[0]));
  const bounds = [...um, ...relabelled, ...near].sort((x, y) => x[0] - y[0]);
  for (const [i, j] of bounds) {
    gapOf(pa, i, pb, j);
    if (nearA.has(i)) gapOf(i, i + 1, j, j + 1);
    pa = i + 1;
    pb = j + 1;
  }
  gapOf(pa, A.units.length, pb, B.units.length);
  const t2 = performance.now();

  // Moves: a long deleted run and a long inserted run in another gap, nearly the same.
  let changes: Change[] = raw;
  if (o.moves !== false) changes = findMoves(A, B, raw, intern, dfn, o.minMove ?? MIN_MOVE);
  for (const blk of blocks) {
    const flatOf = (D: DocText, is: number[]): Flat[] =>
      is.flatMap((u) => D.units[u]!.tokens.map((tok, t) => ({ u, t, tok })));
    const fa = flatOf(A, blk.a);
    const fb = flatOf(B, blk.b);
    const inner: (Change & { gap: number })[] = [];
    wordChanges(A, B, fa, fb, intern, dfn, -1, inner);
    changes.push({
      kind: 'moved',
      a: sideOf(A.units, fa, 0, fa.length),
      b: sideOf(B.units, fb, 0, fb.length),
      inner: inner.map(dropGap),
    });
  }
  const t3 = performance.now();

  if (o.headersFooters !== false) changes.push(...hfChanges(A, B));
  if (o.renumbering !== false) changes = foldRenumbering(A, B, changes, relabelled, um);
  return {
    changes,
    matchedUnits: um.length,
    ms: { units: t1 - t0, words: t2 - t1, moves: t3 - t2, total: performance.now() - t0 },
  };
}

/**
 * Units that are the same in both revisions but out of order (the unit-level
 * match could not keep them), in blocks of consecutive units, each block grown
 * by the near-identical units next to it (a moved section whose text was also
 * edited). Blocks shorter than `minMove` tokens are left to the word level.
 */
export function moveBlocks(
  A: DocText,
  B: DocText,
  um: readonly [number, number][],
  minMove: number,
): { a: number[]; b: number[] }[] {
  const mA = new Set(um.map((m) => m[0]));
  const mB = new Set(um.map((m) => m[1]));
  const freeB = new Map<string, number[]>();
  B.units.forEach((u, j) => {
    if (!mB.has(j) && u.kind === 'para') freeB.set(u.key, [...(freeB.get(u.key) ?? []), j]);
  });
  const pairs: [number, number][] = [];
  A.units.forEach((u, i) => {
    if (mA.has(i) || u.kind !== 'para') return;
    const js = freeB.get(u.key);
    const j = js?.shift();
    if (j !== undefined) pairs.push([i, j]);
  });
  const usedA = new Set(pairs.map((p) => p[0]));
  const usedB = new Set(pairs.map((p) => p[1]));
  // Consecutive pairs form a block.
  const blocks: { a: number[]; b: number[] }[] = [];
  for (const [i, j] of pairs) {
    const last = blocks[blocks.length - 1];
    if (last?.a[last.a.length - 1] === i - 1 && last.b[last.b.length - 1] === j - 1) {
      last.a.push(i);
      last.b.push(j);
    } else blocks.push({ a: [i], b: [j] });
  }
  const near = (i: number, j: number) => {
    const ua = A.units[i];
    const ub = B.units[j];
    if (!ua || !ub || ua.kind !== 'para' || ub.kind !== 'para') return false;
    if (mA.has(i) || mB.has(j) || usedA.has(i) || usedB.has(j)) return false;
    return (
      dice(
        ua.tokens.map((t) => t.key),
        ub.tokens.map((t) => t.key),
      ) >= 0.5
    );
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
  const size = (D: DocText, is: number[]) =>
    is.reduce((s, i) => s + (D.units[i]?.tokens.length ?? 0), 0);
  return joined.filter((b) => size(A, b.a) >= minMove);
}

/**
 * Unit alignment. Unique units, with clause numbers masked, are the skeleton
 * (so renumbered boilerplate cannot pull the alignment off course); between
 * two skeleton anchors, units equal as read are matched first, then units
 * equal once clause numbers are masked ("relabelled": renumbered clauses).
 */
function alignUnits(
  A: DocText,
  B: DocText,
  ka: Int32Array,
  kb: Int32Array,
  intern: Interner,
  renumbering: boolean,
): { exact: [number, number][]; relabelled: [number, number][]; near: [number, number][] } {
  if (!renumbering) return { exact: matches(ka, kb), relabelled: [], near: [] };
  const ra = Int32Array.from(A.units, (u) => intern.id(`R:${u.relabelKey}`));
  const rb = Int32Array.from(B.units, (u) => intern.id(`R:${u.relabelKey}`));
  const skel = uniqueMatches(ra, rb);
  const exact: [number, number][] = [];
  const relabelled: [number, number][] = [];
  const put = (i: number, j: number) => (ka[i] === kb[j] ? exact : relabelled).push([i, j]);
  // Numbered units that are nearly the same once numbers are masked (renumbered
  // and edited), paired in order; their words are compared as one pair.
  const near: [number, number][] = [];
  const masked = (u: Unit) => u.relabelKey.slice(2).split(' ');
  const nearPairs = (c0: number, c1: number, d0: number, d1: number) => {
    let from = d0;
    for (let i = c0; i < c1; i++) {
      const ua = A.units[i]!;
      if (!ua.clauseTok.length) continue;
      for (let j = from; j < d1; j++) {
        const ub = B.units[j]!;
        if (!ub.clauseTok.length || ub.kind !== ua.kind) continue;
        if (dice(masked(ua), masked(ub)) >= 0.8) {
          near.push([i, j]);
          from = j + 1;
          break;
        }
      }
    }
  };
  let pa = 0;
  let pb = 0;
  const between = (a0: number, a1: number, b0: number, b1: number) => {
    if (a1 <= a0 || b1 <= b0) return;
    const em = matches(ka.subarray(a0, a1), kb.subarray(b0, b1)).map(
      ([x, y]) => [x + a0, y + b0] as [number, number],
    );
    let qa = a0;
    let qb = b0;
    const rest = (c0: number, c1: number, d0: number, d1: number) => {
      if (c1 <= c0 || d1 <= d0) return;
      let sa = c0;
      let sb = d0;
      for (const [x, y] of matches(ra.subarray(c0, c1), rb.subarray(d0, d1))) {
        nearPairs(sa, x + c0, sb, y + d0);
        put(x + c0, y + d0);
        sa = x + c0 + 1;
        sb = y + d0 + 1;
      }
      nearPairs(sa, c1, sb, d1);
    };
    for (const [i, j] of em) {
      rest(qa, i, qb, j);
      exact.push([i, j]);
      qa = i + 1;
      qb = j + 1;
    }
    rest(qa, a1, qb, b1);
  };
  for (const [i, j] of skel) {
    between(pa, i, pb, j);
    put(i, j);
    pa = i + 1;
    pb = j + 1;
  }
  between(pa, A.units.length, pb, B.units.length);
  exact.sort((x, y) => x[0] - y[0]);
  relabelled.sort((x, y) => x[0] - y[0]);
  near.sort((x, y) => x[0] - y[0]);
  if (process.env.S30_DEBUG)
    console.log('near', JSON.stringify(near), 'relabelled', JSON.stringify(relabelled));
  return { exact, relabelled, near };
}

function tokensOf(D: DocText, s: Side): Token[] {
  const out: Token[] = [];
  for (let u = s.u0; u <= s.u1; u++) {
    const toks = D.units[u]?.tokens ?? [];
    const from = u === s.u0 ? s.t0 : 0;
    const to = u === s.u1 ? s.t1 : toks.length;
    for (let t = from; t < to; t++) out.push(toks[t]!);
  }
  return out;
}

function findMoves(
  A: DocText,
  B: DocText,
  raw: (Change & { gap: number })[],
  intern: Interner,
  dfn: DiffFn,
  minMove: number,
): Change[] {
  const dels = raw.filter(
    (c) => (c.kind === 'deleted' || c.kind === 'replaced') && !c.table && c.a,
  );
  const ins = raw.filter(
    (c) => (c.kind === 'inserted' || c.kind === 'replaced') && !c.table && c.b,
  );
  const cand: { d: (typeof raw)[number]; i: (typeof raw)[number]; s: number }[] = [];
  for (const d of dels) {
    const ta = tokensOf(A, d.a!);
    if (ta.length < minMove) continue;
    const ka = ta.map((t) => t.key);
    for (const i of ins) {
      if (i === d || i.gap === d.gap) continue;
      const tb = tokensOf(B, i.b!);
      if (tb.length < minMove || tb.length > 2 * ta.length || ta.length > 2 * tb.length) continue;
      const s = dice(
        ka,
        tb.map((t) => t.key),
      );
      if (s >= MOVE_SIMILARITY) cand.push({ d, i, s });
    }
  }
  cand.sort((x, y) => y.s - x.s);
  const used = new Set<object>();
  const moves: Change[] = [];
  for (const { d, i } of cand) {
    if (used.has(d) || used.has(i)) continue;
    used.add(d);
    used.add(i);
    const a = d.a!;
    const b = i.b!;
    // Inner edits: the two runs compared word by word.
    const flatOf = (D: DocText, s: Side): Flat[] => {
      const out: Flat[] = [];
      for (let u = s.u0; u <= s.u1; u++) {
        const toks = D.units[u]?.tokens ?? [];
        const from = u === s.u0 ? s.t0 : 0;
        const to = u === s.u1 ? s.t1 : toks.length;
        for (let t = from; t < to; t++) out.push({ u, t, tok: toks[t]! });
      }
      return out;
    };
    const inner: (Change & { gap: number })[] = [];
    wordChanges(A, B, flatOf(A, a), flatOf(B, b), intern, dfn, -1, inner);
    moves.push({ kind: 'moved', a, b, inner: inner.map(dropGap) });
    // What the replaced halves leave behind stays a change of its own.
    if (d.kind === 'replaced' && d.b) moves.push({ kind: 'inserted', b: d.b });
    if (i.kind === 'replaced' && i.a) moves.push({ kind: 'deleted', a: i.a });
  }
  const rest: Change[] = raw.filter((c) => !used.has(c)).map(dropGap);
  return [...rest, ...moves];
}

function hfChanges(A: DocText, B: DocText): Change[] {
  const out: Change[] = [];
  for (const band of ['top', 'bottom'] as const) {
    const ga = A.hf.filter((g) => g.band === band).sort((x, y) => x.y - y.y);
    const gb = B.hf.filter((g) => g.band === band).sort((x, y) => x.y - y.y);
    const ta = ga.flatMap((g) => g.template);
    const tb = gb.flatMap((g) => g.template);
    const intern = new Interner();
    const hs = diff(
      ta.map((k) => intern.id(k)),
      tb.map((k) => intern.id(k)),
    );
    for (let i = 0; i < hs.length; i++) {
      const h = hs[i]!;
      if (h.op === '=') continue;
      const nx = hs[i + 1];
      const kind = band === 'top' ? 'header' : 'footer';
      const s = (text: string): Side => ({ u0: -1, t0: 0, u1: -1, t1: 0, text, page: 0 });
      if (h.op === '-' && nx?.op === '+') {
        out.push({
          kind,
          a: s(ta.slice(h.a0, h.a1).join(' ')),
          b: s(tb.slice(nx.b0, nx.b1).join(' ')),
          note: 'on every page',
        });
        i++;
      } else if (h.op === '-')
        out.push({ kind, a: s(ta.slice(h.a0, h.a1).join(' ')), note: 'on every page' });
      else out.push({ kind, b: s(tb.slice(h.b0, h.b1).join(' ')), note: 'on every page' });
    }
  }
  return out;
}
