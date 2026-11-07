import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { msg } from '../../i18n';
import { accessStrategy } from '../../storage/fileAccess';
import { Button, Dialog } from '../../ui/components';
import { sources } from '../open/sources';
import {
  answerGrowthPrompt,
  closeOptimizeDialog,
  optimizeRecommended,
  saveOptimized,
  useSave,
} from './save';
import { dialogHelp } from '../help/openHelp';

/**
 * Save Optimized (§4.2, M1-23): a full rewrite, as a new file by default or
 * over the original. Signed files first say how many signatures it breaks.
 */
export function SaveOptimizedDialog() {
  const { t } = useTranslation();
  const docId = useSave((s) => s.optimizePrompt);
  const doc = useDocuments((s) => (docId ? s.docs[docId] : undefined));
  const signatures = doc?.meta.signatureCount ?? 0;
  const canReplace =
    docId !== null && accessStrategy() === 'fsa' && sources.get(docId)?.handle !== undefined;
  const run = (target: 'copy' | 'replace'): void => {
    closeOptimizeDialog();
    if (docId) void saveOptimized(docId, target);
  };
  return (
    <Dialog
      open={docId !== null && doc !== undefined}
      onOpenChange={(open) => {
        if (!open) closeOptimizeDialog();
      }}
      title={t('save.optimize.title', { name: doc?.meta.name ?? '' })}
      description={
        signatures > 0
          ? t('save.optimize.signatures', { count: signatures })
          : t('save.optimize.description')
      }
      closeIcon={<Dismiss20Regular />}
      help={dialogHelp('saving')}
      footer={
        <>
          <Button
            label={t('save.optimize.copy')}
            variant="primary"
            onClick={() => {
              run('copy');
            }}
          />
          {canReplace ? (
            <Button
              label={t('save.optimize.replace')}
              onClick={() => {
                run('replace');
              }}
            />
          ) : null}
          <Button label={t('save.optimize.cancel')} onClick={closeOptimizeDialog} />
        </>
      }
    />
  );
}

/**
 * "Save Optimized instead?" when Ctrl+S would grow the file past 30 % (D-06),
 * or after a flatten rewrote page content (M6-09).
 */
export function GrowthPrompt() {
  const { t } = useTranslation();
  const docId = useSave((s) => s.growthPrompt);
  const name = useDocuments((s) => (docId ? s.docs[docId]?.meta.name : undefined));
  return (
    <Dialog
      open={docId !== null && name !== undefined}
      onOpenChange={(open) => {
        if (!open) answerGrowthPrompt('cancel');
      }}
      title={t('save.growth.title')}
      description={t(
        docId && optimizeRecommended(docId)
          ? msg('save.growth.recommended')
          : msg('save.growth.description'),
        { name: name ?? '' },
      )}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t('save.growth.optimize')}
            variant="primary"
            onClick={() => {
              answerGrowthPrompt('optimize');
            }}
          />
          <Button
            label={t('save.growth.save')}
            onClick={() => {
              answerGrowthPrompt('save');
            }}
          />
        </>
      }
    />
  );
}
