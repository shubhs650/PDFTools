import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { msg, type MessageKey } from '../i18n';
import { Button, Dialog, TextField } from '../ui/components';
import { useDocuments } from './store/documentStore';
import { closeRename, renameFile, useRename, type RenameFailure } from './tabRename';

const FAILURE: Record<RenameFailure, MessageKey> = {
  empty: msg('frame.rename.empty'),
  chars: msg('frame.rename.chars'),
  reserved: msg('frame.rename.reserved'),
  taken: msg('frame.rename.taken'),
  denied: msg('frame.rename.denied'),
  busy: msg('frame.rename.busy'),
  failed: msg('frame.rename.failed'),
  gone: msg('frame.rename.gone'),
};

/** Rename File… from the tab menu (M11-05, D-50): the file on disk, in place. */
export function RenameFileDialog() {
  const docId = useRename((s) => s.docId);
  const name = useDocuments((s) => (docId ? s.docs[docId]?.meta.name : undefined));
  if (!docId || name === undefined) return null;
  return <RenameForm key={docId} docId={docId} name={name} />;
}

function RenameForm({ docId, name }: { docId: string; name: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<RenameFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const formId = `${useId()}-form`;
  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const failure = await renameFile(docId, value);
    setBusy(false);
    if (failure) {
      setError(failure);
      input.current?.focus();
    } else closeRename();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) closeRename();
      }}
      title={t('frame.rename.title')}
      description={t('frame.rename.description')}
      closeIcon={<Dismiss20Regular />}
      initialFocus={input}
      footer={
        <>
          <Button
            label={t('frame.rename.ok')}
            variant="primary"
            type="submit"
            form={formId}
            disabled={busy}
          />
          <Button label={t('frame.rename.cancel')} onClick={closeRename} />
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField
          ref={input}
          label={t('frame.rename.label')}
          value={value}
          spellCheck={false}
          autoComplete="off"
          error={error ? t(FAILURE[error]) : undefined}
          onFocus={(e) => {
            // The name without ".pdf" is selected, as a file manager does.
            const el = e.currentTarget;
            const dot = el.value.toLowerCase().endsWith('.pdf') ? el.value.length - 4 : -1;
            el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
          }}
          onChange={(e) => {
            setValue(e.currentTarget.value);
            setError(null);
          }}
        />
      </form>
    </Dialog>
  );
}
