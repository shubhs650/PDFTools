// Our own sequence difference for the text comparison (M12-17, D-63, spike
// S30: the same results as jsdiff on every corpus pair, so no library).
// Myers' O(ND) algorithm in linear space (the "middle snake" divide and
// conquer, Myers 1986), with the common prefix and suffix stripped first, and
// optionally unique anchors (items that occur exactly once in each sequence,
// longest increasing run of them: the "patience" idea) to cut long inputs into
// short independent pieces. Sequences are of integers (interned keys), so
// equality is one comparison. Pure code.

export type Seq = ArrayLike<number>;

/** A run of the edit script: equal, deleted from A, or inserted from B. */
export interface Hunk {
  op: '=' | '-' | '+';
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** Matched index pairs (a, b), increasing in both. */
export type Matches = [number, number][];

const at = (s: Seq, i: number): number => s[i] ?? -1;

/** Myers' divide and conquer between a[a0,a1) and b[b0,b1); pushes the matches of an LCS. */
function myersLcs(
  a: Seq,
  a0: number,
  a1: number,
  b: Seq,
  b0: number,
  b1: number,
  out: Matches,
): void {
  while (a0 < a1 && b0 < b1 && at(a, a0) === at(b, b0)) out.push([a0++, b0++]);
  const tail: Matches = [];
  while (a0 < a1 && b0 < b1 && at(a, a1 - 1) === at(b, b1 - 1)) tail.push([--a1, --b1]);
  if (a1 > a0 && b1 > b0) {
    // Both halves have a strictly shorter edit script, so this ends.
    const [x, y, u, v] = middleSnake(a, a0, a1 - a0, b, b0, b1 - b0);
    myersLcs(a, a0, x, b, b0, y, out);
    for (let i = x, j = y; i < u; i++, j++) out.push([i, j]);
    myersLcs(a, u, a1, b, v, b1, out);
  }
  for (let k = tail.length - 1; k >= 0; k--) {
    const m = tail[k];
    if (m) out.push(m);
  }
}

/**
 * The middle snake of the shortest edit script between a[a0,a0+n) and
 * b[b0,b0+m), in absolute indices: the snake runs from (x, y) to (u, v).
 */
function middleSnake(
  a: Seq,
  a0: number,
  n: number,
  b: Seq,
  b0: number,
  m: number,
): [number, number, number, number] {
  const max = n + m;
  const delta = n - m;
  const odd = (delta & 1) !== 0;
  const off = max + 1;
  const vf = new Int32Array(2 * max + 3);
  const vb = new Int32Array(2 * max + 3);
  const dMax = Math.ceil(max / 2);
  for (let d = 0; d <= dMax; d++) {
    for (let k = -d; k <= d; k += 2) {
      const lo = vf[off + k - 1] ?? 0;
      const hi = vf[off + k + 1] ?? 0;
      let x = k === -d || (k !== d && lo < hi) ? hi : lo + 1;
      let y = x - k;
      const sx = x;
      const sy = y;
      while (x < n && y < m && at(a, a0 + x) === at(b, b0 + y)) {
        x++;
        y++;
      }
      vf[off + k] = x;
      if (odd && k >= delta - (d - 1) && k <= delta + (d - 1)) {
        if (x + (vb[off + delta - k] ?? 0) >= n) return [a0 + sx, b0 + sy, a0 + x, b0 + y];
      }
    }
    for (let k = -d; k <= d; k += 2) {
      const lo = vb[off + k - 1] ?? 0;
      const hi = vb[off + k + 1] ?? 0;
      let x = k === -d || (k !== d && lo < hi) ? hi : lo + 1;
      let y = x - k;
      const ex = x;
      const ey = y;
      while (x < n && y < m && at(a, a0 + n - 1 - x) === at(b, b0 + m - 1 - y)) {
        x++;
        y++;
      }
      vb[off + k] = x;
      if (!odd && delta - k >= -d && delta - k <= d) {
        if (x + (vf[off + delta - k] ?? 0) >= n)
          return [a0 + n - x, b0 + m - y, a0 + n - ex, b0 + m - ey];
      }
    }
  }
  throw new Error('no middle snake');
}

/** Longest increasing run (by b) of pairs sorted by a: patience sorting. */
function lis(pairs: Matches): Matches {
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  const bOf = (i: number): number => pairs[i]?.[1] ?? 0;
  for (let i = 0; i < pairs.length; i++) {
    const bv = bOf(i);
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bOf(tails[mid] ?? 0) < bv) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1] ?? -1;
    tails[lo] = i;
  }
  const out: Matches = [];
  let k = tails.length ? (tails[tails.length - 1] ?? -1) : -1;
  while (k >= 0) {
    const p = pairs[k];
    if (p) out.push(p);
    k = prev[k] ?? -1;
  }
  return out.reverse();
}

/** Items that occur once in a[a0,a1) and once in b[b0,b1), as an increasing run. */
function uniqueAnchors(
  a: Seq,
  a0: number,
  a1: number,
  b: Seq,
  b0: number,
  b1: number,
  skip?: ReadonlySet<number>,
): Matches {
  const ca = new Map<number, number>();
  for (let i = a0; i < a1; i++) {
    const k = at(a, i);
    ca.set(k, ca.has(k) ? -1 : i);
  }
  const cb = new Map<number, number>();
  for (let j = b0; j < b1; j++) {
    const k = at(b, j);
    cb.set(k, cb.has(k) ? -1 : j);
  }
  const pairs: Matches = [];
  for (const [k, i] of ca) {
    if (i < 0 || skip?.has(k)) continue;
    const j = cb.get(k);
    if (j !== undefined && j >= 0) pairs.push([i, j]);
  }
  pairs.sort((p, q) => p[0] - q[0]);
  return lis(pairs);
}

export interface DiffOptions {
  /**
   * Use unique anchors first (default true). A heuristic (S30: 0.3 % of the
   * matches lost on a whole 500-page token stream) that keeps repeated
   * clauses in place and bounds the time on a long, heavily edited stretch.
   * False gives a true longest common subsequence.
   */
  anchors?: boolean;
  /** Keys never taken for an anchor (numbers: a renumbered clause keeps its number unique). */
  noAnchor?: ReadonlySet<number>;
}

function lcs(
  a: Seq,
  a0: number,
  a1: number,
  b: Seq,
  b0: number,
  b1: number,
  out: Matches,
  skip?: ReadonlySet<number>,
): void {
  while (a0 < a1 && b0 < b1 && at(a, a0) === at(b, b0)) out.push([a0++, b0++]);
  const tail: Matches = [];
  while (a0 < a1 && b0 < b1 && at(a, a1 - 1) === at(b, b1 - 1)) tail.push([--a1, --b1]);
  const anchors = uniqueAnchors(a, a0, a1, b, b0, b1, skip);
  if (anchors.length === 0) myersLcs(a, a0, a1, b, b0, b1, out);
  else {
    let pa = a0;
    let pb = b0;
    for (const [i, j] of anchors) {
      // Between anchors, the pieces may have their own unique items.
      lcs(a, pa, i, b, pb, j, out, skip);
      out.push([i, j]);
      pa = i + 1;
      pb = j + 1;
    }
    lcs(a, pa, a1, b, pb, b1, out, skip);
  }
  for (let k = tail.length - 1; k >= 0; k--) {
    const m = tail[k];
    if (m) out.push(m);
  }
}

/** Items unique in both sequences, as a longest increasing run (the anchors alone). */
export function uniqueMatches(a: Seq, b: Seq): Matches {
  return uniqueAnchors(a, 0, a.length, b, 0, b.length);
}

/** The matched pairs of a common subsequence (anchored by default). */
export function matches(a: Seq, b: Seq, o: DiffOptions = {}): Matches {
  const out: Matches = [];
  if (o.anchors !== false) lcs(a, 0, a.length, b, 0, b.length, out, o.noAnchor);
  else myersLcs(a, 0, a.length, b, 0, b.length, out);
  return out;
}

/** The edit script as hunks: '=' runs, and '-' / '+' runs between them. */
export function diff(a: Seq, b: Seq, o: DiffOptions = {}): Hunk[] {
  return hunks(matches(a, b, o), a.length, b.length);
}

/** Matches → hunks; a deletion comes before the insertion it sits with. */
export function hunks(ms: Matches, n: number, m: number): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  const push = (h: Hunk): void => {
    const last = out[out.length - 1];
    if (last?.op === h.op && last.a1 === h.a0 && last.b1 === h.b0) {
      last.a1 = h.a1;
      last.b1 = h.b1;
    } else out.push(h);
  };
  for (const [x, y] of [...ms, [n, m] as [number, number]]) {
    if (x > i) push({ op: '-', a0: i, a1: x, b0: j, b1: j });
    if (y > j) push({ op: '+', a0: x, a1: x, b0: j, b1: y });
    if (x < n && y < m) push({ op: '=', a0: x, a1: x + 1, b0: y, b1: y + 1 });
    i = x + 1;
    j = y + 1;
  }
  return out;
}

/** Maps strings to integers, shared by both sides of a comparison. */
export class Interner {
  private readonly ids = new Map<string, number>();
  private readonly keys: string[] = [];

  id(s: string): number {
    let v = this.ids.get(s);
    if (v === undefined) {
      v = this.keys.length;
      this.ids.set(s, v);
      this.keys.push(s);
    }
    return v;
  }

  /** The string of an id. */
  key(id: number): string {
    return this.keys[id] ?? '';
  }

  get size(): number {
    return this.keys.length;
  }
}
