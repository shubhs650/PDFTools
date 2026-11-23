// The unsaved mark of a comparison (M12-27, ADR-033 decision 5): the document
// tabs' dot after the window titles of Document A and B, and on the comparison's
// tab when any of its documents (A, B or the overlay's notes) has unsaved changes.
import type { DocumentSlice } from '../../app/store/documentStore';
import { documentsOf, type Comparison } from './model';
import { notesStore } from './review/notes';

/** Whether a comparison has unsaved changes: in Document A, B, or the overlay's notes. */
export function comparisonUnsaved(
  c: Comparison,
  docs: Readonly<Record<string, DocumentSlice | undefined>>,
): boolean {
  if (documentsOf(c).some((d) => docs[d]?.dirty === true)) return true;
  const notes = notesStore.getState().byId[c.id]?.docId;
  return !!notes && docs[notes]?.dirty === true;
}
