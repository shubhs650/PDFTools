// "Save changes to this comparison?" (M12-27, ADR-033 decision 5): closing a
// comparison tab whose overlay comments, or reopened comparison file, are not saved.
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { msg, type MessageKey } from '../../../i18n';
import { Button, Dialog } from '../../../ui/components';
import { comparisonTitle } from '../title';
import {
  closeWithoutSaving,
  keepComparison,
  saveThenClose,
  unsavedOnlyHere,
  useClosePrompt,
} from './closePrompt';

const SAY: Record<'notes' | 'review', { text: MessageKey; save: MessageKey }> = {
  notes: { text: msg('compare.file.close.notes'), save: msg('compare.file.close.saveFile') },
  review: { text: msg('compare.file.close.review'), save: msg('compare.file.close.saveReview') },
};

export function CloseComparisonDialog() {
  const { t } = useTranslation();
  const id = useClosePrompt((s) => s.queue[0] ?? null);
  const name = useDocuments((s) => {
    const c = id ? s.comparisons[id] : undefined;
    return c ? comparisonTitle(c, (d) => s.docs[d]?.meta.name) : null;
  });
  if (!id || name === null) return null;
  const kind = unsavedOnlyHere(id) ?? 'notes';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) keepComparison(id);
      }}
      title={t('compare.file.close.title', { name })}
      description={t(SAY[kind].text)}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button
            label={t(SAY[kind].save)}
            variant="primary"
            onClick={() => {
              void saveThenClose(id);
            }}
          />
          <Button
            label={t('compare.file.close.discard')}
            onClick={() => {
              closeWithoutSaving(id);
            }}
          />
          <Button
            label={t('compare.file.close.cancel')}
            onClick={() => {
              keepComparison(id);
            }}
          />
        </>
      }
    >
      <span data-testid="close-comparison" data-kind={kind} />
    </Dialog>
  );
}
