import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { dialogHelp } from '../../help/openHelp';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { Button, Dialog, ProgressBar } from '../../../ui/components';
import {
  cancelRegister,
  closeRegister,
  registerBlock,
  registerName,
  setRegisterFormat,
  startRegister,
  useRegister,
  useRegisterCount,
  type RegisterCount,
  type RegisterFormat,
} from './changeRegister';
import type { CompareType } from '../model';

const FORMATS: readonly RegisterFormat[] = ['xlsx', 'csv'];

/** "It lists 12 of 40 differences: …" */
function rowsText(t: TFunction, type: CompareType, c: RegisterCount): string {
  const n = format.number(c.total);
  if (c.shown === c.total)
    return type === 'overlay'
      ? t('compare.register.diffRows', { count: c.total, n })
      : t('compare.register.textRows', { count: c.total, n });
  const shown = format.number(c.shown);
  return type === 'overlay'
    ? t('compare.register.diffRowsShown', { count: c.total, n, shown })
    : t('compare.register.textRowsShown', { count: c.total, n, shown });
}

/**
 * Compare → Export Change Register… (M12-21, D-65, Q34): the differences the
 * list shows, with its filters, as an Excel workbook or a CSV file. Says how
 * many rows it will hold, and when the comparison is still finding them.
 */
export function RegisterDialog() {
  const { t } = useTranslation();
  const id = useRegister((s) => s.id);
  const fmt = useRegister((s) => s.format);
  const running = useRegister((s) => s.running);
  const error = useRegister((s) => s.error);
  const c = useDocuments((s) => (id ? s.comparisons[id] : undefined));
  const fileName = useDocuments(() => (c ? registerName(c, fmt) : ''));
  const blocked = useDocuments(() => (c ? (registerBlock(c)?.name ?? null) : null));
  const count = useRegisterCount(c);
  if (!id || !c || !count) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeRegister();
      }}
      title={t('compare.register.title')}
      help={dialogHelp('compare-saving')}
      description={t('compare.register.description', { name: fileName })}
      closeIcon={<Dismiss20Regular />}
      footer={
        running ? (
          <Button label={t('compare.register.cancel')} onClick={cancelRegister} />
        ) : (
          <>
            <Button
              label={t('compare.register.export')}
              variant="primary"
              disabled={count.shown === 0 || blocked !== null}
              onClick={() => {
                void startRegister();
              }}
            />
            <Button label={t('compare.register.close')} onClick={closeRegister} />
          </>
        )
      }
    >
      <div className="print-dialog-form" data-testid="change-register">
        <p className="print-note" data-testid="register-count" data-shown={count.shown}>
          {rowsText(t, c.type, count)}
        </p>
        <p className="print-note">{t('compare.register.details')}</p>
        {!count.complete ? (
          <p className="print-note" role="note">
            {t('compare.register.stillFinding')}
          </p>
        ) : null}
        <fieldset disabled={running}>
          <legend>{t('compare.register.format')}</legend>
          {FORMATS.map((f) => (
            <label key={f} className="print-option">
              <input
                type="radio"
                name="change-register-format"
                value={f}
                checked={fmt === f}
                onChange={() => {
                  setRegisterFormat(f);
                }}
              />
              {f === 'xlsx' ? t('compare.register.format_xlsx') : t('compare.register.format_csv')}
            </label>
          ))}
        </fieldset>
        {blocked !== null ? (
          <p className="print-warning" role="note">
            {t('compare.register.blocked', { name: blocked })}
          </p>
        ) : null}
        {running ? (
          <>
            <ProgressBar label={t('compare.register.progressName')} value={null} />
            <p className="print-note" role="status">
              {t('compare.register.progress')}
            </p>
          </>
        ) : null}
        {error ? (
          <p className="print-error" role="alert">
            {error === 'denied'
              ? t('compare.register.denied')
              : error === 'empty'
                ? t('compare.register.empty')
                : t('compare.register.failed')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
