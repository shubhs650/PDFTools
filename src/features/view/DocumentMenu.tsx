// The document's right-click menus (M6-02, ADR-021 D-38 a): one on a comment
// on the page, one on the page background. Right click, Shift+F10 or the Menu
// key opens them; Esc closes and focus returns to the document. Every item is
// a command (same handler and disabled reason as the ribbon and keys); Paste
// from either menu puts the comments at the pointer.
import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { PagePoint } from '../../app/commands/dispatch';
import { isEditable } from '../../app/keys/useShortcuts';
import { msg } from '../../i18n';
import { ContextMenu } from '../../ui/components';
import { TextEditMenu } from '../annotate/TextEditMenu';
import { textMenuFromEvent } from '../annotate/textMenu';
import {
  commentMenu,
  keyboardAnchor,
  onSelectedComment,
  openers,
  PAGE_MENU,
  selectedComments,
} from './documentMenus';
import { pagePointAt, viewOf } from './pagePoint';

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
  const [target, setTarget] = useState<{ kind: 'comment' | 'page'; at: PagePoint | null }>({
    kind: 'page',
    at: null,
  });

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
        label={t(target.kind === 'comment' ? msg('contextMenu.comment') : msg('contextMenu.page'))}
        entries={target.kind === 'comment' ? commentMenu(documentId) : PAGE_MENU}
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
