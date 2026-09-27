// Form state on the main thread (M2-14): each page's widgets (one engine call
// per page at the Render worker's normal priority, after the page settles),
// the document's form facts from the Work worker, fills, and Reset Form. No
// parsing here (rule 1): the workers do it.
import type { FormFieldValue, PdfWidgetAnnoObject } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../app/store/documentStore';
import type { FormFacts } from '../../model/formFacts';
import { trackEdit } from '../save/pendingEdits';
import { hostStore, renderEngine, workClient } from '../view/host';
import { fieldKey, resetCalls } from './fields';

interface FormState {
  /** Bumped per document when values change outside a page's own controls. */
  version: Record<string, number>;
  /** The document whose Reset Form confirmation is open. */
  confirmReset: string | null;
  /** A Reset Form in progress: pages done / total. */
  resetting: { docId: string; done: number; total: number } | null;
}

export const formStore = createStore<FormState>()(() => ({
  version: {},
  confirmReset: null,
  resetting: null,
}));

export function useForms<T>(selector: (s: FormState) => T): T {
  return useStore(formStore, selector);
}

let running: AbortController | null = null;
const facts = new Map<string, Promise<FormFacts>>();
const widgets = new Map<string, Promise<PdfWidgetAnnoObject[]>>();

function docObject(docId: string) {
  return hostStore.getState().registry?.getStore().getState().core.documents[docId]?.document;
}

/** /Tabs and /DV (read once per document in the Work worker). */
export function formFactsOf(docId: string): Promise<FormFacts> {
  let p = facts.get(docId);
  if (!p) {
    p = workClient().run('formFacts', { docId }).promise;
    p.catch(() => facts.delete(docId));
    facts.set(docId, p);
  }
  return p;
}

/** A page's widgets, as PDFium now has them. */
export function widgetsOf(docId: string, pageIndex: number): Promise<PdfWidgetAnnoObject[]> {
  const key = `${docId}|${String(pageIndex)}`;
  let p = widgets.get(key);
  if (!p) {
    const doc = docObject(docId);
    const page = doc?.pages[pageIndex];
    if (!doc || !page) return Promise.resolve([]);
    p = new Promise<PdfWidgetAnnoObject[]>((resolve, reject) => {
      renderEngine()
        .engine.getPageAnnoWidgets(doc, page)
        .wait(resolve, () => {
          reject(new Error('widgets'));
        });
    });
    p.catch(() => widgets.delete(key));
    widgets.set(key, p);
  }
  return p;
}

function forgetPage(docId: string, pageIndex: number): void {
  widgets.delete(`${docId}|${String(pageIndex)}`);
}

function bump(docId: string): void {
  // A radio group or a same-named field can span pages: every page reloads.
  for (const key of widgets.keys()) if (key.startsWith(`${docId}|`)) widgets.delete(key);
  formStore.setState((s) => ({ version: { ...s.version, [docId]: (s.version[docId] ?? 0) + 1 } }));
}

function setValue(
  docId: string,
  pageIndex: number,
  widget: PdfWidgetAnnoObject,
  value: FormFieldValue,
): Promise<void> {
  const doc = docObject(docId);
  const page = doc?.pages[pageIndex];
  if (!doc || !page) return Promise.reject(new Error('no-document'));
  return new Promise<void>((resolve, reject) => {
    renderEngine()
      .engine.setFormFieldValue(doc, page, widget, value)
      .wait(
        () => {
          resolve();
        },
        () => {
          reject(new Error('fill'));
        },
      );
  });
}

/** Changes one field (the tab is marked dirty by the hosted engine, M1-22). */
export async function fill(
  docId: string,
  pageIndex: number,
  widget: PdfWidgetAnnoObject,
  value: FormFieldValue,
): Promise<void> {
  try {
    // Saves, prints and exports wait for it (a Ctrl+S from the field, M2-19).
    await trackEdit(setValue(docId, pageIndex, widget, value));
  } finally {
    // Siblings (radio buttons, fields sharing the name) show the new value.
    forgetPage(docId, pageIndex);
    bump(docId);
  }
}

export function askReset(docId: string): void {
  formStore.setState({ confirmReset: docId });
}

export function cancelReset(): void {
  formStore.setState({ confirmReset: null });
}

/**
 * Reset Form (§7.10): every field back to its /DV (none: empty, off, nothing
 * selected), read-only fields left alone. Page by page with progress; the
 * signal stops it between pages (rule 2).
 */
export async function resetForm(docId: string): Promise<void> {
  formStore.setState({ confirmReset: null });
  running?.abort();
  const controller = new AbortController();
  running = controller;
  const { signal } = controller;
  const f = await formFactsOf(docId);
  const pages = f.annotated;
  formStore.setState({ resetting: { docId, done: 0, total: pages.length } });
  try {
    for (const [i, pageIndex] of pages.entries()) {
      if (signal.aborted) break;
      forgetPage(docId, pageIndex);
      const list = await widgetsOf(docId, pageIndex);
      // Radio buttons: the default one first on, so no other call turns the group off after.
      for (const w of list) {
        if (w.field.flag & 1) continue; // read-only (PDF_FORM_FIELD_FLAG.READONLY)
        const dv = f.defaults[Number(fieldKey(w))] ?? null;
        for (const value of resetCalls(w, dv)) {
          // One field PDFium refuses doesn't stop the others.
          await setValue(docId, pageIndex, w, value).catch(() => undefined);
        }
      }
      formStore.setState({ resetting: { docId, done: i + 1, total: pages.length } });
    }
  } finally {
    if (running === controller) running = null;
    formStore.setState({ resetting: null });
    bump(docId);
  }
}

/** Stops a running Reset Form after the current page (fields already reset stay reset). */
export function stopReset(): void {
  running?.abort();
}

/** Forget a closed document's forms. */
function drop(docId: string): void {
  facts.delete(docId);
  for (const key of widgets.keys()) if (key.startsWith(`${docId}|`)) widgets.delete(key);
}

documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  for (const id of Object.keys(prev.docs)) if (!(id in s.docs)) drop(id);
});
