// The unsaved mark of a comparison (M12-27, ADR-033 decision 5): the document
// tabs' dot after the window titles of Document A and B, and on the comparison's
// tab when any of its documents (A, B or the overlay's notes) has unsaved changes.
import { useTranslation } from 'react-i18next';
import { useDocuments, type DocumentSlice } from '../../app/store/documentStore';
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

/** The dot after a window's title while its document has unsaved changes, named for screen readers. */
export function UnsavedDot({ docId, testId }: { docId: string; testId?: string }) {
  const { t } = useTranslation();
  const dirty = useDocuments((s) => s.docs[docId]?.dirty === true);
  if (!dirty) return null;
  return (
    <>
      <span className="tab-dirty window-dirty" aria-hidden="true" data-testid={testId} />
      <span className="ui-visually-hidden">{t('compare.review.unsaved')}</span>
    </>
  );
}
