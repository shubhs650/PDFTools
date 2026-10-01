import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import { Dismiss20Regular } from '@fluentui/react-icons/svg/dismiss';
import type { PdfRedactAnnoObject } from '@embedpdf/models';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { securityOf, useDocuments } from '../../app/store/documentStore';
import { format, msg } from '../../i18n';
import { allows } from '../../model/permissions';
import { Button, IconButton } from '../../ui/components';
import { runCommand } from '../../app/commands/dispatch';
import { annotationCapability } from '../annotate/selection';
import { goToPoint } from '../view/controller';
import { markKind } from './markModel';
import { setRedactPanel, useMarks, useRedactPanel } from './redactStore';

const APPLY = 'protect.applyRedactions';

/** Longest snippet shown per mark. */
const SNIPPET = 60;

/**
 * Pending Redactions (M4-16, §7.9 step 1): every /Redact mark of the active
 * document — page, kind, the marked text when copying is allowed (rule 9) —
 * to jump to or remove, and Apply (M4-18).
 */
export function PendingRedactionsPanel() {
  const open = useRedactPanel((s) => s.open);
  const docId = useDocuments((s) => s.activeId);
  if (!open || !docId) return null;
  return <Panel docId={docId} />;
}

function Panel({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const ids = useId();
  const marks = useMarks(docId);
  const meta = useDocuments((s) => s.docs[docId]?.meta);
  const canCopy = meta ? allows(securityOf(meta), 'copy') : false;
  const canAnnotate = meta ? allows(securityOf(meta), 'annotate') : false;

  const apply = () => void runCommand(APPLY);
  const jump = (m: PdfRedactAnnoObject) => {
    goToPoint(m.pageIndex, m.rect.origin.x, m.rect.origin.y);
    annotationCapability()?.forDocument(docId).selectAnnotation(m.pageIndex, m.id);
  };
  const remove = (m: PdfRedactAnnoObject) => {
    annotationCapability()?.forDocument(docId).deleteAnnotation(m.pageIndex, m.id);
  };

  return (
    <aside aria-labelledby={`${ids}-title`} className="properties-pane redact-panel">
      <div className="pane-header">
        <h2 id={`${ids}-title`} className="pane-title">
          {t('redact.panel.title')}
        </h2>
        <IconButton
          label={t('redact.panel.close')}
          icon={<Dismiss20Regular />}
          size="small"
          tooltip={false}
          onClick={() => {
            setRedactPanel(false);
          }}
        />
      </div>
      <div className="table-review-body">
        <p className="print-note" role="status">
          {t('redact.panel.count', { count: marks.length, n: format.number(marks.length, 0) })}
        </p>
        {marks.length === 0 ? <p className="print-note">{t('redact.panel.empty')}</p> : null}
        <ul className="table-review-list">
          {marks.map((m, i) => {
            const kind = markKind(m);
            const snippet =
              canCopy && m.contents
                ? m.contents.replace(/\s+/gu, ' ').slice(0, SNIPPET) +
                  (m.contents.length > SNIPPET ? '…' : '')
                : null;
            const name = t(
              kind === 'text' ? msg('redact.panel.textItem') : msg('redact.panel.areaItem'),
              {
                n: format.number(i + 1, 0),
                page: format.number(m.pageIndex + 1, 0),
              },
            );
            return (
              <li key={m.id} className="table-review-item">
                <button
                  type="button"
                  className="table-review-select"
                  onClick={() => {
                    jump(m);
                  }}
                >
                  <span>{name}</span>
                  {snippet ? <span className="redact-snippet">{snippet}</span> : null}
                </button>
                <IconButton
                  label={t('redact.panel.remove', { name })}
                  icon={<Delete20Regular />}
                  size="small"
                  tooltip={false}
                  disabled={!canAnnotate}
                  onClick={() => {
                    remove(m);
                  }}
                />
              </li>
            );
          })}
        </ul>
        <p className="print-note">{t('redact.panel.applyLater')}</p>
        <Button
          label={t('redact.panel.apply')}
          variant="primary"
          disabled={marks.length === 0}
          onClick={apply}
        />
        <Button
          label={t('redact.panel.close')}
          onClick={() => {
            setRedactPanel(false);
          }}
        />
      </div>
    </aside>
  );
}

/** "3 redaction marks" in the status bar while a document has marks. */
export function RedactionStatus() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const marks = useMarks(docId);
  if (!docId || marks.length === 0) return null;
  return (
    <button
      type="button"
      className="status-chip"
      onClick={() => {
        setRedactPanel(true);
      }}
    >
      {t('redact.status', { count: marks.length, n: format.number(marks.length, 0) })}
    </button>
  );
}
