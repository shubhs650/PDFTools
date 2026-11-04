// Text comments under the mouse (M7-03, ADR-023 D-43 b, c; review 4b-iv, 4b-v;
// bugs B5, B6). EmbedPDF selects a comment on the press and only lets a
// comment that was already selected be dragged, so a press-and-drag on a text
// box, typewriter or callout selected it and left it where it was (B5). Here a
// press that travels further than a few pixels moves the comment it just
// selected, through the plugin's own drag (one undo step, attached links
// follow, kept on the page). The press also keeps the focus on the document
// view (not on the comment's hidden editor), so Delete, the clipboard keys and
// the arrows reach the comment (B6). A double-click puts the caret at the
// clicked character, and Enter or F2 edits the selected text comment.
import type { PluginRegistry } from '@embedpdf/core';
import { PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { securityOf, documentStore } from '../../app/store/documentStore';
import { allows } from '../../model/permissions';
import { hostStore } from '../view/host';
import { focusDocumentView } from '../view/focus';
import { annotationCapability } from './selection';
import { TEXT_BODY_ATTR } from './textEdit';
import { MOVE_THRESHOLD_PX, pageDelta } from './textEditModel';

/** The annotation plugin's drag calls (the same its selection box uses). */
interface DragInternals {
  startDrag(
    documentId: string,
    options: { annotationIds: string[]; pageSize: { width: number; height: number } },
  ): void;
  updateDrag(documentId: string, delta: { x: number; y: number }): unknown;
  commitDrag(documentId: string): void;
  cancelDrag(documentId: string): void;
}

function dragInternals(registry: PluginRegistry | null): DragInternals | null {
  const p = registry?.getPlugin('annotation') as Partial<DragInternals> | null | undefined;
  return p && typeof p.startDrag === 'function' ? (p as DragInternals) : null;
}

/** Where a page lies on screen, as the annotation layer draws it. */
export interface PageGeometry {
  scale: number;
  /** Quarter turns. */
  rotation: number;
  /** Page size in page points. */
  pageWidth: number;
  pageHeight: number;
}

/** Whether the comment may change: annotate permission (rule 9), not locked (M6-06). */
function movable(docId: string, obj: PdfAnnotationObject): boolean {
  const meta = documentStore.getState().docs[docId]?.meta;
  if (!meta || !allows(securityOf(meta), 'annotate')) return false;
  try {
    const scope = annotationCapability()?.forDocument(docId);
    return !!scope && !scope.isAnnotationStructurallyLocked(obj);
  } catch {
    return false;
  }
}

function selectedIds(docId: string): string[] {
  try {
    return annotationCapability()?.forDocument(docId).getSelectedAnnotationIds() ?? [];
  } catch {
    return [];
  }
}

/**
 * The press on a text comment's body that is not selected yet (AnnotationLayer,
 * capture phase: the plugin's own handler selects it next). Moves it if the
 * pointer travels while pressed.
 */
export function pressTextComment(
  e: ReactPointerEvent<HTMLElement>,
  obj: PdfAnnotationObject,
  geometry: PageGeometry,
): void {
  if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  const docId = e.currentTarget.closest<HTMLElement>('[data-doc-id]')?.dataset['docId'];
  if (!docId) return;
  // The hidden editor would take the focus (and the keys, B6) and the
  // drag would select the page's text: the view keeps the focus instead.
  e.preventDefault();
  focusDocumentView(docId);
  const start = { x: e.clientX, y: e.clientY };
  const pointerId = e.pointerId;
  const plugin = dragInternals(hostStore.getState().registry);
  let dragging = false;
  let gaveUp = false;

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId || gaveUp) return;
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (!dragging) {
      if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
      // Only the comment this press selected, and only if it may move.
      const ids = selectedIds(docId);
      if (!plugin || ids.length !== 1 || ids[0] !== obj.id || !movable(docId, obj)) {
        gaveUp = true;
        return;
      }
      plugin.startDrag(docId, {
        annotationIds: [obj.id],
        pageSize: { width: geometry.pageWidth, height: geometry.pageHeight },
      });
      dragging = true;
    }
    ev.preventDefault();
    ev.stopPropagation();
    plugin?.updateDrag(docId, pageDelta(dx, dy, geometry.scale, geometry.rotation));
  };
  const finish = (commit: boolean) => (ev: Event) => {
    if (ev instanceof PointerEvent && ev.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('blur', onCancel, true);
    if (!dragging || !plugin) return;
    if (commit) plugin.commitDrag(docId);
    else plugin.cancelDrag(docId);
  };
  const onUp = finish(true);
  const onCancel = finish(false);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('blur', onCancel, true);
}

// --- Editing at the clicked character ---------------------------------------

/** The last double-click on the page, for the editor it opens. */
let lastDouble: { x: number; y: number; at: number } | null = null;
const DOUBLE_FRESH_MS = 1000;

/** Puts the caret in `el` at the screen point, if the point is in its text. */
function caretAt(el: HTMLElement, x: number, y: number): boolean {
  const doc = el.ownerDocument;
  // caretPositionFromPoint is the standard; older Safari only has the WebKit call.
  const legacy = doc as unknown as {
    caretPositionFromPoint?: unknown;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof legacy.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    node = pos?.offsetNode ?? null;
    offset = pos?.offset ?? 0;
  } else {
    const range = legacy.caretRangeFromPoint?.(x, y) ?? null;
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  if (!node || !el.contains(node)) return false;
  const sel = doc.getSelection();
  if (!sel) return false;
  const range = doc.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

/**
 * A text comment's editor just opened (textEdit.ts): after a double-click on
 * it, the caret goes to the clicked character (the plugin puts it at the end).
 */
export function editorOpened(el: HTMLElement): void {
  const d = lastDouble;
  lastDouble = null;
  if (!d || performance.now() - d.at > DOUBLE_FRESH_MS) return;
  const r = el.getBoundingClientRect();
  if (d.x < r.left || d.x > r.right || d.y < r.top || d.y > r.bottom) return;
  // After the plugin's own caret placement (its effect runs after the render).
  requestAnimationFrame(() => {
    if (el.isContentEditable) caretAt(el, d.x, d.y);
  });
}

// --- Enter / F2 ----------------------------------------------------------------

/** The selected text comment that Enter or F2 would edit, if exactly one is selected. */
export function editableTextComment(docId: string): PdfAnnotationObject | null {
  try {
    const scope = annotationCapability()?.forDocument(docId);
    const st = scope?.getState();
    if (st?.selectedUids.length !== 1 || !scope) return null;
    const obj = st.byUid[st.selectedUids[0] ?? '']?.object;
    if (obj?.type !== PdfAnnotationSubtype.FREETEXT) return null;
    if (scope.isAnnotationContentLocked(obj) || !movable(docId, obj)) return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Opens the editor of the selected text comment (Enter, F2), with the caret at
 * the end of its text. The plugin starts editing on a double-click on the
 * selected comment's frame, so that is what is sent to it.
 */
export function editSelectedText(docId: string): boolean {
  const obj = editableTextComment(docId);
  if (!obj) return false;
  const body = document.querySelector<HTMLElement>(
    `[data-doc-id="${CSS.escape(docId)}"] [${TEXT_BODY_ATTR}][data-annotation-id="${CSS.escape(obj.id)}"]`,
  );
  // The selected comment's frame: the second layer of its container, last child.
  const frame = body?.closest('[data-no-interaction]')?.children[1]?.lastElementChild;
  if (!(frame instanceof HTMLElement)) return false;
  frame.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = frame.getBoundingClientRect();
  frame.dispatchEvent(
    new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      detail: 2,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    }),
  );
  return true;
}

/**
 * The locked text comment a double-click is on, if it is one: the plugin
 * would open its editor (it only keeps a locked comment from moving), but a
 * locked comment does not edit either (M6-06).
 */
function lockedTextComment(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const body = target
    .closest('[data-no-interaction]')
    ?.querySelector<HTMLElement>(`[${TEXT_BODY_ATTR}]`);
  const docId = body?.closest<HTMLElement>('[data-doc-id]')?.dataset['docId'];
  const id = body?.dataset['annotationId'];
  if (!docId || !id) return false;
  try {
    const scope = annotationCapability()?.forDocument(docId);
    const obj = scope?.getAnnotationById(id)?.object;
    return !!scope && !!obj && scope.isAnnotationStructurallyLocked(obj);
  } catch {
    return false;
  }
}

/** Called once at startup (DocumentHost); returns the uninstall. */
export function installTextPointer(): () => void {
  const onDouble = (e: MouseEvent): void => {
    // Before React's own listener: a locked comment's frame never sees it.
    if (lockedTextComment(e.target)) {
      e.stopPropagation();
      return;
    }
    if (!e.isTrusted) return;
    lastDouble = { x: e.clientX, y: e.clientY, at: performance.now() };
  };
  document.addEventListener('dblclick', onDouble, true);
  return () => {
    document.removeEventListener('dblclick', onDouble, true);
  };
}
