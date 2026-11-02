import { Dismiss12Regular } from '@fluentui/react-icons/svg/dismiss';
import { Search20Regular } from '@fluentui/react-icons/svg/search';
import type { PdfAnnotationObject } from '@embedpdf/models';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { securityOf, useDocuments } from '../../../app/store/documentStore';
import { format } from '../../../i18n';
import { allows } from '../../../model/permissions';
import { IconButton } from '../../../ui/components';
import { goToPoint } from '../../view/controller';
import { annotationTypeKey } from '../annotationTypes';
import { annotationCapability, useSelectedAnnotations } from '../selection';
import { CommentList } from './CommentList';
import { CommentsToolbar } from './CommentsToolbar';
import {
  findText,
  groupKeys,
  isFiltered,
  layoutComments,
  rootOf,
  type CommentFilter,
} from './commentsModel';
import {
  commentsFor,
  objectsOf,
  setView,
  useAnnotationMap,
  useComments,
  viewOf,
  type CommentsView,
} from './commentsStore';
import { STATUS_KEYS } from './statusLabels';
import { buildThread, childrenOf, type Thread } from './thread';

const NO_THREAD: Thread = { replies: [], states: [], history: [] };

/**
 * The Comments pane (M3-11, redesigned in M6-05, ADR-021 D-38 a): a one-row
 * toolbar with the Options menu, Find (on Enter, rule 3), the active filters
 * as chips, and the comments as cards under collapsible group headers, with
 * their replies and an inline editor; the list's selection is the page's.
 */
export function CommentsPane() {
  const { t } = useTranslation();
  const docId = useDocuments((s) => s.activeId);
  const byUid = useAnnotationMap(docId);
  const view = useComments((s) => (docId ? viewOf(s, docId) : null));
  const page = useDocuments((s) => (docId ? (s.docs[docId]?.view.page ?? 0) : 0));
  const canEdit = useDocuments((s) => {
    const meta = docId ? s.docs[docId]?.meta : undefined;
    return meta ? allows(securityOf(meta), 'annotate') : false;
  });
  const selected = useSelectedAnnotations(docId);

  const all = useMemo(() => (byUid ? objectsOf(byUid) : []), [byUid]);
  const comments = useMemo(() => (byUid ? commentsFor(byUid) : []), [byUid]);
  const authors = useMemo(() => [...new Set(comments.map((c) => c.author))].sort(), [comments]);
  const types = useMemo(
    () => [...new Set(comments.map((c) => c.type))].sort((a, b) => a - b),
    [comments],
  );
  // Threads, built once per annotation state from one map of replies.
  const threadOf = useMemo(() => {
    const kids = childrenOf(all);
    const threads = new Map<string, Thread>(
      [...kids.keys()].map((id) => [id, buildThread(all, id, kids)]),
    );
    return (id: string): Thread => threads.get(id) ?? NO_THREAD;
  }, [all]);
  const layout = useMemo(
    () =>
      view
        ? layoutComments(comments, view.filter, view.sort, {
            group: view.group,
            collapsed: new Set(view.collapsed),
            repliesOf: (id) => threadOf(id).replies,
          })
        : null,
    [comments, view, threadOf],
  );
  const roots = useMemo(() => {
    const byId = new Map(all.map((a) => [a.id, a]));
    return new Set(selected.map((a) => rootOf(a, byId)));
  }, [selected, all]);

  // Current page only follows the page (M6-05).
  useEffect(() => {
    if (!docId || !view?.currentPageOnly) return;
    const p = view.filter.pages;
    if (p?.[0] !== page || p[1] !== page)
      setView(docId, { filter: { ...view.filter, pages: [page, page] } });
  }, [docId, view, page]);

  if (!docId || !view || !layout) return <p className="pane-empty">{t('comments.noDocument')}</p>;

  const open = (a: PdfAnnotationObject): void => {
    goToPoint(a.pageIndex, a.rect.origin.x, a.rect.origin.y);
    annotationCapability()?.forDocument(docId).selectAnnotation(a.pageIndex, a.id);
  };
  // Previous / Next: from the selected comment, through every comment shown (collapsed too).
  const at = layout.order.findIndex((c) => roots.has(c.id));
  const step = (dir: 1 | -1) => {
    const to = at < 0 ? (dir === 1 ? 0 : layout.order.length - 1) : at + dir;
    const c = layout.order[to];
    if (!c) return null;
    return () => {
      const group = layout.groupOf.get(c.id);
      if (group && view.collapsed.includes(group))
        setView(docId, { collapsed: view.collapsed.filter((k) => k !== group) });
      open(c.annot);
    };
  };

  return (
    <div className="comments-pane" data-testid="comments-pane">
      <CommentsToolbar
        docId={docId}
        view={view}
        authors={authors}
        types={types}
        groupKeys={groupKeys(layout)}
        onPrev={step(-1)}
        onNext={step(1)}
        page={page}
      />
      <FindBox docId={docId} filter={view.filter} paneFocus={layout.rows.length === 0} />
      {isFiltered(view.filter) ? <FilterChips docId={docId} view={view} /> : null}
      {layout.rows.length > 0 ? (
        <CommentList
          docId={docId}
          layout={layout}
          threadOf={threadOf}
          selectedRoots={roots}
          canEdit={canEdit}
          onOpen={open}
        />
      ) : (
        <p className="comments-empty">
          {comments.length === 0 ? t('comments.none') : t('comments.noMatch')}
        </p>
      )}
      <p className="comments-count" role="status">
        {comments.length === 0
          ? t('comments.none')
          : t('comments.count', {
              shown: format.number(layout.shown, 0),
              total: format.number(comments.length, 0),
              count: comments.length,
            }) +
            (selected.length
              ? ` · ${t('comments.selected', { count: selected.length, n: format.number(selected.length, 0) })}`
              : '')}
      </p>
    </div>
  );
}

/** Find (M6-05): filters the cards by their text; runs on Enter or the button (rule 3). */
function FindBox({
  docId,
  filter,
  paneFocus,
}: {
  docId: string;
  filter: CommentFilter;
  /** No list to focus: a rail button opens the pane with focus here (LeftRail). */
  paneFocus: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(filter.text ?? '');
  const applied = filter.text ?? '';
  const [shown, setShown] = useState(applied);
  // A chip's × (or another document) changes the applied text: the box follows.
  if (applied !== shown) {
    setShown(applied);
    setText(applied);
  }
  const focusFilters = useComments((s) => s.focusFilters);
  useEffect(() => {
    if (focusFilters > 0) input.current?.focus();
  }, [focusFilters]);
  const apply = (value: string): void => {
    const rest = { ...filter };
    delete rest.text;
    setView(docId, { filter: findText(value) ? { ...rest, text: value.trim() } : rest });
  };
  return (
    <div className="comments-find" role="search">
      <label htmlFor={`${id}-find`} className="ui-visually-hidden">
        {t('comments.find')}
      </label>
      <input
        ref={input}
        id={`${id}-find`}
        type="search"
        className="ui-field-input comments-find-input"
        placeholder={t('comments.findPlaceholder')}
        value={text}
        enterKeyHint="search"
        data-pane-focus={paneFocus || undefined}
        onChange={(e) => {
          setText(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply(text);
          } else if (e.key === 'Escape' && text) {
            e.preventDefault();
            e.stopPropagation();
            setText('');
            apply('');
          }
        }}
      />
      <IconButton
        label={t('comments.findButton')}
        icon={<Search20Regular />}
        className="comments-tool"
        onClick={() => {
          apply(text);
        }}
      />
    </div>
  );
}

/** The filters that are set, each removable, and Clear all (M6-05). */
function FilterChips({ docId, view }: { docId: string; view: CommentsView }) {
  const { t } = useTranslation();
  const f = view.filter;
  const chips: { key: string; label: string; clear: () => CommentFilter; page?: boolean }[] = [];
  const without = <K extends keyof CommentFilter>(k: K, keep?: CommentFilter[K]): CommentFilter => {
    const rest = Object.fromEntries(
      Object.entries(f).filter(([key]) => key !== k),
    ) as CommentFilter;
    return keep === undefined ? rest : { ...rest, [k]: keep };
  };
  if (f.text)
    chips.push({
      key: 'text',
      label: t('comments.chip.find', { text: f.text }),
      clear: () => without('text'),
    });
  for (const a of f.authors ?? [])
    chips.push({
      key: `a:${a}`,
      label: t('comments.chip.author', { name: a || t('annotate.noAuthor') }),
      clear: () =>
        without(
          'authors',
          (f.authors ?? []).filter((x) => x !== a),
        ),
    });
  for (const ty of f.types ?? [])
    chips.push({
      key: `t:${String(ty)}`,
      label: t('comments.chip.type', { name: t(annotationTypeKey({ type: ty } as never)) }),
      clear: () =>
        without(
          'types',
          (f.types ?? []).filter((x) => x !== ty),
        ),
    });
  for (const s of f.statuses ?? [])
    chips.push({
      key: `s:${s}`,
      label: t('comments.chip.status', { name: t(STATUS_KEYS[s]) }),
      clear: () =>
        without(
          'statuses',
          (f.statuses ?? []).filter((x) => x !== s),
        ),
    });
  if (f.pages)
    chips.push({
      key: 'pages',
      label: view.currentPageOnly
        ? t('comments.thisPage')
        : t('comments.chip.pages', {
            from: format.number(f.pages[0] + 1, 0),
            to: format.number(f.pages[1] + 1, 0),
          }),
      clear: () => without('pages'),
      page: true,
    });
  return (
    <div className="comments-chips" role="group" aria-label={t('comments.activeFilters')}>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          className="comments-chip"
          aria-label={t('comments.chip.remove', { filter: c.label })}
          onClick={() => {
            setView(docId, {
              filter: c.clear(),
              ...(c.page ? { currentPageOnly: false } : {}),
            });
          }}
        >
          <span className="comments-chip-label">{c.label}</span>
          <Dismiss12Regular aria-hidden />
        </button>
      ))}
      <button
        type="button"
        className="comments-chip comments-chip--clear"
        onClick={() => {
          setView(docId, { filter: {}, currentPageOnly: false });
        }}
      >
        {t('comments.clearFilters')}
      </button>
    </div>
  );
}
