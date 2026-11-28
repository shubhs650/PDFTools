import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import { Button, Dialog, ProgressBar } from '../../../ui/components';
import {
  canAttach,
  cancelMeasureExport,
  closeMeasureExport,
  startMeasureExport,
  useMeasureExport,
  type ExportError,
  type ExportOptions,
} from './measureExport';
import type { ExportFormat } from './exportSettings';

/**
 * Export measurements (M14-10, D-76, Q32, Q33, Q17): which measurements (This
 * page or All pages, as the pane shows), Excel or CSV, Include pictures
 * (remembered), and where it goes: a file (asked first), this PDF's
 * attachments (replacing the earlier copy), or both. Then progress with
 * Cancel while the Work worker builds the workbook.
 */
export function MeasureExportDialog() {
  const initial = useMeasureExport((s) => s.initial);
  const docId = useMeasureExport((s) => s.docId);
  if (!initial || !docId) return null;
  return <ExportForm key={docId} docId={docId} initial={initial} />;
}

const FORMATS: readonly ExportFormat[] = ['xlsx', 'csv'];

const ERRORS: Record<ExportError, MessageKey> = {
  empty: msg('measureExport.empty'),
  failed: msg('measureExport.failed'),
  nothing: msg('measureExport.nothing'),
  restricted: msg('measureExport.restricted'),
};

function ExportForm({ docId, initial }: { docId: string; initial: ExportOptions }) {
  const { t } = useTranslation();
  const ids = useId();
  const running = useMeasureExport((s) => s.running);
  const error = useMeasureExport((s) => s.error);
  const page = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const [o, setO] = useState(initial);
  const attachable = canAttach(docId);
  const xlsx = o.format === 'xlsx';
  const busy = !!running;
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]): void => {
    setO((p) => ({ ...p, [k]: v }));
  };
  const check = (
    k: 'pictures' | 'saveFile' | 'attach',
    label: string,
    disabled: boolean,
    note?: string,
  ) => (
    <label className="scale-radio">
      <input
        type="checkbox"
        checked={o[k] && !(disabled && k !== 'saveFile')}
        disabled={busy || disabled}
        {...(note ? { 'aria-describedby': `${ids}-${k}-note` } : {})}
        onChange={(e) => {
          set(k, e.currentTarget.checked);
        }}
      />
      {label}
      {note ? (
        <span id={`${ids}-${k}-note`} className="ui-visually-hidden">
          {note}
        </span>
      ) : null}
    </label>
  );
  const nothing = !o.saveFile && !(o.attach && xlsx && attachable);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeMeasureExport();
      }}
      title={t('measureExport.title.dialog')}
      description={t('measureExport.description')}
      closeIcon={<Dismiss20Regular />}
      className="measure-export-dialog"
      footer={
        running ? (
          // Its own node (key): a reused submit button would submit the form again.
          <Button key="cancel" label={t('measureExport.cancel')} onClick={cancelMeasureExport} />
        ) : (
          <>
            <Button
              label={t('measureExport.export')}
              variant="primary"
              type="submit"
              form={`${ids}-form`}
              disabled={nothing}
            />
            <Button label={t('measureExport.close')} onClick={closeMeasureExport} />
          </>
        )
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        data-testid="measure-export-form"
        onSubmit={(e) => {
          e.preventDefault();
          void startMeasureExport(o);
        }}
      >
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('measureExport.which')}</legend>
          <label className="scale-radio">
            <input
              type="radio"
              name={`${ids}-scope`}
              checked={!o.scope.all}
              disabled={busy}
              onChange={() => {
                set('scope', { all: false, page });
              }}
            />
            {t('measureExport.thisPage', { page: format.number(page + 1, 0) })}
          </label>
          <label className="scale-radio">
            <input
              type="radio"
              name={`${ids}-scope`}
              checked={o.scope.all}
              disabled={busy}
              onChange={() => {
                set('scope', { all: true });
              }}
            />
            {t('measureExport.allPages')}
          </label>
        </fieldset>
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('measureExport.format')}</legend>
          {FORMATS.map((f) => (
            <label key={f} className="scale-radio">
              <input
                type="radio"
                name={`${ids}-format`}
                checked={o.format === f}
                disabled={busy}
                onChange={() => {
                  set('format', f);
                }}
              />
              {f === 'xlsx' ? t('measureExport.xlsx') : t('measureExport.csv')}
            </label>
          ))}
        </fieldset>
        {check(
          'pictures',
          t('measureExport.pictures'),
          !xlsx,
          xlsx ? undefined : t('measureExport.excelOnly'),
        )}
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('measureExport.where')}</legend>
          {check('saveFile', t('measureExport.saveFile'), false)}
          {check(
            'attach',
            t('measureExport.attach'),
            !xlsx || !attachable,
            !attachable
              ? t('measureExport.restricted')
              : xlsx
                ? t('measureExport.attachNote')
                : t('measureExport.excelOnly'),
          )}
          <p className="print-note">
            {!attachable ? t('measureExport.restricted') : t('measureExport.attachNote')}
          </p>
        </fieldset>
        {running ? (
          <>
            <ProgressBar
              label={t('measureExport.progressName')}
              value={running.total > 0 ? running.done / running.total : null}
            />
            <p className="print-note" role="status">
              {t('measureExport.progress', {
                done: format.number(running.done, 0),
                total: format.number(running.total, 0),
              })}
            </p>
          </>
        ) : null}
        {error ? (
          <p className="print-error" role="alert">
            {t(ERRORS[error])}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
