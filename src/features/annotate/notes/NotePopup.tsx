// A sticky note's pop-up window on the page (M7-06, ADR-023 D-44; review 4c,
// bug B12), in PDF-XChange's layout, drawn by us: a header ("Sticky Note",
// author, date, Close) that drags the window; the note's text, several lines
// (Enter = new line; Ctrl+Enter or a click outside saves; Esc saves and
// closes); its replies; a footer with a menu (Set Status ▸, Delete,
// Properties), the status, a Lock toggle and Reply; a grip that resizes it.
// The window follows the page and keeps its size and stays upright (the
// pop-up's /F NoZoom and NoRotate). Its text is the note's /Contents; replies
// are /IRT notes (they show in the Comments pane too).
import { ArrowReply16Regular } from '@fluentui/react-icons/svg/arrow-reply';
import { Dismiss16Regular } from '@fluentui/react-icons/svg/dismiss';
import { LockClosed16Regular } from '@fluentui/react-icons/svg/lock-closed';
import { LockOpen16Regular } from '@fluentui/react-icons/svg/lock-open';
import { MoreVertical16Regular } from '@fluentui/react-icons/svg/more-vertical';
import { Note16Regular } from '@fluentui/react-icons/svg/note';
import { PdfAnnotationState, type PdfAnnotationObject } from '@embedpdf/models';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { runCommand } from '../../../app/commands/dispatch';
import { format } from '../../../i18n';
import { Button, DropdownMenu, IconButton, type MenuEntry } from '../../../ui/components';
import { StatusIcon } from '../comments/CommentCard';
import { STATUS_KEYS } from '../comments/statusLabels';
import type { StateEntry, ThreadEntry } from '../comments/thread';
import { addReply, deleteComments, editText, setStatus } from '../comments/threadActions';
import { setFlag } from '../properties/flagActions';
import { annotationCapability } from '../selection';
import { closeNotePopup, placePopup, raisePopup, type OpenPopup } from './notePopupStore';
import {
  moved,
  popupFromView,
  popupToView,
  resized,
  type PageFrame,
  type ViewBox,
} from './popupGeometry';
import { noteInk, NOTE_DEFAULT_COLOR } from './noteInk';

/** The statuses Set Status offers (as the comment menu does). */
const STATUSES = [
  PdfAnnotationState.None,
  PdfAnnotationState.Accepted,
  PdfAnnotationState.Rejected,
  PdfAnnotationState.Cancelled,
  PdfAnnotationState.Completed,
] as const;

/** Keyboard moves and resizes: CSS px per arrow press (Shift: four times). */
const STEP = 8;

export interface NotePopupProps {
  docId: string;
  note: PdfAnnotationObject;
  popup: OpenPopup;
  frame: PageFrame;
  replies: readonly ThreadEntry[];
  /** The latest review status by anyone (the indicator). */
  status: StateEntry | null;
  /** The document allows comment changes (rule 9). */
  canEdit: boolean;
}

/** Locked (the Lock toggle, /F bit 8). */
const isLocked = (a: PdfAnnotationObject): boolean => (a.flags ?? []).includes('locked');
/** Its text can't change: locked, contents locked or read only. */
const isFrozen = (a: PdfAnnotationObject): boolean =>
  (a.flags ?? []).some((f) => f === 'locked' || f === 'lockedContents' || f === 'readOnly');

const authorOf = (a: PdfAnnotationObject): string | null => {
  const name = a.author?.trim();
  return name !== undefined && name.length > 0 ? name : null;
};

export function NotePopup({ docId, note, popup, frame, replies, status, canEdit }: NotePopupProps) {
  const { t } = useTranslation();
  const locked = isLocked(note);
  const editable = canEdit && !isFrozen(note);
  // Acrobat ends lines with CR; a text area shows (and gives back) LF, so a
  // note that was only read is not rewritten.
  const contents = (note.contents ?? '').replace(/\r\n?/g, '\n');

  // The text: a draft while focused, the note's /Contents otherwise.
  const [draft, setDraft] = useState(contents);
  const focused = useRef(false);
  const latest = useRef({ draft, contents, editable, note });
  useLayoutEffect(() => {
    latest.current = { draft, contents, editable, note };
  });
  useEffect(() => {
    if (!focused.current) setDraft(contents);
  }, [contents]);
  const commit = (): void => {
    const l = latest.current;
    if (l.editable && l.draft !== l.contents) editText(docId, l.note, l.draft);
  };
  // A window that goes (page scrolled away, closed, document switched) keeps the text.
  useLayoutEffect(
    () => () => {
      commit();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on unmount
    [],
  );

  // Where the window is: the stored rect, or the one being dragged.
  const [live, setLive] = useState<ViewBox | null>(null);
  const box = live ?? popupToView(popup.rect, frame);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    start: ViewBox;
    kind: 'move' | 'size';
  } | null>(null);

  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (popup.focus === 0) return;
    const put = (): void => {
      const el = text.current;
      if (!el || document.activeElement === el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    put();
    // The press that placed the note (or double-clicked it) ends after this:
    // its mousedown focuses the page, so the caret goes back once it is over.
    // A press in a window (Reply, the menu) is the user's own and stays.
    const again = (e: Event): void => {
      if (e.target instanceof Element && e.target.closest('[data-note-popup]')) return;
      requestAnimationFrame(put);
    };
    window.addEventListener('pointerup', again, { once: true });
    window.addEventListener('click', again, { once: true });
    const stop = window.setTimeout(() => {
      window.removeEventListener('pointerup', again);
      window.removeEventListener('click', again);
    }, 1000);
    return () => {
      window.clearTimeout(stop);
      window.removeEventListener('pointerup', again);
      window.removeEventListener('click', again);
    };
  }, [popup.focus]);

  const close = (): void => {
    commit();
    closeNotePopup(docId, note);
  };

  const place = (next: ViewBox): void => {
    setLive(null);
    placePopup(docId, note, popupFromView(next, frame));
  };

  const startDrag = (e: PointerEvent<HTMLElement>, kind: 'move' | 'size'): void => {
    if (e.button !== 0) return;
    // A press on a header button is that button's.
    if (kind === 'move' && (e.target as Element).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: box, kind };
  };
  const onDrag = (e: PointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setLive(d.kind === 'move' ? moved(d.start, dx, dy, frame) : resized(d.start, dx, dy, frame));
  };
  const endDrag = (e: PointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    drag.current = null;
    const end = live;
    if (
      end &&
      (end.left !== d.start.left ||
        end.top !== d.start.top ||
        end.width !== d.start.width ||
        end.height !== d.start.height)
    )
      place(end);
    else setLive(null);
  };

  /** Arrow keys on the header's move handle or the resize grip. */
  const arrows = (e: KeyboardEvent<HTMLElement>, kind: 'move' | 'size'): void => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const [dx = 0, dy = 0] = d;
    place(kind === 'move' ? moved(box, dx, dy, frame) : resized(box, dx, dy, frame));
  };

  const onTextKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Keys typed into the note are the note's, never the document's shortcuts.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  };

  // ---------------------------------------------------------------- replies
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const replyBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (replying) replyBox.current?.focus();
  }, [replying]);
  const post = (): void => {
    const body = reply.trim();
    setReplying(false);
    setReply('');
    if (body) void addReply(docId, note, body);
  };
  const onReplyKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      setReplying(false);
      setReply('');
      text.current?.focus();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      post();
    }
  };

  // ---------------------------------------------------------------- footer
  const menu: MenuEntry[] = [
    {
      kind: 'submenu',
      id: 'status',
      label: t('command.comment.setStatus'),
      entries: STATUSES.map((s) => ({
        id: s,
        label: t(STATUS_KEYS[s]),
        disabled: !canEdit,
        onSelect: () => {
          void setStatus(docId, note, s);
        },
      })),
    },
    {
      id: 'delete',
      label: t('notePopup.delete'),
      disabled: !editable,
      onSelect: () => {
        commit();
        deleteComments(docId, [note]);
      },
    },
    { kind: 'separator', id: 'sep' },
    {
      id: 'properties',
      label: t('command.edit.properties'),
      onSelect: () => {
        commit();
        annotationCapability()?.forDocument(docId).selectAnnotation(note.pageIndex, note.id);
        void runCommand('edit.properties');
      },
    },
  ];
  const statusName = t(STATUS_KEYS[status?.state ?? PdfAnnotationState.None]);

  const own = note as { strokeColor?: string; color?: string };
  const color = own.strokeColor ?? own.color ?? NOTE_DEFAULT_COLOR;
  const author = authorOf(note) ?? t('annotate.noAuthor');
  const when = note.modified ?? note.created;
  const style = {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    zIndex: popup.z,
    '--note-color': color,
    '--note-ink': noteInk(color),
  } as CSSProperties;

  return (
    // The handlers only keep the window's presses from the page; its controls are the interactions.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className="note-popup"
      role="dialog"
      aria-modal="false"
      aria-label={t('notePopup.label', { author })}
      data-note-popup={note.id}
      data-locked={locked || undefined}
      style={style}
      // The page underneath never sees these presses (tools, Hand, the comment menu).
      onPointerDown={(e) => {
        e.stopPropagation();
        raisePopup(docId, note.id);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        // Esc anywhere in the window closes it (and saves the text).
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <header
        className="note-popup-header"
        onPointerDown={(e) => {
          startDrag(e, 'move');
        }}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <button
          type="button"
          className="note-popup-handle"
          aria-label={t('notePopup.move')}
          title={t('notePopup.moveHint')}
          onKeyDown={(e) => {
            arrows(e, 'move');
          }}
        >
          <Note16Regular aria-hidden />
        </button>
        <span className="note-popup-meta">
          <span className="note-popup-line">
            <span className="note-popup-title">{t('notePopup.title')}</span>
            <span className="note-popup-author">{author}</span>
          </span>
          {when ? <span className="note-popup-date">{format.dateTime(when)}</span> : null}
        </span>
        <IconButton
          label={t('notePopup.close')}
          icon={<Dismiss16Regular />}
          size="small"
          className="note-popup-close"
          onClick={close}
        />
      </header>
      <div className="note-popup-body">
        <textarea
          ref={text}
          className="note-popup-text"
          aria-label={t('notePopup.text')}
          aria-describedby={`note-popup-hint-${note.id}`}
          value={draft}
          readOnly={!editable}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={onTextKey}
        />
        <span id={`note-popup-hint-${note.id}`} className="ui-visually-hidden">
          {t('notePopup.hint')}
        </span>
        {replies.length > 0 ? (
          <ol className="note-popup-replies" aria-label={t('notePopup.replies')}>
            {replies.map(({ annot, depth }) => (
              <li
                key={annot.id}
                className="note-popup-reply"
                style={{ marginInlineStart: depth * 12 }}
              >
                <span className="note-popup-reply-meta">
                  {authorOf(annot) ?? t('annotate.noAuthor')}
                  {annot.created ? ` · ${format.dateTime(annot.created)}` : ''}
                </span>
                <span className="note-popup-reply-text">{annot.contents ?? ''}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {replying ? (
          <div className="note-popup-reply-editor">
            <textarea
              ref={replyBox}
              className="note-popup-reply-input"
              aria-label={t('notePopup.replyText')}
              aria-describedby={`note-popup-reply-hint-${note.id}`}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
              }}
              onKeyDown={onReplyKey}
            />
            <span id={`note-popup-reply-hint-${note.id}`} className="ui-visually-hidden">
              {t('notePopup.replyHint')}
            </span>
            <div className="note-popup-reply-actions">
              <Button
                label={t('notePopup.post')}
                size="small"
                variant="primary"
                onClick={post}
                disabled={!reply.trim()}
              />
              <Button
                label={t('notePopup.cancel')}
                size="small"
                onClick={() => {
                  setReplying(false);
                  setReply('');
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
      <footer className="note-popup-footer">
        <DropdownMenu
          trigger={
            <IconButton
              label={t('notePopup.options')}
              icon={<MoreVertical16Regular />}
              size="small"
            />
          }
          entries={menu}
        />
        <span className="note-popup-status" title={statusName}>
          <StatusIcon state={status?.state ?? 'none'} />
          <span>{statusName}</span>
        </span>
        <span className="note-popup-spacer" />
        <IconButton
          label={t('notePopup.lock')}
          icon={locked ? <LockClosed16Regular /> : <LockOpen16Regular />}
          size="small"
          aria-pressed={locked}
          disabled={!canEdit}
          onClick={() => {
            commit();
            setFlag(docId, [note], 'locked', !locked);
          }}
        />
        <Button
          label={t('notePopup.reply')}
          icon={<ArrowReply16Regular />}
          size="small"
          disabled={!canEdit}
          onClick={() => {
            setReplying(true);
          }}
        />
        <span
          className="note-popup-grip"
          role="button"
          tabIndex={0}
          aria-label={t('notePopup.resize')}
          title={t('notePopup.resizeHint')}
          onPointerDown={(e) => {
            startDrag(e, 'size');
          }}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            arrows(e, 'size');
          }}
        />
      </footer>
    </section>
  );
}
