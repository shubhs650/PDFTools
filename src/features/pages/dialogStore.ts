// Which Organize dialog is open (M4-09). Kept apart from the components so
// commands and menus can open them.
import { createStore, useStore } from 'zustand';
import type { CropMargins } from '../../model/cropBox';
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
  /** Crop Pages (M11-08·O9). */
  | 'crop'
  /** Create Blank PDF (M10-08·O4): needs no document. */
  | 'newBlank';

interface DialogState {
  open: {
    kind: PageDialogKind;
    docId: string;
    where?: Where;
    /** Crop Pages from the Crop Tool: the page and the margins of the area drawn. */
    crop?: { page: number; margins: CropMargins };
  } | null;
}

export const pageDialogStore = createStore<DialogState>()(() => ({ open: null }));

export function usePageDialog() {
  return useStore(pageDialogStore, (s) => s.open);
}

export function openPageDialog(
  kind: PageDialogKind,
  docId: string,
  where?: Where,
  crop?: { page: number; margins: CropMargins },
): void {
  pageDialogStore.setState({
    open: { kind, docId, ...(where ? { where } : {}), ...(crop ? { crop } : {}) },
  });
}

export function closePageDialog(): void {
  pageDialogStore.setState({ open: null });
}
