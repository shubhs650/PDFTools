import { ArrowCollapseAll20Regular } from '@fluentui/react-icons/svg/arrow-collapse-all';
import { ArrowExpandAll20Regular } from '@fluentui/react-icons/svg/arrow-expand-all';
import { BookmarkAdd20Regular } from '@fluentui/react-icons/svg/bookmark-add';
import { ChevronDown16Regular } from '@fluentui/react-icons/svg/chevron-down';
import { ChevronRight16Regular } from '@fluentui/react-icons/svg/chevron-right';
import { Delete20Regular } from '@fluentui/react-icons/svg/delete';
import { Options20Regular } from '@fluentui/react-icons/svg/options';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useDocuments } from '../../app/store/documentStore';
import { useRovingToolbar } from '../../app/ribbon/useRovingToolbar';
import { msg } from '../../i18n';
import { itemAt, keyPath, type OutlineItem } from '../../model/outline';
import { CommandDropdown, ContextMenu, type ContextMenuEntry } from '../../ui/components';
import { CommandToolButton, ToolButton } from '../annotate/comments/CommentsToolbar';
import { usePages } from '../pages/pageOps';
import { followTarget } from '../view/links';
import {
  clearError,
  editBlocked,
  endRename,
  loadOutline,
  runEdit,
  setExpanded,
  setFocus,
  useBookmarks,
} from './bookmarks';
import { treeKey, visibleRows, type OutlineRow } from './outline';
import { dropEdit, moveTarget } from './outlineEdit';

/** A keyboard open can be followed by the browser's own `contextmenu`: ignored this long. */
const KEYBOARD_ECHO_MS = 500;
const DRAG_TYPE = 'application/x-pdftools-bookmark';
const NEW = 'bookmark.new';
const DELETE = 'bookmark.delete';
const EXPAND_ALL = 'bookmark.expandAll';
const COLLAPSE_ALL = 'bookmark.collapseAll';

const sep = (key: string): ContextMenuEntry => ({ kind: 'separator', key });
const cmd = (id: string): ContextMenuEntry => ({ kind: 'command', id });

/** The tree's context menu (M6-11, B3c). */
const MENU: readonly ContextMenuEntry[] = [
  cmd('bookmark.goTo'),
  sep('new'),
  cmd('bookmark.new'),
  cmd('bookmark.newChild'),
  sep('clipboard'),
  cmd('bookmark.cut'),
  cmd('bookmark.copy'),
  cmd('bookmark.paste'),
  sep('delete'),
  cmd('bookmark.delete'),
  cmd('bookmark.deleteKeepChildren'),
  cmd('bookmark.deleteChildren'),
  sep('expand'),
  cmd('bookmark.expandAll'),
  cmd('bookmark.collapseAll'),
  sep('edit'),
  cmd('bookmark.rename'),
  cmd('bookmark.setDestination'),
  sep('properties'),
  cmd('bookmark.properties'),
];

/** The toolbar's Options menu: the rest of the edits, with their keys. */
const OPTIONS: readonly ContextMenuEntry[] = [
  cmd('bookmark.newChild'),
  sep('clipboard'),
  cmd('bookmark.cut'),
  cmd('bookmark.copy'),
  cmd('bookmark.paste'),
  sep('delete'),
  cmd('bookmark.deleteKeepChildren'),
  cmd('bookmark.deleteChildren'),
  sep('move'),
  cmd('bookmark.moveUp'),
  cmd('bookmark.moveDown'),
  cmd('bookmark.promote'),
  cmd('bookmark.demote'),
  sep('edit'),
  cmd('bookmark.rename'),
  cmd('bookmark.setDestination'),
  cmd('bookmark.properties'),
];

type Where = 'before' | 'after' | 'inside';

/** Where on a row a drop lands: its top quarter before it, its bottom quarter after, else inside. */
const whereOn = (el: HTMLElement, clientY: number): Where => {
  const r = el.getBoundingClientRect();
  const f = (clientY - r.top) / Math.max(1, r.height);
  return f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'inside';
};

const rgbCss = (c: [number, number, number]): string =>
  `rgb(${c.map((v) => String(Math.round(v * 255))).join(' ')})`;

/**
 * Bookmarks pane (§5, M2-10; editing M6-11, §7.15): the outline as an ARIA
 * tree. Arrows move, Right/Left expand and collapse (or go to the child /
 * parent), Home/End, Enter or Space (or a click) jumps to the bookmark's
 * destination. Editing: the toolbar (New, Delete, Expand All, Collapse All,
 * Options), the context menu (right click, Shift+F10, the Menu key), the
 * tree's own keys (Insert, Delete, F2, Ctrl+X/C/V, Alt+Enter, Alt+Shift+
 * arrows to move) and drag and drop; every edit is one undo step.
 */
export function BookmarksPane() {
  const { t } = useTranslation();
  const documentId = useDocuments((s) => s.activeId);
  const version = usePages((s) => (documentId ? (s.version[documentId] ?? 0) : 0));
  const loaded = useBookmarks((s) => (documentId ? s.outlines[documentId] : undefined));
  const editing = useBookmarks((s) => s.editing);
  const ids = useBookmarks((s) => (documentId ? s.expanded[documentId] : undefined));
  const focusKey = useBookmarks((s) => (documentId ? s.focus[documentId] : undefined));
  const renaming = useBookmarks((s) => (s.renaming?.docId === documentId ? s.renaming.key : null));
  const focusTick = useBookmarks((s) => s.focusTick);
  const error = useBookmarks((s) => s.error);
  const tree = useRef<HTMLDivElement>(null);
  const focusAfterKey = useRef(false);
  const echoUntil = useRef(0);
  const hintId = useId();
  /** The loading text had focus (the pane was opened from the rail): the tree takes it. */
  const wantFocus = useRef(false);
  const [drag, setDrag] = useState<{ from: string; over: string | null; where: Where } | null>(
    null,
  );

  useEffect(() => {
    if (documentId) loadOutline(documentId);
  }, [documentId, version, editing]);

  const bookmarks = loaded?.state === 'ready' ? loaded.items : null;
  const rows = useMemo(
    () => (bookmarks ? visibleRows(bookmarks, ids ?? new Set()) : []),
    [bookmarks, ids],
  );
  const focused =
    focusKey !== undefined && rows.some((r) => r.id === focusKey) ? focusKey : (rows[0]?.id ?? '0');

  // After a key, an edit or a rename, focus follows the focused row.
  useEffect(() => {
    if (!focusAfterKey.current) return;
    focusAfterKey.current = false;
    tree.current?.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
  }, [focused, rows]);
  const seenTick = useRef(focusTick);
  useEffect(() => {
    if (seenTick.current === focusTick) return;
    seenTick.current = focusTick;
    // The rename field takes focus itself.
    if (renaming !== null) return;
    // Only when the tree had focus (or nothing has): never steal it from the page.
    const a = document.activeElement;
    const inPane =
      !a || a === document.body || tree.current?.closest('.bookmarks-pane')?.contains(a);
    if (inPane) tree.current?.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
  }, [focusTick, focused, renaming]);
  useEffect(() => {
    if (!bookmarks || !wantFocus.current) return;
    wantFocus.current = false;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    const pane = tree.current?.closest('.bookmarks-pane') ?? null;
    (
      tree.current?.querySelector<HTMLElement>('[tabindex="0"]') ??
      pane?.querySelector<HTMLElement>('.bookmarks-pane [role="toolbar"] [tabindex="0"]')
    )?.focus();
  }, [bookmarks]);
  // The row the commands act on is the one shown focused.
  useEffect(() => {
    if (documentId && bookmarks && rows.length && focusKey !== focused)
      setFocus(documentId, focused);
  }, [documentId, bookmarks, rows.length, focusKey, focused]);

  if (!documentId) return <p className="pane-empty">{t('bookmarks.noDocument')}</p>;
  if (!loaded || loaded.state === 'loading')
    return (
      <div className="bookmarks-pane">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- where the rail puts focus until the tree is read */}
        <p
          className="pane-empty"
          tabIndex={-1}
          data-pane-focus
          onFocus={() => {
            wantFocus.current = true;
          }}
        >
          {t('bookmarks.loading')}
        </p>
      </div>
    );
  if (loaded.state === 'failed') return <p className="pane-empty">{t('bookmarks.failed')}</p>;
  const items = loaded.items;

  const toggle = (id: string, open: boolean): void => {
    const next = new Set(ids ?? []);
    if (open) next.add(id);
    else next.delete(id);
    setExpanded(documentId, next);
  };
  const activate = (row: OutlineRow | undefined): void => {
    if (row) followTarget(row.target);
  };
  const openMenuAt = (id: string): void => {
    const el = tree.current?.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + Math.min(r.width / 2, 48),
        clientY: r.top + Math.min(r.height / 2, 12),
        button: 2,
      }),
    );
    echoUntil.current = performance.now() + KEYBOARD_ECHO_MS;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return; // the rename field's own keys
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      if (rows.length) openMenuAt(focused);
      return;
    }
    // Alt+Shift+arrows move the bookmark (the keymap's bookmark scope).
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const r = treeKey(rows, focused, e.key);
    if (!r) return;
    e.preventDefault();
    focusAfterKey.current = true;
    if ('focus' in r) setFocus(documentId, r.focus);
    else if ('expand' in r) toggle(r.expand, true);
    else if ('collapse' in r) toggle(r.collapse, false);
    else activate(rows.find((x) => x.id === r.activate));
  };

  const rowOf = (target: EventTarget): HTMLElement | null =>
    target instanceof HTMLElement ? target.closest<HTMLElement>('[data-id]') : null;

  const canEdit = editBlocked(documentId) === null;
  const onDragStart = (e: DragEvent): void => {
    const el = rowOf(e.target);
    const id = el?.dataset['id'];
    if (!id || !canEdit || renaming !== null) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DRAG_TYPE, id);
    e.dataTransfer.effectAllowed = 'move';
    setFocus(documentId, id);
    setDrag({ from: id, over: null, where: 'inside' });
  };
  const dropOf = (e: DragEvent) => {
    const el = rowOf(e.target);
    const over = el?.dataset['id'];
    if (!drag || !el || over === undefined) return null;
    const where = whereOn(el, e.clientY);
    const edit = dropEdit(items, keyPath(drag.from), keyPath(over), where);
    return { over, where, edit };
  };
  const onDragOver = (e: DragEvent): void => {
    const d = dropOf(e);
    if (!d?.edit) {
      if (drag?.over !== null && drag) setDrag({ ...drag, over: null });
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (drag && (drag.over !== d.over || drag.where !== d.where))
      setDrag({ ...drag, over: d.over, where: d.where });
  };
  const onDrop = (e: DragEvent): void => {
    const d = dropOf(e);
    setDrag(null);
    if (d?.edit?.kind !== 'move') return;
    e.preventDefault();
    const to = moveTarget(d.edit);
    void runEdit(documentId, d.edit, msg('bookmarks.editing'), {
      focus: [...to.parent, to.index],
      expand: to.parent.length ? [to.parent] : [],
    });
  };

  return (
    <div className="bookmarks-pane">
      <Toolbar />
      {error ? (
        <div className="bookmarks-error" role="alert">
          <span>{t(error)}</span>
          <button
            type="button"
            className="ui-button ui-button--subtle ui-button--small"
            onClick={clearError}
          >
            {t('ui.dialog.close')}
          </button>
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="pane-empty">{t('bookmarks.empty')}</p>
      ) : (
        <ContextMenu
          label={t('bookmarks.menu')}
          entries={MENU}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            tree.current?.querySelector<HTMLElement>(`[data-id="${focused}"]`)?.focus();
          }}
        >
          <div
            ref={tree}
            className="bookmark-tree"
            role="tree"
            tabIndex={-1}
            data-key-scope="bookmarks"
            aria-label={t('bookmarks.tree')}
            aria-describedby={hintId}
            onKeyDown={onKeyDown}
            onContextMenuCapture={(e: MouseEvent) => {
              if (e.nativeEvent.isTrusted && e.timeStamp < echoUntil.current) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              const id = rowOf(e.target)?.dataset['id'];
              if (id) setFocus(documentId, id);
            }}
            onClick={(e) => {
              const el = rowOf(e.target);
              const id = el?.dataset['id'];
              if (!id || (e.target as HTMLElement).closest('input')) return;
              setFocus(documentId, id);
              const row = rows.find((x) => x.id === id);
              if ((e.target as HTMLElement).closest('[data-twisty]') && row?.hasChildren)
                toggle(id, !row.expanded);
              else activate(row);
            }}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragLeave={(e) => {
              if (drag && !tree.current?.contains(e.relatedTarget as Node | null))
                setDrag({ ...drag, over: null });
            }}
            onDrop={onDrop}
            onDragEnd={() => {
              setDrag(null);
            }}
          >
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                item={itemAt(items, keyPath(row.id))}
                focused={row.id === focused}
                renaming={row.id === renaming}
                draggable={canEdit && renaming === null}
                drop={drag?.over === row.id ? drag.where : null}
                docId={documentId}
                onFocus={() => {
                  setFocus(documentId, row.id);
                }}
              />
            ))}
          </div>
        </ContextMenu>
      )}
      <p id={hintId} hidden>
        {t('bookmarks.dragHint')}
      </p>
    </div>
  );
}

function Row({
  row,
  item,
  focused,
  renaming,
  draggable,
  drop,
  docId,
  onFocus,
}: {
  row: OutlineRow;
  item: OutlineItem | null;
  focused: boolean;
  renaming: boolean;
  draggable: boolean;
  drop: Where | null;
  docId: string;
  onFocus: () => void;
}) {
  const style: CSSProperties = {
    paddingInlineStart: `calc(var(--space-4) * ${String(row.level - 1)})`,
  };
  const titleStyle: CSSProperties = {
    ...(item?.color ? { color: rgbCss(item.color) } : {}),
    ...(item?.bold ? { fontWeight: 600 } : {}),
    ...(item?.italic ? { fontStyle: 'italic' } : {}),
  };
  const cls = ['bookmark'];
  if (focused) cls.push('bookmark--focused');
  if (drop) cls.push(`bookmark--drop-${drop}`);
  return (
    <div
      role="treeitem"
      data-id={row.id}
      aria-level={row.level}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-selected={focused}
      tabIndex={focused ? 0 : -1}
      data-pane-focus={focused || undefined}
      className={cls.join(' ')}
      style={style}
      draggable={draggable}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocus();
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
      {renaming ? (
        <RenameField docId={docId} id={row.id} title={row.title} />
      ) : (
        <span className="bookmark-title" style={titleStyle}>
          {row.title}
        </span>
      )}
    </div>
  );
}

/** The title edited in place (F2, Rename, New Bookmark): Enter or leaving it keeps it, Esc not. */
function RenameField({ docId, id, title }: { docId: string; id: string; title: string }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const commit = (): void => {
    if (done.current) return;
    done.current = true;
    const value = input.current?.value.trim() ?? '';
    if (!value || value === title) {
      endRename();
      return;
    }
    void runEdit(
      docId,
      { kind: 'update', path: keyPath(id), props: { title: value } },
      msg('bookmarks.editing'),
      { focus: keyPath(id) },
    );
  };
  return (
    <input
      ref={input}
      className="bookmark-rename"
      aria-label={t('bookmarks.renameField')}
      defaultValue={title}
      maxLength={1000}
      // In the capture phase: before the pane's own Esc (back to the rail button).
      onKeyDownCapture={(e) => {
        // From the keyboard, focus goes back to the bookmark (the field goes away).
        const toRow = (): void => {
          input.current?.closest<HTMLElement>('[role="treeitem"]')?.focus();
        };
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          toRow();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done.current = true;
          toRow();
          endRename();
        }
      }}
      onKeyDown={(e) => {
        // The field's keys are its own (not the tree's arrows, not the shortcuts).
        e.stopPropagation();
      }}
      onBlur={commit}
      onClick={(e) => {
        e.stopPropagation();
      }}
    />
  );
}

/** New, Delete, Expand All, Collapse All and Options: one tab stop, arrows move (rule 12). */
function Toolbar() {
  const { t } = useTranslation();
  const roving = useRovingToolbar(5);
  const at = (i: number) => ({
    ref: roving.register(i),
    tabIndex: roving.index === i ? 0 : -1,
    onFocus: () => {
      roving.setCurrent(i);
    },
  });
  return (
    <div
      className="bookmarks-toolbar"
      role="toolbar"
      aria-label={t('bookmarks.toolbar')}
      onKeyDown={roving.onKeyDown}
    >
      <CommandToolButton {...at(0)} command={NEW} icon={<BookmarkAdd20Regular />} />
      <CommandToolButton {...at(1)} command={DELETE} icon={<Delete20Regular />} />
      <CommandToolButton {...at(2)} command={EXPAND_ALL} icon={<ArrowExpandAll20Regular />} />
      <CommandToolButton {...at(3)} command={COLLAPSE_ALL} icon={<ArrowCollapseAll20Regular />} />
      <CommandDropdown
        label={t('bookmarks.options')}
        entries={OPTIONS}
        trigger={
          <ToolButton {...at(4)} label={t('bookmarks.options')} icon={<Options20Regular />} />
        }
      />
    </div>
  );
}
