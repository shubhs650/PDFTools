import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import {
  discardSnapshot,
  findSnapshots,
  recoverSnapshot,
  recoveryStore,
  useRecovery,
} from './recovery';

/** "Recover unsaved changes?" at launch, one row per snapshot (§4.3, M1-24). */
export function RecoveryDialog() {
  const { t } = useTranslation();
  const offers = useRecovery((s) => s.offers);
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(Date.now);
  useEffect(() => {
    void findSnapshots();
  }, []);
  const close = (): void => {
    recoveryStore.setState({ offers: [] });
  };
  return (
    <Dialog
      open={offers.length > 0}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t('recovery.title')}
      description={t('recovery.description')}
      closeIcon={<Dismiss20Regular />}
      footer={<Button label={t('recovery.later')} onClick={close} />}
    >
      <ul className="recovery-list" data-testid="recovery-list">
        {offers.map((o) => {
          const name = typeof o.ui?.['name'] === 'string' ? o.ui['name'] : t('recovery.untitled');
          return (
            <li key={o.fp} className="recovery-item">
              <span className="recovery-name">
                {t('recovery.item', { name, when: format.relative(Math.min(o.updated, now), now) })}
              </span>
              <Button
                size="small"
                variant="primary"
                label={t('recovery.recover')}
                aria-label={t('recovery.recoverName', { name })}
                disabled={busy !== null}
                onClick={() => {
                  setBusy(o.fp);
                  void recoverSnapshot(o.fp).finally(() => {
                    setBusy(null);
                  });
                }}
              />
              <Button
                size="small"
                label={t('recovery.discard')}
                aria-label={t('recovery.discardName', { name })}
                disabled={busy !== null}
                onClick={() => {
                  void discardSnapshot(o.fp);
                }}
              />
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
