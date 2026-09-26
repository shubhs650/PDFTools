import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, TextField } from '../../ui/components';
import { selectPasswordJob, useOpen } from '../open/openStore';
import { answerPassword } from './passwordPrompt';

/**
 * "Enter the password to open …" (D-19, §7.12). Shown while a file being opened
 * waits for its open password; after a refused password it says so. The typed
 * password goes to the engine and is not kept (M2-Q7).
 */
export function PasswordDialog() {
  const job = useOpen(selectPasswordJob);
  // A fresh field for every prompt (new file or retry).
  const key = job
    ? `${String(job.id)}:${String(job.state.phase === 'password' && job.state.retry)}`
    : '';
  return job ? (
    <PasswordPrompt
      key={key}
      jobId={job.id}
      name={job.name}
      retry={job.state.phase === 'password' && job.state.retry}
    />
  ) : null;
}

function PasswordPrompt({ jobId, name, retry }: { jobId: number; name: string; retry: boolean }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const submit = (): void => {
    answerPassword(jobId, value);
  };
  const cancel = (): void => {
    answerPassword(jobId, null);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
      title={t('protect.password.title')}
      description={t('protect.password.description', { name })}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button label={t('protect.password.open')} variant="primary" onClick={submit} />
          <Button label={t('protect.password.cancel')} onClick={cancel} />
        </>
      }
    >
      <TextField
        label={t('protect.password.label')}
        type="password"
        autoComplete="off"
        value={value}
        error={retry ? t('protect.password.incorrect') : undefined}
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
