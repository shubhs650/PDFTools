// The attached measurements export (M14-10, D-76, Q18): whether a document
// holds one (read once from the Render worker, then kept as this session
// attaches), and so whether the Measurements pane says it is out of date:
// its stamp (model/measureExport.ts) differs from the one the measurements
// would give now. Refreshing is only ever on request; Ctrl+S never does it.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore } from '../../../app/store/documentStore';
import { renderEngine } from '../../view/host';

export interface AttachedInfo {
  name: string;
  stamp: string;
}

type DocAttached = { state: 'loading' } | { state: 'ready'; attached: AttachedInfo | null };

interface AttachedState {
  docs: Record<string, DocAttached>;
  /** Documents whose copy is being made again. */
  refreshing: Record<string, true>;
}

export const attachedStore = createStore<AttachedState>()(() => ({ docs: {}, refreshing: {} }));

export function useAttached<T>(selector: (s: AttachedState) => T): T {
  return useStore(attachedStore, selector);
}

const setDoc = (docId: string, d: DocAttached): void => {
  attachedStore.setState((s) => ({ docs: { ...s.docs, [docId]: d } }));
};

/** Reads whether the document holds our export (once per document). */
export function loadAttached(docId: string): void {
  if (attachedStore.getState().docs[docId]) return;
  setDoc(docId, { state: 'loading' });
  renderEngine()
    .rpc.call('exportAttachment', { docId })
    .promise.then((attached) => {
      if (documentStore.getState().docs[docId]) setDoc(docId, { state: 'ready', attached });
    })
    .catch((err: unknown) => {
      recordError('measure.attached', err);
      setDoc(docId, { state: 'ready', attached: null });
    });
}

/** This session attached (or refreshed) the export. */
export function noteAttached(docId: string, info: AttachedInfo): void {
  setDoc(docId, { state: 'ready', attached: info });
}

export function setRefreshing(docId: string, on: boolean): void {
  attachedStore.setState((s) => ({
    refreshing: on
      ? { ...s.refreshing, [docId]: true }
      : Object.fromEntries(Object.entries(s.refreshing).filter(([id]) => id !== docId)),
  }));
}

/** Forget a closed document; one opened again is read again. */
documentStore.subscribe((s, prev) => {
  if (s.docs === prev.docs) return;
  const gone = Object.keys(prev.docs).filter((id) => !(id in s.docs));
  if (!gone.length) return;
  attachedStore.setState((st) => ({
    docs: Object.fromEntries(Object.entries(st.docs).filter(([id]) => !gone.includes(id))),
    refreshing: Object.fromEntries(
      Object.entries(st.refreshing).filter(([id]) => !gone.includes(id)),
    ),
  }));
});
