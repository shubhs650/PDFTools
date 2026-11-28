// "12 measurements updated" (M14-04, D-77, Q23): after a scale change the
// person made (a page scale, a recalibration, a viewport's scale, place or
// size), the measurements that use it follow in the same undo step, and a note
// above the document says how many, with Undo. The note goes once anything
// else is done or undone (its Undo would then undo something else), or with ×.
import type { HistoryCapability } from '@embedpdf/plugin-history';
import { createStore, useStore } from 'zustand';
import { capability, hostStore } from '../view/host';

export interface ScaleNote {
  docId: string;
  count: number;
}

export const scaleNoteStore = createStore<{ note: ScaleNote | null }>()(() => ({ note: null }));

export function useScaleNote(docId: string): ScaleNote | null {
  return useStore(scaleNoteStore, (s) => (s.note?.docId === docId ? s.note : null));
}

function historyOf(docId: string) {
  const registry = hostStore.getState().registry;
  if (!registry) return null;
  try {
    return capability<HistoryCapability>(registry, 'history').forDocument(docId);
  } catch {
    return null;
  }
}

let off: (() => void) | null = null;

export function closeScaleNote(): void {
  off?.();
  off = null;
  if (scaleNoteStore.getState().note) scaleNoteStore.setState({ note: null });
}

/** Shows the note for `count` measurements updated by the last scale change. */
export function showScaleNote(docId: string, count: number): void {
  closeScaleNote();
  scaleNoteStore.setState({ note: { docId, count } });
  // The next history change (another edit, an undo, a redo) closes it.
  off =
    historyOf(docId)?.onHistoryChange(() => {
      closeScaleNote();
    }) ?? null;
}

/** The note's Undo: the scale change and every measurement it updated go back. */
export function undoScaleChange(): void {
  const docId = scaleNoteStore.getState().note?.docId;
  closeScaleNote();
  if (docId) historyOf(docId)?.undo();
}
