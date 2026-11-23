import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { dialogHelp } from '../../help/openHelp';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { Button, Dialog, ProgressBar } from '../../../ui/components';
import { usePairing } from '../pairingFlow';
import { sheetsOf } from './overlayState';
import {
  cancelExportOverlay,
  closeExportOverlay,
  exportBlock,
  exportName,
  setExportScope,
  startExportOverlay,
  useExportOverlay,
  type ExportScope,
} from './vectorOverlay';

/**
 * Compare → Export Overlay… (M12-16, D-59): the overlay of a PDF overlay as a
 * new PDF file, one vector page per sheet, without the two files attached
 * (that is Save comparison…, M12-20). All sheets or the one shown; progress
 * with Cancel while the Work worker builds it (rule 2).
 */
export function ExportOverlayDialog() {
  const { t } = useTranslation();
  const id = useExportOverlay((s) => s.id);
  const scope = useExportOverlay((s) => s.scope);
  const running = useExportOverlay((s) => s.running);
  const error = useExportOverlay((s) => s.error);
  const c = useDocuments((s) => (id ? s.comparisons[id] : undefined));
  // Strings only (the file names and permissions are read from the store).
  const fileName = useDocuments(() => (c ? exportName(c) : ''));
  const blocked = useDocuments(() => (c ? (exportBlock(c)?.name ?? null) : null));
  const pairing = usePairing(id ?? '');
  if (!id || !c) return null;
  const sheets = pairing?.status === 'done' ? sheetsOf(pairing.rows, pairing.pages).length : 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeExportOverlay();
      }}
      title={t('compare.export.title')}
      help={dialogHelp('compare-other-readers')}
      description={t('compare.export.description', { name: fileName })}
      closeIcon={<Dismiss20Regular />}
      footer={
        running ? (
          <Button label={t('compare.export.cancel')} onClick={cancelExportOverlay} />
        ) : (
          <>
            <Button
              label={t('compare.export.export')}
              variant="primary"
              disabled={sheets === 0 || blocked !== null}
              onClick={() => {
                void startExportOverlay();
              }}
            />
            <Button label={t('compare.export.close')} onClick={closeExportOverlay} />
          </>
        )
      }
    >
      <div className="print-dialog-form" data-testid="export-overlay">
        <p className="print-note">{t('compare.export.details')}</p>
        <fieldset disabled={running !== null}>
          <legend>{t('compare.export.scope')}</legend>
          <ScopeOption
            value="all"
            current={scope}
            label={t('compare.export.scope_all', { count: sheets, n: format.number(sheets) })}
          />
          <ScopeOption value="sheet" current={scope} label={t('compare.export.scope_sheet')} />
        </fieldset>
        {blocked !== null ? (
          <p className="print-warning" role="note">
            {t('compare.export.blocked', { name: blocked })}
          </p>
        ) : null}
        {running ? (
          <>
            <ProgressBar
              label={t('compare.export.progressName')}
              value={
                running.stage === 'drawing' && running.total > 0
                  ? running.done / running.total
                  : null
              }
            />
            <p className="print-note" role="status">
              {running.stage === 'aligning'
                ? t('compare.export.aligning')
                : t('compare.export.progress', {
                    done: format.number(running.done, 0),
                    total: format.number(running.total, 0),
                  })}
            </p>
          </>
        ) : null}
        {error ? (
          <p className="print-error" role="alert">
            {error === 'denied' ? t('compare.export.denied') : t('compare.export.failed')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function ScopeOption({
  value,
  current,
  label,
}: {
  value: ExportScope;
  current: ExportScope;
  label: string;
}) {
  return (
    <label className="print-option">
      <input
        type="radio"
        name="export-overlay-scope"
        value={value}
        checked={current === value}
        onChange={() => {
          setExportScope(value);
        }}
      />
      {label}
    </label>
  );
}
