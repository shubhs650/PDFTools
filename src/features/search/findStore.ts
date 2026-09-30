// Quick Find (Ctrl+F, D-08, §6, M2-07). Typing only edits the query; Enter
// (or the button) runs it in the Work worker (rule 3). Results stream into
// findModel.ts; next/previous walk them in document order, scroll to each hit
// and the highlight layer draws the hits of the pages in view. One search at
// a time: a new one cancels the last (SearchSession).
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import { isAbortError } from '../../engine/errors';
import { SearchSession } from '../../engine/searchSession';
import type { HitRect } from '../../workers/work/search';
import type { SearchOptions } from '../../workers/work/searchCore';
import { goToPoint } from '../view/controller';
import { workClient } from '../view/host';
import {
  addBatch,
  emptyResults,
  fillPage,
  firstFrom,
  ordinal,
  step,
  type Cursor,
  type FindResults,
} from './findModel';

export type FindStatus = 'idle' | 'searching' | 'done' | 'error';

export interface FindState {
  open: boolean;
  /** Hits are drawn: the bar is open, or Advanced Search jumped to a hit (M2-09). */
  highlights: boolean;
  /** Document the results belong to. */
  docId: string | null;
  query: string;
  options: Pick<SearchOptions, 'matchCase' | 'wholeWord'>;
  /** Query and options of the results shown (null before the first search). */
  ran: { query: string; options: SearchOptions } | null;
  status: FindStatus;
  /** A `search-*` error code (never a message, rule 10). */
  error: string | null;
  results: FindResults;
  cursor: Cursor | null;
  pagesDone: number;
  pageCount: number;
  /** Bumped per search, so the highlight layer drops rectangles of older results. */
  generation: number;
  /** Bumped by every Ctrl+F: the bar (re)focuses its field. */
  focusRequest: number;
}

const initial = (): FindState => ({
  open: false,
  highlights: false,
  docId: null,
  query: '',
  options: {},
  ran: null,
  status: 'idle',
  error: null,
  results: emptyResults(),
  cursor: null,
  pagesDone: 0,
  pageCount: 0,
  generation: 0,
  focusRequest: 0,
});

export const findStore = createStore<FindState>()(initial);

export function useFind<T>(selector: (s: FindState) => T): T {
  return useStore(findStore, selector);
}

let session: SearchSession | null = null;
const sessionFor = (): SearchSession => (session ??= new SearchSession(workClient()));

/** Hit rectangles per page for the current results (generation-keyed). */
const rectCache = new Map<string, Promise<HitRect[][]>>();

const activeDocId = (): string | null => documentStore.getState().activeId;

/** Ctrl+F: opens the bar (the component focuses the field). */
export function openFind(): void {
  const docId = activeDocId();
  const s = findStore.getState();
  if (docId !== s.docId) resetResults(docId);
  findStore.setState((cur) => ({
    open: true,
    highlights: true,
    docId,
    focusRequest: cur.focusRequest + 1,
  }));
}

export function closeFind(): void {
  cancelFind();
  findStore.setState({ open: false, highlights: false });
}

export function setQuery(query: string): void {
  findStore.setState({ query }); // never searches (D-08, rule 3)
}

export function setOption(name: 'matchCase' | 'wholeWord', on: boolean): void {
  findStore.setState((s) => ({ options: { ...s.options, [name]: on } }));
}

/** Pages changed (M4-09): hits of the document point at old page indexes. */
export function dropFindResults(docId: string): void {
  if (findStore.getState().docId === docId) resetResults(docId);
}

function resetResults(docId: string | null): void {
  rectCache.clear();
  findStore.setState((s) => ({
    docId,
    ran: null,
    status: 'idle',
    error: null,
    results: emptyResults(),
    cursor: null,
    pagesDone: 0,
    pageCount: 0,
    generation: s.generation + 1,
  }));
}

const sameRun = (s: FindState): boolean =>
  s.ran !== null &&
  s.ran.query === s.query.trim() &&
  !!s.ran.options.matchCase === !!s.options.matchCase &&
  !!s.ran.options.wholeWord === !!s.options.wholeWord;

/** Enter / the Next button: run the query, or go to the next hit if it already ran. */
export async function findNext(dir: 1 | -1 = 1): Promise<void> {
  const s = findStore.getState();
  const docId = activeDocId();
  if (!docId || !s.query.trim()) return;
  if (docId === s.docId && sameRun(s) && s.status !== 'error') {
    await move(dir);
    return;
  }
  await runSearch(docId);
}

export function cancelFind(): void {
  if (findStore.getState().status === 'searching') {
    sessionFor().cancel();
    findStore.setState({ status: 'done' });
  }
}

async function runSearch(docId: string): Promise<void> {
  resetResults(docId);
  const { query, options } = findStore.getState();
  const from = documentStore.getState().docs[docId]?.view.page ?? 0;
  findStore.setState({
    status: 'searching',
    ran: { query: query.trim(), options: { ...options } },
  });
  const { promise } = sessionFor().start({ docId, query, options, visible: [from] }, (batch) => {
    const s = findStore.getState();
    const results = addBatch(s.results, batch.hits, batch.counts);
    const cursor = s.cursor ?? firstFrom(results, from);
    findStore.setState({
      results,
      cursor,
      pagesDone: batch.pagesDone,
      pageCount: batch.pageCount,
    });
    if (!s.cursor && cursor) void show(cursor);
  });
  try {
    const summary = await promise;
    findStore.setState({ status: 'done', pagesDone: summary.pageCount });
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (isAbortError(err)) return; // superseded or cancelled
    findStore.setState({
      status: 'error',
      error: typeof code === 'string' && code.startsWith('search-') ? code : 'search-failed',
    });
  }
}

async function move(dir: 1 | -1): Promise<void> {
  const s = findStore.getState();
  const cursor = s.cursor ? step(s.results, s.cursor, dir) : firstFrom(s.results, 0);
  if (!cursor) return;
  findStore.setState({ cursor });
  await show(cursor);
}

/** Loads a page's hits when only their count is known (past the context cap). */
async function hitsOf(page: number) {
  const s = findStore.getState();
  const entry = s.results.pages.get(page);
  if (entry?.hits) return entry.hits;
  if (!s.docId || !s.ran) return [];
  const gen = s.generation;
  const hits = await workClient().run('searchContext', {
    docId: s.docId,
    query: s.ran.query,
    options: s.ran.options,
    pages: [page],
  }).promise;
  if (findStore.getState().generation === gen)
    findStore.setState((cur) => ({ results: fillPage(cur.results, page, hits) }));
  return hits;
}

/** Highlight rectangles of every hit on `page` (cached for the current results). */
export function rectsFor(page: number): Promise<HitRect[][]> {
  const s = findStore.getState();
  const key = `${String(s.generation)}:${String(page)}`;
  let p = rectCache.get(key);
  if (!p) {
    const docId = s.docId;
    p = hitsOf(page).then((hits) =>
      docId && hits.length
        ? workClient().run('hitRects', { docId, pageIndex: page, hits }).promise
        : [],
    );
    rectCache.set(key, p);
    p.catch(() => rectCache.delete(key));
  }
  return p;
}

/** Scrolls the current hit into view. */
async function show(c: Cursor): Promise<void> {
  const gen = findStore.getState().generation;
  const rects = await rectsFor(c.page).catch(() => []);
  const s = findStore.getState();
  if (s.generation !== gen || s.cursor?.page !== c.page || s.cursor.index !== c.index) return;
  const r = rects[c.index]?.[0];
  goToPoint(c.page, r?.x ?? 0, r?.y ?? 0);
}

/**
 * Advanced Search (M2-09) shows one of its hits: its results for that
 * document become the current results (highlighted; F3 walks them), and the
 * view scrolls to the hit.
 */
export async function showResults(
  docId: string,
  ran: { query: string; options: SearchOptions },
  results: FindResults,
  cursor: Cursor,
): Promise<void> {
  if (session && findStore.getState().status === 'searching') session.cancel();
  rectCache.clear();
  findStore.setState((s) => ({
    highlights: true,
    docId,
    query: ran.query,
    options: { matchCase: !!ran.options.matchCase, wholeWord: !!ran.options.wholeWord },
    ran,
    status: 'done',
    error: null,
    results,
    cursor,
    pagesDone: 0,
    pageCount: 0,
    generation: s.generation + 1,
  }));
  await show(cursor);
}

/** 1-based position of the current hit ("n" of "n of N"; the total is results.total). */
export function currentOrdinal(s: FindState): number {
  return s.cursor ? ordinal(s.results, s.cursor) : 0;
}
