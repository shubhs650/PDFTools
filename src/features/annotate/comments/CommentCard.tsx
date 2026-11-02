// One row of the Comments pane (M6-05): a group header, a comment's card, or
// one of its replies (drawn inside the card, indented). Rows are listbox
// options, so nothing in them takes focus (rule 12, one tab stop): the small
// Reply / Edit / Delete marks are pointer shortcuts for keys and toolbar
// buttons that do the same (F2, Delete, Reply).
import { ArrowReply16Regular } from '@fluentui/react-icons/svg/arrow-reply';
import { CheckmarkCircle16Regular } from '@fluentui/react-icons/svg/checkmark-circle';
import { ChevronDown16Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronRight16Regular } from '@fluentui/react-icons/svg/chevron-right';
import { Circle16Regular } from '@fluentui/react-icons/svg/circle';
import { Delete16Regular } from '@fluentui/react-icons/svg/delete';
import { DismissCircle16Regular } from '@fluentui/react-icons/svg/dismiss-circle';
import { Edit16Regular } from '@fluentui/react-icons/svg/edit';
import { LockClosed16Regular } from '@fluentui/react-icons/svg/lock-closed';
import { Prohibited16Regular } from '@fluentui/react-icons/svg/prohibited';
import { PdfAnnotationState, type PdfAnnotationObject } from '@embedpdf/models';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { format, type MessageKey } from '../../../i18n';
import { CommandIcon } from '../../../ui/icons/CommandIcon';
import { annotationTypeKey } from '../annotationTypes';
import type { CommentRow } from './commentsModel';
import { ACTION, groupLabel } from './cardLabels';
import { STATUS_KEYS } from './statusLabels';
import type { StateEntry } from './thread';
import { typeIconCommand } from './typeIcons';

export interface RowProps {
  row: CommentRow;
  id: string;
  index: number;
  top: number;
  active: boolean;
  /** The card's comment is selected (on the page too). */
  selected: boolean;
  /** The row's text is being edited in the inline editor (hidden here). */
  editing: boolean;
  /** Review states by reviewer (comment rows). */
  states: readonly StateEntry[];
  /** Whether the current reviewer may edit / delete this reply. */
  mine: boolean;
  canEdit: boolean;
  measureRef: Ref<HTMLDivElement>;
}

export function StatusIcon({ state }: { state: PdfAnnotationState | 'none' }) {
  switch (state) {
    case PdfAnnotationState.Accepted:
    case PdfAnnotationState.Completed:
      return <CheckmarkCircle16Regular aria-hidden className="comment-status-icon" />;
    case PdfAnnotationState.Rejected:
      return <DismissCircle16Regular aria-hidden className="comment-status-icon" />;
    case PdfAnnotationState.Cancelled:
      return <Prohibited16Regular aria-hidden className="comment-status-icon" />;
    default:
      return <Circle16Regular aria-hidden className="comment-status-icon" />;
  }
}

/** A pointer-only mark (aria-hidden; the same action has a key and a button). */
function Mark({ action, title, children }: { action: string; title: string; children: ReactNode }) {
  return (
    <span className="comment-mark" data-action={action} title={title} aria-hidden="true">
      {children}
    </span>
  );
}

export function CommentRowView(p: RowProps) {
  const { t } = useTranslation();
  const { row } = p;
  const style: CSSProperties = { top: p.top };
  const common = {
    id: p.id,
    ref: p.measureRef,
    role: 'option',
    'data-row': p.index,
    'data-key': row.key,
    style,
  } as const;
  const active = p.active ? ' is-active' : '';

  if (row.kind === 'group') {
    return (
      <div
        {...common}
        aria-selected={false}
        className={`comment-group${active}${row.collapsed ? ' is-collapsed' : ''}`}
      >
        {row.collapsed ? (
          <ChevronRight16Regular aria-hidden className="comment-group-chevron" />
        ) : (
          <ChevronDown16Regular aria-hidden className="comment-group-chevron" />
        )}
        <span className="comment-group-label">{groupLabel(t, row.value, row.count)}</span>
        {row.collapsed ? (
          <span className="ui-visually-hidden"> {t('comments.collapsed')}</span>
        ) : null}
      </div>
    );
  }

  const selected = p.selected ? ' is-selected' : '';
  if (row.kind === 'reply') {
    const r = row.reply;
    return (
      <div
        {...common}
        aria-selected={false}
        className={`comment-option${active}${selected}${row.last ? ' is-last' : ''}`}
        style={{
          ...style,
          ...cardColor(row.root.annot),
          ['--reply-depth' as string]: Math.min(row.depth, 4),
        }}
      >
        <div className="comment-row comment-reply">
          <div className="comment-reply-body">
            <div className="comment-reply-meta">
              <span className="ui-visually-hidden">{t('comments.replyBy')} </span>
              <span className="comment-reply-author">{who(t, r)}</span>
              {r.created ? (
                <span className="comment-card-date"> · {format.dateTime(r.created)}</span>
              ) : null}{' '}
              {p.mine && p.canEdit && !p.editing ? (
                <span className="comment-marks">
                  <Mark action={ACTION.edit} title={t('comments.edit')}>
                    <Edit16Regular />
                  </Mark>
                  <Mark action={ACTION.deleteReply} title={t('comments.delete')}>
                    <Delete16Regular />
                  </Mark>
                </span>
              ) : null}
            </div>
            {p.editing ? null : <p className="comment-reply-text">{r.contents ?? ''} </p>}
          </div>
        </div>
      </div>
    );
  }

  const c = row.comment;
  const a = c.annot;
  return (
    <div
      {...common}
      aria-selected={p.selected}
      data-comment={c.id}
      className={`comment-option is-first${active}${selected}${row.replies ? '' : ' is-last'}`}
      style={{ ...style, ...cardColor(a) }}
    >
      <div className="comment-row comment-card">
        <div className="comment-card-head">
          <span className="comment-card-icon">
            <CommandIcon id={typeIconCommand(a)} />
          </span>
          <span className="comment-card-number" aria-hidden="true">
            {format.number(c.number, 0)}
          </span>
          <span className="ui-visually-hidden">
            {t('comments.numberLabel', { n: format.number(c.number, 0) })}{' '}
          </span>
          <span className="comment-card-type">{t(annotationTypeKey(a))}</span>{' '}
          {c.locked ? (
            <span className="comment-card-lock" title={t('comments.locked')}>
              <LockClosed16Regular aria-hidden />
              <span className="ui-visually-hidden">{t('comments.locked')} </span>
            </span>
          ) : null}
          <span className="comment-marks">
            {p.canEdit ? (
              <Mark action={ACTION.reply} title={t('comments.replyMark')}>
                <ArrowReply16Regular />
              </Mark>
            ) : null}
          </span>
        </div>
        <div className="comment-card-meta">
          <span className="comment-card-author">{who(t, a)}</span>
          {c.date ? (
            <span className="comment-card-date"> · {format.dateTime(c.date)}</span>
          ) : null}{' '}
        </div>
        {p.editing ? null : (
          <p className={`comment-card-text${c.contents ? '' : ' is-empty'}`}>
            {c.contents || t('comments.noText')}{' '}
          </p>
        )}
        {p.states.length ? (
          <ul className="comment-card-states">
            {p.states.map((s) => (
              <li key={s.author} className="comment-state">
                <StatusIcon state={s.state} />
                {t('comments.stateBy', { state: t(STATUS_KEYS[s.state]), author: who(t, s) })}{' '}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

const who = (t: (k: MessageKey) => string, a: { author?: string | undefined }): string =>
  a.author === undefined || a.author === '' ? t('annotate.noAuthor') : a.author;

/** The card's colour bar: the comment's stroke (or fill) colour, when it has one. */
function cardColor(a: PdfAnnotationObject): CSSProperties {
  const o = a as { strokeColor?: string; color?: string };
  const c = o.strokeColor ?? o.color;
  return typeof c === 'string' && /^#[0-9a-f]{6}$/iu.test(c)
    ? { ['--card-color' as string]: c }
    : {};
}
