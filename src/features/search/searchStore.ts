// Advanced Search (Ctrl+Shift+F, D-08, §6, M2-09): options, scope over the
// current document or all open tabs, annotation text and bookmark titles
// (read-only, M2-Q3). Typing only edits the query; Enter or the Search
// button runs it in the Work worker (rule 3). Documents are searched one
// after another (the current one first); a new search cancels the running
// one. Results stay while other panes are shown.
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import { isAbortError } from '../../engine/errors';
import { SearchSession } from '../../engine/searchSession';
import type { ExtraHit } from '../../workers/work/search';
import type { Hit, SearchOptions } from '../../workers/work/searchCore';
import { goToPage, goToPoint } from '../view/controller';
import { recordJump } from '../view/viewHistory';
import { workClient } from '../view/host';
import { addBatch, emptyResults, fillPage } from './findModel';
import { showResults } from './findStore';
import type { DocGroup } from './resultRows';

export type SearchScope = 'document' | 'all';
export type SearchStatus = 'idle' | 'searching' | 'done' | 'cancelled' | 'error';

export interface AdvancedOptions extends Required<SearchOptions> {
  annotations: boolean;
  bookmarks: boolean;
}

export interface SearchState {
  query: string;
  options: AdvancedOptions;
  scope: SearchScope;
  /** What the results shown were searched with (null before the first search). */
  ran: { query: string; options: AdvancedOptions; scope: SearchScope } | null;
  status: SearchStatus;
  /** A `search-*` error code (never a message, rule 10). */
  error: string | null;
  groups: DocGroup[];
  total: number;
  /** Documents searched so far / to search. */
  docsDone: number;
  docCount: number;
  /** Pages searched in the current document / its page count. */
  pagesDone: number;
  pageCount: number;
  /** Bumped per search: late answers of older searches are dropped. */
  generation: number;
  /** Bumped by Ctrl+Shift+F: the pane (re)focuses its field. */
  focusRequest: number;
}

const initial = (): SearchState => ({
  query: '',
  options: {
    matchCase: false,
    wholeWord: false,
    wildcards: false,
    regex: false,
    annotations: false,
    bookmarks: false,
  },
  scope: 'document',
  ran: null,
  status: 'idle',
  error: null,
  groups: [],
  total: 0,
  docsDone: 0,
  docCount: 0,
  pagesDone: 0,
  pageCount: 0,
  generation: 0,
  focusRequest: 0,
});

export const searchStore = createStore<SearchState>()(initial);

export function useSearch<T>(selector: (s: SearchState) => T): T {
  return useStore(searchStore, selector);
}

let session: SearchSession | null = null;
const sessionFor = (): SearchSession => (session ??= new SearchSession(workClient()));
let extrasJob: { cancel(): void } | null = null;

export function setSearchQuery(query: string): void {
  searchStore.setState({ query }); // never searches (D-08, rule 3)
}

export function setSearchOption(name: keyof AdvancedOptions, on: boolean): void {
  searchStore.setState((s) => {
    const options = { ...s.options, [name]: on };
    // Wildcards and regex are two query languages: one at a time.
    if (on && name === 'regex') options.wildcards = false;
    if (on && name === 'wildcards') options.regex = false;
    return { options };
  });
}

export function setScope(scope: SearchScope): void {
  searchStore.setState({ scope });
}

export function requestSearchFocus(): void {
  searchStore.setState((s) => ({ focusRequest: s.focusRequest + 1 }));
}

/** Stops the running search; what was found so far stays. */
export function cancelSearch(): void {
  if (searchStore.getState().status !== 'searching') return;
  stop();
  searchStore.setState((s) => ({ status: 'cancelled', generation: s.generation + 1 }));
}

function stop(): void {
  session?.cancel();
  extrasJob?.cancel();
  extrasJob = null;
}

const textOptions = (o: AdvancedOptions): SearchOptions => ({
  matchCase: o.matchCase,
  wholeWord: o.wholeWord,
  wildcards: o.wildcards,
  regex: o.regex,
});

/** Enter / the Search button. */
export async function runAdvancedSearch(): Promise<void> {
  const s = searchStore.getState();
  const query = s.query.trim();
  const docs = documentStore.getState();
  if (!query || !docs.activeId) return;
  stop();
  const active = docs.activeId;
  const ids = s.scope === 'all' ? [active, ...docs.order.filter((id) => id !== active)] : [active];
  const generation = s.generation + 1;
  const ran = { query, options: { ...s.options }, scope: s.scope };
  searchStore.setState({
    ran,
    status: 'searching',
    error: null,
    groups: ids.map((docId) => ({ docId, results: emptyResults(), extras: [] })),
    total: 0,
    docsDone: 0,
    docCount: ids.length,
    pagesDone: 0,
    pageCount: 0,
    generation,
  });
  const live = (): boolean => searchStore.getState().generation === generation;
  const update = (docId: string, fn: (g: DocGroup) => DocGroup): void => {
    searchStore.setState((cur) => {
      const groups = cur.groups.map((g) => (g.docId === docId ? fn(g) : g));
      const total = groups.reduce((n, g) => n + g.results.total + g.extras.length, 0);
      return { groups, total };
    });
  };
  try {
    for (const docId of ids) {
      if (!live()) return;
      const from = documentStore.getState().docs[docId]?.view.page ?? 0;
      const { promise } = sessionFor().start(
        { docId, query, options: textOptions(ran.options), visible: [from] },
        (batch) => {
          if (!live()) return;
          update(docId, (g) => ({ ...g, results: addBatch(g.results, batch.hits, batch.counts) }));
          searchStore.setState({ pagesDone: batch.pagesDone, pageCount: batch.pageCount });
        },
      );
      await promise;
      if (ran.options.annotations || ran.options.bookmarks) {
        const job = workClient().run('searchExtras', {
          docId,
          query,
          options: textOptions(ran.options),
          annotations: ran.options.annotations,
          bookmarks: ran.options.bookmarks,
        });
        extrasJob = job;
        const extras = await job.promise;
        if (!live()) return;
        update(docId, (g) => ({ ...g, extras: sortExtras(extras) }));
      }
      if (live()) searchStore.setState((cur) => ({ docsDone: cur.docsDone + 1 }));
    }
    if (live()) searchStore.setState({ status: 'done' });
  } catch (err) {
    if (!live() || isAbortError(err)) return;
    const code = (err as { code?: unknown }).code;
    searchStore.setState({
      status: 'error',
      error: typeof code === 'string' && code.startsWith('search-') ? code : 'search-failed',
    });
  } finally {
    if (live()) extrasJob = null;
  }
}

/** Bookmarks first (document outline order), then annotations by page. */
function sortExtras(extras: ExtraHit[]): ExtraHit[] {
  const bookmarks = extras.filter((e) => e.source === 'bookmark');
  const annots = extras.filter((e) => e.source === 'annotation').sort((a, b) => a.page - b.page);
  return [...bookmarks, ...annots];
}

const pending = new Set<string>();

/** The list shows rows of pages past the context cap: fetch their hits. */
export function requestContext(pages: readonly { docId: string; page: number }[]): void {
  const s = searchStore.getState();
  const ran = s.ran;
  if (!ran) return;
  const byDoc = new Map<string, number[]>();
  for (const { docId, page } of pages) {
    const key = `${String(s.generation)}:${docId}:${String(page)}`;
    if (pending.has(key)) continue;
    pending.add(key);
    byDoc.set(docId, [...(byDoc.get(docId) ?? []), page]);
  }
  for (const [docId, list] of byDoc) {
    const gen = s.generation;
    workClient()
      .run('searchContext', {
        docId,
        query: ran.query,
        options: textOptions(ran.options),
        pages: list,
      })
      .promise.then(
        (hits) => {
          if (searchStore.getState().generation !== gen) return;
          const perPage = new Map<number, Hit[]>(list.map((p) => [p, []]));
          for (const h of hits) perPage.get(h.page)?.push(h);
          searchStore.setState((cur) => ({
            groups: cur.groups.map((g) =>
              g.docId === docId
                ? {
                    ...g,
                    results: [...perPage].reduce((r, [p, hs]) => fillPage(r, p, hs), g.results),
                  }
                : g,
            ),
          }));
        },
        () => {
          for (const p of list) pending.delete(`${String(gen)}:${docId}:${String(p)}`);
        },
      );
  }
}

/**
 * Makes `docId` the active tab's document view; a jump within the active
 * document is recorded for Previous View (M2-10).
 */
async function activate(docId: string): Promise<void> {
  const docs = documentStore.getState();
  if (docs.activeId === docId) {
    recordJump();
    return;
  }
  docs.activate(docId);
  // The document view mounts on the next frames.
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
}

/** Enter or click on a result: open its tab, scroll to it, highlight it. */
export async function openHit(docId: string, page: number, index: number): Promise<void> {
  const s = searchStore.getState();
  const g = s.groups.find((x) => x.docId === docId);
  if (!g || !s.ran || !documentStore.getState().docs[docId]) return;
  await activate(docId);
  await showResults(docId, { query: s.ran.query, options: textOptions(s.ran.options) }, g.results, {
    page,
    index,
  });
}

export async function openExtra(docId: string, extra: ExtraHit): Promise<void> {
  if (!documentStore.getState().docs[docId] || extra.page < 0) return;
  await activate(docId);
  if (extra.rect) goToPoint(extra.page, extra.rect.x, extra.rect.y);
  else goToPage(extra.page);
}

documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const id of Object.keys(prev.docs)) if (!(id in s.docs)) dropDocument(id);
});

/** A closed document's results go (its rows would lead nowhere). */
export function dropDocument(docId: string): void {
  searchStore.setState((cur) => {
    const groups = cur.groups.filter((g) => g.docId !== docId);
    if (groups.length === cur.groups.length) return {};
    return { groups, total: groups.reduce((n, g) => n + g.results.total + g.extras.length, 0) };
  });
}
