import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { Button, Dialog, ProgressBar } from '../../ui/components';
import type { LeakKind } from '../../workers/work/redact/verify';
import { openReport } from '../report/reportStore';
import {
  cancelApply,
  closeApply,
  openRedacted,
  redactedName,
  runApply,
  useApply,
} from './applyFlow';
import { useMarks } from './redactStore';

const KINDS: Record<LeakKind, MessageKey> = {
  text: msg('redact.check.text'),
  'text-object': msg('redact.check.textObject'),
  path: msg('redact.check.path'),
  image: msg('redact.check.image'),
  shading: msg('redact.check.shading'),
  annotation: msg('redact.check.annotation'),
  string: msg('redact.check.string'),
  structure: msg('redact.check.structure'),
};

const FEATURE = 'redact';

const REMOVED: MessageKey[] = [
  msg('redact.apply.removes.content'),
  msg('redact.apply.removes.annotations'),
  msg('redact.apply.removes.metadata'),
  msg('redact.apply.removes.hidden'),
];

/**
 * Apply Redactions (M4-17/18, §7.9): what will happen, then progress and
 * Cancel, then either the result (marks applied, pages, checks passed, open
 * the new file) or the verification failure (nothing written; which pages and
 * checks; a content-free report).
 */
export function ApplyDialog() {
  const docId = useApply((s) => s.docId);
  if (!docId) return null;
  return <Body docId={docId} />;
}

function Body({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const meta = useDocuments((s) => s.docs[docId]?.meta);
  const marks = useMarks(docId);
  const running = useApply((s) => s.running);
  const result = useApply((s) => s.result);
  const failure = useApply((s) => s.failure);
  const error = useApply((s) => s.error);
  const pages = new Set(marks.map((m) => m.pageIndex)).size;
  const signatures = meta?.signatureCount ?? 0;
  const done = !!result || !!failure;
  // Content-free (rule 10): the entry holds counts per check, never text.
  const report = () => {
    if (failure) openReport({ error: failure.entry, feature: FEATURE });
  };

  const footer = running ? (
    <Button key="cancel" label={t('redact.apply.cancel')} onClick={cancelApply} />
  ) : result ? (
    <>
      <Button
        key="open"
        label={t('redact.apply.openNew')}
        variant="primary"
        onClick={() => void openRedacted()}
      />
      <Button label={t('redact.apply.close')} onClick={closeApply} />
    </>
  ) : failure ? (
    <>
      <Button key="report" label={t('redact.apply.report')} onClick={report} />
      <Button label={t('redact.apply.close')} onClick={closeApply} />
    </>
  ) : (
    <>
      <Button
        key="apply"
        label={t('redact.apply.apply')}
        variant="primary"
        disabled={marks.length === 0}
        onClick={() => void runApply()}
      />
      <Button label={t('redact.apply.close')} onClick={closeApply} />
    </>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeApply();
      }}
      title={t('redact.apply.title')}
      description={t('redact.apply.description')}
      closeIcon={<Dismiss20Regular />}
      footer={footer}
    >
      <div className="scale-form" data-testid="redact-apply">
        {!done ? (
          <>
            <p className="print-note">
              {t('redact.apply.summary', {
                count: marks.length,
                marks: format.number(marks.length, 0),
                pages: format.number(pages, 0),
              })}
            </p>
            <p className="print-note">
              {t('redact.apply.newFile', { name: meta ? redactedName(meta.name) : '' })}
            </p>
            <p className="ui-field-label">{t('redact.apply.removesLabel')}</p>
            <ul className="redact-list">
              {REMOVED.map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
            {signatures > 0 ? (
              <p className="print-error" role="alert">
                {t('redact.apply.signed', { count: signatures, n: format.number(signatures, 0) })}
              </p>
            ) : null}
          </>
        ) : null}
        {running ? (
          <>
            <ProgressBar
              label={t('redact.apply.progressName')}
              value={running.total > 0 ? running.done / running.total : null}
            />
            <p className="print-note" role="status">
              {t(
                running.phase === 'verify'
                  ? msg('redact.apply.verifying')
                  : msg('redact.apply.applying'),
                {
                  done: format.number(running.done, 0),
                  total: format.number(running.total, 0),
                },
              )}
            </p>
          </>
        ) : null}
        {result ? (
          <div role="status" data-testid="redact-result">
            <p className="redact-ok">{t('redact.apply.success', { name: result.name })}</p>
            <ul className="redact-list">
              <li>
                {t('redact.apply.applied', {
                  count: result.marks,
                  marks: format.number(result.marks, 0),
                  pages: format.number(result.pages, 0),
                })}
              </li>
              <li>{t('redact.apply.checksPassed')}</li>
              {result.removedAnnotations ? (
                <li>
                  {t('redact.apply.annotationsRemoved', {
                    count: result.removedAnnotations,
                    n: format.number(result.removedAnnotations, 0),
                  })}
                </li>
              ) : null}
              {result.recut.clipApproximated +
                result.recut.styleApproximated +
                result.recut.marksLost >
              0 ? (
                <li>{t('redact.apply.simplified')}</li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {failure ? (
          <div role="alert" data-testid="redact-failure">
            <p className="print-error">{t('redact.apply.failedVerify')}</p>
            <ul className="redact-list">
              {failure.leaks.map((l) => (
                <li key={l.page}>
                  {l.page === 0
                    ? t('redact.apply.leakDocument', {
                        checks: format.list(l.kinds.map((k) => t(KINDS[k]))),
                      })
                    : t('redact.apply.leakPage', {
                        page: format.number(l.page, 0),
                        checks: format.list(l.kinds.map((k) => t(KINDS[k]))),
                      })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <p className="print-error" role="alert">
            {t(
              error === 'denied'
                ? msg('export.error.denied')
                : error === 'noMarks'
                  ? msg('redact.apply.noMarks')
                  : msg('redact.apply.failed'),
              { what: t('protect.capability.modify') },
            )}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
