// Which Organize dialog is open (M4-09). Kept apart from the components so
// commands and menus can open them.
import { createStore, useStore } from 'zustand';
import type { Where } from './sizes';

export type PageDialogKind =
  | 'delete'
  | 'insertBlank'
  | 'move'
  | 'insertFile'
  | 'extract'
  | 'merge'
  /** Split Document (M11-08·O7). */
  | 'split'
  /** Create Blank PDF (M10-08·O4): needs no document. */
  | 'newBlank';

interface DialogState {
  open: { kind: PageDialogKind; docId: string; where?: Where } | null;
}

export const pageDialogStore = createStore<DialogState>()(() => ({ open: null }));

export function usePageDialog() {
  return useStore(pageDialogStore, (s) => s.open);
}

export function openPageDialog(kind: PageDialogKind, docId: string, where?: Where): void {
  pageDialogStore.setState({ open: { kind, docId, ...(where ? { where } : {}) } });
}

export function closePageDialog(): void {
  pageDialogStore.setState({ open: null });
}
