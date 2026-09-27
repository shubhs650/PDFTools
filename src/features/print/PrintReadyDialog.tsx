import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format } from '../../i18n';
import { Button, Dialog, ProgressBar } from '../../ui/components';
import { cancelExport, closeExport, startExport, useExport } from './exportPrintReady';

/**
 * File → Export Print-Ready PDF (D-25, M2-16): what the copy is, a warning on
 * signed documents (the copy carries no valid signature), then progress with
 * Cancel while the Work worker flattens the copy.
 */
export function PrintReadyDialog() {
  const { t } = useTranslation();
  const docId = useExport((s) => s.docId);
  const running = useExport((s) => s.running);
  const failed = useExport((s) => s.error === 'failed');
  const doc = useDocuments((s) => (docId ? s.docs[docId] : undefined));
  if (!docId || !doc) return null;
  const signed = doc.meta.signatureCount > 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeExport();
      }}
      title={t('printReady.title')}
      description={t('printReady.description', { name: doc.meta.name })}
      closeIcon={<Dismiss20Regular />}
      footer={
        running ? (
          <Button label={t('printReady.cancel')} onClick={cancelExport} />
        ) : (
          <>
            <Button
              label={t('printReady.export')}
              variant="primary"
              onClick={() => {
                void startExport();
              }}
            />
            <Button label={t('printReady.close')} onClick={closeExport} />
          </>
        )
      }
    >
      <div className="print-dialog-form">
        <p className="print-note">{t('printReady.details')}</p>
        {signed ? (
          <p className="print-warning" role="note" data-testid="print-ready-signed">
            {t('printReady.signed')}
          </p>
        ) : null}
        {running ? (
          <>
            <ProgressBar
              label={t('printReady.progressName')}
              value={running.total > 0 ? running.done / running.total : null}
            />
            <p className="print-note" role="status">
              {t('printReady.progress', {
                done: format.number(running.done, 0),
                total: format.number(running.total, 0),
              })}
            </p>
          </>
        ) : null}
        {failed ? (
          <p className="print-error" role="alert">
            {t('printReady.failed')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
