import type { PdfBookmarkObject } from '@embedpdf/models';
import { ChevronDown16Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronRight16Regular } from '@fluentui/react-icons/svg/chevron-right';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { Button } from '../../ui/components';
import { followTarget } from '../view/links';
import { allBranchIds, treeKey, visibleRows, type OutlineRow } from './outline';
import { outlineOf } from './outlineCache';

type Loaded =
  | { docId: string; state: 'loading' }
  | { docId: string; state: 'failed' }
  | { docId: string; state: 'ready'; bookmarks: PdfBookmarkObject[] };

/**
 * Bookmarks pane (§5, M2-10): the outline as an ARIA tree. Arrows move,
 * Right/Left expand and collapse (or go to the child / parent), Home/End,
 * Enter or Space (or a click) jumps to the bookmark's destination.
 */
export function BookmarksPane() {
  const { t } = useTranslation();
  const documentId = useDocuments((s) => s.activeId);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [expanded, setExpanded] = useState<{ docId: string | null; ids: Set<string> }>({
    docId: null,
    ids: new Set(),
  });
  const [focusId, setFocusId] = useState('0');
  const tree = useRef<HTMLDivElement>(null);
  const focusAfterKey = useRef(false);

  useEffect(() => {
    if (!documentId) return;
    let live = true;
    outlineOf(documentId).then(
      (bookmarks) => {
        if (live) setLoaded({ docId: documentId, state: 'ready', bookmarks });
      },
      () => {
        if (live) setLoaded({ docId: documentId, state: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [documentId]);

  const current = loaded?.docId === documentId ? loaded : null;
  const bookmarks = current?.state === 'ready' ? current.bookmarks : null;
  const ids = expanded.docId === documentId ? expanded.ids : null;
  const rows = useMemo(
    () => (bookmarks ? visibleRows(bookmarks, ids ?? new Set()) : []),
    [bookmarks, ids],
  );
  const focused = rows.some((r) => r.id === focusId) ? focusId : (rows[0]?.id ?? '0');

  useEffect(() => {
    if (!focusAfterKey.current) return;
    focusAfterKey.current = false;
    tree.current?.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
  }, [focused, rows]);

  if (!documentId) return <p className="pane-empty">{t('bookmarks.noDocument')}</p>;
  if (!current) return <p className="pane-empty">{t('bookmarks.loading')}</p>;
  if (current.state === 'failed') return <p className="pane-empty">{t('bookmarks.failed')}</p>;
  if (!bookmarks?.length) return <p className="pane-empty">{t('bookmarks.empty')}</p>;

  const setIds = (next: Set<string>): void => {
    setExpanded({ docId: documentId, ids: next });
  };
  const toggle = (id: string, open: boolean): void => {
    const next = new Set(ids ?? []);
    if (open) next.add(id);
    else next.delete(id);
    setIds(next);
  };
  const activate = (row: OutlineRow | undefined): void => {
    if (row) followTarget(row.target);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const r = treeKey(rows, focused, e.key);
    if (!r) return;
    e.preventDefault();
    focusAfterKey.current = true;
    if ('focus' in r) setFocusId(r.focus);
    else if ('expand' in r) toggle(r.expand, true);
    else if ('collapse' in r) toggle(r.collapse, false);
    else activate(rows.find((x) => x.id === r.activate));
  };

  return (
    <div className="bookmarks-pane">
      <div className="bookmarks-toolbar">
        <Button
          label={t('bookmarks.expandAll')}
          size="small"
          variant="subtle"
          onClick={() => {
            setIds(new Set(allBranchIds(bookmarks)));
          }}
        />
        <Button
          label={t('bookmarks.collapseAll')}
          size="small"
          variant="subtle"
          onClick={() => {
            setIds(new Set());
          }}
        />
      </div>
      <div
        ref={tree}
        className="bookmark-tree"
        role="tree"
        tabIndex={-1}
        aria-label={t('bookmarks.tree')}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
          const id = el?.dataset['id'];
          if (!id) return;
          setFocusId(id);
          const row = rows.find((x) => x.id === id);
          if ((e.target as HTMLElement).closest('[data-twisty]') && row?.hasChildren)
            toggle(id, !row.expanded);
          else activate(row);
        }}
      >
        {rows.map((row) => (
          <div
            key={row.id}
            role="treeitem"
            data-id={row.id}
            aria-level={row.level}
            aria-posinset={row.posInSet}
            aria-setsize={row.setSize}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-selected={row.id === focused}
            tabIndex={row.id === focused ? 0 : -1}
            data-pane-focus={row.id === focused || undefined}
            className={row.id === focused ? 'bookmark bookmark--focused' : 'bookmark'}
            style={{ paddingInlineStart: `calc(var(--space-4) * ${String(row.level - 1)})` }}
            onFocus={() => {
              setFocusId(row.id);
            }}
          >
            <span className="bookmark-twisty" data-twisty aria-hidden="true">
              {row.hasChildren ? (
                row.expanded ? (
                  <ChevronDown16Regular />
                ) : (
                  <ChevronRight16Regular />
                )
              ) : null}
            </span>
            <span className="bookmark-title">{row.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
