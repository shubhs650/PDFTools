import { useTranslation } from 'react-i18next';
import { BarCloseButton } from '../../app/BarCloseButton';
import { useBarClosed } from '../../app/infoBars';
import { useDocuments } from '../../app/store/documentStore';
import { focusDocumentView } from '../view/focus';

/** `FPDF_GetFormType`: 2 full (dynamic) XFA, 3 hybrid XFA with an AcroForm (ADR-013). */
const XFA_FULL = 2;
const XFA_HYBRID = 3;

/**
 * Above an XFA document (§7.10, D-26): XFA isn't filled; a hybrid's AcroForm still is.
 * Its × closes it for that document (M13-04).
 */
export function XfaBanner({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const formType = useDocuments((s) => s.docs[documentId]?.meta.formType ?? 0);
  const key = `xfa:${documentId}`;
  const closed = useBarClosed(key);
  if ((formType !== XFA_FULL && formType !== XFA_HYBRID) || closed) return null;
  return (
    <section className="permission-banner" aria-label={t('forms.xfa.name')}>
      <p className="permission-banner-text" data-testid="xfa-banner">
        {formType === XFA_FULL ? t('forms.xfa.full') : t('forms.xfa.hybrid')}
      </p>
      <BarCloseButton
        barKey={key}
        afterClose={() => {
          focusDocumentView(documentId);
        }}
      />
    </section>
  );
}
