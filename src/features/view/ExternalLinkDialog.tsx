import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../ui/components';
import { closeLinkDialog, openableUrl, openPendingUrl, useLinks } from './links';

/** Confirmation before a document's external link is opened (M2-Q4, rule 4). */
export function ExternalLinkDialog() {
  const { t } = useTranslation();
  const url = useLinks((s) => s.pendingUrl);
  if (url === null) return null;
  const openable = openableUrl(url);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeLinkDialog();
      }}
      title={t('links.dialogTitle')}
      description={t('links.dialogBody')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          {openable ? (
            <Button label={t('links.open')} variant="primary" onClick={openPendingUrl} />
          ) : null}
          <Button label={t('links.cancel')} onClick={closeLinkDialog} />
        </>
      }
    >
      <p className="link-url" data-testid="link-url">
        {url}
      </p>
      {openable ? null : <p className="link-blocked">{t('links.blocked')}</p>}
    </Dialog>
  );
}
