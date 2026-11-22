// Spike S30 (M12-05): our own sequence difference, route 1 of the plan's
// "own code against a small permissive library". Myers' O(ND) algorithm in
// linear space (the "middle snake" divide and conquer, Myers 1986), with the
// common prefix and suffix stripped first, and unique anchors (items that
// occur exactly once in each sequence, longest increasing run of them: the
// "patience" idea) to cut long inputs into short independent pieces.
// Sequences are of integers (interned keys), so equality is one comparison.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- indices in range, in hot loops (spike code) */

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
type Matches = [number, number][];

/** Myers' divide and conquer between a[a0,a1) and b[b0,b1); pushes the matches of an LCS. */
function myersLcs(a: Seq, a0: number, a1: number, b: Seq, b0: number, b1: number, out: Matches) {
  // Common prefix and suffix.
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) out.push([a0++, b0++]);
  const tail: Matches = [];
  while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) tail.push([--a1, --b1]);
  if (a1 > a0 && b1 > b0) {
    // Both halves have a strictly shorter edit script, so this ends.
    const [x, y, u, v] = middleSnake(a, a0, a1 - a0, b, b0, b1 - b0);
    myersLcs(a, a0, x, b, b0, y, out);
    for (let i = x, j = y; i < u; i++, j++) out.push([i, j]);
    myersLcs(a, u, a1, b, v, b1, out);
  }
  for (let k = tail.length - 1; k >= 0; k--) out.push(tail[k]!);
}

/**
 * Finds the middle snake of the shortest edit script between a[a0,a0+n) and
 * b[b0,b0+m). Returns [x, y, u, v, d] in absolute indices: the snake runs from
 * (x, y) to (u, v) and d is the length of the shortest edit script.
 */
function middleSnake(
  a: Seq,
  a0: number,
  n: number,
  b: Seq,
  b0: number,
  m: number,
): [number, number, number, number, number] {
  const max = n + m;
  const delta = n - m;
  const odd = (delta & 1) !== 0;
  const off = max + 1;
  const vf = new Int32Array(2 * max + 3);
  const vb = new Int32Array(2 * max + 3);
  vf[off + 1] = 0;
  vb[off + 1] = 0;
  const dMax = Math.ceil(max / 2);
  for (let d = 0; d <= dMax; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (vf[off + k - 1] ?? 0) < (vf[off + k + 1] ?? 0))
          ? (vf[off + k + 1] ?? 0)
          : (vf[off + k - 1] ?? 0) + 1;
      let y = x - k;
      const sx = x;
      const sy = y;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      vf[off + k] = x;
      if (odd && k >= delta - (d - 1) && k <= delta + (d - 1)) {
        if (x + (vb[off + delta - k] ?? 0) >= n) {
          return [a0 + sx, b0 + sy, a0 + x, b0 + y, 2 * d - 1];
        }
      }
    }
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (vb[off + k - 1] ?? 0) < (vb[off + k + 1] ?? 0))
          ? (vb[off + k + 1] ?? 0)
          : (vb[off + k - 1] ?? 0) + 1;
      let y = x - k;
      const ex = x;
      const ey = y;
      while (x < n && y < m && a[a0 + n - 1 - x] === b[b0 + m - 1 - y]) {
        x++;
        y++;
      }
      vb[off + k] = x;
      if (!odd && delta - k >= -d && delta - k <= d) {
        if (x + (vf[off + delta - k] ?? 0) >= n) {
          return [a0 + n - x, b0 + m - y, a0 + n - ex, b0 + m - ey, 2 * d];
        }
      }
    }
  }
  throw new Error('no middle snake');
}

/** Longest increasing subsequence of pairs sorted by a (by b), patience sorting. */
function lis(pairs: Matches): Matches {
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    const bv = pairs[i]![1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![1] < bv) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const out: Matches = [];
  let k = tails.length ? tails[tails.length - 1]! : -1;
  while (k >= 0) {
    out.push(pairs[k]!);
    k = prev[k] ?? -1;
  }
  return out.reverse();
}

/** Items that occur once in a[a0,a1) and once in b[b0,b1), as an increasing run. */
function uniqueAnchors(a: Seq, a0: number, a1: number, b: Seq, b0: number, b1: number): Matches {
  const ca = new Map<number, number>();
  for (let i = a0; i < a1; i++) {
    const k = a[i]!;
    ca.set(k, ca.has(k) ? -1 : i);
  }
  const cb = new Map<number, number>();
  for (let j = b0; j < b1; j++) {
    const k = b[j]!;
    cb.set(k, cb.has(k) ? -1 : j);
  }
  const pairs: Matches = [];
  for (const [k, i] of ca) {
    if (i < 0) continue;
    const j = cb.get(k);
    if (j !== undefined && j >= 0) pairs.push([i, j]);
  }
  pairs.sort((p, q) => p[0] - q[0]);
  return lis(pairs);
}

export interface DiffOptions {
  /** Use unique anchors first (default true). */
  anchors?: boolean;
}

function lcs(
  a: Seq,
  a0: number,
  a1: number,
  b: Seq,
  b0: number,
  b1: number,
  o: DiffOptions,
  out: Matches,
) {
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) out.push([a0++, b0++]);
  const tail: Matches = [];
  while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) tail.push([--a1, --b1]);
  const anchors = o.anchors !== false ? uniqueAnchors(a, a0, a1, b, b0, b1) : [];
  if (anchors.length === 0) {
    myersLcs(a, a0, a1, b, b0, b1, out);
  } else {
    let pa = a0;
    let pb = b0;
    for (const [i, j] of anchors) {
      // Between anchors, the pieces may have their own unique items: recurse.
      lcs(a, pa, i, b, pb, j, o, out);
      out.push([i, j]);
      pa = i + 1;
      pb = j + 1;
    }
    lcs(a, pa, a1, b, pb, b1, o, out);
  }
  for (let k = tail.length - 1; k >= 0; k--) out.push(tail[k]!);
}

/** Items unique in both sequences, as a longest increasing run (the anchors alone). */
export function uniqueMatches(a: Seq, b: Seq): Matches {
  return uniqueAnchors(a, 0, a.length, b, 0, b.length);
}

/** The matched pairs of a longest common subsequence (anchored by default). */
export function matches(a: Seq, b: Seq, o: DiffOptions = {}): Matches {
  const out: Matches = [];
  lcs(a, 0, a.length, b, 0, b.length, o, out);
  return out;
}

/** The edit script as hunks: '=' runs, and '-' / '+' runs between them. */
export function diff(a: Seq, b: Seq, o: DiffOptions = {}): Hunk[] {
  return hunks(matches(a, b, o), a.length, b.length);
}

export function hunks(ms: Matches, n: number, m: number): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  const push = (h: Hunk) => {
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

/** Maps strings to integers (shared by both sides of a comparison). */
export class Interner {
  private readonly ids = new Map<string, number>();
  id(s: string): number {
    let v = this.ids.get(s);
    if (v === undefined) {
      v = this.ids.size;
      this.ids.set(s, v);
    }
    return v;
  }
}
