// Spike S30 (M12-05): clause renumbering, reported once (D-63, Q31,
// experimental). Units that match only with their clause numbers masked
// (compare.ts, pass 2) give the old → new numbers. Their own numbers make the
// renumbering map (3.4 → 3.6 … 3.9 → 3.11; sub-clauses follow their parent:
// 3.4.1 → 3.6.1). Consecutive clauses shifted alike are one entry. A
// cross-reference that follows the map is not flagged; one that does not is
// ("still cites Clause 3.5, which is now 3.7"), including references in text
// that did not change at all.
/* eslint-disable @typescript-eslint/no-non-null-assertion -- indices in range, in hot loops (spike code) */

import type { Change, Side } from './compare.ts';
import type { DocText } from './doc.ts';

const strip = (s: string) => s.replace(/\.$/, '');
const parts = (s: string) => strip(s).split('.').map(Number);

/** The new number of `a` under the map (longest prefix), or undefined. */
function mapped(map: Map<string, string>, a: string): string | undefined {
  const p = strip(a).split('.');
  for (let n = p.length; n > 0; n--) {
    const head = p.slice(0, n).join('.');
    const to = map.get(head);
    if (to !== undefined) return [to, ...p.slice(n)].join('.');
  }
  return undefined;
}

interface Pair {
  a: string;
  b: string;
  i: number;
  j: number;
  pos: number;
  own: boolean;
}

function pairsOf(A: DocText, B: DocText, i: number, j: number): Pair[] {
  const ua = A.units[i]!;
  const ub = B.units[j]!;
  return ua.clauseTok.map((pos, k) => ({
    a: strip(ua.tokens[pos]?.key ?? ''),
    b: strip(ub.tokens[ub.clauseTok[k] ?? pos]?.key ?? ''),
    i,
    j,
    pos,
    own: k === 0 && pos <= 1,
  }));
}

export function foldRenumbering(
  A: DocText,
  B: DocText,
  changes: Change[],
  relabelled: readonly [number, number][],
  matched: readonly [number, number][],
): Change[] {
  const pairs = relabelled.flatMap(([i, j]) => pairsOf(A, B, i, j));
  // Word-level number changes in clause position count too (a renumbered clause also edited).
  const single = (c: Change): Pair | null => {
    if (c.kind !== 'replaced' || !c.a || !c.b || c.table) return null;
    if (c.a.u0 !== c.a.u1 || c.a.t1 - c.a.t0 !== 1 || c.b.t1 - c.b.t0 !== 1) return null;
    const ua = A.units[c.a.u0];
    const ub = B.units[c.b.u0];
    if (!ua?.clauseTok.includes(c.a.t0) || !ub?.clauseTok.includes(c.b.t0)) return null;
    return {
      a: strip(ua.tokens[c.a.t0]?.key ?? ''),
      b: strip(ub.tokens[c.b.t0]?.key ?? ''),
      i: c.a.u0,
      j: c.b.u0,
      pos: c.a.t0,
      own: c.a.t0 <= 1 && ua.clauseTok[0] === c.a.t0,
    };
  };
  const fromChanges = new Map<Change, Pair>();
  for (const c of changes) {
    const p = single(c);
    if (p) fromChanges.set(c, p);
  }
  const all = [...pairs, ...fromChanges.values()];
  // The map: own numbers, shortest first, so sub-clauses can be explained by their parent.
  const own = all
    .filter((p) => p.own && p.a !== p.b)
    .sort((x, y) => parts(x.a).length - parts(y.a).length);
  const map = new Map<string, string>();
  const tops: Pair[] = [];
  for (const p of own) {
    if (mapped(map, p.a) === p.b) continue;
    map.set(p.a, p.b);
    tops.push(p);
  }
  if (map.size === 0) return changes;
  const follows = (a: string, b: string) => (mapped(map, a) ?? a) === b;

  const out: Change[] = changes.filter((c) => {
    const p = fromChanges.get(c);
    return !(p && follows(p.a, p.b));
  });
  // One entry per run of consecutive clauses shifted alike.
  tops.sort((x, y) => x.i - y.i);
  const groups: Pair[][] = [];
  for (const p of tops) {
    const g = groups[groups.length - 1];
    const q = g?.[g.length - 1];
    const pa = parts(p.a);
    const pb = parts(p.b);
    const ok =
      q &&
      parts(q.a).length === pa.length &&
      parts(q.a).slice(0, -1).join('.') === pa.slice(0, -1).join('.') &&
      (pa.at(-1) ?? 0) - (parts(q.a).at(-1) ?? 0) === 1 &&
      (pb.at(-1) ?? 0) - (pa.at(-1) ?? 0) === (parts(q.b).at(-1) ?? 0) - (parts(q.a).at(-1) ?? 0);
    if (g && ok) g.push(p);
    else groups.push([p]);
  }
  const refs = all.filter((p) => !p.own);
  const followed = refs.filter((p) => follows(p.a, p.b)).length;
  const under = all.filter((p) => p.own && p.a !== p.b).length;
  for (const g of groups) {
    const f = g[0]!;
    const l = g[g.length - 1]!;
    const side = (D: DocText, u0: number, u1: number, text: string): Side => ({
      u0,
      t0: 0,
      u1,
      t1: D.units[u1]?.tokens.length ?? 0,
      text,
      page: D.units[u0]?.page ?? 0,
    });
    out.push({
      kind: 'renumbered',
      a: side(A, f.i, l.i, g.length > 1 ? `${f.a}–${l.a}` : f.a),
      b: side(B, f.j, l.j, g.length > 1 ? `${f.b}–${l.b}` : f.b),
      note: `${String(under)} numbers shifted, ${String(followed)} cross-references follow`,
    });
  }
  // References that do not follow, in renumbered or changed units.
  for (const p of refs) {
    if (follows(p.a, p.b)) continue;
    out.push({
      kind: 'reference',
      a: { u0: p.i, t0: p.pos, u1: p.i, t1: p.pos + 1, text: p.a, page: A.units[p.i]?.page ?? 0 },
      b: { u0: p.j, t0: p.pos, u1: p.j, t1: p.pos + 1, text: p.b, page: B.units[p.j]?.page ?? 0 },
      note: `cites ${p.b}; under the renumbering it would be ${mapped(map, p.a) ?? p.a}`,
    });
  }
  // References in text that did not change at all.
  for (const [i, j] of matched) {
    const ua = A.units[i]!;
    ua.clauseTok.forEach((pos, k) => {
      if (k === 0 && pos <= 1) return;
      const a = strip(ua.tokens[pos]?.key ?? '');
      const to = mapped(map, a);
      if (to === undefined || to === a) return;
      out.push({
        kind: 'reference',
        a: { u0: i, t0: pos, u1: i, t1: pos + 1, text: a, page: ua.page },
        b: { u0: j, t0: pos, u1: j, t1: pos + 1, text: a, page: B.units[j]?.page ?? 0 },
        note: `still cites ${a}, which is now ${to}`,
      });
    });
  }
  return out;
}
