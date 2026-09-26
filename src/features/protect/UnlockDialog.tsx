import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { Button, Dialog, TextField } from '../../ui/components';
import { closeUnlockDialog, submitUnlock, useUnlock } from './unlock';

/** Protect → Unlock with Owner Password (§7.12): full access for this session. */
export function UnlockDialog() {
  const docId = useUnlock((s) => s.docId);
  return docId ? <UnlockPrompt key={docId} docId={docId} /> : null;
}

function UnlockPrompt({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const name = useDocuments((s) => s.docs[docId]?.meta.name ?? '');
  const busy = useUnlock((s) => s.busy);
  const wrong = useUnlock((s) => s.wrong);
  const [value, setValue] = useState('');
  const submit = (): void => {
    if (!busy) void submitUnlock(value);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeUnlockDialog();
      }}
      title={t('protect.unlockDialog.title')}
      description={t('protect.unlockDialog.description', { name })}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('protect.unlockDialog.unlock')}
            variant="primary"
            disabled={busy}
            onClick={submit}
          />
          <Button label={t('protect.unlockDialog.cancel')} onClick={closeUnlockDialog} />
        </>
      }
    >
      <TextField
        label={t('protect.unlockDialog.label')}
        type="password"
        autoComplete="off"
        value={value}
        error={wrong ? t('protect.unlockDialog.incorrect') : undefined}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
    </Dialog>
  );
}
