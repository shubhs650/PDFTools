// Quick Find results as navigable data (M2-07, §6): hits grouped by page in
// document order, whatever order the search streamed them in (visible pages
// first). Pages past the 5,000-hit context cap arrive as counts; their hits
// are fetched when navigation reaches them (ADR-006 decision 2). Pure.
import type { Hit } from '../../workers/work/searchCore';

export interface PageHits {
  /** Hits with context, or only their number until fetched. */
  hits: Hit[] | null;
  count: number;
}

export interface FindResults {
  pages: Map<number, PageHits>;
  total: number;
}

/** Where we are: a page and a hit index on it. */
export interface Cursor {
  page: number;
  index: number;
}

export const emptyResults = (): FindResults => ({ pages: new Map(), total: 0 });

/** Adds a streamed batch (immutable update). */
export function addBatch(
  r: FindResults,
  hits: readonly Hit[],
  counts: readonly (readonly [number, number])[],
): FindResults {
  if (hits.length === 0 && counts.length === 0) return r;
  const pages = new Map(r.pages);
  let total = r.total;
  for (const h of hits) {
    const p = pages.get(h.page);
    const list = p?.hits ? [...p.hits, h] : [h];
    pages.set(h.page, { hits: list, count: (p?.count ?? 0) + 1 });
    total++;
  }
  for (const [page, n] of counts) {
    const p = pages.get(page);
    // Hits past the cap on a page that also has detailed hits: all fetched later.
    pages.set(page, { hits: null, count: (p?.count ?? 0) + n });
    total += n;
  }
  return { pages, total };
}

/** Fills a page's fetched hits (the whole page, from searchContext). */
export function fillPage(r: FindResults, page: number, hits: Hit[]): FindResults {
  const pages = new Map(r.pages);
  pages.set(page, { hits, count: hits.length });
  return { pages, total: r.total };
}

const sortedPages = (r: FindResults): number[] => [...r.pages.keys()].sort((a, b) => a - b);

/** The first hit at or after `fromPage` (wrapping), for the first result. */
export function firstFrom(r: FindResults, fromPage: number): Cursor | null {
  const pages = sortedPages(r);
  const page = pages.find((p) => p >= fromPage) ?? pages[0];
  return page === undefined ? null : { page, index: 0 };
}

/** Next (+1) or previous (-1) hit in document order, wrapping around. */
export function step(r: FindResults, c: Cursor, dir: 1 | -1): Cursor | null {
  const cur = r.pages.get(c.page);
  if (!cur) return firstFrom(r, c.page);
  const i = c.index + dir;
  if (i >= 0 && i < cur.count) return { page: c.page, index: i };
  const pages = sortedPages(r);
  const at = pages.indexOf(c.page);
  const next = pages[(at + dir + pages.length) % pages.length];
  if (next === undefined) return null;
  const n = r.pages.get(next)?.count ?? 1;
  return { page: next, index: dir === 1 ? 0 : n - 1 };
}

/** 1-based position of the cursor among all hits (for "n of N"). */
export function ordinal(r: FindResults, c: Cursor): number {
  let n = 0;
  for (const p of sortedPages(r)) {
    if (p === c.page) return n + c.index + 1;
    n += r.pages.get(p)?.count ?? 0;
  }
  return 0;
}
