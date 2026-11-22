// A text comparison's run and view state (M12-19, D-63, D-64, ARCHITECTURE
// §7.16). Compare starts the comparison's work in the workers (rule 1): the
// Work worker reads each page's positioned text (and, when the reviewer
// asks, reads scans by OCR for this comparison only), the Compare worker
// matches the two documents, first on their first pages and then whole, so
// the view fills in progressively (D-66). Changing the inputs or a switch
// (headers and footers, renumbering, hand-drawn bands, OCR) runs it again;
// closing the comparison releases its session.
//
// The view state (sync, colours, filters, the checked ticks, the entry in
// use) is the view's own: nothing here is written into either document.
import { createStore, useStore } from 'zustand';
import { documentStore, type DocumentsState } from '../../../app/store/documentStore';
import type { TextMatchProgress } from '../../../engine/compareApi';
import { isAbortError } from '../../../engine/errors';
import type { HfBands } from '../../../model/compare/text/headers';
import type { TextChange, TextComparison } from '../../../model/compare/text/match';
import {
  DEFAULT_FILTER,
  DEFAULT_MARK_COLOURS,
  type ListFilter,
  type MarkColourKey,
  type MarkColours,
} from '../../../model/compare/textView';
import type { OcrLanguage } from '../../../model/ocr/languages';
import { ocrClient, ocrStore } from '../../ocr/ocrJob';
import { workClient } from '../../view/host';
import { compareClient } from '../engine/compareHost';
import type { QueueProgress } from '../engine/jobQueue';
import { CompareSession, oneFile, type TextState } from '../engine/session';
import { rangePages, type Comparison, type SideId } from '../model';

/** The switches that change what is compared (D-63); changing one runs the comparison again. */
export interface TextRunOptions {
  /** Leave headers and footers out and report a changed one once (experimental). */
  headersFooters: boolean;
  /** Report clause renumbering once (experimental). */
  renumbering: boolean;
  /** Header and footer bands drawn by hand, per side; they replace the detection. */
  bands: { a?: HfBands; b?: HfBands } | null;
  /** Read scanned pages by OCR for this comparison (Q29), in these languages. */
  ocr: OcrLanguage[] | null;
}

export const DEFAULT_RUN_OPTIONS: TextRunOptions = {
  headersFooters: true,
  renumbering: true,
  bands: null,
  ocr: null,
};

/** The pages compared on each side (the page ranges), and their documents. */
export interface TextInputs {
  a: { docId: string; pages: number[]; name: string };
  b: { docId: string; pages: number[]; name: string };
  key: string;
}

export interface TextRun {
  /** The inputs and options this run belongs to. */
  key: string;
  status: 'reading' | 'matching' | 'done' | 'failed' | 'cancelled';
  /** Tasks done of all (pages read, then the matching steps). */
  progress: { done: number; total: number };
  /** The latest result: on the first pages while it runs, then complete. */
  result: TextComparison | null;
  state: TextState | null;
  inputs: TextInputs;
}

/** The hand-drawn bands being edited (null: not drawing). */
export type BandEdit = Record<SideId, HfBands>;

export interface TextView {
  options: TextRunOptions;
  /** Scrolling is synchronised by content (D-64; on by default). */
  sync: boolean;
  colours: MarkColours;
  filter: ListFilter;
  /** The changes ticked as checked, by `changeKey`. */
  checked: string[];
  /** The change in use (selected in the list), by `changeKey`. */
  selected: string | null;
  bandEdit: BandEdit | null;
}

export const DEFAULT_TEXT_VIEW: TextView = {
  options: DEFAULT_RUN_OPTIONS,
  sync: true,
  colours: DEFAULT_MARK_COLOURS,
  filter: DEFAULT_FILTER,
  checked: [],
  selected: null,
  bandEdit: null,
};

interface TextStoreState {
  runs: Record<string, TextRun>;
  views: Record<string, TextView>;
}

export const textStore = createStore<TextStoreState>()(() => ({ runs: {}, views: {} }));

export function useTextRun(id: string): TextRun | undefined {
  return useStore(textStore, (s) => s.runs[id]);
}

export function useTextView(id: string): TextView {
  return useStore(textStore, (s) => s.views[id] ?? DEFAULT_TEXT_VIEW);
}

export function useTextViewPart<T>(id: string, fn: (v: TextView) => T): T {
  return useStore(textStore, (s) => fn(s.views[id] ?? DEFAULT_TEXT_VIEW));
}

export function updateTextView(id: string, fn: (v: TextView) => TextView): void {
  textStore.setState((s) => ({
    views: { ...s.views, [id]: fn(s.views[id] ?? DEFAULT_TEXT_VIEW) },
  }));
}

/**
 * A change's key, steady across the progressive results (the ticks and the
 * entry in use survive a fuller result): its kind and where it starts on
 * each side.
 */
export function changeKey(c: TextChange): string {
  const at = (s: TextChange['a']): string =>
    s ? `${String(s.page)}:${String(s.t0)}:${s.t0 < 0 ? s.text.slice(0, 40) : ''}` : '-';
  return `${c.kind}|${at(c.a)}|${at(c.b)}`;
}

export const setColour = (v: TextView, key: MarkColourKey, hex: string): TextView => ({
  ...v,
  colours: { ...v.colours, [key]: hex },
});

export const toggleChecked = (v: TextView, key: string): TextView => ({
  ...v,
  checked: v.checked.includes(key) ? v.checked.filter((k) => k !== key) : [...v.checked, key],
});

/** The comparison's sides as the session takes them, or null while it cannot run. */
export function textInputs(c: Comparison, docs: DocumentsState['docs']): TextInputs | null {
  if (c.type !== 'text') return null;
  const side = (s: SideId): TextInputs['a'] | null => {
    const f = c[s][0];
    const meta = f ? docs[f.docId]?.meta : undefined;
    if (!f || !meta) return null;
    const r = rangePages(f.range, meta.pageCount);
    return r.ok ? { docId: f.docId, pages: r.pages, name: meta.name } : null;
  };
  const a = side('a');
  const b = side('b');
  if (!a || !b) return null;
  return { a, b, key: JSON.stringify([a.docId, a.pages, b.docId, b.pages]) };
}

const sessions = new Map<string, CompareSession>();

function patchRun(id: string, key: string, fn: (r: TextRun) => Partial<TextRun>): void {
  textStore.setState((s) => {
    const cur = s.runs[id];
    // A run of inputs or options that have changed since is dropped.
    if (cur?.key !== key) return {};
    return { runs: { ...s.runs, [id]: { ...cur, ...fn(cur) } } };
  });
}

function drop(id: string, keepView = true): void {
  const session = sessions.get(id);
  sessions.delete(id);
  void session?.close();
  textStore.setState((s) => {
    const runs = Object.fromEntries(Object.entries(s.runs).filter(([k]) => k !== id));
    const views = keepView
      ? s.views
      : Object.fromEntries(Object.entries(s.views).filter(([k]) => k !== id));
    return { runs, views };
  });
}

let watching = false;

/** Closing a comparison releases its session and forgets its view. */
function watchClosing(): void {
  if (watching) return;
  watching = true;
  documentStore.subscribe((s) => {
    for (const id of Object.keys(textStore.getState().views))
      if (!s.comparisons[id]) drop(id, false);
    for (const id of sessions.keys()) if (!s.comparisons[id]) drop(id, false);
  });
}

const runKey = (inputs: TextInputs, o: TextRunOptions): string => JSON.stringify([inputs.key, o]);

/**
 * Runs the comparison when its inputs or switches are new (the result shows
 * it); a run of other inputs is dropped.
 */
export function syncTextRun(c: Comparison): void {
  watchClosing();
  const inputs = textInputs(c, documentStore.getState().docs);
  if (!inputs) {
    if (sessions.has(c.id) || textStore.getState().runs[c.id]) drop(c.id);
    return;
  }
  const options = (textStore.getState().views[c.id] ?? DEFAULT_TEXT_VIEW).options;
  const key = runKey(inputs, options);
  if (textStore.getState().runs[c.id]?.key === key) return;
  drop(c.id);
  start(c.id, key, inputs, options);
}

/** Runs the comparison again with other switches. */
export function setRunOptions(c: Comparison, fn: (o: TextRunOptions) => TextRunOptions): void {
  updateTextView(c.id, (v) => ({ ...v, options: fn(v.options) }));
  syncTextRun(c);
}

/** Stops the comparison; what is found so far stays. */
export function cancelTextRun(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.cancel();
  const key = textStore.getState().runs[id]?.key;
  if (key) patchRun(id, key, (r) => (r.status === 'done' ? {} : { status: 'cancelled' }));
}

/** The OCR languages a run uses: the last ones the OCR dialog used (English by default). */
export const ocrLanguages = (): OcrLanguage[] => [...ocrStore.getState().languages];

function start(id: string, key: string, inputs: TextInputs, o: TextRunOptions): void {
  const total = inputs.a.pages.length + inputs.b.pages.length;
  const session = new CompareSession(
    oneFile(inputs.a.docId, inputs.a.pages, inputs.a.name),
    oneFile(inputs.b.docId, inputs.b.pages, inputs.b.name),
    {
      work: workClient(),
      compare: compareClient(),
      text: true,
      textOptions: {
        headersFooters: o.headersFooters,
        renumbering: o.renumbering,
        ...(o.bands ? { bands: o.bands } : {}),
      },
      ...(o.ocr ? { ocr: { languages: o.ocr, client: ocrClient() } } : {}),
      onText: (result, state) => {
        patchRun(id, key, (r) => ({
          result,
          state,
          status: state.complete ? 'done' : r.status === 'reading' ? 'matching' : r.status,
        }));
      },
      onProgress: (p: QueueProgress) => {
        patchRun(id, key, () => ({ progress: { done: p.done + p.failed, total: p.total } }));
      },
      onTextProgress: (p: TextMatchProgress) => {
        if (p.stage === 'match')
          patchRun(id, key, (r) => (r.status === 'reading' ? { status: 'matching' } : {}));
      },
    },
  );
  sessions.set(id, session);
  textStore.setState((s) => ({
    runs: {
      ...s.runs,
      [id]: {
        key,
        status: 'reading',
        progress: { done: 0, total },
        result: null,
        state: null,
        inputs,
      },
    },
  }));
  void (async () => {
    try {
      // The Work worker reads from its own copies of the documents.
      const work = workClient();
      await Promise.all([inputs.a.docId, inputs.b.docId].map((d) => work.whenAdded(d, 10_000)));
      await session.start();
      await session.whenDone();
      patchRun(id, key, (r) =>
        r.status === 'done' || r.status === 'cancelled'
          ? {}
          : { status: r.state?.complete ? 'done' : 'failed' },
      );
    } catch (err) {
      if (isAbortError(err)) return;
      patchRun(id, key, () => ({ status: 'failed' }));
    }
  })();
}
