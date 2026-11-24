import { useTranslation } from 'react-i18next';
import { runCommand } from '../../app/commands/dispatch';
import { BarCloseButton } from '../../app/BarCloseButton';
import { useBarClosed } from '../../app/infoBars';
import { useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
import { Button } from '../../ui/components';
import { focusDocumentView } from '../view/focus';

const SHOW = 'protect.signatures';

/**
 * Above a signed document (§7.11, M2-13): how many signatures, and where to see them.
 * Its × closes the bar for that document (owner, 2026-11-24, M13-04); Protect →
 * Signatures still shows them.
 */
export function SignatureBanner({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const count = useDocuments((s) => s.docs[documentId]?.meta.signatureCount ?? 0);
  const key = `signatures:${documentId}`;
  const closed = useBarClosed(key);
  if (count === 0 || closed) return null;
  return (
    <section className="permission-banner" aria-label={t('signatures.banner.name')}>
      <p className="permission-banner-text">
        {t('signatures.banner.text', { count, n: format.number(count, 0) })}
      </p>
      <Button
        label={t('signatures.banner.show')}
        size="small"
        onClick={() => {
          void runCommand(SHOW);
        }}
      />
      <BarCloseButton
        barKey={key}
        afterClose={() => {
          focusDocumentView(documentId);
        }}
      />
    </section>
  );
}
