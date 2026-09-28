import type { PdfAnnotationState } from '@embedpdf/models';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { documentStore, useDocuments } from '../../../app/store/documentStore';
import { format, msg, type MessageKey } from '../../../i18n';
import { goToPoint } from '../../view/controller';
import { annotationTypeKey } from '../annotationTypes';
import { annotationCapability, useSelectedAnnotations } from '../selection';
import { buildRows, type CommentRow, type CommentSort } from './commentsModel';
import { STATUS_FILTERS, STATUS_KEYS } from './statusLabels';
import {
  commentsFor,
  objectsOf,
  setView,
  useAnnotationMap,
  useComments,
  viewOf,
} from './commentsStore';
import { ThreadView } from './ThreadView';

/** Row height in CSS px (fixed: the list is virtualized by index). */
const ROW_H = 44;
const OVERSCAN = 6;

const SORTS: readonly { value: CommentSort; key: MessageKey }[] = [
  { value: 'page', key: msg('comments.sort.page') },
  { value: 'date', key: msg('comments.sort.date') },
  { value: 'author', key: msg('comments.sort.author') },
  { value: 'type', key: msg('comments.sort.type') },
];

/**
 * The Comments pane (M3-11, §5, §7.1): every comment of the document, new
 * and unsaved ones included, numbered (M3-Q5), filtered and sorted per
 * document; Enter or a click selects the comment on its page. A listbox with
 * one tab stop (rule 12), virtualized for 10,000 comments (rule 1).
 */
export function CommentsPane() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const byUid = useAnnotationMap(docId);
  const view = useComments((s) => (docId ? viewOf(s, docId) : null));
  const focusFilters = useComments((s) => s.focusFilters);
  const filtersRef = useRef<HTMLSelectElement>(null);
  const ids = useId();
  useEffect(() => {
    if (focusFilters > 0) filtersRef.current?.focus();
  }, [focusFilters]);
  const comments = useMemo(() => (byUid ? commentsFor(byUid) : []), [byUid]);
  const authors = useMemo(() => [...new Set(comments.map((c) => c.author))].sort(), [comments]);
  const types = useMemo(
    () => [...new Set(comments.map((c) => c.type))].sort((a, b) => a - b),
    [comments],
  );
  const rows = useMemo(
    () => (view ? buildRows(comments, view.filter, view.sort) : []),
    [comments, view],
  );
  if (!docId || !view) return <p className="pane-empty">{t('comments.noDocument')}</p>;
  const f = view.filter;
  const shown = rows.filter((r) => r.kind === 'comment').length;
  return (
    <div className="comments-pane" data-testid="comments-pane">
      <div className="comments-filters" role="group" aria-label={t('comments.filters')}>
        <label htmlFor={`${ids}-author`}>{t('comments.author')}</label>
        <select
          ref={filtersRef}
          id={`${ids}-author`}
          className="ui-field-input"
          value={f.authors?.[0] ?? '*'}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setView(docId, { filter: { ...f, authors: v === '*' ? [] : [v] } });
          }}
        >
          <option value="*">{t('comments.all')}</option>
          {authors.map((a) => (
            <option key={a} value={a}>
              {a || t('annotate.noAuthor')}
            </option>
          ))}
        </select>
        <label htmlFor={`${ids}-type`}>{t('comments.type')}</label>
        <select
          id={`${ids}-type`}
          className="ui-field-input"
          value={f.types?.[0] ?? '*'}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setView(docId, {
              filter: { ...f, types: v === '*' ? [] : [Number(v)] },
            });
          }}
        >
          <option value="*">{t('comments.all')}</option>
          {types.map((ty) => (
            <option key={ty} value={ty}>
              {t(annotationTypeKey({ type: ty } as never))}
            </option>
          ))}
        </select>
        <label htmlFor={`${ids}-status`}>{t('comments.statusLabel')}</label>
        <select
          id={`${ids}-status`}
          className="ui-field-input"
          value={f.statuses?.[0] ?? '*'}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setView(docId, {
              filter: { ...f, statuses: v === '*' ? [] : [v as PdfAnnotationState | 'none'] },
            });
          }}
        >
          <option value="*">{t('comments.all')}</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_KEYS[s])}
            </option>
          ))}
        </select>
        <label className="comments-check">
          <input
            type="checkbox"
            checked={!!f.pages}
            onChange={(e) => {
              const page = e.currentTarget.checked ? currentPage(docId) : null;
              setView(docId, {
                filter: {
                  ...f,
                  ...(page === null ? { pages: undefined } : { pages: [page, page] }),
                },
              });
            }}
          />
          {t('comments.thisPage')}
        </label>
        <label htmlFor={`${ids}-sort`}>{t('comments.sortLabel')}</label>
        <select
          id={`${ids}-sort`}
          className="ui-field-input"
          value={view.sort}
          onChange={(e) => {
            setView(docId, { sort: e.currentTarget.value as CommentSort });
          }}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {t(s.key)}
            </option>
          ))}
        </select>
      </div>
      <p className="comments-count" role="status">
        {comments.length === 0
          ? t('comments.none')
          : t('comments.count', {
              shown: format.number(shown, 0),
              total: format.number(comments.length, 0),
              count: comments.length,
            })}
      </p>
      {rows.length > 0 ? <CommentList docId={docId} rows={rows} /> : null}
      {byUid ? <SelectedThread docId={docId} byUid={byUid} /> : null}
    </div>
  );
}

/** The thread of the comment selected on the page (M3-12). */
function SelectedThread({
  docId,
  byUid,
}: {
  docId: string;
  byUid: Parameters<typeof objectsOf>[0];
}) {
  const selected = useSelectedAnnotations(docId);
  const focusReply = useComments((s) => s.focusReply);
  const focusStatus = useComments((s) => s.focusStatus);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (focusReply > 0) replyRef.current?.focus();
  }, [focusReply]);
  useEffect(() => {
    if (focusStatus > 0) statusRef.current?.focus();
  }, [focusStatus]);
  const comments = commentsFor(byUid);
  const only = selected.length === 1 ? selected[0] : undefined;
  const c = only ? comments.find((x) => x.id === only.id) : undefined;
  if (!c) return null;
  return (
    <ThreadView
      docId={docId}
      comment={c.annot}
      number={c.number}
      all={objectsOf(byUid)}
      replyRef={replyRef}
      statusRef={statusRef}
    />
  );
}

function currentPage(docId: string): number {
  return documentStore.getState().docs[docId]?.view.page ?? 0;
}

function CommentList({ docId, rows }: { docId: string; rows: CommentRow[] }) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);
  const [active, setActive] = useState(0);
  const selected = useSelectedAnnotations(docId);
  const selectedId = selected[0]?.id ?? null;

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewHeight(el.clientHeight);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const scrollIntoView = (i: number): void => {
    const el = list.current;
    if (!el) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_H - el.clientHeight;
    setScrollTop(el.scrollTop);
  };

  // The comment selected on the page is the active row (and scrolled to).
  const selectedRow = selectedId
    ? rows.findIndex((r) => r.kind === 'comment' && r.comment.id === selectedId)
    : -1;
  const [followed, setFollowed] = useState<string | null>(null);
  if (selectedId !== followed) {
    setFollowed(selectedId);
    if (selectedRow >= 0) setActive(selectedRow);
  }
  useEffect(() => {
    if (selectedRow >= 0) scrollIntoView(selectedRow);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the page's selection only
  }, [selectedId]);

  const current = Math.min(active, rows.length - 1);
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length - 1, Math.ceil((scrollTop + viewHeight) / ROW_H) + OVERSCAN);

  const open = (i: number): void => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === 'page') {
      goToPoint(row.page, 0, 0, 0);
      return;
    }
    const a = row.comment.annot;
    goToPoint(a.pageIndex, a.rect.origin.x, a.rect.origin.y);
    annotationCapability()?.forDocument(docId).selectAnnotation(a.pageIndex, a.id);
  };

  const moveTo = (i: number): void => {
    const to = Math.max(0, Math.min(rows.length - 1, i));
    setActive(to);
    scrollIntoView(to);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const perView = Math.max(1, Math.floor(viewHeight / ROW_H) - 1);
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        moveTo(current + 1);
      },
      ArrowUp: () => {
        moveTo(current - 1);
      },
      PageDown: () => {
        moveTo(current + perView);
      },
      PageUp: () => {
        moveTo(current - perView);
      },
      Home: () => {
        moveTo(0);
      },
      End: () => {
        moveTo(rows.length - 1);
      },
      Enter: () => {
        open(current);
      },
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  const items = [];
  for (let i = first; i <= last; i++) {
    const row = rows[i];
    if (!row) continue;
    const common = {
      key: i,
      id: `${listId}-${String(i)}`,
      role: 'option',
      'aria-selected': i === current,
      'data-row': i,
      style: { top: i * ROW_H, height: ROW_H },
    } as const;
    if (row.kind === 'page') {
      items.push(
        <div
          {...common}
          className={`comment-row comment-row--page${i === current ? ' comment-row--active' : ''}`}
        >
          {t('comments.page', { page: format.number(row.page + 1, 0), count: row.count })}
        </div>,
      );
      continue;
    }
    const c = row.comment;
    const meta = [
      t(annotationTypeKey(c.annot)),
      c.author || t('annotate.noAuthor'),
      c.date ? format.dateTime(c.date) : null,
      c.status ? t(STATUS_KEYS[c.status]) : null,
      c.replies ? t('comments.replies', { count: c.replies }) : null,
    ].filter(Boolean);
    items.push(
      <div
        {...common}
        className={`comment-row${i === current ? ' comment-row--active' : ''}`}
        data-comment={c.id}
      >
        <span className="comment-number">{format.number(c.number, 0)}</span>
        <span className="comment-body">
          <span className="comment-meta">{meta.join(' · ')}</span>
          <span className="comment-text">{c.firstLine || '—'}</span>
        </span>
      </div>,
    );
  }

  return (
    <div
      ref={list}
      className="comments-list"
      role="listbox"
      tabIndex={0}
      aria-label={t('comments.list')}
      aria-activedescendant={`${listId}-${String(current)}`}
      data-testid="comments-list"
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
      }}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
        if (!el) return;
        const i = Number(el.dataset['row']);
        setActive(i);
        open(i);
      }}
    >
      <div className="comments-list-content" style={{ height: rows.length * ROW_H }}>
        {items}
      </div>
    </div>
  );
}
