import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { storageClient } from '../../engine/storageClient';
import { format } from '../../i18n';
import { appDb } from '../../storage/appDb';
import { Button, Dialog } from '../../ui/components';
import { appClearDeps } from './appClearDeps';
import { clearAllLocalData } from './clearAll';

interface Usage {
  recent: number;
  snapshots: number;
  /** Everything this site stores, as the browser reports it (includes the offline app). */
  bytes: number | null;
}

async function measure(): Promise<Usage> {
  const [recent, snapshots, estimate] = await Promise.all([
    appDb()
      .then((db) => db.listRecent(1000))
      .then((l) => l.length)
      .catch(() => 0),
    storageClient()
      .call('list', null)
      .promise.then((l) => l.length)
      .catch(() => 0),
    navigator.storage.estimate().catch(() => undefined),
  ]);
  return { recent, snapshots, bytes: estimate?.usage ?? null };
}

type Outcome = 'cleared' | 'failed' | null;

/**
 * File → Settings: what PDFTools keeps on this device and "Clear all local
 * data" (M1-26, §10.3), with a confirmation that warns about open documents.
 */
export function LocalData() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const open = useDocuments((s) => s.order.length);
  const unsaved = useDocuments((s) => Object.values(s.docs).filter((d) => d.dirty).length);

  const refresh = useCallback(() => {
    void measure().then(setUsage);
  }, []);
  useEffect(refresh, [refresh]);

  const clear = (): void => {
    setBusy(true);
    void clearAllLocalData(appClearDeps)
      .then(({ failed }) => {
        setOutcome(failed.length ? 'failed' : 'cleared');
      })
      .finally(() => {
        setBusy(false);
        setConfirming(false);
        refresh();
      });
  };

  return (
    <div className="local-data" data-testid="local-data">
      <h3 className="local-data-title">{t('settings.localData.title')}</h3>
      <dl className="local-data-usage">
        <dt>{t('settings.localData.recent')}</dt>
        <dd data-testid="local-data-recent">{usage ? format.number(usage.recent) : '…'}</dd>
        <dt>{t('settings.localData.snapshots')}</dt>
        <dd data-testid="local-data-snapshots">{usage ? format.number(usage.snapshots) : '…'}</dd>
        <dt>{t('settings.localData.used')}</dt>
        <dd>
          {usage
            ? usage.bytes === null
              ? t('settings.localData.unknown')
              : format.bytes(usage.bytes)
            : '…'}
        </dd>
      </dl>
      <p className="local-data-note">{t('settings.localData.note')}</p>
      <Button
        label={t('settings.localData.clear')}
        disabled={busy}
        onClick={() => {
          setOutcome(null);
          setConfirming(true);
        }}
      />
      <p className="local-data-outcome" role="status">
        {outcome === 'cleared'
          ? t('settings.localData.cleared')
          : outcome === 'failed'
            ? t('settings.localData.failed')
            : ''}
      </p>
      <Dialog
        open={confirming}
        onOpenChange={(o) => {
          if (!busy) setConfirming(o);
        }}
        title={t('settings.localData.confirmTitle')}
        description={t('settings.localData.confirmDescription')}
        closeIcon={<Dismiss20Regular />}
        footer={
          <>
            <Button
              label={t('settings.localData.confirm')}
              variant="primary"
              disabled={busy}
              onClick={clear}
            />
            <Button
              label={t('settings.localData.cancel')}
              disabled={busy}
              onClick={() => {
                setConfirming(false);
              }}
            />
          </>
        }
      >
        {open > 0 ? (
          <p className="local-data-warning" data-testid="local-data-warning">
            {unsaved > 0
              ? t('settings.localData.warnUnsaved', { count: unsaved })
              : t('settings.localData.warnOpen', { count: open })}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
