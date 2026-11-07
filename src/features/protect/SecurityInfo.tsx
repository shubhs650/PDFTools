import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { allows, CAPABILITIES, type Capability } from '../../model/permissions';
import { Button, Dialog } from '../../ui/components';
import { useDocProperties } from '../properties/useDocProperties';
import { closeSecurityInfo, useSecurityInfo } from './securityInfoStore';
import { dialogHelp } from '../help/openHelp';

const CAPABILITY_LABEL: Record<Capability, MessageKey> = {
  print: msg('security.capability.print'),
  printHighQuality: msg('security.capability.printHighQuality'),
  copy: msg('security.capability.copy'),
  accessibility: msg('security.capability.accessibility'),
  annotate: msg('security.capability.annotate'),
  fillForms: msg('security.capability.fillForms'),
  modify: msg('security.capability.modify'),
  assemble: msg('security.capability.assemble'),
};

/**
 * Protect → Security Info (§7.12, M2-12): the encryption method, whether an
 * owner password restricts the document, what this session may do (after an
 * owner unlock too), and the number of signatures. Read-only.
 */
export function SecurityInfoDialog() {
  const { t } = useTranslation();
  const docId = useSecurityInfo((s) => s.docId);
  const doc = useDocuments((s) => (docId ? s.docs[docId] : undefined));
  const props = useDocProperties(doc ? docId : null);
  if (!docId || !doc) return null;
  const { meta } = doc;
  const security = { permissions: meta.permissions, revision: meta.securityRevision ?? -1 };
  const encrypted = security.revision >= 2;
  const restricted = CAPABILITIES.some((c) => !allows(security, c));
  const enc = props.state === 'ready' ? props.props.encryption : null;
  const method = !encrypted
    ? t('security.none')
    : enc && enc.method !== 'unknown'
      ? t('security.methodValue', {
          method: enc.method,
          bits: format.number(enc.keyBits ?? 0, 0),
          revision: format.number(security.revision, 0),
        })
      : t('security.methodUnknown', { revision: format.number(security.revision, 0) });
  const owner = !encrypted
    ? t('security.none')
    : meta.ownerUnlocked
      ? t('security.owner.unlocked')
      : restricted
        ? t('security.owner.restricts')
        : t('security.owner.notRestricting');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeSecurityInfo();
      }}
      title={t('security.title')}
      description={t('security.description', { name: meta.name })}
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('protected-files')}
      footer={<Button label={t('security.close')} onClick={closeSecurityInfo} />}
    >
      <dl className="facts" data-testid="security-info">
        <div className="fact">
          <dt>{t('security.encryption')}</dt>
          <dd>{method}</dd>
        </div>
        <div className="fact">
          <dt>{t('security.ownerPassword')}</dt>
          <dd>{owner}</dd>
        </div>
        <div className="fact">
          <dt>{t('security.signatures')}</dt>
          <dd>{format.number(meta.signatureCount, 0)}</dd>
        </div>
      </dl>
      <table className="permission-table">
        <caption>{t('security.permissions')}</caption>
        <tbody>
          {CAPABILITIES.map((c) => (
            <tr key={c}>
              <th scope="row">{t(CAPABILITY_LABEL[c])}</th>
              <td>{allows(security, c) ? t('security.allowed') : t('security.denied')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
