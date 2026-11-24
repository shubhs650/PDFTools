// Page pairing (M12-09, D-60, ADR-031, ADR-032 §S28): which page of
// Document A is compared with which page of Document B. Pure code: no
// PDFium, no DOM; the Compare worker runs it on the signatures the Work
// worker read (rule 1).
//
// Each page's signature is a coarse picture of its ink and its words. Two
// pages are similar when the pictures correlate and the words agree, the
// words weighted by how rare they are in the two documents (a title block
// repeated on every sheet weighs nothing). Pages are then paired keeping
// order where they can (an order-keeping alignment, like a sequence diff)
// and the pages it leaves are matched to each other best first (reordered
// sheets); what is left was added (B only) or removed (A only). S28 paired
// all 19 overlay pairs of the corpus this way, and showed that a threshold
// alone cannot pair a set: the sheet order does.
//
// With several files per side (an overlay set, Q38) file names help: a file
// of A whose name matches a file of B (revision marks ignored) adds to the
// similarity of their pages, and A's files are put in the order of their
// namesakes in B before the order-keeping pass. No title-block reading.
//
// A "side page" is a page's position in its side: the side's files one after
// the other, each with the pages of its page range.

/** Below this, two pages are never paired automatically (S28). */
export const PAIR_THRESHOLD = 0.35;
/** Ink picture and words count half each when both pages have words (S28). */
export const TEXT_WEIGHT = 0.5;
/** A portrait page against a landscape one (S28). */
export const ORIENTATION_PENALTY = 0.2;
/** How much a pair's shortfall from either page's best partner counts in the ordered pass. */
export const RIVAL_WEIGHT = 1;
/** What matching file names add to the similarity of their pages. */
export const NAME_WEIGHT = 0.25;

/** What pairing needs of a page's signature (material.ts `PageSignature`). */
export interface PairingSignature {
  /** The ink picture: zero mean, unit length (all zero on a blank page). */
  ink: Float32Array;
  landscape: boolean;
  words: readonly string[];
}

export interface PairingSide {
  /** One signature per side page. */
  pages: readonly PairingSignature[];
  /** The file each side page comes from (index into `names`); default: all file 0. */
  files?: readonly number[];
  /** The side's file names, in set order. */
  names?: readonly string[];
}

export interface Pairing {
  /** [A side page, B side page], in B's order. */
  pairs: [number, number][];
  /** A pages with no partner. */
  removed: number[];
  /** B pages with no partner. */
  added: number[];
}

export interface PairingResult extends Pairing {
  na: number;
  nb: number;
  /** Similarity of A page i and B page j at `i * nb + j` (file names included). */
  sim: Float32Array;
}

// ----------------------------------------------------------------- words ---

/** A page's words as counts: lower case, single characters dropped (S28). */
export function wordBag(words: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of words) {
    const k = w.toLowerCase();
    if (k.length < 2) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** tf-idf vectors of unit length, the document frequency over every page of both sides. */
function wordVectors(bags: Map<string, number>[]): Map<string, number>[] {
  const df = new Map<string, number>();
  for (const bag of bags) for (const k of bag.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const n = bags.length;
  return bags.map((bag) => {
    const v = new Map<string, number>();
    let norm = 0;
    for (const [k, c] of bag) {
      const w = (1 + Math.log(c)) * Math.log((n + 1) / (df.get(k) ?? 1));
      if (w <= 0) continue;
      v.set(k, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [k, w] of v) v.set(k, w / norm);
    return v;
  });
}

// ----------------------------------------------------------------- names ---

/** Words of a file name that mark a revision or a state, not the sheet. */
const REVISION_WORDS = new Set([
  'rev',
  'revision',
  'old',
  'new',
  'draft',
  'final',
  'copy',
  'current',
  'latest',
  'issued',
  'issue',
  'superseded',
  'ifc',
  'ifr',
  'ifa',
  'ifp',
  'pdf',
]);

/**
 * A file name reduced to what names the sheet: lower case, no extension,
 * split into words and numbers, revision marks dropped ("Rev B", "RevB",
 * "R2", "v3", "_B" at the end, dates, "old", "new", "IFC" …).
 */
export function sheetNameKey(name: string): string {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, '').toLowerCase();
  const raw = base.split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i] ?? '';
    const before = raw[i - 1];
    // The word right after "rev" is the revision itself ("Rev B", "rev 03").
    if (before === 'rev' || before === 'revision') continue;
    if (REVISION_WORDS.has(w)) continue;
    // Glued revisions ("revb", "rev2", "r02", "v3") and dates of six or eight digits.
    if (/^rev[\p{L}\p{N}]{1,3}$/u.test(w) || /^[rv]\d{1,3}$/.test(w)) continue;
    if (/^(19|20)\d{4}(\d{2})?$/.test(w)) continue;
    out.push(w);
  }
  // A single letter last, after a sheet number, is a revision letter ("S-101 B").
  if (/^\p{L}$/u.test(out[out.length - 1] ?? '') && /\d/.test(out[out.length - 2] ?? '')) out.pop();
  return out.join(' ');
}

/** 1 when two file names name the same sheet, else 0. */
export function nameSimilarity(a: string, b: string): number {
  const ka = sheetNameKey(a);
  return ka !== '' && ka === sheetNameKey(b) ? 1 : 0;
}

// ------------------------------------------------------------ similarity ---

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
};

/** Whether file names take part: both sides are sets of several files. */
const usesNames = (a: PairingSide, b: PairingSide): boolean =>
  (a.names?.length ?? 0) > 1 && (b.names?.length ?? 0) > 1;

/**
 * The similarity of every A page with every B page (row-major, A by B), in
 * about [−1.2, 1.25]: ink correlation, half and half with the word cosine
 * when both pages have words; less for a portrait page against a landscape
 * one; more when the pages' files have the same sheet name.
 */
export function similarityMatrix(
  a: PairingSide,
  b: PairingSide,
  tick?: (done: number, total: number) => void,
): Float32Array {
  const na = a.pages.length;
  const nb = b.pages.length;
  const vectors = wordVectors([...a.pages, ...b.pages].map((p) => wordBag(p.words)));
  const names = usesNames(a, b);
  const sameName: boolean[][] = [];
  if (names) {
    const kb = (b.names ?? []).map(sheetNameKey);
    for (const n of a.names ?? []) {
      const k = sheetNameKey(n);
      sameName.push(kb.map((x) => k !== '' && x === k));
    }
  }
  const sim = new Float32Array(na * nb);
  for (let i = 0; i < na; i++) {
    const A = a.pages[i];
    const ta = vectors[i];
    if (!A || !ta) continue;
    for (let j = 0; j < nb; j++) {
      const B = b.pages[j];
      const tb = vectors[na + j];
      if (!B || !tb) continue;
      let s = dot(A.ink, B.ink);
      if (A.landscape !== B.landscape) s -= ORIENTATION_PENALTY;
      if (ta.size > 0 && tb.size > 0) {
        let st = 0;
        for (const [k, w] of ta) st += w * (tb.get(k) ?? 0);
        s = (1 - TEXT_WEIGHT) * s + TEXT_WEIGHT * st;
      }
      if (names && sameName[a.files?.[i] ?? 0]?.[b.files?.[j] ?? 0]) s += NAME_WEIGHT;
      sim[i * nb + j] = s;
    }
    // A row is nb × 1,024 products: a cancel or progress point every 16 rows.
    if (tick && (i % 16 === 15 || i === na - 1)) tick(i + 1, na);
  }
  return sim;
}

// ------------------------------------------------------------ assignment ---

/**
 * Pairs pages on a similarity matrix: first an order-keeping alignment
 * (dynamic programming) that maximises the summed similarity above
 * `threshold`, less each pair's shortfall from its pages' best partners,
 * walking A in `orderA` (default: as given); then the pages it left are
 * matched to each other best first (reordered sheets), only above the
 * threshold. What stays is removed (A) or added (B).
 */
export function assignPairs(
  sim: Float32Array,
  na: number,
  nb: number,
  threshold = PAIR_THRESHOLD,
  orderA?: readonly number[],
): Pairing {
  const order = orderA ?? [...Array(na).keys()];
  // Each page's best similarity: a pair counts less in the ordered pass by how
  // far it falls short of either page's best partner, so two mediocre pairs in
  // order never beat two good pairs out of order (swapped sheets that look alike).
  const bestA = new Float64Array(na).fill(-Infinity);
  const bestB = new Float64Array(nb).fill(-Infinity);
  for (let i = 0; i < na; i++)
    for (let j = 0; j < nb; j++) {
      const s = sim[i * nb + j] ?? -1;
      if (s > (bestA[i] ?? 0)) bestA[i] = s;
      if (s > (bestB[j] ?? 0)) bestB[j] = s;
    }
  const gain = (k: number, j: number): number => {
    const i = order[k] ?? 0;
    const s = sim[i * nb + j] ?? -1;
    return s - threshold - RIVAL_WEIGHT * ((bestA[i] ?? s) - s + (bestB[j] ?? s) - s);
  };
  const w = nb + 1;
  const dp = new Float64Array((na + 1) * w);
  const at = (k: number, j: number): number => dp[k * w + j] ?? 0;
  for (let k = na - 1; k >= 0; k--)
    for (let j = nb - 1; j >= 0; j--) {
      const g = gain(k, j);
      dp[k * w + j] = Math.max(
        at(k + 1, j),
        at(k, j + 1),
        g > 0 ? g + at(k + 1, j + 1) : -Infinity,
      );
    }
  const pairs: [number, number][] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  for (let k = 0, j = 0; k < na && j < nb;) {
    const g = gain(k, j);
    if (g > 0 && at(k, j) === g + at(k + 1, j + 1)) {
      const i = order[k] ?? 0;
      pairs.push([i, j]);
      usedA.add(i);
      usedB.add(j);
      k++;
      j++;
    } else if (at(k, j) === at(k + 1, j)) k++;
    else j++;
  }
  const left: [number, number, number][] = [];
  for (let i = 0; i < na; i++) {
    if (usedA.has(i)) continue;
    for (let j = 0; j < nb; j++) {
      const s = (sim[i * nb + j] ?? -1) - threshold;
      if (!usedB.has(j) && s > 0) left.push([s, i, j]);
    }
  }
  left.sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2]);
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

/**
 * A's side pages in the order the order-keeping pass walks them: A's files
 * sorted by the position of their namesake in B (a file without one keeps
 * its place after the file before it), pages within a file as they are.
 */
export function orderByNames(a: PairingSide, b: PairingSide): number[] {
  const na = a.pages.length;
  const identity = [...Array(na).keys()];
  if (!usesNames(a, b)) return identity;
  const kb = (b.names ?? []).map(sheetNameKey);
  let last = -1;
  const rank = (a.names ?? []).map((n, f) => {
    const k = sheetNameKey(n);
    const at = k === '' ? -1 : kb.indexOf(k);
    // Ties keep the set order; a file without a namesake follows its predecessor.
    last = at >= 0 ? at : last;
    return { f, key: at >= 0 ? at : last + 0.5 };
  });
  rank.sort((p, q) => p.key - q.key || p.f - q.f);
  const fileOrder = new Map(rank.map((r, i) => [r.f, i]));
  return identity.sort(
    (p, q) =>
      (fileOrder.get(a.files?.[p] ?? 0) ?? 0) - (fileOrder.get(a.files?.[q] ?? 0) ?? 0) || p - q,
  );
}

/** Automatic pairing of two sides (D-60): similarity, then the assignment. */
export function pairPages(
  a: PairingSide,
  b: PairingSide,
  threshold = PAIR_THRESHOLD,
  tick?: (done: number, total: number) => void,
): PairingResult {
  const na = a.pages.length;
  const nb = b.pages.length;
  const sim = similarityMatrix(a, b, tick);
  return { ...assignPairs(sim, na, nb, threshold, orderByNames(a, b)), na, nb, sim };
}

// --------------------------------------------------------- pairing table ---

/**
 * One row of the editable pairing table: a sheet. A page on one side only
 * is an added (B) or removed (A) sheet. An excluded sheet is not compared.
 */
export interface PairRow {
  a: number | null;
  b: number | null;
  excluded: boolean;
}

/**
 * The table of a pairing, in B's order (the new revision's order); a
 * removed A page comes right after the sheet of the A page before it.
 */
export function pairingRows(p: Pairing): PairRow[] {
  const byB = new Map(p.pairs.map(([a, b]) => [b, a]));
  const rows: PairRow[] = [];
  const bs = [...new Set([...p.pairs.map(([, b]) => b), ...p.added])].sort((x, y) => x - y);
  for (const b of bs) rows.push({ a: byB.get(b) ?? null, b, excluded: false });
  for (const r of [...p.removed].sort((x, y) => x - y)) {
    let at = 0;
    let best = -1;
    rows.forEach((row, k) => {
      if (row.a !== null && row.a < r && row.a > best) {
        best = row.a;
        at = k + 1;
      }
    });
    rows.splice(at, 0, { a: r, b: null, excluded: false });
  }
  return rows;
}

/** The pairing a table shows (excluded sheets count as pairs). */
export function rowsPairing(rows: readonly PairRow[]): Pairing {
  const pairs: [number, number][] = [];
  const removed: number[] = [];
  const added: number[] = [];
  for (const r of rows) {
    if (r.a !== null && r.b !== null) pairs.push([r.a, r.b]);
    else if (r.a !== null) removed.push(r.a);
    else if (r.b !== null) added.push(r.b);
  }
  return { pairs, removed, added };
}

/**
 * Gives sheet `row` the page `page` of `side` (null: none). The page leaves
 * the sheet it was on; the page the sheet had on that side becomes a sheet of
 * its own right after it. Sheets left with no page go.
 */
export function setPartner(
  rows: readonly PairRow[],
  row: number,
  side: 'a' | 'b',
  page: number | null,
): PairRow[] {
  const target = rows[row];
  if (!target || target[side] === page) return [...rows];
  const old = target[side];
  const out: (PairRow | null)[] = rows.map((r) => ({ ...r }));
  if (page !== null)
    out.forEach((r, k) => {
      if (r && k !== row && r[side] === page) out[k] = { ...r, [side]: null };
    });
  out[row] = { ...target, [side]: page };
  if (old !== null) {
    const alone: PairRow =
      side === 'a' ? { a: old, b: null, excluded: false } : { a: null, b: old, excluded: false };
    out.splice(row + 1, 0, alone);
  }
  return out.filter((r): r is PairRow => r !== null && (r.a !== null || r.b !== null));
}

/** Splits a sheet into its A page (removed) and its B page (added). */
export function unpair(rows: readonly PairRow[], row: number): PairRow[] {
  const r = rows[row];
  if (r?.a == null || r.b === null) return [...rows];
  return [
    ...rows.slice(0, row),
    { a: null, b: r.b, excluded: r.excluded },
    { a: r.a, b: null, excluded: r.excluded },
    ...rows.slice(row + 1),
  ];
}

export function setExcluded(rows: readonly PairRow[], row: number, excluded: boolean): PairRow[] {
  return rows.map((r, k) => (k === row ? { ...r, excluded } : r));
}

/** The sheets to compare: rows with a page on both sides, not excluded, in table order. */
export function comparedPairs(rows: readonly PairRow[]): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (const r of rows)
    if (!r.excluded && r.a !== null && r.b !== null) out.push({ a: r.a, b: r.b });
  return out;
}

/** Whether a table differs from the automatic pairing it started from. */
export function isEdited(rows: readonly PairRow[], auto: Pairing): boolean {
  const mine = rowsPairing(rows);
  const key = (p: Pairing): string =>
    JSON.stringify([
      [...p.pairs].sort((x, y) => x[0] - y[0] || x[1] - y[1]),
      [...p.removed].sort((x, y) => x - y),
      [...p.added].sort((x, y) => x - y),
    ]);
  return rows.some((r) => r.excluded) || key(mine) !== key(auto);
}

/** Similarity of A page `a` and B page `b` in a result, or null. */
export function scoreOf(r: PairingResult, a: number | null, b: number | null): number | null {
  if (a === null || b === null || a >= r.na || b >= r.nb) return null;
  return r.sim[a * r.nb + b] ?? null;
}

/** A paired sheet matching below this is marked "Check" in the input window (ADR-033). */
export const CHECK_BELOW = 0.5;

/** Why a sheet of the pairing table needs a look, or null. */
export type RowCheck = 'low' | 'added' | 'removed';

/**
 * Whether a sheet needs a look before Compare (M12-24, ADR-033): a page added
 * in B or removed from A, or a pair matching below CHECK_BELOW. A sheet left
 * out of the comparison, or with no score (an area comparison), is not marked.
 */
export function rowCheck(row: PairRow, score: number | null): RowCheck | null {
  if (row.a === null) return 'added';
  if (row.b === null) return 'removed';
  if (row.excluded || score === null) return null;
  return score < CHECK_BELOW ? 'low' : null;
}

/**
 * Candidates for the partner of a page, best first: the other side's pages by
 * similarity (at most `limit`), always including `keep` (the current partner).
 */
export function candidates(
  r: PairingResult,
  side: 'a' | 'b',
  page: number,
  limit: number,
  keep: number | null = null,
): number[] {
  const n = side === 'a' ? r.nb : r.na;
  const s = (k: number): number =>
    (side === 'a' ? r.sim[page * r.nb + k] : r.sim[k * r.nb + page]) ?? -Infinity;
  const all = [...Array(n).keys()].sort((x, y) => s(y) - s(x) || x - y);
  const top = all.slice(0, limit);
  if (keep !== null && keep < n && !top.includes(keep)) top.push(keep);
  return top;
}
