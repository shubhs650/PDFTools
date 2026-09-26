import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../i18n';
import { Button, ProgressBar } from '../../ui/components';
import { loadAttachments, openAttachment, saveAttachment, useAttachments } from './attachments';

const ERROR: Record<string, MessageKey> = {
  'attachment-not-pdf': msg('attachments.error.notPdf'),
};

/**
 * Attachments pane (§5, M2-11): the document's embedded files with size,
 * description and date. "Save…" writes the file where the user chooses; a
 * PDF can open as a new tab. Nothing is previewed or run.
 */
export function AttachmentsPane() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const list = useAttachments((s) => (docId ? s.lists[docId] : undefined));
  const busy = useAttachments((s) => s.busy);
  const error = useAttachments((s) => s.error);

  useEffect(() => {
    if (docId) loadAttachments(docId);
  }, [docId]);

  if (!docId) return <p className="pane-empty">{t('attachments.noDocument')}</p>;
  if (!list || list.state === 'loading')
    return (
      <div className="pane-empty">
        <ProgressBar
          label={t('attachments.loading')}
          value={list?.total ? list.done / list.total : null}
          {...(list?.total
            ? {
                valueText: t('attachments.progress', {
                  done: format.number(list.done, 0),
                  total: format.number(list.total, 0),
                }),
              }
            : {})}
        />
      </div>
    );
  if (list.state === 'failed') return <p className="pane-empty">{t('attachments.failed')}</p>;
  if (list.items.length === 0) return <p className="pane-empty">{t('attachments.empty')}</p>;

  return (
    <div className="attachments-pane">
      {error ? (
        <p className="attachments-error" role="alert">
          {t(ERROR[error] ?? msg('attachments.error.failed'))}
        </p>
      ) : null}
      <ul className="attachment-list" aria-label={t('attachments.list')}>
        {list.items.map((item, i) => (
          <li key={i} className="attachment" data-pane-focus={i === 0 || undefined} tabIndex={-1}>
            <div className="attachment-name">{item.name || t('attachments.unnamed')}</div>
            <div className="attachment-meta">
              {[
                item.size === null ? null : format.bytes(item.size),
                item.created ? format.dateTime(new Date(item.created)) : null,
                item.ref.source === 'annotation'
                  ? t('attachments.onPage', { page: format.number(item.ref.page + 1, 0) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {item.description ? (
              <div className="attachment-description">{item.description}</div>
            ) : null}
            <div className="attachment-actions">
              <Button
                label={t('attachments.save')}
                size="small"
                disabled={busy !== null}
                onClick={() => {
                  void saveAttachment(docId, item, i);
                }}
              />
              {/\.pdf$/i.test(item.name) ? (
                <Button
                  label={t('attachments.open')}
                  size="small"
                  disabled={busy !== null}
                  onClick={() => {
                    void openAttachment(docId, item, i);
                  }}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
