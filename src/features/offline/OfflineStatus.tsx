import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { applyUpdate, dismissUpdateExplanation, postponeUpdate, useOffline } from './offline';

/**
 * Status bar (§9, M1-25): offline readiness, on-demand downloads and
 * "Update ready". Nothing is shown where there is no service worker.
 */
export function OfflineStatus() {
  const { t } = useTranslation();
  const phase = useOffline((s) => s.phase);
  const progress = useOffline((s) => s.progress);
  const priority = useOffline((s) => s.priority);
  const update = useOffline((s) => s.update);
  return (
    <>
      {priority > 0 ? (
        <span className="offline-status" role="status">
          <span className="offline-spinner" aria-hidden="true" />
          {t('offline.downloading')}
        </span>
      ) : null}
      {phase === 'preparing' ? (
        <span className="offline-status" role="status">
          {t('offline.preparing', { percent: format.percent(progress, 0) })}
        </span>
      ) : phase === 'ready' ? (
        <span className="offline-status" role="status">
          {t('offline.ready')}
        </span>
      ) : null}
      {update !== 'none' ? (
        <Button
          size="small"
          variant="primary"
          label={t('offline.updateReady')}
          onClick={applyUpdate}
        />
      ) : null}
    </>
  );
}

/** Clicking "Update ready" with documents open: why nothing happens yet. */
export function UpdateWaitDialog() {
  const { t } = useTranslation();
  const open = useOffline((s) => s.explain);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismissUpdateExplanation();
      }}
      title={t('offline.waitTitle')}
      description={t('offline.waitDescription')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('offline.waitOk')}
            variant="primary"
            onClick={dismissUpdateExplanation}
          />
          <Button label={t('offline.notNow')} onClick={postponeUpdate} />
        </>
      }
    />
  );
}
