// Closing a comparison tab with changes only a comparison file keeps (M12-27,
// ADR-033 decision 5): comments drawn on the overlay (its notes), or the review
// comments of a reopened comparison file (its copies of A and B). One question
// for the comparison: save (Save Comparison… or Save review), close without
// saving, or keep it open. Document A and B opened from their own files still
// get the usual question each, after this one, as they are files of their own.
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../../app/store/documentStore';
import { requestCloseMany } from '../../open/openDocument';
import { notesStore } from '../review/notes';
import { hasUnsaved, linkedOf, openSaveComparison, saveReview } from './fileFlow';

interface ClosePromptState {
  /** The comparisons waiting for an answer, the one asked first. */
  queue: readonly string[];
}

export const closePromptStore = createStore<ClosePromptState>()(() => ({ queue: [] }));

export function useClosePrompt<T>(selector: (s: ClosePromptState) => T): T {
  return useStore(closePromptStore, selector);
}

/** What a comparison would lose: its overlay comments, or its comparison file's review; null: nothing. */
export function unsavedOnlyHere(id: string): 'notes' | 'review' | null {
  const s = documentStore.getState();
  const c = s.comparisons[id];
  if (!c) return null;
  if (linkedOf(id)) {
    const notes = notesStore.getState().byId[id]?.docId;
    const notesDirty = !!notes && s.docs[notes]?.dirty === true;
    return notesDirty || hasUnsaved(c) ? 'review' : null;
  }
  const notes = notesStore.getState().byId[id]?.docId;
  return notes && s.docs[notes]?.dirty === true ? 'notes' : null;
}

/** The close guard (openDocument's): asks when closing would lose what only a comparison file keeps. */
export function guardComparisonClose(id: string): boolean {
  if (unsavedOnlyHere(id) === null) return false;
  closePromptStore.setState((s) => (s.queue.includes(id) ? s : { queue: [...s.queue, id] }));
  return true;
}

const done = (id: string): void => {
  closePromptStore.setState((s) => ({ queue: s.queue.filter((x) => x !== id) }));
};

/** Cancel: the comparison stays open. */
export function keepComparison(id: string): void {
  done(id);
}

/** Don't Save: the comparison closes; a comparison file's copies go without asking. */
export function closeWithoutSaving(id: string): void {
  const linked = linkedOf(id) !== undefined;
  done(id);
  requestCloseMany([id], { asked: true, discard: linked });
}

/**
 * Save: a reopened comparison file saves its review into the file and then
 * closes; otherwise Save Comparison… opens (the tab stays open; once saved,
 * closing it asks nothing more).
 */
export async function saveThenClose(id: string): Promise<void> {
  done(id);
  if (!linkedOf(id)) {
    openSaveComparison(id);
    return;
  }
  await saveReview(id);
  if (unsavedOnlyHere(id) === null) requestCloseMany([id], { asked: true, discard: true });
}
