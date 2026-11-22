// Clause renumbering (M12-18, D-63, Q31, experimental; spike S30). Pure code.
//
// Units are aligned on a skeleton of units unique on both sides with their
// clause numbers masked, so renumbered boilerplate cannot pull the alignment
// off course. Between skeleton anchors, units equal as read are matched first,
// then units equal once clause numbers are masked ("relabelled": a renumbered
// clause), then numbered units nearly the same once masked ("near": renumbered
// and edited, compared word by word as a pair).
//
// The relabelled pairs give an old → new map of own numbers (3.4 → 3.6;
// sub-clauses follow their parent: 3.4.1 → 3.6.1). Consecutive clauses shifted
// alike are reported once. A cross-reference that follows the map is not
// flagged; one that does not is, also in text that did not change.
import { UNIT_PARA, unitCount, type TextDoc } from './document';
import { matches, uniqueMatches } from './myers';

export type Pairs = [number, number][];

export interface UnitAlignment {
  /** Units equal as read. */
  exact: Pairs;
  /** Units equal once clause numbers are masked. */
  relabelled: Pairs;
  /** Numbered units nearly the same once masked: compared word by word. */
  near: Pairs;
}

/** Clause tokens of unit u (document token indexes). */
export function clausesOf(d: TextDoc, u: number): Int32Array {
  return d.clauseTok.subarray(d.unitClause[u] ?? 0, d.unitClause[u + 1] ?? 0);
}

/** A clause number as compared: its token's key without a closing full stop. */
export function clauseText(d: TextDoc, t: number): string {
  const u = unitOfToken(d, t);
  return (d.unitText[u] ?? '')
    .slice(d.tokStart[t] ?? 0, d.tokEnd[t] ?? 0)
    .normalize('NFKC')
    .replace(/\.$/u, '');
}

/** The unit holding token t (binary search on unitTok). */
export function unitOfToken(d: TextDoc, t: number): number {
  let lo = 0;
  let hi = unitCount(d) - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((d.unitTok[mid] ?? 0) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Whether token t is its unit's own number (its first clause token, at the start). */
export function isOwn(d: TextDoc, u: number, t: number): boolean {
  const cs = clausesOf(d, u);
  return cs[0] === t && t - (d.unitTok[u] ?? 0) <= 1;
}

function masked(d: TextDoc, u: number): Int32Array {
  const t0 = d.unitTok[u] ?? 0;
  const out = d.tokKey.slice(t0, d.unitTok[u + 1] ?? 0);
  for (const t of clausesOf(d, u)) out[t - t0] = -1;
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

/** Masked likeness from which a numbered unit is the same clause, renumbered and edited. */
const NEAR = 0.8;

/** The unit alignment with renumbering (see the head of this file). */
export function alignUnits(A: TextDoc, B: TextDoc): UnitAlignment {
  const ka = A.unitKey;
  const kb = B.unitKey;
  const ra = A.unitRelabel;
  const rb = B.unitRelabel;
  const exact: Pairs = [];
  const relabelled: Pairs = [];
  const near: Pairs = [];
  const put = (i: number, j: number): void => {
    (ka[i] === kb[j] ? exact : relabelled).push([i, j]);
  };
  const nearPairs = (c0: number, c1: number, d0: number, d1: number): void => {
    let from = d0;
    for (let i = c0; i < c1; i++) {
      if (A.unitKind[i] !== UNIT_PARA || clausesOf(A, i).length === 0) continue;
      const mi = masked(A, i);
      for (let j = from; j < d1; j++) {
        if (B.unitKind[j] !== UNIT_PARA || clausesOf(B, j).length === 0) continue;
        if (dice(mi, masked(B, j)) >= NEAR) {
          near.push([i, j]);
          from = j + 1;
          break;
        }
      }
    }
  };
  const rest = (c0: number, c1: number, d0: number, d1: number): void => {
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
  const between = (a0: number, a1: number, b0: number, b1: number): void => {
    if (a1 <= a0 || b1 <= b0) return;
    let qa = a0;
    let qb = b0;
    for (const [x, y] of matches(ka.subarray(a0, a1), kb.subarray(b0, b1))) {
      rest(qa, x + a0, qb, y + b0);
      exact.push([x + a0, y + b0]);
      qa = x + a0 + 1;
      qb = y + b0 + 1;
    }
    rest(qa, a1, qb, b1);
  };
  let pa = 0;
  let pb = 0;
  for (const [i, j] of uniqueMatches(ra, rb)) {
    between(pa, i, pb, j);
    put(i, j);
    pa = i + 1;
    pb = j + 1;
  }
  between(pa, unitCount(A), pb, unitCount(B));
  const byA = (x: [number, number], y: [number, number]): number => x[0] - y[0];
  return { exact: exact.sort(byA), relabelled: relabelled.sort(byA), near: near.sort(byA) };
}

/** A clause number on each side. */
export interface ClausePair {
  a: string;
  b: string;
  /** Units and tokens. */
  i: number;
  j: number;
  ta: number;
  tb: number;
  /** The units' own numbers (not a reference). */
  own: boolean;
}

/** The clause numbers of two relabelled units, k-th with k-th. */
export function pairsOf(A: TextDoc, B: TextDoc, i: number, j: number): ClausePair[] {
  const ca = clausesOf(A, i);
  const cb = clausesOf(B, j);
  const out: ClausePair[] = [];
  ca.forEach((ta, k) => {
    const tb = cb[k];
    if (tb === undefined) return;
    out.push({
      a: clauseText(A, ta),
      b: clauseText(B, tb),
      i,
      j,
      ta,
      tb,
      own: k === 0 && isOwn(A, i, ta),
    });
  });
  return out;
}

const parts = (s: string): number[] => s.split('.').map(Number);

/** The new number of `a` under the map (longest prefix), or undefined. */
export function mapped(map: ReadonlyMap<string, string>, a: string): string | undefined {
  const p = a.split('.');
  for (let n = p.length; n > 0; n--) {
    const to = map.get(p.slice(0, n).join('.'));
    if (to !== undefined) return [to, ...p.slice(n)].join('.');
  }
  return undefined;
}

export interface Renumbering {
  map: Map<string, string>;
  /** Runs of consecutive clauses shifted alike (own numbers), in A's order. */
  groups: ClausePair[][];
  /** Own numbers that shifted, and references that follow the map. */
  shifted: number;
  follow: number;
  /** Whether a pair follows the map. */
  follows: (a: string, b: string) => boolean;
}

/** The renumbering map from the clause pairs (own numbers shortest first), or null. */
export function renumbering(all: readonly ClausePair[]): Renumbering | null {
  const own = all
    .filter((p) => p.own && p.a !== p.b)
    .sort((x, y) => parts(x.a).length - parts(y.a).length);
  const map = new Map<string, string>();
  const tops: ClausePair[] = [];
  for (const p of own) {
    if (mapped(map, p.a) === p.b) continue;
    map.set(p.a, p.b);
    tops.push(p);
  }
  if (map.size === 0) return null;
  const follows = (a: string, b: string): boolean => (mapped(map, a) ?? a) === b;
  tops.sort((x, y) => x.i - y.i);
  const groups: ClausePair[][] = [];
  for (const p of tops) {
    const g = groups[groups.length - 1];
    const q = g?.[g.length - 1];
    const pa = parts(p.a);
    const pb = parts(p.b);
    const qa = q ? parts(q.a) : [];
    const qb = q ? parts(q.b) : [];
    const ok =
      !!q &&
      qa.length === pa.length &&
      qa.slice(0, -1).join('.') === pa.slice(0, -1).join('.') &&
      (pa.at(-1) ?? 0) - (qa.at(-1) ?? 0) === 1 &&
      (pb.at(-1) ?? 0) - (pa.at(-1) ?? 0) === (qb.at(-1) ?? 0) - (qa.at(-1) ?? 0);
    if (g && ok) g.push(p);
    else groups.push([p]);
  }
  return {
    map,
    groups,
    shifted: all.filter((p) => p.own && p.a !== p.b).length,
    follow: all.filter((p) => !p.own && follows(p.a, p.b)).length,
    follows,
  };
}
