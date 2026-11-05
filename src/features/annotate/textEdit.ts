// Text comment editing (M7-02, ADR-023 D-43 a, d). EmbedPDF's free text
// editor (text box, typewriter, callout) writes its text only on `blur`, and
// most ways out of it never blur it: Esc deselects, which only hides the
// editor (the body's opacity), so the focus stays in it; a click on the page
// ends a callout's editing without moving the focus; a tool change, Ctrl+S or
// a tab switch leave the focus where it is. The typed text was then lost
// (B1, B2). So the commit is ours, not the plugin's: the editor's own blur
// commit is stopped, and every way out — the focus leaving the editor, Esc,
// the comment losing the selection, a tool or tab change, any command (Ctrl+S,
// Close…), the editor unmounting — writes the typed text once (one undo step,
// and only when it changed) and ends editing.
//
// While editing, the editor shows all of its text (M7-12, bug B15): it grows
// past its box instead of clipping (a typewriter also stops wrapping), and
// the commit grows the comment to fit in the same undo step
// (`grownTextGeometry`), as PDF-XChange does while typing.
//
// The plugin keeps "which comment is being edited" in its page layer's React
// state and has no call to clear it, so when editing has to end without the
// plugin's help (Esc, a tool change…), the page's annotation layer is
// remounted (`useEditEpoch`); the selection lives in the plugin's store and
// stays.
import { createStore, useStore } from 'zustand';
import { appStore } from '../../app/store/appStore';
import { onBeforeCommand } from '../../app/commands/dispatch';
import { documentStore } from '../../app/store/documentStore';
import { annotationCapability } from './selection';
import { contentsPatch, grownTextGeometry, type FitTarget } from './textEditModel';
import { editorOpened } from './textPointer';

/** Marks an annotation body that holds a free text editor (AnnotationLayer). */
export const TEXT_BODY_ATTR = 'data-text-comment';

interface Fit {
  /** The editor's size (px) as the plugin laid it out, before it may grow. */
  width: number;
  height: number;
  /** Screen px per page point. */
  scale: number;
  /** The page's size in points (the comment stays on it). */
  page: { width: number; height: number };
  /** Puts the plugin's editor style back. */
  restore: () => void;
}

interface Session {
  docId: string;
  pageIndex: number;
  id: string;
  el: HTMLElement;
  stop: () => void;
  fit: Fit | null;
}

let session: Session | null = null;

/**
 * While the text menu is open (M7-05), the focus is in the menu, not in the
 * editor: that is not a way out of the edit.
 */
let held = false;

/** Keeps editing alive while focus is in the text menu; returns the release. */
export function holdTextEdit(): () => void {
  held = true;
  return () => {
    held = false;
  };
}

/** The text comment being edited: its document, page, id and editor. */
export function textEditSession(): Readonly<Omit<Session, 'stop'>> | null {
  return session;
}

/** Whether `target` is (inside) the editor of the text comment being edited. */
export function inTextEditor(target: EventTarget | null): boolean {
  return !!session && target instanceof Node && session.el.contains(target);
}

// Per page, a counter the annotation layer uses as its key.
const epochs = createStore<{ map: Readonly<Record<string, number>> }>()(() => ({ map: {} }));
const pageKey = (docId: string, pageIndex: number): string => `${docId}:${String(pageIndex)}`;

/** The key of a page's annotation layer: it changes when editing there must end. */
export function useEditEpoch(docId: string, pageIndex: number): number {
  return useStore(epochs, (s) => s.map[pageKey(docId, pageIndex)] ?? 0);
}

function remount(docId: string, pageIndex: number): void {
  const k = pageKey(docId, pageIndex);
  epochs.setState((s) => ({ map: { ...s.map, [k]: (s.map[k] ?? 0) + 1 } }));
}

/** The free text editor `target` is, if it is one (editable or not). */
function editorSpan(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement) || !target.hasAttribute('tabindex')) return null;
  return target.closest(`[${TEXT_BODY_ATTR}]`) ? target : null;
}

function selectedIds(docId: string): string[] | null {
  try {
    const st = annotationCapability()?.forDocument(docId).getState();
    if (!st) return null;
    return st.selectedUids.map((uid) => st.byUid[uid]?.object.id ?? uid);
  } catch {
    return null;
  }
}

function begin(el: HTMLElement): void {
  if (session?.el === el) return;
  endTextEdit();
  const body = el.closest<HTMLElement>(`[${TEXT_BODY_ATTR}]`);
  const docId = el.closest<HTMLElement>('[data-doc-id]')?.dataset['docId'];
  const id = body?.dataset['annotationId'];
  const pageIndex = Number(body?.dataset['pageIndex']);
  if (!docId || !id || !Number.isInteger(pageIndex)) return;
  // Losing the selection (Esc's deselect, the Comments pane, undo…) ends it.
  let stop = (): void => undefined;
  try {
    stop =
      annotationCapability()
        ?.forDocument(docId)
        .onStateChange(() => {
          const ids = selectedIds(docId);
          if (ids && !ids.includes(id) && session?.id === id) endTextEdit();
        }) ?? stop;
  } catch {
    // No plugin state for the document: nothing to watch.
  }
  session = { docId, pageIndex, id, el, stop, fit: fitEditor(docId, id, el) };
  editorOpened(el);
}

/**
 * Lets the editor grow with its text (B15): no clipping, at least its box's
 * size; a typewriter's lines don't wrap. The plugin sets these as inline
 * styles and React only rewrites a style whose value changes, so they hold
 * until editing ends.
 */
function fitEditor(docId: string, id: string, el: HTMLElement): Fit | null {
  try {
    const obj = annotationCapability()?.forDocument(docId).getAnnotationById(id)?.object as
      (FitTarget & { type?: number }) | undefined;
    const frame = el.parentElement;
    if (!obj || !frame || obj.rect.size.width <= 0) return null;
    const scale = frame.offsetWidth / obj.rect.size.width;
    if (!(scale > 0)) return null;
    const content = el.closest<HTMLElement>('.page-content');
    const page = content
      ? { width: content.offsetWidth / scale, height: content.offsetHeight / scale }
      : { width: Infinity, height: Infinity };
    const fit: Fit = {
      width: el.offsetWidth,
      height: el.offsetHeight,
      scale,
      page,
      restore: () => undefined,
    };
    const st = el.style;
    const before = {
      height: st.height,
      minHeight: st.minHeight,
      width: st.width,
      minWidth: st.minWidth,
      overflow: st.overflow,
      whiteSpace: st.whiteSpace,
    };
    st.minHeight = st.height;
    st.height = 'auto';
    st.overflow = 'visible';
    if (obj.intent === 'FreeTextTypeWriter') {
      st.minWidth = st.width;
      st.width = 'max-content';
      st.whiteSpace = 'pre';
    }
    fit.restore = () => {
      // A new size from the commit is the plugin's to set again.
      if (st.height === 'auto') st.height = before.height;
      if (st.width === 'max-content') st.width = before.width;
      st.minHeight = before.minHeight;
      st.minWidth = before.minWidth;
      st.overflow = before.overflow;
      st.whiteSpace = before.whiteSpace;
    };
    return fit;
  } catch {
    return null;
  }
}

function commit(s: Session): void {
  try {
    const scope = annotationCapability()?.forDocument(s.docId);
    const obj = scope?.getAnnotationById(s.id)?.object;
    if (!scope || !obj) return;
    const text = contentsPatch(obj.contents, s.el.innerText);
    const f = s.fit;
    const size = f
      ? grownTextGeometry(
          obj,
          {
            width: (s.el.offsetWidth - f.width) / f.scale,
            height: (s.el.offsetHeight - f.height) / f.scale,
          },
          f.page,
        )
      : null;
    // The text and the new size are one change (one undo step).
    if (text || size) scope.updateAnnotation(s.pageIndex, s.id, { ...text, ...size });
  } catch {
    // The document closed meanwhile: nothing left to write to.
  } finally {
    s.fit?.restore();
  }
}

/**
 * Types `text` at the editor's selection as the user would (one step of the
 * editor's own undo history). The browser's editing commands are the only way
 * to join that history, hence the deprecated call.
 */
export function insertPlainText(text: string): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement joins the editor's undo history
  document.execCommand('insertText', false, text);
}

/** Whether a text comment is being edited. */
export function isEditingText(): boolean {
  return session !== null;
}

/**
 * Writes the text being edited and ends editing. False when nothing was
 * being edited. The comment stays selected.
 */
export function endTextEdit(): boolean {
  const s = session;
  if (!s) return false;
  session = null;
  s.stop();
  commit(s);
  // After this event's re-render: is the plugin still editing it? (A click on
  // the page or on another comment ends its editing by itself.)
  setTimeout(() => {
    if (s.el.isConnected && s.el.isContentEditable) remount(s.docId, s.pageIndex);
  }, 0);
  return true;
}

/** The body around an editor unmounts (page scrolled away, comment deleted…). */
export function textBodyUnmounted(id: string): void {
  if (session?.id === id) endTextEdit();
}

/** Called once at startup (DocumentHost); returns the uninstall. */
export function installTextEdit(): () => void {
  const onFocusIn = (e: FocusEvent): void => {
    const el = editorSpan(e.target);
    if (el?.isContentEditable) begin(el);
  };
  const onFocusOut = (e: FocusEvent): void => {
    const el = editorSpan(e.target);
    if (!el) return;
    // The plugin's own blur commit would write a second, stale undo step.
    e.stopPropagation();
    // Another window took the focus: the editor gets it back on return.
    if (session?.el === el && document.hasFocus() && !held) endTextEdit();
  };
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  // A double-click focuses the editor before it becomes editable, so no
  // focusin follows: it is caught when the editor turns editable.
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const el = editorSpan(r.target);
      if (el?.isContentEditable && document.activeElement === el) begin(el);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['contenteditable'],
  });
  // Pasted text arrives as plain text (M7-05): the editor holds what /Contents saves.
  const onPaste = (e: ClipboardEvent): void => {
    if (!inTextEditor(e.target)) return;
    e.preventDefault();
    insertPlainText(e.clipboardData?.getData('text/plain') ?? '');
  };
  document.addEventListener('paste', onPaste, true);
  const offCommand = onBeforeCommand((id) => {
    // Esc (tool.cancel) ends editing itself and stops there; the text menu's
    // commands (M7-05) act on the edit.
    if (id !== 'tool.cancel' && !id.startsWith('text.')) endTextEdit();
  });
  const offTool = appStore.subscribe((s, prev) => {
    if (s.tool !== prev.tool) endTextEdit();
  });
  const offDoc = documentStore.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) endTextEdit();
  });
  return () => {
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('paste', onPaste, true);
    observer.disconnect();
    offCommand();
    offTool();
    offDoc();
  };
}
