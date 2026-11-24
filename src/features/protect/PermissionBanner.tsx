import { useTranslation } from 'react-i18next';
import { runCommand } from '../../app/commands/dispatch';
import { BarCloseButton } from '../../app/BarCloseButton';
import { useBarClosed } from '../../app/infoBars';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { restrictions, type Capability } from '../../model/permissions';
import { Button } from '../../ui/components';
import { focusDocumentView } from '../view/focus';

const UNLOCK = 'protect.unlock';

const CAPABILITY_LABEL: Record<Capability, MessageKey> = {
  print: msg('protect.capability.print'),
  printHighQuality: msg('protect.capability.printHighQuality'),
  copy: msg('protect.capability.copy'),
  accessibility: msg('protect.capability.accessibility'),
  annotate: msg('protect.capability.annotate'),
  fillForms: msg('protect.capability.fillForms'),
  modify: msg('protect.capability.modify'),
  assemble: msg('protect.capability.assemble'),
};

/**
 * Above a restricted document (§7.12): what its security settings forbid, and
 * the way to lift them with the owner password. Restricted commands say the
 * same when disabled (rule 9). Its × closes it for that document (M13-04); the
 * restrictions still hold.
 */
export function PermissionBanner({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const denied = useDocuments((s) => {
    const d = s.docs[documentId];
    return d ? restrictions(securityOf(d.meta)).join(',') : '';
  });
  const key = `restrictions:${documentId}`;
  const closed = useBarClosed(key);
  if (!denied || closed) return null;
  const list = format.list(denied.split(',').map((c) => t(CAPABILITY_LABEL[c as Capability])));
  return (
    <section className="permission-banner" aria-label={t('protect.banner.name')}>
      <p className="permission-banner-text">{t('protect.banner.text', { list })}</p>
      <Button
        label={t('protect.banner.unlock')}
        size="small"
        onClick={() => {
          void runCommand(UNLOCK);
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
