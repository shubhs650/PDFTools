// The text typed for Insert Text / Replace Text (M3-08): asked right after the
// caret is made, written to the caret's /Contents (Acrobat and PDF-XChange show
// it as the inserted or replacing text). Cancel leaves the caret without text;
// it can still be edited or undone.
import { createStore, useStore } from 'zustand';
import { annotationCapability } from '../selection';

interface CaretTextState {
  target: { docId: string; pageIndex: number; id: string } | null;
}

export const caretTextStore = createStore<CaretTextState>()(() => ({ target: null }));

export function useCaretText<T>(selector: (s: CaretTextState) => T): T {
  return useStore(caretTextStore, selector);
}

export function openCaretText(docId: string, pageIndex: number, id: string): void {
  caretTextStore.setState({ target: { docId, pageIndex, id } });
}

export function closeCaretText(text: string | null): void {
  const t = caretTextStore.getState().target;
  caretTextStore.setState({ target: null });
  if (!t || text === null || text.trim() === '') return;
  annotationCapability()?.forDocument(t.docId).updateAnnotation(t.pageIndex, t.id, {
    contents: text,
  });
}
