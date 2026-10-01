// Screen-reader announcement of a comment import, copy or paste (M4-20,
// M4-21, rule 12): said once by the document's annotation live region
// (SelectionAnnouncer), then cleared.
import { createStore, useStore } from 'zustand';

interface State {
  docId: string | null;
  text: string | null;
}

export const transferAnnounceStore = createStore<State>()(() => ({ docId: null, text: null }));

let timer: ReturnType<typeof setTimeout> | undefined;

export function announceTransfer(docId: string, text: string): void {
  clearTimeout(timer);
  transferAnnounceStore.setState({ docId, text });
  timer = setTimeout(() => {
    transferAnnounceStore.setState({ docId: null, text: null });
  }, 5000);
}

export function useTransferAnnouncement(docId: string): string | null {
  return useStore(transferAnnounceStore, (s) => (s.docId === docId ? s.text : null));
}
