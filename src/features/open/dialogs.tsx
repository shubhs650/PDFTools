import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { commandState, runCommand, subscribeCommands } from '../../app/commands/dispatch';
import { documentStore, useDocuments } from '../../app/store/documentStore';
import { Button, Dialog } from '../../ui/components';
import { OPEN_ERROR_MESSAGE } from './errors';
import { closeDocument } from './openDocument';
import { dismissFailure, openStore, useOpen } from './openStore';

const SAVE = 'file.save';

/** "Save changes to …?" before closing a dirty tab (§4.3, M1-13). */
export function CloseDocumentDialog() {
  const { t } = useTranslation();
  const id = useOpen((s) => s.closePrompt);
  const name = useDocuments((s) => (id ? s.docs[id]?.meta.name : undefined));
  // Save arrives with M1-22; until then the button is disabled.
  const canSave = useSyncExternalStore(subscribeCommands, () => commandState(SAVE).enabled);
  const dismiss = (): void => {
    openStore.setState({ closePrompt: null });
  };

  const save = async (): Promise<void> => {
    if (!id) return;
    documentStore.getState().activate(id);
    await runCommand(SAVE);
    dismiss();
    if (documentStore.getState().docs[id]?.dirty === false) await closeDocument(id);
  };

  return (
    <Dialog
      open={id !== null && name !== undefined}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
      title={t('open.close.title', { name: name ?? '' })}
      description={t('open.close.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('open.close.save')}
            variant="primary"
            disabled={!canSave}
            onClick={() => {
              void save();
            }}
          />
          <Button
            label={t('open.close.discard')}
            onClick={() => {
              dismiss();
              if (id) void closeDocument(id);
            }}
          />
          <Button label={t('open.close.cancel')} onClick={dismiss} />
        </>
      }
    />
  );
}

/** One failure at a time: "Couldn't open …" with the reason. */
export function OpenErrorDialog() {
  const { t } = useTranslation();
  const failure = useOpen((s) => s.failures[0]);
  return (
    <Dialog
      open={failure !== undefined}
      onOpenChange={(open) => {
        if (!open && failure) dismissFailure(failure.id);
      }}
      title={t('open.failedTitle', { name: failure?.name ?? '' })}
      description={failure ? t(OPEN_ERROR_MESSAGE[failure.kind]) : ''}
      closeIcon={<Dismiss20Regular />}
      footer={
        <Button
          label={t('open.ok')}
          variant="primary"
          onClick={() => {
            if (failure) dismissFailure(failure.id);
          }}
        />
      }
    />
  );
}
