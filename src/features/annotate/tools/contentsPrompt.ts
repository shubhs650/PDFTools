// The text of a new annotation, asked right after it is made (M3-08, M3-09):
// Insert/Replace Text (the caret's inserted text), a sticky note and a text
// box made from the keyboard. Written to /Contents; Cancel leaves the
// annotation as it is (it can still be edited or undone).
import { createStore, useStore } from 'zustand';
import { annotationCapability } from '../selection';

export type ContentsKind = 'caret' | 'note' | 'freeText';

interface ContentsState {
  target: { kind: ContentsKind; docId: string; pageIndex: number; id: string } | null;
}

export const contentsStore = createStore<ContentsState>()(() => ({ target: null }));

export function useContentsPrompt<T>(selector: (s: ContentsState) => T): T {
  return useStore(contentsStore, selector);
}

export function openContentsPrompt(
  kind: ContentsKind,
  docId: string,
  pageIndex: number,
  id: string,
): void {
  contentsStore.setState({ target: { kind, docId, pageIndex, id } });
}

export function closeContentsPrompt(text: string | null): void {
  const t = contentsStore.getState().target;
  contentsStore.setState({ target: null });
  if (!t || text === null || text.trim() === '') return;
  annotationCapability()?.forDocument(t.docId).updateAnnotation(t.pageIndex, t.id, {
    contents: text,
  });
}
