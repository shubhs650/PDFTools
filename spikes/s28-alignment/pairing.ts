// Spike S28 (M12-03): page signatures and automatic pairing (D-60).
// A signature is (1) a coarse picture of the page's ink, the page squeezed
// to a fixed grid so the same drawing at A1 and A3 looks the same, and (2) a
// fingerprint of its words, weighted by how rare each word is in the two
// documents (a title block repeated on every sheet weighs nothing).

import { boxBlur, type Ink } from './image.ts';
import type { Glyph } from './pdfium.ts';

export const SIG = 32;

export interface Signature {
  /** SIG × SIG ink picture, zero mean, unit length. */
  ink: Float64Array;
  landscape: boolean;
  words: Map<string, number>;
}

/** The ink picture of a page rendered at any resolution. */
export function inkSignature(ink: Ink): Float64Array {
  const g = new Float64Array(SIG * SIG);
  for (let y = 0; y < ink.h; y++) {
    const gy = Math.min(SIG - 1, Math.floor((y * SIG) / ink.h));
    for (let x = 0; x < ink.w; x++) {
      const gx = Math.min(SIG - 1, Math.floor((x * SIG) / ink.w));
      g[gy * SIG + gx] = (g[gy * SIG + gx] ?? 0) + (ink.data[y * ink.w + x] ?? 0) / 255;
    }
  }
  // sqrt tames the frame and solid fills, the blur tolerates a shift.
  for (let i = 0; i < g.length; i++) g[i] = Math.sqrt(g[i] ?? 0);
  boxBlur(g, SIG, SIG, 1);
  let mean = 0;
  for (const v of g) mean += v;
  mean /= g.length;
  let norm = 0;
  for (let i = 0; i < g.length; i++) {
    g[i] = (g[i] ?? 0) - mean;
    norm += (g[i] ?? 0) ** 2;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < g.length; i++) g[i] = (g[i] ?? 0) / norm;
  return g;
}

/** Words of a page from its positioned characters (same line, small gaps). */
export function words(gl: Glyph[]): string[] {
  const out: string[] = [];
  let cur = '';
  let last: Glyph | null = null;
  for (const g of gl) {
    const near =
      last !== null &&
      Math.abs(g.y - last.y) < Math.max(g.size, last.size) * 0.5 &&
      g.x - last.x > -0.1 &&
      g.x - last.x < Math.max(g.size, last.size) * 1.2;
    if (!near && cur) {
      out.push(cur);
      cur = '';
    }
    cur += g.ch;
    last = g;
  }
  if (cur) out.push(cur);
  return out;
}

export function wordBag(ws: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of ws) {
    const k = w.toLowerCase();
    if (k.length < 2) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

const cosine = (a: Float64Array, b: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
};

/** Similarity matrix [A page][B page] in [−1, 1]; text counts half when both pages have words. */
export function similarity(
  sa: Signature[],
  sb: Signature[],
  mode: 'ink' | 'text' | 'both' = 'both',
): { sim: number[][]; ink: number[][]; text: (number | null)[][] } {
  // Inverse document frequency over all pages of both sides.
  const df = new Map<string, number>();
  const all = [...sa, ...sb];
  for (const s of all) for (const k of s.words.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const n = all.length;
  const vec = (s: Signature): Map<string, number> => {
    const v = new Map<string, number>();
    let norm = 0;
    for (const [k, c] of s.words) {
      const w = (1 + Math.log(c)) * Math.log((n + 1) / (df.get(k) ?? 1));
      if (w <= 0) continue;
      v.set(k, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [k, w] of v) v.set(k, w / norm);
    return v;
  };
  const va = sa.map(vec);
  const vb = sb.map(vec);
  const sim: number[][] = [];
  const ink: number[][] = [];
  const text: (number | null)[][] = [];
  sa.forEach((A, i) => {
    const simRow: number[] = [];
    const inkRow: number[] = [];
    const textRow: (number | null)[] = [];
    sim.push(simRow);
    ink.push(inkRow);
    text.push(textRow);
    const ta = va[i] ?? new Map<string, number>();
    sb.forEach((B, j) => {
      let si = cosine(A.ink, B.ink);
      if (A.landscape !== B.landscape) si -= 0.2;
      const tb = vb[j] ?? new Map<string, number>();
      let st: number | null = null;
      if (ta.size > 0 && tb.size > 0) {
        st = 0;
        for (const [k, w] of ta) st += w * (tb.get(k) ?? 0);
      }
      inkRow.push(si);
      textRow.push(st);
      const s = mode === 'ink' || st === null ? si : mode === 'text' ? st : 0.5 * si + 0.5 * st;
      simRow.push(s);
    });
  });
  return { sim, ink, text };
}

export interface Pairing {
  /** [A page, B page], sorted by B page then A. */
  pairs: [number, number][];
  removed: number[];
  added: number[];
}

/**
 * Pairs pages: first an order-keeping alignment (dynamic programming, like a
 * sequence diff) that maximises the summed similarity above `threshold`, then
 * the pages it left over are matched to each other greedily (reordered
 * sheets), still only above the threshold. What stays is removed or added.
 */
export function assignPairs(sim: number[][], threshold: number): Pairing {
  const na = sim.length;
  const nb = sim[0]?.length ?? 0;
  const gain = (i: number, j: number): number => (sim[i]?.[j] ?? -1) - threshold;
  // dp in one flat array: at(i, j) = best total gain of A[i…] against B[j…].
  const dp = new Float64Array((na + 1) * (nb + 1));
  const at = (i: number, j: number): number => dp[i * (nb + 1) + j] ?? 0;
  for (let i = na - 1; i >= 0; i--)
    for (let j = nb - 1; j >= 0; j--) {
      const g = gain(i, j);
      dp[i * (nb + 1) + j] = Math.max(
        at(i + 1, j),
        at(i, j + 1),
        g > 0 ? g + at(i + 1, j + 1) : -Infinity,
      );
    }
  const pairs: [number, number][] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  for (let i = 0, j = 0; i < na && j < nb;) {
    const g = gain(i, j);
    if (g > 0 && at(i, j) === g + at(i + 1, j + 1)) {
      pairs.push([i, j]);
      usedA.add(i);
      usedB.add(j);
      i++;
      j++;
    } else if (at(i, j) === at(i + 1, j)) i++;
    else j++;
  }
  // Leftovers: greedy best first (reordered sheets).
  const left: [number, number, number][] = [];
  for (let i = 0; i < na; i++)
    for (let j = 0; j < nb; j++)
      if (!usedA.has(i) && !usedB.has(j) && gain(i, j) > 0) left.push([gain(i, j), i, j]);
  left.sort((p, q) => q[0] - p[0]);
  for (const [, i, j] of left) {
    if (usedA.has(i) || usedB.has(j)) continue;
    pairs.push([i, j]);
    usedA.add(i);
    usedB.add(j);
  }
  pairs.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  return {
    pairs,
    removed: [...Array(na).keys()].filter((i) => !usedA.has(i)),
    added: [...Array(nb).keys()].filter((j) => !usedB.has(j)),
  };
}
