// The unsaved dot of a comparison window (M12-27, ADR-033 decision 5): the document
// tabs' dot after the window titles of Document A and B, and on the comparison's
// tab when any of its documents (A, B or the overlay's notes) has unsaved changes.
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';

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
