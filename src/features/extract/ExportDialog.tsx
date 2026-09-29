import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, msg, type MessageKey } from '../../i18n';
import { Button, Dialog, ProgressBar, TextField } from '../../ui/components';
import { canPickFolder } from '../../storage/fileAccess';
import {
  cancelExport,
  closeExport,
  HAS_IMAGES,
  startExport,
  useExport,
  type ExportError,
  type ExportFormat,
} from './exportJob';
import type { Scope, ScopeKind } from './scope';

const TITLES: Record<ExportFormat, MessageKey> = {
  text: msg('export.title.text'),
  markdown: msg('export.title.markdown'),
  html: msg('export.title.html'),
  images: msg('export.title.images'),
};

const ERRORS: Record<ExportError, MessageKey> = {
  empty: msg('export.error.empty'),
  syntax: msg('export.error.syntax'),
  outOfRange: msg('export.error.outOfRange'),
  noSelection: msg('export.error.noSelection'),
  denied: msg('export.error.denied'),
  failed: msg('export.error.failed'),
  noDocument: msg('export.error.noDocument'),
};

/**
 * The export dialog (M4-04): which pages, then progress with Cancel while
 * the Work worker builds the file. Formats add their own options (M4-05 on).
 */
export function ExportDialog() {
  const docId = useExport((s) => s.docId);
  const fmt = useExport((s) => s.format);
  if (!docId || !fmt) return null;
  return <ExportForm key={`${docId}:${fmt}`} format={fmt} />;
}

function ExportForm({ format: fmt }: { format: ExportFormat }) {
  const { t } = useTranslation();
  const ids = useId();
  const running = useExport((s) => s.running);
  const error = useExport((s) => s.error);
  const [scope, setScope] = useState<Scope>({ kind: 'all', custom: '' });
  const [images, setImages] = useState(true);
  const rangeError =
    scope.kind === 'custom' && (error === 'empty' || error === 'syntax' || error === 'outOfRange')
      ? error
      : null;
  const radio = (kind: ScopeKind, label: string) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-scope`}
        checked={scope.kind === kind}
        disabled={!!running}
        onChange={() => {
          setScope((s) => ({ ...s, kind }));
        }}
      />
      {label}
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeExport();
      }}
      title={t(TITLES[fmt])}
      description={t('export.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        running ? (
          // Its own node (key): a reused submit button would submit the form again.
          <Button key="cancel" label={t('export.cancel')} onClick={cancelExport} />
        ) : (
          <>
            <Button
              label={t('export.export')}
              variant="primary"
              type="submit"
              form={`${ids}-form`}
            />
            <Button label={t('export.close')} onClick={closeExport} />
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
          void startExport({ scope, images });
        }}
      >
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('export.scope.legend')}</legend>
          {radio('all', t('export.scope.all'))}
          {radio('current', t('export.scope.current'))}
          {radio('custom', t('export.scope.custom'))}
          {scope.kind === 'custom' ? (
            <TextField
              label={t('export.scope.customLabel')}
              placeholder={t('export.scope.customHint')}
              value={scope.custom}
              disabled={!!running}
              error={rangeError ? t(ERRORS[rangeError]) : undefined}
              onChange={(e) => {
                const custom = e.currentTarget.value;
                setScope({ kind: 'custom', custom });
              }}
            />
          ) : null}
        </fieldset>
        {HAS_IMAGES[fmt] ? (
          <>
            <label className="scale-radio">
              <input
                type="checkbox"
                checked={images}
                disabled={!!running}
                onChange={(e) => {
                  setImages(e.currentTarget.checked);
                }}
              />
              {t(fmt === 'markdown' ? msg('export.images.markdown') : msg('export.images.html'))}
            </label>
            {fmt === 'markdown' && images ? (
              <p className="print-note">
                {t(
                  canPickFolder() ? msg('export.images.folderNote') : msg('export.images.zipNote'),
                )}
              </p>
            ) : null}
          </>
        ) : null}
        {fmt === 'images' ? (
          <p className="print-note">
            {t(
              canPickFolder()
                ? msg('export.images.imagesFolderNote')
                : msg('export.images.imagesZipNote'),
            )}
          </p>
        ) : null}
        {running ? (
          <>
            <ProgressBar
              label={t('export.progressName')}
              value={running.total > 0 ? running.done / running.total : null}
            />
            <p className="print-note" role="status">
              {t('export.progress', {
                done: format.number(running.done, 0),
                total: format.number(running.total, 0),
              })}
            </p>
          </>
        ) : null}
        {error && !rangeError ? (
          <p className="print-error" role="alert">
            {t(ERRORS[error], { what: t('protect.capability.copy') })}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
