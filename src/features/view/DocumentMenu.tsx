// The document's right-click menus (M6-02, ADR-021 D-38 a): one on a comment
// on the page, one on the page background, and one on selected text (M11-08·O1). Right click, Shift+F10 or the Menu
// key opens them; Esc closes and focus returns to the document. Every item is
// a command (same handler and disabled reason as the ribbon and keys); Paste
// from either menu puts the comments at the pointer.
import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { PagePoint } from '../../app/commands/dispatch';
import { isEditable } from '../../app/keys/useShortcuts';
import { msg, type MessageKey } from '../../i18n';
import { ContextMenu } from '../../ui/components';
import { TextEditMenu } from '../annotate/TextEditMenu';
import { textMenuFromEvent } from '../annotate/textMenu';
import { selectedTextMenu, snippetOf } from '../select/selectedText';
import { onTextSelectionAt, selectedQuery, textSelectionOf } from '../select/textSelection';
import {
  commentMenu,
  keyboardAnchor,
  onSelectedComment,
  openers,
  PAGE_MENU,
  selectedComments,
} from './documentMenus';
import { pagePointAt, viewOf } from './pagePoint';

type MenuKind = 'comment' | 'page' | 'text';

const MENU_LABEL = {
  comment: msg('contextMenu.comment'),
  page: msg('contextMenu.page'),
  text: msg('contextMenu.text'),
} as const satisfies Record<MenuKind, MessageKey>;

/** A keyboard open can be followed by the browser's own `contextmenu`: ignored this long. */
const KEYBOARD_ECHO_MS = 500;

export function DocumentMenu({
  documentId,
  children,
}: {
  documentId: string;
  children: ReactElement;
}) {
  const { t } = useTranslation();
  const area = useRef<HTMLDivElement>(null);
  const echoUntil = useRef(0);
  const [target, setTarget] = useState<{ kind: MenuKind; at: PagePoint | null }>({
    kind: 'page',
    at: null,
  });
  // The selected-text menu's quote of the text ('' until read), and which open it is for.
  const [snippet, setSnippet] = useState('');
  const reading = useRef(0);

  // A right press on selected text keeps it (M11-08·O1): the page's own
  // handlers (text selection, comments) would clear it before the menu opens.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onDown = (e: PointerEvent): void => {
      if (e.button === 2 && onTextSelectionAt(documentId, e.clientX, e.clientY))
        e.stopPropagation();
    };
    el.addEventListener('pointerdown', onDown, true);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
    };
  }, [documentId]);

  useEffect(() => {
    const open = (): void => {
      const el = area.current;
      const p = keyboardAnchor(documentId);
      if (!el || !p) return;
      el.dispatchEvent(
        new window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: p.x,
          clientY: p.y,
          button: 2,
        }),
      );
      echoUntil.current = performance.now() + KEYBOARD_ECHO_MS;
    };
    openers.set(documentId, open);
    return () => {
      if (openers.get(documentId) === open) openers.delete(documentId);
    };
  }, [documentId]);

  // Before Radix opens the menu (bubble phase): which menu, and where.
  const onContextMenuCapture = (e: MouseEvent<HTMLDivElement>): void => {
    if (e.nativeEvent.isTrusted && performance.now() < echoUntil.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // A text comment being edited: the text menu (M7-05, B10).
    if (textMenuFromEvent(e.nativeEvent)) return;
    // A form field keeps the browser's menu (cut/copy/paste text).
    if (isEditable(e.target as Element)) {
      e.stopPropagation();
      return;
    }
    const at = pagePointAt(documentId, e.clientX, e.clientY);
    // On selected text, or from the keys while text is selected: the text menu.
    const onText = e.nativeEvent.isTrusted
      ? onTextSelectionAt(documentId, e.clientX, e.clientY)
      : textSelectionOf(documentId).length > 0;
    if (onText) {
      setTarget({ kind: 'text', at });
      setSnippet('');
      const read = ++reading.current;
      void selectedQuery(documentId).then((q) => {
        if (read === reading.current) setSnippet(q ? snippetOf(q) : '');
      });
      return;
    }
    setTarget({
      kind: at && onSelectedComment(at, selectedComments(documentId)) ? 'comment' : 'page',
      at,
    });
  };

  // Back to the document unless an item moved focus on purpose (a dialog, the reply box).
  const onCloseAutoFocus = (e: Event): void => {
    e.preventDefault();
    const active = document.activeElement;
    if (!active || active === document.body) viewOf(documentId)?.focus({ preventScroll: true });
  };

  return (
    <>
      <ContextMenu
        label={t(MENU_LABEL[target.kind])}
        entries={
          target.kind === 'text'
            ? selectedTextMenu(snippet)
            : target.kind === 'comment'
              ? commentMenu(documentId)
              : PAGE_MENU
        }
        {...(target.at ? { args: { at: target.at } } : {})}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div ref={area} className="document-menu-area" onContextMenuCapture={onContextMenuCapture}>
          {children}
        </div>
      </ContextMenu>
      <TextEditMenu documentId={documentId} />
    </>
  );
}
