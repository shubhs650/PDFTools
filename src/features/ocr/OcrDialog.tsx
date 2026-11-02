import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore, useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { OCR_LANGUAGES, OCR_PRECACHED, type OcrLanguage } from '../../model/ocr/languages';
import { Button, Dialog, TextField } from '../../ui/components';
import type { Scope, ScopeKind } from '../extract/scope';
import { usePageSelection } from '../pages/selection';
import { closeOcr, startOcr, useOcr, type OcrError } from './ocrJob';

const ERRORS: Record<OcrError, MessageKey> = {
  empty: msg('ocr.error.empty'),
  syntax: msg('ocr.error.syntax'),
  outOfRange: msg('ocr.error.outOfRange'),
  noSelection: msg('ocr.error.noSelection'),
  noDocument: msg('ocr.error.noDocument'),
  noLanguage: msg('ocr.error.noLanguage'),
};

const LANGUAGE_LABELS: Record<OcrLanguage, MessageKey> = {
  eng: msg('ocr.languages.eng'),
  chi_sim: msg('ocr.languages.chi_sim'),
  hin: msg('ocr.languages.hin'),
  spa: msg('ocr.languages.spa'),
  fra: msg('ocr.languages.fra'),
};

/**
 * The OCR dialog (M5-04): which pages, which languages, whether pages with
 * text are recognized too, then Recognize. Progress and Cancel are the
 * page-operation busy dialog's (the job is one page change).
 */
export function OcrDialog() {
  const docId = useOcr((s) => s.docId);
  if (!docId) return null;
  return <OcrForm key={docId} docId={docId} />;
}

function OcrForm({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const error = useOcr((s) => s.error);
  const remembered = useOcr((s) => s.languages);
  const rememberedRe = useOcr((s) => s.reRecognize);
  const selection = usePageSelection(docId).selected;
  const current = useDocuments((s) => s.docs[docId]?.view.page ?? 0);
  const [scope, setScope] = useState<Scope>({
    kind: selection.length > 1 ? 'selection' : 'all',
    custom: '',
  });
  const [languages, setLanguages] = useState<OcrLanguage[]>(remembered);
  const [reRecognize, setReRecognize] = useState(rememberedRe);
  const rangeError =
    scope.kind === 'custom' && (error === 'empty' || error === 'syntax' || error === 'outOfRange')
      ? error
      : null;
  const radio = (kind: ScopeKind, label: string, disabled = false) => (
    <label className="scale-radio">
      <input
        type="radio"
        name={`${ids}-scope`}
        checked={scope.kind === kind}
        disabled={disabled}
        onChange={() => {
          setScope((s) => ({ ...s, kind }));
        }}
      />
      {label}
    </label>
  );
  const onDemandBytes = OCR_LANGUAGES.filter((l) => !OCR_PRECACHED.includes(l.code)).reduce(
    (n, l) => n + l.gzBytes,
    0,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeOcr();
      }}
      title={t('ocr.title')}
      description={t('ocr.description')}
      closeIcon={<Dismiss20Regular />}
      footer={
        <>
          <Button label={t('ocr.start')} variant="primary" type="submit" form={`${ids}-form`} />
          <Button label={t('ocr.close')} onClick={closeOcr} />
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="scale-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!documentStore.getState().docs[docId]) return;
          void startOcr({ scope, languages, reRecognize });
        }}
      >
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('ocr.scope.legend')}</legend>
          {radio('all', t('ocr.scope.all'))}
          {radio('current', t('ocr.scope.current', { page: format.number(current + 1, 0) }))}
          {radio(
            'selection',
            t('ocr.scope.selected', { count: selection.length }),
            selection.length === 0,
          )}
          {radio('custom', t('ocr.scope.custom'))}
          {scope.kind === 'custom' ? (
            <TextField
              label={t('ocr.scope.customLabel')}
              placeholder={t('ocr.scope.customHint')}
              value={scope.custom}
              error={rangeError ? t(ERRORS[rangeError]) : undefined}
              onChange={(e) => {
                const custom = e.currentTarget.value;
                setScope({ kind: 'custom', custom });
              }}
            />
          ) : null}
        </fieldset>
        <fieldset className="scale-where">
          <legend className="ui-field-label">{t('ocr.languages.legend')}</legend>
          {OCR_LANGUAGES.map((l) => (
            <label key={l.code} className="scale-radio">
              <input
                type="checkbox"
                checked={languages.includes(l.code)}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setLanguages((prev) =>
                    on
                      ? OCR_LANGUAGES.map((x) => x.code).filter(
                          (c) => c === l.code || prev.includes(c),
                        )
                      : prev.filter((c) => c !== l.code),
                  );
                }}
              />
              {t(LANGUAGE_LABELS[l.code])}
            </label>
          ))}
          <p className="print-note">
            {t('ocr.languages.downloadNote', { size: format.bytes(onDemandBytes) })}
          </p>
        </fieldset>
        <label className="scale-radio">
          <input
            type="checkbox"
            checked={reRecognize}
            onChange={(e) => {
              setReRecognize(e.currentTarget.checked);
            }}
          />
          {t('ocr.reRecognize')}
        </label>
        <p className="print-note">{t('ocr.skipNote')}</p>
        {error && !rangeError ? (
          <p className="print-error" role="alert">
            {t(ERRORS[error])}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
