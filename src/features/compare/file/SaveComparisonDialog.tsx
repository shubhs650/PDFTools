import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { dialogHelp } from '../../help/openHelp';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { Button, Dialog, ProgressBar, TextField } from '../../../ui/components';
import {
  answerRebuild,
  cancelSaveComparison,
  closeSaveComparison,
  comparisonFileName,
  hasUnsaved,
  protectedInput,
  saveBlock,
  setSavePassword,
  startSaveComparison,
  useReviewSave,
  useSaveComparison,
} from './fileFlow';

/**
 * Compare → Save Comparison… (M12-20, D-65): the comparison as one PDF that
 * holds both documents, said in plain words so nobody shares it without
 * meaning to share them. An open password when an input has one (ADR-032
 * decision 1); progress with Cancel while the Work worker builds it (rule 2).
 */
export function SaveComparisonDialog() {
  const { t } = useTranslation();
  const id = useSaveComparison((s) => s.id);
  const password = useSaveComparison((s) => s.password);
  const confirm = useSaveComparison((s) => s.confirm);
  const running = useSaveComparison((s) => s.running);
  const error = useSaveComparison((s) => s.error);
  const c = useDocuments((s) => (id ? s.comparisons[id] : undefined));
  // Strings only (names, permissions and passwords are read from the stores).
  const fileName = useDocuments(() => (c ? comparisonFileName(c) : ''));
  const namesA = useDocuments((s) =>
    c ? format.list(c.a.map((f) => s.docs[f.docId]?.meta.name ?? '')) : '',
  );
  const namesB = useDocuments((s) =>
    c ? format.list(c.b.map((f) => s.docs[f.docId]?.meta.name ?? '')) : '',
  );
  const blocked = useDocuments(() => (c ? (saveBlock(c)?.name ?? null) : null));
  const needsLock = useDocuments(() => (c ? protectedInput(c) : null));
  const unsaved = useDocuments(() => (c ? hasUnsaved(c) : false));
  if (!id || !c) return null;
  const fieldError =
    error === 'password'
      ? t('compare.file.save.needsPassword')
      : error === 'mismatch'
        ? t('compare.file.save.mismatch')
        : undefined;
  const stageText = (): string => {
    if (!running) return '';
    if (running.stage === 'drawing' && running.total > 0)
      return t('compare.file.save.drawingOf', {
        done: format.number(running.done, 0),
        total: format.number(running.total, 0),
      });
    switch (running.stage) {
      case 'preparing':
        return t('compare.file.save.preparing');
      case 'aligning':
        return t('compare.file.save.aligning');
      case 'drawing':
        return t('compare.file.save.drawing');
      case 'writing':
        return t('compare.file.save.writing');
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeSaveComparison();
      }}
      title={t('compare.file.save.title')}
      help={dialogHelp('compare-saving')}
      description={t('compare.file.save.description', { name: fileName })}
      closeIcon={<Dismiss20Regular />}
      footer={
        running ? (
          <Button label={t('compare.file.save.cancel')} onClick={cancelSaveComparison} />
        ) : (
          <>
            <Button
              label={t('compare.file.save.save')}
              variant="primary"
              disabled={blocked !== null}
              onClick={() => {
                void startSaveComparison();
              }}
            />
            <Button label={t('compare.file.save.close')} onClick={closeSaveComparison} />
          </>
        )
      }
    >
      <div className="print-dialog-form" data-testid="save-comparison">
        <p className="print-warning" role="note">
          {t('compare.file.save.both', { a: namesA, b: namesB })}
        </p>
        <p className="print-note">
          {c.type === 'text' ? t('compare.file.save.text') : t('compare.file.save.overlay')}
        </p>
        {unsaved ? <p className="print-note">{t('compare.file.save.unsaved')}</p> : null}
        {needsLock !== null ? (
          <fieldset disabled={running !== null}>
            <legend>{t('compare.file.save.lockTitle')}</legend>
            <p className="print-note">{t('compare.file.save.passwordWhy', { name: needsLock })}</p>
            <div className="security-passwords">
              <TextField
                label={t('compare.file.save.password')}
                type="password"
                autoComplete="new-password"
                value={password}
                error={error === 'password' ? fieldError : undefined}
                onChange={(e) => {
                  setSavePassword(e.currentTarget.value, confirm);
                }}
              />
              <TextField
                label={t('compare.file.save.confirm')}
                type="password"
                autoComplete="new-password"
                value={confirm}
                error={error === 'mismatch' ? fieldError : undefined}
                onChange={(e) => {
                  setSavePassword(password, e.currentTarget.value);
                }}
              />
            </div>
          </fieldset>
        ) : null}
        {blocked !== null ? (
          <p className="print-warning" role="note">
            {t('compare.file.save.blocked', { name: blocked })}
          </p>
        ) : null}
        {running ? (
          <>
            <ProgressBar
              label={t('compare.file.save.progressName')}
              value={
                running.stage === 'drawing' && running.total > 0
                  ? running.done / running.total
                  : null
              }
            />
            <p className="print-note" role="status">
              {stageText()}
            </p>
          </>
        ) : null}
        {error === 'failed' || error === 'denied' ? (
          <p className="print-error" role="alert">
            {error === 'denied' ? t('compare.file.save.denied') : t('compare.file.save.failed')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Save review into a text comparison file another program added to after us
 * (ADR-032): the file is rebuilt from Document B, so what was added is lost.
 */
export function RebuildComparisonDialog() {
  const { t } = useTranslation();
  const id = useReviewSave((s) => s.confirm);
  const known = useDocuments((s) => (id ? s.comparisons[id] !== undefined : false));
  if (!id || !known) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) answerRebuild(false);
      }}
      title={t('compare.file.review.rebuildTitle')}
      description={t('compare.file.review.rebuild')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('compare.file.review.rebuildGo')}
            variant="primary"
            onClick={() => {
              answerRebuild(true);
            }}
          />
          <Button
            label={t('compare.file.review.rebuildCancel')}
            onClick={() => {
              answerRebuild(false);
            }}
          />
        </>
      }
    >
      <span data-testid="rebuild-comparison" />
    </Dialog>
  );
}
