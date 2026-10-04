import { PdfAnnotationState, type PdfAnnotationObject } from '@embedpdf/models';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { securityOf, useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { allows } from '../../../model/permissions';
import { Button } from '../../../ui/components';
import { annotationTypeKey } from '../annotationTypes';
import { STATUS_KEYS } from './statusLabels';
import { buildThread } from './thread';
import { addReply, deleteComments, editReply, isMine, reselect, setStatus } from './threadActions';

const SETTABLE = [
  PdfAnnotationState.None,
  PdfAnnotationState.Accepted,
  PdfAnnotationState.Rejected,
  PdfAnnotationState.Cancelled,
  PdfAnnotationState.Completed,
] as const;

/**
 * The selected comment's thread (M3-12, §7.1): its replies (nested), the
 * review status per reviewer with its history, a reply box and Set Status.
 * Replies are edited and deleted by their author only; everything is
 * disabled without the annotate permission (rule 9).
 */
export function ThreadView({
  docId,
  comment,
  number,
  all,
  replyRef,
  statusRef,
}: {
  docId: string;
  comment: PdfAnnotationObject;
  number: number;
  all: readonly PdfAnnotationObject[];
  replyRef?: React.Ref<HTMLTextAreaElement>;
  statusRef?: React.Ref<HTMLSelectElement>;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const canEdit = useDocuments((s) => {
    const meta = s.docs[docId]?.meta;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const thread = useMemo(() => buildThread(all, comment.id), [all, comment.id]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const who = (a: string | undefined) => (a === undefined || a === '' ? t('annotate.noAuthor') : a);
  return (
    <section className="thread" aria-labelledby={`${ids}-h`} data-testid="comment-thread">
      <h3 id={`${ids}-h`} className="thread-title">
        {t('comments.thread', { n: format.number(number, 0), type: t(annotationTypeKey(comment)) })}
      </h3>
      <p className="thread-root">{comment.contents ?? ''}</p>
      <fieldset disabled={!canEdit} className="thread-fields">
        <div className="thread-actions thread-actions--root">
          <Button
            label={t('comments.deleteComment')}
            size="small"
            variant="subtle"
            onClick={() => {
              // The same path as the Delete key and the ribbon (replies ask first).
              deleteComments(docId, [comment]);
            }}
          />
        </div>
        <div className="thread-status">
          <label htmlFor={`${ids}-status`}>{t('comments.setStatus')}</label>
          <select
            ref={statusRef}
            id={`${ids}-status`}
            className="ui-field-input"
            value=""
            onChange={(e) => {
              const v = e.currentTarget.value;
              if (v !== '') void setStatus(docId, comment, v as PdfAnnotationState);
            }}
          >
            <option value="" disabled>
              {t('comments.chooseStatus')}
            </option>
            {SETTABLE.map((s) => (
              <option key={s} value={s}>
                {t(STATUS_KEYS[s])}
              </option>
            ))}
          </select>
        </div>
        {thread.states.length ? (
          <ul className="thread-states" aria-label={t('comments.statuses')}>
            {thread.states.map((s) => (
              <li key={s.author}>
                {t('comments.stateBy', { state: t(STATUS_KEYS[s.state]), author: who(s.author) })}
                <span className="thread-date"> · {format.dateTime(s.date)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {thread.history.length > thread.states.length ? (
          <details className="thread-history">
            <summary>{t('comments.history')}</summary>
            <ol>
              {thread.history.map((h) => (
                <li key={h.id}>{h.contents ?? ''}</li>
              ))}
            </ol>
          </details>
        ) : null}
        <ol className="thread-replies" aria-label={t('comments.repliesLabel')}>
          {thread.replies.map(({ annot: r, depth }) => (
            <li
              key={r.id}
              className="thread-reply"
              style={{ marginInlineStart: `${String(depth * 1.25)}em` }}
            >
              <div className="thread-meta">
                {who(r.author)}
                {r.created ? ` · ${format.dateTime(r.created)}` : ''}
              </div>
              {editing?.id === r.id ? (
                <div className="thread-edit">
                  <textarea
                    className="ui-field-input"
                    aria-label={t('comments.editReply')}
                    value={editing.text}
                    onChange={(e) => {
                      setEditing({ id: r.id, text: e.currentTarget.value });
                    }}
                  />
                  <Button
                    label={t('comments.save')}
                    size="small"
                    variant="primary"
                    onClick={() => {
                      editReply(docId, r, editing.text);
                      setEditing(null);
                    }}
                  />
                  <Button
                    label={t('annotate.caret.cancel')}
                    size="small"
                    onClick={() => {
                      setEditing(null);
                    }}
                  />
                </div>
              ) : (
                <p className="thread-text">{r.contents ?? ''}</p>
              )}
              {isMine(r) && editing?.id !== r.id ? (
                <div className="thread-actions">
                  <Button
                    label={t('comments.edit')}
                    size="small"
                    variant="subtle"
                    onClick={() => {
                      setEditing({ id: r.id, text: r.contents ?? '' });
                    }}
                  />
                  <Button
                    label={t('comments.delete')}
                    size="small"
                    variant="subtle"
                    onClick={() => {
                      deleteComments(docId, [r]);
                      // The plugin's delete clears the selection: keep this thread open.
                      reselect(docId, comment);
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="thread-reply-box">
          <label htmlFor={`${ids}-reply`}>{t('comments.replyLabel')}</label>
          <textarea
            ref={replyRef}
            id={`${ids}-reply`}
            className="ui-field-input"
            rows={2}
            value={draft}
            onChange={(e) => {
              setDraft(e.currentTarget.value);
            }}
          />
          <Button
            label={t('comments.reply')}
            size="small"
            variant="primary"
            disabled={!draft.trim()}
            onClick={() => {
              void addReply(docId, comment, draft).then(() => {
                setDraft('');
              });
            }}
          />
        </div>
      </fieldset>
    </section>
  );
}
