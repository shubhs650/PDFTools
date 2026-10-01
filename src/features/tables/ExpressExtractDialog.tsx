import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../i18n';
import { canPickFolder } from '../../storage/fileAccess';
import { Button, Dialog, ProgressBar } from '../../ui/components';
import type { TableFormat } from '../../workers/work/tables/job';
import {
  cancelExpressExtract,
  closeExpressExtract,
  findTables,
  saveTables,
  useExpress,
  type ExpressError,
} from './expressExtract';

const ERRORS: Record<ExpressError, MessageKey> = {
  denied: msg('export.error.denied'),
  failed: msg('tables.express.failed'),
  noDocument: msg('export.error.noDocument'),
};

/** Express Extract (M4-13): find the tables on the pages, then save them. */
export function ExpressExtractDialog() {
  const docId = useExpress((s) => s.docId);
  if (!docId) return null;
  return <ExpressForm key={docId} />;
}

const pageList = (pages: readonly number[]) =>
  format.list(pages.map((p) => format.number(p + 1, 0)));

function ExpressForm() {
  const { t } = useTranslation();
  const ids = useId();
  const pages = useExpress((s) => s.pages);
  const running = useExpress((s) => s.running);
  const found = useExpress((s) => s.found);
  const error = useExpress((s) => s.error);
  const [fmt, setFmt] = useState<TableFormat>('xlsx');
  const count = found?.tables.length ?? 0;
  const radio = (value: TableFormat, label: string) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-format`}
        checked={fmt === value}
        disabled={!!running}
        onChange={() => {
          setFmt(value);
        }}
      />
      {label}
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeExpressExtract();
      }}
      title={t('tables.express.title')}
      description={t('tables.express.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        running ? (
          <Button key="cancel" label={t('tables.express.cancel')} onClick={cancelExpressExtract} />
        ) : (
          <>
            {count > 0 ? (
              <Button
                key="save"
                label={t('tables.express.save')}
                variant="primary"
                type="submit"
                form={`${ids}-form`}
              />
            ) : (
              <Button
                key="find"
                label={t('tables.express.find')}
                variant="primary"
                type="submit"
                form={`${ids}-form`}
              />
            )}
            <Button label={t('tables.express.close')} onClick={closeExpressExtract} />
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
          void (count > 0 ? saveTables(fmt) : findTables());
        }}
      >
        <p className="print-note">
          {t('tables.express.pages', { count: pages.length, list: pageList(pages) })}
        </p>
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('tables.express.format')}</legend>
          {radio('xlsx', t('tables.express.xlsx'))}
          {radio('csv', t('tables.express.csv'))}
        </fieldset>
        {fmt === 'csv' && count > 1 ? (
          <p className="print-note">
            {t(canPickFolder() ? msg('tables.express.folderNote') : msg('tables.express.zipNote'))}
          </p>
        ) : null}
        <p className="print-note">{t('tables.express.beta')}</p>
        {running ? (
          <>
            <ProgressBar
              label={t('tables.express.progressName')}
              value={running.total > 0 ? running.done / running.total : null}
            />
            <p className="print-note" role="status">
              {running.phase === 'detect'
                ? t('tables.express.progress', {
                    done: format.number(running.done, 0),
                    total: format.number(running.total, 0),
                  })
                : t('tables.express.saving')}
            </p>
          </>
        ) : found ? (
          <div role="status">
            <p className="print-note">
              {count > 0
                ? t('tables.express.found', { count, n: format.number(count, 0) })
                : t('tables.express.none')}
            </p>
            {found.ocrPages.length ? (
              <p className="print-note">
                {t('tables.express.ocr', {
                  count: found.ocrPages.length,
                  list: pageList(found.ocrPages),
                })}
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="print-error" role="alert">
            {t(ERRORS[error], { what: t('protect.capability.copy') })}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
