import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, type MessageKey } from '../../i18n';
import { Button, Dialog, ProgressBar, TextField } from '../../ui/components';
import { activeScheme } from '../stamps/schemes/schemeStore';
import { cancelCrs, closeCrs, startCrs, useCrs, type CrsOptions } from './crsExport';

/**
 * Comment → Export CRS (M3-19, D-15, §7.5): the header (prefilled from the
 * document, the reviewer profile and the stamps' document number), scope,
 * snapshots and format; then progress with Cancel while the Work worker
 * builds the workbook.
 */
export function CrsDialog() {
  const initial = useCrs((s) => s.initial);
  const docId = useCrs((s) => s.docId);
  if (!initial || !docId) return null;
  return <CrsForm key={docId} initial={initial} />;
}

function CrsForm({ initial }: { initial: CrsOptions }) {
  const { t } = useTranslation();
  const ids = useId();
  const running = useCrs((s) => s.running);
  const error = useCrs((s) => s.error);
  const [o, setO] = useState(initial);
  const set = <K extends keyof CrsOptions>(k: K, v: CrsOptions[K]): void => {
    setO((p) => ({ ...p, [k]: v }));
  };
  const scheme = activeScheme();
  const schemeName = scheme.nameKey ? t(scheme.nameKey as MessageKey) : (scheme.name ?? '');
  const radio = <K extends 'scope' | 'format'>(k: K, v: CrsOptions[K], label: string) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-${k}`}
        checked={o[k] === v}
        disabled={!!running}
        onChange={() => {
          set(k, v);
        }}
      />
      {label}
    </label>
  );
  const field = (k: 'docNumber' | 'revision' | 'title' | 'reviewer' | 'date', label: string) => (
    <TextField
      label={label}
      value={o[k]}
      disabled={!!running}
      onChange={(e) => {
        set(k, e.currentTarget.value);
      }}
    />
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeCrs();
      }}
      title={t('crs.title')}
      description={t('crs.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        running ? (
          // Its own node (key): a reused submit button would submit the form again.
          <Button key="cancel" label={t('crs.cancel')} onClick={cancelCrs} />
        ) : (
          <>
            <Button label={t('crs.export')} variant="primary" type="submit" form={`${ids}-form`} />
            <Button label={t('crs.close')} onClick={closeCrs} />
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
          void startCrs(o);
        }}
      >
        {field('docNumber', t('crs.docNumber'))}
        {field('revision', t('crs.revision'))}
        {field('title', t('crs.docTitle'))}
        {field('reviewer', t('crs.reviewer'))}
        {field('date', t('crs.date'))}
        <p className="print-note">{t('crs.scheme', { name: schemeName })}</p>
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('crs.scope')}</legend>
          {radio('scope', 'all', t('crs.scopeAll'))}
          {radio('scope', 'filtered', t('crs.scopeFiltered'))}
        </fieldset>
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('crs.format')}</legend>
          {radio('format', 'xlsx', t('crs.xlsx'))}
          {radio('format', 'csv', t('crs.csv'))}
        </fieldset>
        <label className="scale-radio">
          <input
            type="checkbox"
            checked={o.snapshots && o.format === 'xlsx'}
            disabled={!!running || o.format === 'csv'}
            onChange={(e) => {
              set('snapshots', e.currentTarget.checked);
            }}
          />
          {t('crs.snapshots')}
        </label>
        {running ? (
          <>
            <ProgressBar
              label={t('crs.progressName')}
              value={running.total > 0 ? running.done / running.total : null}
            />
            <p className="print-note" role="status">
              {t('crs.progress', {
                done: format.number(running.done, 0),
                total: format.number(running.total, 0),
              })}
            </p>
          </>
        ) : null}
        {error ? (
          <p className="print-error" role="alert">
            {error === 'empty' ? t('crs.empty') : t('crs.failed')}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
