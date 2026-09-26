import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { cancelSave, dismissSaveFailure, openOptimizeDialog, saveAs, useSave } from './save';
import type { SaveErrorKind } from './saveMachine';

const PHASE: Record<'saving' | 'verifying' | 'writing', MessageKey> = {
  saving: msg('save.phase.saving'),
  verifying: msg('save.phase.verifying'),
  writing: msg('save.phase.writing'),
};

const SAVE_ERROR: Record<SaveErrorKind, MessageKey> = {
  'permission-denied': msg('save.error.permissionDenied'),
  missing: msg('save.error.missing'),
  'file-changed': msg('save.error.fileChanged'),
  'verify-failed': msg('save.error.verifyFailed'),
  'needs-rewrite': msg('save.error.needsRewrite'),
  'write-failed': msg('save.error.writeFailed'),
};

/** Status bar: the active document's save phase with Cancel (§4.2, M1-22). */
export function SaveStatus() {
  const { t } = useTranslation();
  const id = useDocuments((s) => s.activeId);
  const phase = useSave((s) => (id ? s.phases[id] : undefined));
  const progress = useSave((s) => (id ? s.progress[id] : undefined));
  if (!id || !phase || !(phase.phase in PHASE)) return null;
  const key = PHASE[phase.phase as keyof typeof PHASE];
  const text =
    phase.phase === 'writing' && progress !== undefined
      ? t('save.phase.writingProgress', { percent: format.percent(progress, 0) })
      : t(key);
  return (
    <span className="save-status" role="status">
      <span>{text}</span>
      {phase.phase !== 'done' ? (
        <Button
          size="small"
          variant="subtle"
          label={t('save.cancel')}
          onClick={() => {
            cancelSave(id);
          }}
        />
      ) : null}
    </span>
  );
}

/** "Couldn't save …" with the reason; Save As… where the original can't be written. */
export function SaveErrorDialog() {
  const { t } = useTranslation();
  const failure = useSave((s) => s.failure);
  const name = useDocuments((s) => (failure ? s.docs[failure.docId]?.meta.name : undefined));
  const offerSaveAs =
    failure !== null && failure.kind !== 'verify-failed' && failure.kind !== 'needs-rewrite';
  return (
    <Dialog
      open={failure !== null && name !== undefined}
      onOpenChange={(open) => {
        if (!open) dismissSaveFailure();
      }}
      title={t('save.error.title', { name: name ?? '' })}
      description={failure ? t(SAVE_ERROR[failure.kind]) : ''}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          {failure?.kind === 'needs-rewrite' ? (
            <Button
              label={t('save.error.saveOptimized')}
              variant="primary"
              onClick={() => {
                const docId = failure.docId;
                dismissSaveFailure();
                openOptimizeDialog(docId);
              }}
            />
          ) : null}
          {offerSaveAs ? (
            <Button
              label={t('save.error.saveAs')}
              variant="primary"
              onClick={() => {
                const docId = failure.docId;
                dismissSaveFailure();
                void saveAs(docId);
              }}
            />
          ) : null}
          <Button label={t('save.error.ok')} onClick={dismissSaveFailure} />
        </>
      }
    />
  );
}
