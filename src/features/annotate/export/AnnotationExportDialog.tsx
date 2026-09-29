import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, ProgressBar } from '../../../ui/components';
import {
  cancelAnnotationExport,
  closeAnnotationExport,
  startAnnotationExport,
  useAnnotationExport,
  type AnnotationExportOptions,
} from './annotationExport';

/**
 * Comment → Export Annotations (M4-08): all comments or the ones the Comments
 * pane shows, as CSV, Excel or JSON; progress with Cancel while it is built.
 */
export function AnnotationExportDialog() {
  const docId = useAnnotationExport((s) => s.docId);
  if (!docId) return null;
  return <Form key={docId} />;
}

function Form() {
  const { t } = useTranslation();
  const ids = useId();
  const running = useAnnotationExport((s) => s.running);
  const error = useAnnotationExport((s) => s.error);
  const [o, setO] = useState<AnnotationExportOptions>({ scope: 'all', format: 'xlsx' });
  const radio = <K extends keyof AnnotationExportOptions>(
    k: K,
    v: AnnotationExportOptions[K],
    label: string,
  ) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-${k}`}
        checked={o[k] === v}
        disabled={running}
        onChange={() => {
          setO((p) => ({ ...p, [k]: v }));
        }}
      />
      {label}
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeAnnotationExport();
      }}
      title={t('annotExport.title')}
      description={t('annotExport.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        running ? (
          <Button key="cancel" label={t('annotExport.cancel')} onClick={cancelAnnotationExport} />
        ) : (
          <>
            <Button
              label={t('annotExport.export')}
              variant="primary"
              type="submit"
              form={`${ids}-form`}
            />
            <Button label={t('annotExport.close')} onClick={closeAnnotationExport} />
          </>
        )
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void startAnnotationExport(o);
        }}
      >
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('annotExport.scope')}</legend>
          {radio('scope', 'all', t('annotExport.scopeAll'))}
          {radio('scope', 'filtered', t('annotExport.scopeFiltered'))}
        </fieldset>
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('annotExport.format')}</legend>
          {radio('format', 'xlsx', t('annotExport.xlsx'))}
          {radio('format', 'csv', t('annotExport.csv'))}
          {radio('format', 'json', t('annotExport.json'))}
        </fieldset>
        {running ? <ProgressBar label={t('annotExport.progressName')} value={null} /> : null}
        {error ? (
          <p className="print-error" role="alert">
            {error === 'empty' ? t('annotExport.empty') : t('annotExport.failed')}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
