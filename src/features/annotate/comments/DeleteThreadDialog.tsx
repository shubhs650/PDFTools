import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../../ui/components';
import { confirmDelete, useDeleteConfirm } from './threadActions';

/** Deleting comments that have replies asks first (M3-12). */
export function DeleteThreadDialog() {
  const { t } = useTranslation();
  const pending = useDeleteConfirm((s) => s.pending);
  const cancelRef = useRef<HTMLButtonElement>(null);
  if (!pending) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) confirmDelete(false);
      }}
      title={t('comments.deleteTitle')}
      description={t('comments.deleteDescription', { count: pending.replies })}
      closeIcon={<Dismiss20Regular />}
      initialFocus={cancelRef}
      footer={
        <>
          <Button
            label={t('comments.deleteConfirm')}
            variant="primary"
            onClick={() => {
              confirmDelete(true);
            }}
          />
          <Button
            ref={cancelRef}
            label={t('annotate.caret.cancel')}
            onClick={() => {
              confirmDelete(false);
            }}
          />
        </>
      }
    />
  );
}
