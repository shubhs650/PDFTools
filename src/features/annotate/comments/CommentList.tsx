// The Comments pane's list (M6-05, B1 B2 B3b): cards under collapsible group
// headers, measured and virtualized (10,000 comments, rule 1); a listbox with
// one tab stop whose selection is the page's selection, both ways; the
// comment right-click menu (M6-02's, same commands); the inline editor.
import type { PdfAnnotationObject } from '@embedpdf/models';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { commandState, runCommand } from '../../../app/commands/dispatch';
import { msg } from '../../../i18n';
import { ContextMenu } from '../../../ui/components';
import { commentMenu } from '../../view/documentMenus';
import { annotationCapability, annotationState } from '../selection';
import { ACTION } from './cardLabels';
import { CommentEditor } from './CommentEditor';
import { CommentRowView } from './CommentCard';
import type { Comment, CommentLayout, CommentRow } from './commentsModel';
import {
  commentsStore,
  setEditing,
  setView,
  useComments,
  viewOf,
  type CommentEdit,
} from './commentsStore';
import type { Thread } from './thread';
import { addReply, deleteComments, editText, isMine, reselect } from './threadActions';
import { offsetsOf, pageFrom, scrollToShow, visibleRange } from './virtualRows';

const OVERSCAN = 4;
/** Estimated heights (CSS px) until a row is drawn and measured. */
const ESTIMATE = { group: 30, comment: 78, reply: 50, editor: 112 } as const;
/** A keyboard open can be followed by the browser's own `contextmenu`: ignored this long. */
const KEYBOARD_ECHO_MS = 500;

type DisplayRow = CommentRow | { kind: 'editor'; key: string };

export interface CommentListProps {
  docId: string;
  layout: CommentLayout;
  threadOf: (id: string) => Thread;
  /** The roots of the selected comments (a selected reply stands for its comment). */
  selectedRoots: ReadonlySet<string>;
  canEdit: boolean;
  /** Selects a comment on its page and scrolls there (a card click, Enter, Previous / Next). */
  onOpen: (c: PdfAnnotationObject) => void;
}

export function CommentList({
  docId,
  layout,
  threadOf,
  selectedRoots,
  canEdit,
  onOpen,
}: CommentListProps) {
  const { t } = useTranslation();
  const listId = useId();
  const hintId = useId();
  const list = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const echoUntil = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [editorHeight, setEditorHeight] = useState<number>(ESTIMATE.editor);
  const editing = useComments((s) => (s.editing?.docId === docId ? s.editing : null));

  // ------------------------------------------------------------ rows (+ the editor's gap)
  const display = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = layout.rows;
    if (!editing) return rows;
    const at = editorSlot(layout.rows, editing);
    if (at < 0) return rows;
    return [...rows.slice(0, at + 1), { kind: 'editor', key: 'editor' }, ...rows.slice(at + 1)];
  }, [layout.rows, editing]);
  const indexOf = useMemo(() => new Map(display.map((r, i) => [r.key, i])), [display]);
  const editorAt = indexOf.get('editor') ?? -1;
  const editTarget = editing?.kind === 'text' ? editing.target : null;

  // An edit whose card is gone (deleted, filtered out) closes; one in a collapsed group opens it.
  useEffect(() => {
    if (!editing || editorAt >= 0) return;
    const group = layout.groupOf.get(editing.root);
    if (group && layout.order.some((c) => c.id === editing.root)) {
      const v = viewOf(commentsStore.getState(), docId);
      setView(docId, { collapsed: v.collapsed.filter((k) => k !== group) });
    } else setEditing(null);
  }, [editing, editorAt, layout, docId]);

  // ------------------------------------------------------------ measured heights
  // Rows are measured once drawn (a ResizeObserver per list); rows never drawn
  // keep their estimate. The callback owns `measuredRef`; renders read `heights`.
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const tops = useMemo(
    () =>
      offsetsOf(
        display.map((r) =>
          r.kind === 'editor' ? editorHeight : (heights.get(r.key) ?? ESTIMATE[r.kind]),
        ),
      ),
    [display, heights, editorHeight],
  );
  const topsRef = useRef(tops);
  const indexRef = useRef(indexOf);
  useLayoutEffect(() => {
    topsRef.current = tops;
    indexRef.current = indexOf;
  }, [tops, indexOf]);

  const observer = useRef<ResizeObserver | null>(null);
  const measuredRef = useRef(new Map<string, number>());
  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    [],
  );
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    observer.current ??= new ResizeObserver((entries) => {
      const view = list.current;
      const known = measuredRef.current;
      let changed = false;
      let shift = 0;
      const firstShown = view ? firstIndexAt(topsRef.current, view.scrollTop) : 0;
      for (const e of entries) {
        const target = e.target as HTMLElement;
        const key = target.dataset['key'];
        if (!key || !target.isConnected) continue;
        const h = e.borderBoxSize[0]?.blockSize ?? target.offsetHeight;
        const before = known.get(key);
        if (before !== undefined && Math.abs(before - h) < 0.5) continue;
        const kind = rowKind(target);
        const old = before ?? (kind ? ESTIMATE[kind] : h);
        known.set(key, h);
        changed = true;
        // Rows above the view grew or shrank: keep what is in view where it is.
        const i = indexRef.current.get(key);
        if (i !== undefined && i < firstShown) shift += h - old;
      }
      if (!changed) return;
      if (view && shift !== 0) view.scrollTop += shift;
      setHeights(new Map(known));
    });
    const ro = observer.current;
    ro.observe(el);
    return () => {
      ro.unobserve(el);
    };
  }, []);

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

  // ------------------------------------------------------------ active row, following the page
  const activeIndex = activeKey !== null ? (indexOf.get(activeKey) ?? -1) : -1;
  const current = activeIndex >= 0 ? activeIndex : 0;
  const currentRef = useRef(current);
  useLayoutEffect(() => {
    currentRef.current = current;
  }, [current]);

  const scrollTo = useCallback((i: number): void => {
    const el = list.current;
    if (!el) return;
    const next = scrollToShow(topsRef.current, i, el.scrollTop, el.clientHeight);
    if (next !== el.scrollTop) el.scrollTop = next;
    setScrollTop(el.scrollTop);
  }, []);

  // The comment selected on the page is the active card, scrolled to (B2).
  const firstSelected = [...selectedRoots][0] ?? null;
  const [followed, setFollowed] = useState<string | null>(null);
  if (firstSelected !== followed) {
    setFollowed(firstSelected);
    if (firstSelected && !(activeKey && selectedRoots.has(keyRoot(display, indexOf, activeKey))))
      setActiveKey(`c:${firstSelected}`);
  }
  useEffect(() => {
    if (!firstSelected) return;
    const i = indexRef.current.get(`c:${firstSelected}`);
    if (i !== undefined) scrollTo(i);
  }, [firstSelected, scrollTo]);

  const moveTo = (i: number): number => {
    const to = Math.max(0, Math.min(display.length - 1, i));
    const row = display[to];
    if (row?.kind === 'editor') return moveTo(to + (to > currentRef.current ? 1 : -1));
    currentRef.current = to;
    setActiveKey(row?.key ?? null);
    scrollTo(to);
    return to;
  };

  // ------------------------------------------------------------ selection
  const scope = () => annotationCapability()?.forDocument(docId) ?? null;
  const rootAt = (i: number): Comment | null => {
    const row = display[i];
    if (row?.kind === 'comment') return row.comment;
    if (row?.kind === 'reply') return row.root;
    return null;
  };
  const liveSelection = (): Set<string> => {
    const st = annotationState(docId);
    if (!st) return new Set();
    return new Set(
      st.selectedUids.map((uid) => st.byUid[uid]?.object.id).filter((x): x is string => !!x),
    );
  };
  const toggle = (i: number): void => {
    const c = rootAt(i);
    if (!c) return;
    const now = liveSelection();
    const ids = [...now];
    scope()?.setSelection(now.has(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]);
  };
  const extend = (from: number, to: number): void => {
    const ids = liveSelection();
    for (let k = Math.min(from, to); k <= Math.max(from, to); k++) {
      const row = display[k];
      if (row?.kind === 'comment') ids.add(row.comment.id);
    }
    scope()?.setSelection([...ids]);
  };
  const ensureSelected = (c: Comment): void => {
    if (!liveSelection().has(c.id)) scope()?.selectAnnotation(c.page, c.id);
  };
  const toggleGroup = (row: Extract<CommentRow, { kind: 'group' }>, open?: boolean): void => {
    const key = row.key.slice(2);
    const v = viewOf(commentsStore.getState(), docId);
    const collapse = open === undefined ? !row.collapsed : !open;
    if (collapse === row.collapsed) return;
    setView(docId, {
      collapsed: collapse ? [...v.collapsed, key] : v.collapsed.filter((k) => k !== key),
    });
  };
  const activate = (i: number): void => {
    const row = display[i];
    if (!row || row.kind === 'editor') return;
    if (row.kind === 'group') toggleGroup(row);
    else onOpen((row.kind === 'comment' ? row.comment : row.root).annot);
  };

  // ------------------------------------------------------------ editing
  // The plugin's delete clears the selection: the card stays selected (as M3-12's thread did).
  const deleteReply = (reply: PdfAnnotationObject, root: Comment): void => {
    deleteComments(docId, [reply]);
    reselect(docId, root.annot);
  };
  const startEdit = (i: number): void => {
    const row = display[i];
    if (!canEdit || !row) return;
    if (row.kind === 'comment' && !row.comment.locked)
      setEditing({ docId, kind: 'text', root: row.comment.id, target: row.comment.id });
    else if (row.kind === 'reply' && isMine(row.reply))
      setEditing({ docId, kind: 'text', root: row.root.id, target: row.reply.id });
  };
  const startReplyAt = (i: number): void => {
    const c = rootAt(i);
    if (!canEdit || !c) return;
    ensureSelected(c);
    setEditing({ docId, kind: 'reply', root: c.id });
  };
  const closeEditor = (): void => {
    setEditing(null);
    list.current?.focus({ preventScroll: true });
  };
  const editorTarget = useMemo((): { root: Comment; target: PdfAnnotationObject } | null => {
    if (!editing) return null;
    const root = layout.order.find((c) => c.id === editing.root);
    if (!root) return null;
    if (editing.kind === 'reply' || editing.target === root.id) return { root, target: root.annot };
    const reply = threadOf(root.id).replies.find((r) => r.annot.id === editing.target)?.annot;
    return reply ? { root, target: reply } : null;
  }, [editing, layout.order, threadOf]);

  // ------------------------------------------------------------ keys
  const openMenuAt = (i: number): void => {
    const el = list.current?.querySelector<HTMLElement>(`[data-row="${String(i)}"]`);
    if (el) echoUntil.current = openMenuOn(el);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey;
    const row = display[current];
    // Copy, cut and paste comments (M4-21, M6-02): the pane is outside the document's keys.
    const clip: Record<string, string> = {
      c: 'comment.copyComments',
      x: 'edit.cut',
      v: e.shiftKey ? 'comment.pasteToOriginal' : 'comment.pasteComments',
    };
    const command = mod && !e.altKey ? clip[e.key.toLowerCase()] : undefined;
    if (command) {
      e.preventDefault();
      void runCommand(command);
      return;
    }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const c = rootAt(current);
      if (!c) return;
      ensureSelected(c);
      openMenuAt(current);
      return;
    }
    if (mod && e.key === ' ') {
      e.preventDefault();
      toggle(current);
      return;
    }
    if (e.key === 'F2' && !mod) {
      e.preventDefault();
      startEdit(current);
      return;
    }
    // Delete: the selected comments (the list's selection is the page's,
    // USR01); on one of your replies, that reply.
    if (e.key === 'Delete' && !mod && !e.altKey) {
      if (row?.kind === 'reply' && isMine(row.reply) && canEdit) {
        e.preventDefault();
        deleteReply(row.reply, row.root);
        return;
      }
      if (!commandState('comment.delete').enabled) return;
      e.preventDefault();
      void runCommand('comment.delete');
      return;
    }
    if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const from = currentRef.current;
      extend(from, moveTo(from + (e.key === 'ArrowDown' ? 1 : -1)));
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        moveTo(current + 1);
      },
      ArrowUp: () => {
        moveTo(current - 1);
      },
      ArrowRight: () => {
        if (row?.kind === 'group') toggleGroup(row, true);
      },
      ArrowLeft: () => {
        if (row?.kind === 'group') toggleGroup(row, false);
      },
      PageDown: () => {
        moveTo(pageFrom(tops, current, viewHeight, 1));
      },
      PageUp: () => {
        moveTo(pageFrom(tops, current, viewHeight, -1));
      },
      Home: () => {
        moveTo(0);
      },
      End: () => {
        moveTo(display.length - 1);
      },
      Enter: () => {
        activate(current);
      },
      ' ': () => {
        if (row?.kind === 'group') toggleGroup(row);
        else activate(current);
      },
    };
    const action = keys[e.key];
    if (!action || mod || e.altKey) return;
    e.preventDefault();
    action();
  };

  // ------------------------------------------------------------ pointer
  const rowOf = (e: MouseEvent): number | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
    return el ? Number(el.dataset['row']) : null;
  };
  const ensureSelectedAt = (i: number): void => {
    const c = rootAt(i);
    if (c) ensureSelected(c);
  };
  const onClick = (e: MouseEvent): void => {
    const i = rowOf(e);
    if (i === null) return;
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset[
      'action'
    ];
    const row = display[i];
    setActiveKey(row?.key ?? null);
    currentRef.current = i;
    if (action === ACTION.reply) {
      startReplyAt(i);
      return;
    }
    if (action === ACTION.edit) {
      ensureSelectedAt(i);
      startEdit(i);
      return;
    }
    if (action === ACTION.deleteReply && row?.kind === 'reply' && canEdit && isMine(row.reply)) {
      deleteReply(row.reply, row.root);
      return;
    }
    if (e.ctrlKey || e.metaKey) toggle(i);
    else if (e.shiftKey) extend(current, i);
    else activate(i);
  };
  const onDoubleClick = (e: MouseEvent): void => {
    const i = rowOf(e);
    if (i === null || display[i]?.kind === 'group') return;
    e.preventDefault();
    startEdit(i);
  };
  const onContextMenuCapture = (e: MouseEvent): void => {
    if (e.nativeEvent.isTrusted && e.timeStamp < echoUntil.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const i = rowOf(e);
    const c = i === null ? null : rootAt(i);
    if (i === null || !c) {
      // Headers and the empty area have no menu (nor the browser's).
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setActiveKey(display[i]?.key ?? null);
    ensureSelected(c);
  };
  const onCloseAutoFocus = (e: Event): void => {
    e.preventDefault();
    const a = document.activeElement;
    if (!a || a === document.body) list.current?.focus({ preventScroll: true });
  };

  // ------------------------------------------------------------ draw
  const [first, last] = visibleRange(tops, scrollTop, viewHeight, OVERSCAN);
  const drawn = new Set<number>();
  for (let i = first; i <= last; i++) drawn.add(i);
  if (current < display.length) drawn.add(current); // aria-activedescendant must exist
  const items = [];
  for (const i of [...drawn].sort((a, b) => a - b)) {
    const row = display[i];
    if (!row) continue;
    const top = tops[i] ?? 0;
    if (row.kind === 'editor') {
      items.push(
        <div
          key={row.key}
          className="comment-editor-gap"
          aria-hidden="true"
          style={{ top, height: editorHeight }}
        />,
      );
      continue;
    }
    const root = row.kind === 'comment' ? row.comment : row.kind === 'reply' ? row.root : null;
    items.push(
      <CommentRowView
        key={row.key}
        row={row}
        id={`${listId}-${row.key}`}
        index={i}
        top={top}
        active={i === current}
        selected={!!root && selectedRoots.has(root.id)}
        editing={
          editTarget !== null &&
          ((row.kind === 'comment' && row.comment.id === editTarget) ||
            (row.kind === 'reply' && row.reply.id === editTarget))
        }
        states={row.kind === 'comment' ? threadOf(row.comment.id).states : []}
        mine={row.kind === 'reply' && isMine(row.reply)}
        canEdit={canEdit}
        measureRef={measureRef}
      />,
    );
  }

  useLayoutEffect(() => {
    if (layer.current) layer.current.style.transform = `translateY(${String(-scrollTop)}px)`;
  }, [scrollTop]);

  const activeRow = display[current];
  return (
    <div className="comments-list-wrap">
      <ContextMenu
        label={t(msg('contextMenu.comment'))}
        entries={commentMenu(docId)}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div
          ref={list}
          className="comments-list"
          role="listbox"
          tabIndex={0}
          aria-label={t('comments.list')}
          aria-multiselectable
          aria-describedby={hintId}
          {...(activeRow && activeRow.kind !== 'editor'
            ? { 'aria-activedescendant': `${listId}-${activeRow.key}` }
            : {})}
          data-testid="comments-list"
          onScroll={(e) => {
            const top = e.currentTarget.scrollTop;
            if (layer.current) layer.current.style.transform = `translateY(${String(-top)}px)`;
            setScrollTop(top);
          }}
          onKeyDown={onKeyDown}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onContextMenuCapture={onContextMenuCapture}
        >
          <div className="comments-list-content" style={{ height: tops[display.length] ?? 0 }}>
            {items}
          </div>
        </div>
      </ContextMenu>
      <span id={hintId} hidden>
        {t('comments.listHint')}
      </span>
      {editing && editorTarget && editorAt >= 0 ? (
        <div className="comment-editor-layer">
          <div ref={layer} className="comment-editor-layer-inner">
            <EditorAt
              top={tops[editorAt] ?? 0}
              onHeight={setEditorHeight}
              onWheel={(dy) => {
                if (list.current) list.current.scrollTop += dy;
              }}
            >
              <CommentEditor
                key={editKey(editing)}
                kind={editing.kind}
                initial={editing.kind === 'text' ? (editorTarget.target.contents ?? '') : ''}
                onDelete={
                  editing.kind === 'text' && editorTarget.target.id !== editorTarget.root.id
                    ? () => {
                        deleteReply(editorTarget.target, editorTarget.root);
                        closeEditor();
                      }
                    : undefined
                }
                onCancel={closeEditor}
                onSubmit={(text) => {
                  if (editing.kind === 'reply') void addReply(docId, editorTarget.root.annot, text);
                  else editText(docId, editorTarget.target, text);
                  closeEditor();
                }}
              />
            </EditorAt>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The editor, placed over its gap; reports its height so the gap fits it. */
function EditorAt({
  top,
  onHeight,
  onWheel,
  children,
}: {
  top: number;
  onHeight: (h: number) => void;
  onWheel: (dy: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      onHeight(el.offsetHeight);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [onHeight]);
  return (
    <div
      ref={ref}
      className="comment-editor-place"
      style={{ top }}
      onWheel={(e) => {
        onWheel(e.deltaY);
      }}
    >
      {children}
    </div>
  );
}

const editKey = (e: CommentEdit): string =>
  e.kind === 'reply' ? `reply:${e.root}` : `text:${e.target}`;

/** The row the editor's gap follows: the edited row, or the card's last row for a reply. */
function editorSlot(rows: readonly CommentRow[], e: CommentEdit): number {
  if (e.kind === 'text') {
    return rows.findIndex(
      (r) =>
        (r.kind === 'comment' && r.comment.id === e.target) ||
        (r.kind === 'reply' && r.reply.id === e.target),
    );
  }
  let i = rows.findIndex((r) => r.kind === 'comment' && r.comment.id === e.root);
  if (i < 0) return -1;
  while (rows[i + 1]?.kind === 'reply') i++;
  return i;
}

function keyRoot(
  rows: readonly DisplayRow[],
  index: ReadonlyMap<string, number>,
  key: string,
): string {
  const row = rows[index.get(key) ?? -1];
  if (row?.kind === 'comment') return row.comment.id;
  if (row?.kind === 'reply') return row.root.id;
  return '';
}

/** Opens the row's menu from the keyboard; returns until when the browser's echo is ignored. */
function openMenuOn(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new window.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: r.left + Math.min(r.width / 2, 48),
      clientY: r.top + Math.min(r.height / 2, 24),
      button: 2,
    }),
  );
  return performance.now() + KEYBOARD_ECHO_MS;
}

function rowKind(el: HTMLElement): 'group' | 'comment' | 'reply' | null {
  if (el.classList.contains('comment-group')) return 'group';
  if (el.classList.contains('comment-reply')) return 'reply';
  if (el.classList.contains('comment-card')) return 'comment';
  return null;
}

/** The first row at or below `y` (rows above it are out of view). */
function firstIndexAt(tops: Float64Array, y: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((tops[mid + 1] ?? 0) <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
