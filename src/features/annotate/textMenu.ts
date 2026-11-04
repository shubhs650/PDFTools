// The text menu's actions (M7-05, ADR-023 D-43 e): right-click (Shift+F10,
// the Menu key) inside a text box, typewriter or callout being edited opens
// our menu instead of the browser's. Its items act on the editor: the
// editor's own undo history, the clipboard as plain text, the selection; Text
// Style changes the whole comment (`/DA`, `/Q`), Properties opens the pane.
//
// The menu takes the focus, which would end the edit (textEdit.ts), so the
// edit is held while it is open, the editor's selection is kept, and the
// chosen item runs once the menu has closed and the editor has the focus and
// its selection back.
import { createStore } from 'zustand';
import { notify, registerCommand, type CommandHandler } from '../../app/commands/dispatch';
import { msg, t, type MessageKey } from '../../i18n';
import type { Capability } from '../../model/permissions';
import { viewOf } from '../view/pagePoint';
import { annotationCapability } from './selection';
import { holdTextEdit, inTextEditor, insertPlainText, textEditSession } from './textEdit';
import { stylePatch, textStyleOf, type StyleChange, type TextStyle } from './textMenuModel';
import { announceTransfer } from './transfer/transferAnnounce';

interface MenuState {
  /** The document whose text menu is open. */
  openIn: string | null;
  /** The browser refuses to read the clipboard for us (the site permission). */
  pasteBlocked: boolean;
}

export const textMenuStore = createStore<MenuState>()(() => ({
  openIn: null,
  pasteBlocked: false,
}));

/** Per document, how its text menu (TextEditMenu) opens at a screen point. */
export const textMenuOpeners = new Map<string, (x: number, y: number) => void>();

/** A keyboard open can be followed by the browser's own `contextmenu`: ignored this long. */
const KEYBOARD_ECHO_MS = 500;
let echoUntil = 0;

/** The menu was opened from the keyboard (Shift+F10, the Menu key). */
export function keyboardOpened(): void {
  echoUntil = performance.now() + KEYBOARD_ECHO_MS;
}

/**
 * A `contextmenu` event in the document (DocumentMenu, capture phase): when
 * it is inside the text comment being edited, our menu opens instead of the
 * browser's and true is returned.
 */
export function textMenuFromEvent(e: MouseEvent): boolean {
  if (!inTextEditor(e.target)) return false;
  e.preventDefault();
  e.stopPropagation();
  if (e.isTrusted && performance.now() < echoUntil) return true;
  const docId = textEditSession()?.docId;
  if (docId) textMenuOpeners.get(docId)?.(e.clientX, e.clientY);
  return true;
}

let range: Range | null = null;
let release: (() => void) | null = null;
let pending: (() => void) | null = null;

/** The editor's selection, if it is inside `el`. */
function selectionIn(el: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  return el.contains(r.commonAncestorContainer) ? r.cloneRange() : null;
}

/** The selection the items act on: the kept one while the menu is open. */
function currentRange(): Range | null {
  const s = textEditSession();
  if (!s) return null;
  return textMenuStore.getState().openIn ? range : selectionIn(s.el);
}

async function checkPaste(): Promise<void> {
  try {
    const st = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
    textMenuStore.setState({ pasteBlocked: st.state === 'denied' });
  } catch {
    // No such permission here (another browser): Paste tries, and says so if refused.
    textMenuStore.setState({ pasteBlocked: false });
  }
  notify();
}

/**
 * The menu is about to open on the editor: its selection is kept and the
 * edit goes on. False when no text comment is being edited.
 */
export function textMenuOpening(): boolean {
  const s = textEditSession();
  if (!s) return false;
  range = selectionIn(s.el);
  release?.();
  release = holdTextEdit();
  pending = null;
  textMenuStore.setState({ openIn: s.docId });
  void checkPaste();
  notify();
  return true;
}

function refocus(): boolean {
  const s = textEditSession();
  if (!s?.el.isConnected || !s.el.isContentEditable) return false;
  s.el.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (range && sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return true;
}

/**
 * The menu has closed: the editor gets the focus and its selection back, then
 * the chosen item runs. Without an edit any more (Properties ended it), the
 * document view gets the focus.
 */
export function textMenuClosed(docId: string): void {
  release?.();
  release = null;
  textMenuStore.setState({ openIn: null });
  const run = pending;
  pending = null;
  if (refocus()) run?.();
  else viewOf(docId)?.focus({ preventScroll: true });
  range = null;
  notify();
}

/** Runs `fn` with the focus and selection in the editor (after the menu, if it is open). */
function inEditor(fn: () => void): void {
  if (textMenuStore.getState().openIn) {
    pending = fn;
    return;
  }
  const s = textEditSession();
  if (!s) return;
  if (document.activeElement !== s.el) s.el.focus({ preventScroll: true });
  fn();
}

/** A browser editing command on the focused editor (the only way into its undo history). */
function exec(command: 'undo' | 'redo' | 'delete'): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement acts on the editor's undo history
  document.execCommand(command);
}

function canExec(command: 'undo' | 'redo'): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the editor's own history, as exec()
    return document.queryCommandEnabled(command);
  } catch {
    return true;
  }
}

const hasSelection = (): boolean => {
  const r = currentRange();
  return !!r && !r.collapsed;
};

/** Enabled while a text comment is being edited, and when `also` has no reason against. */
function editing(
  requires: Capability | readonly Capability[],
  also?: () => MessageKey | null,
): Pick<CommandHandler, 'requires' | 'disabledReason'> {
  return {
    requires,
    disabledReason: () => (textEditSession() ? (also?.() ?? null) : msg('textMenu.notEditing')),
  };
}

const selectionNeeded = (): MessageKey | null =>
  hasSelection() ? null : msg('textMenu.noSelection');

function copySelection(): Promise<void> {
  const text = window.getSelection()?.toString() ?? '';
  return navigator.clipboard.writeText(text);
}

function refused(key: MessageKey): void {
  const s = textEditSession();
  if (s) announceTransfer(s.docId, t(key));
}

/** The comment being edited: its Text Style. Null when none. */
export function editedTextStyle(): TextStyle | null {
  const s = textEditSession();
  if (!s) return null;
  try {
    const obj = annotationCapability()?.forDocument(s.docId).getAnnotationById(s.id)?.object;
    return obj ? textStyleOf(obj) : null;
  } catch {
    return null;
  }
}

/** Text Style (D-43 e): the whole comment, one undo step; the edit goes on. */
export function setTextStyle(change: StyleChange): void {
  const s = textEditSession();
  if (!s) return;
  try {
    const scope = annotationCapability()?.forDocument(s.docId);
    const obj = scope?.getAnnotationById(s.id)?.object;
    const patch = obj ? stylePatch(obj, change) : null;
    if (scope && patch) scope.updateAnnotation(s.pageIndex, s.id, patch);
  } catch {
    // The document closed meanwhile.
  }
}

/** Text Style is enabled like the edit commands. */
export const textStyleState = editing('annotate');

export function registerTextMenuCommands(): () => void {
  const offs = [
    registerCommand('text.undo', {
      ...editing('annotate', () => (canExec('undo') ? null : msg('textMenu.nothingToUndo'))),
      run: () => {
        inEditor(() => {
          exec('undo');
        });
      },
    }),
    registerCommand('text.redo', {
      ...editing('annotate', () => (canExec('redo') ? null : msg('textMenu.nothingToRedo'))),
      run: () => {
        inEditor(() => {
          exec('redo');
        });
      },
    }),
    // Copying the comment's text honours the copy permission too (rule 9).
    registerCommand('text.cut', {
      ...editing(['annotate', 'copy'], selectionNeeded),
      run: () => {
        inEditor(() => {
          void copySelection().then(
            () => {
              exec('delete');
            },
            () => {
              refused(msg('textMenu.clipboardRefused'));
            },
          );
        });
      },
    }),
    registerCommand('text.copy', {
      ...editing(['annotate', 'copy'], selectionNeeded),
      run: () => {
        inEditor(() => {
          void copySelection().catch(() => {
            refused(msg('textMenu.clipboardRefused'));
          });
        });
      },
    }),
    registerCommand('text.paste', {
      ...editing('annotate', () =>
        textMenuStore.getState().pasteBlocked ? msg('textMenu.pasteBlocked') : null,
      ),
      run: () => {
        inEditor(() => {
          void navigator.clipboard.readText().then(insertPlainText, () => {
            refused(msg('textMenu.pasteBlocked'));
          });
        });
      },
    }),
    registerCommand('text.delete', {
      ...editing('annotate', selectionNeeded),
      run: () => {
        inEditor(() => {
          exec('delete');
        });
      },
    }),
    registerCommand('text.selectAll', {
      ...editing('annotate'),
      run: () => {
        inEditor(() => {
          const el = textEditSession()?.el;
          if (el) window.getSelection()?.selectAllChildren(el);
        });
      },
    }),
    registerCommand('text.style', {
      ...textStyleState,
      run: () => undefined,
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
