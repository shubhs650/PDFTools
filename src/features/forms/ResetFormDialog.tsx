import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { format } from '../../i18n';
import { Button, Dialog } from '../../ui/components';
import { cancelReset, resetForm, stopReset, useForms } from './formStore';

/** Home → Reset Form (§7.10): asks first, then shows progress while fields reset. */
export function ResetFormDialog() {
  const { t } = useTranslation();
  const docId = useForms((s) => s.confirmReset);
  const resetting = useForms((s) => s.resetting);
  return (
    <>
      <Dialog
        open={docId !== null}
        onOpenChange={(open) => {
          if (!open) cancelReset();
        }}
        title={t('forms.reset.title')}
        description={t('forms.reset.description')}
        closeIcon={<Dismiss20Regular />}
        footer={
          <>
            <Button
              label={t('forms.reset.confirm')}
              variant="primary"
              onClick={() => {
                if (docId) void resetForm(docId).catch(() => undefined);
              }}
            />
            <Button label={t('forms.reset.cancel')} onClick={cancelReset} />
          </>
        }
      />
      {resetting ? (
        <div className="form-reset-status">
          <p role="status">
            {t('forms.reset.progress', {
              done: format.number(resetting.done, 0),
              total: format.number(resetting.total, 0),
            })}
          </p>
          <Button label={t('forms.reset.stop')} size="small" onClick={stopReset} />
        </div>
      ) : null}
    </>
  );
}
