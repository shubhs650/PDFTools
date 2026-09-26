// Advanced Search results as rows of one virtual list (M2-09, §6): per
// document a header (all-tabs scope), its annotation and bookmark hits, then
// per page (document order) a header and one row per hit. Pages past the
// 5,000-hit context cap are only counted (ADR-006 decision 2), so a row may
// have no hit yet: the list asks for the context of the pages in view. Any
// hit count is cheap: segments, not rows, are stored. Pure.
import type { ExtraHit } from '../../workers/work/search';
import type { Hit } from '../../workers/work/searchCore';
import type { FindResults } from './findModel';

export interface DocGroup {
  docId: string;
  results: FindResults;
  extras: ExtraHit[];
}

export type Row =
  | { kind: 'doc'; docId: string; count: number }
  | { kind: 'page'; docId: string; page: number; count: number }
  | { kind: 'hit'; docId: string; page: number; index: number; hit: Hit | null }
  | { kind: 'extra'; docId: string; index: number; extra: ExtraHit };

type Segment =
  | { start: number; kind: 'doc'; group: number; count: number }
  | { start: number; kind: 'extras'; group: number; count: number }
  | { start: number; kind: 'page'; group: number; page: number; count: number };

export interface RowIndex {
  groups: readonly DocGroup[];
  segments: Segment[];
  count: number;
}

const rowsOf = (s: Segment): number =>
  s.kind === 'page' ? s.count + 1 : s.kind === 'doc' ? 1 : s.count;

export function buildRows(groups: readonly DocGroup[], docHeaders: boolean): RowIndex {
  const segments: Segment[] = [];
  let n = 0;
  const push = (s: Segment): void => {
    segments.push(s);
    n += rowsOf(s);
  };
  groups.forEach((g, group) => {
    const count = g.results.total + g.extras.length;
    if (count === 0) return;
    if (docHeaders) push({ start: n, kind: 'doc', group, count });
    if (g.extras.length) push({ start: n, kind: 'extras', group, count: g.extras.length });
    const pages = [...g.results.pages.keys()].sort((a, b) => a - b);
    for (const page of pages) {
      const c = g.results.pages.get(page)?.count ?? 0;
      if (c > 0) push({ start: n, kind: 'page', group, page, count: c });
    }
  });
  return { groups, segments, count: n };
}

function segmentAt(ix: RowIndex, row: number): Segment | undefined {
  let lo = 0;
  let hi = ix.segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((ix.segments[mid]?.start ?? 0) <= row) lo = mid;
    else hi = mid - 1;
  }
  return ix.segments[lo];
}

export function rowAt(ix: RowIndex, row: number): Row | null {
  if (row < 0 || row >= ix.count) return null;
  const s = segmentAt(ix, row);
  const g = s ? ix.groups[s.group] : undefined;
  if (!s || !g) return null;
  const at = row - s.start;
  if (s.kind === 'doc') return { kind: 'doc', docId: g.docId, count: s.count };
  if (s.kind === 'extras') {
    const extra = g.extras[at];
    return extra ? { kind: 'extra', docId: g.docId, index: at, extra } : null;
  }
  if (at === 0) return { kind: 'page', docId: g.docId, page: s.page, count: s.count };
  const index = at - 1;
  const hits = g.results.pages.get(s.page)?.hits;
  return { kind: 'hit', docId: g.docId, page: s.page, index, hit: hits?.[index] ?? null };
}

/** Pages in rows [from, to] whose hits are only counted: the context to ask for. */
export function pagesWithoutContext(
  ix: RowIndex,
  from: number,
  to: number,
): { docId: string; page: number }[] {
  const out: { docId: string; page: number }[] = [];
  const first = segmentAt(ix, Math.max(0, from));
  if (!first) return out;
  for (let i = ix.segments.indexOf(first); i < ix.segments.length; i++) {
    const s = ix.segments[i];
    if (!s || s.start > to) break;
    if (s.kind !== 'page') continue;
    const g = ix.groups[s.group];
    if (g && !g.results.pages.get(s.page)?.hits) out.push({ docId: g.docId, page: s.page });
  }
  return out;
}

/** The row of a document's hit (page and index), or -1. */
export function rowOf(ix: RowIndex, docId: string, page: number, index: number): number {
  for (const s of ix.segments)
    if (s.kind === 'page' && s.page === page && ix.groups[s.group]?.docId === docId)
      return index < s.count ? s.start + 1 + index : -1;
  return -1;
}

/**
 * Tallest scroll content used (browsers stop at ~33 M px): past it, the
 * scrollbar maps proportionally onto the rows (a million hits still scroll).
 */
const MAX_CONTENT_PX = 8_000_000;

/** Scroll position ↔ row-space offset when the rows are taller than the content. */
export function scrollMap(real: number, viewHeight: number, max = MAX_CONTENT_PX) {
  const shown = Math.min(real, max);
  const k = shown > viewHeight ? Math.max(1, (real - viewHeight) / (shown - viewHeight)) : 1;
  return {
    height: shown,
    /** Row-space offset of the top of the view. */
    toReal: (scrollTop: number) => scrollTop * k,
    toScroll: (realTop: number) => realTop / k,
  };
}
