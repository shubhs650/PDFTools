// Selecting comments with the pointer (M7-04, ADR-023 D-36 amendment; review
// 4a; bugs B7, B8). Marquee: with Select Comments a drag that starts on the
// page (not on a comment) draws a rectangle and selects every comment it
// touches; with Select the same, unless the drag starts over text, which
// selects text as before. The selection plugin draws the rectangle and reports
// it (CommentMarquee); the pick is ours (marqueeHits), so form fields, links,
// replies and hidden comments never join. Shift or Ctrl held keeps what was
// selected and adds to it. Shift+click adds a comment to the selection or
// takes it out, as Ctrl+click does in the plugin. Ctrl+A with Select Comments
// selects every comment on the page.
import type { PluginRegistry } from '@embedpdf/core';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { startTransition } from 'react';
import { appStore, type Tool } from '../../app/store/appStore';
import { capability } from '../view/host';
import { POINTER_MODE, SELECT_COMMENTS_MODE } from '../view/plugins';
import { addIds, marqueeHits, pageAnnotations, withGroupMembers } from './model';
import { annotationCapability, annotationState } from './selection';

/** The tools that pick up comments with the pointer (M3-05). */
export const isCommentPicker = (tool: Tool): boolean =>
  tool === 'select' || tool === 'selectObjects';

const scope = (docId: string) => {
  try {
    return annotationCapability()?.forDocument(docId) ?? null;
  } catch {
    return null;
  }
};

/** Selects every comment on a page (Ctrl+A with Select Comments). */
export function selectAllComments(docId: string, pageIndex: number): void {
  const st = annotationState(docId);
  const s = scope(docId);
  if (!st || !s) return;
  const ids = withGroupMembers(
    st,
    pageAnnotations(st, pageIndex).map((o) => o.id),
  );
  // A transition: the page's comment boxes re-render in slices (rule 1, 1,000 comments).
  startTransition(() => {
    s.setSelection(ids);
  });
}

/** The selection held when a press with Shift or Ctrl began (a marquee then adds to it). */
let kept: { docId: string; ids: string[] } | null = null;

function docOf(target: EventTarget | null): string | null {
  return target instanceof Element
    ? (target.closest<HTMLElement>('[data-doc-id]')?.dataset['docId'] ?? null)
    : null;
}

/** A resize, vertex or rotation handle of the selection: a modifier there is the plugin's. */
const isHandle = (el: Element): boolean =>
  el.closest('[data-epdf-handle], [data-epdf-rotation-handle], [data-epdf-vertex]') !== null;

const BODY = '.annotation-body[data-annotation-id]';

const pick = (el: HTMLElement | null | undefined) => {
  const id = el?.dataset['annotationId'];
  const page = Number(el?.dataset['pageIndex']);
  return id && Number.isInteger(page) ? { id, page } : null;
};

/**
 * The comment a press is on: an unselected one whose hit area is at the point
 * (also under the plugin's group box, which lies over the whole selection),
 * else the selected one whose box holds the point (their frames lie over
 * them); the smallest box wins where selected ones overlap.
 */
export function commentAt(
  target: Element,
  x: number,
  y: number,
): { id: string; page: number } | null {
  const layer = target.closest('.annotation-layer');
  if (!layer) return null;
  for (const el of target.ownerDocument.elementsFromPoint(x, y)) {
    if (!layer.contains(el)) continue;
    const body = el.closest<HTMLElement>(BODY);
    if (body && body.dataset['selected'] === undefined) return pick(body);
  }
  let best: { el: HTMLElement; area: number } | null = null;
  for (const el of layer.querySelectorAll<HTMLElement>(`${BODY}[data-selected]`)) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const area = r.width * r.height;
    if (!best || area < best.area) best = { el, area };
  }
  return pick(best?.el);
}

/**
 * Presses on the document, before anything else sees them: Shift+click (and
 * Ctrl+click on a selected comment, which the plugin's group box swallows)
 * adds the comment under the pointer to the selection or takes it out; a press
 * with Shift or Ctrl elsewhere remembers the selection for the marquee it may
 * start.
 */
function onPressCapture(e: PointerEvent): void {
  if (!e.isTrusted || e.button !== 0) return;
  if (!isCommentPicker(appStore.getState().tool)) return;
  const docId = docOf(e.target);
  if (!docId) {
    kept = null;
    return;
  }
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  kept = additive ? { docId, ids: scope(docId)?.getSelectedAnnotationIds() ?? [] } : null;
  const target = e.target;
  if (!additive || e.altKey || !(target instanceof Element) || isHandle(target)) return;
  if (!target.closest('.annotation-layer [data-no-interaction]')) return;
  const hit = commentAt(target, e.clientX, e.clientY);
  // Ctrl on an unselected comment: the plugin's own toggle.
  if (!hit || (!e.shiftKey && !scope(docId)?.getSelectedAnnotationIds().includes(hit.id))) return;
  e.stopPropagation();
  e.preventDefault();
  kept = null;
  scope(docId)?.toggleSelection(hit.page, hit.id);
}

/** Called once the plugin registry is up (DocumentHost); returns the uninstall. */
export function installCommentSelection(registry: PluginRegistry): () => void {
  let off: () => void = () => undefined;
  try {
    const selection = capability<SelectionCapability>(registry, 'selection');
    // After the annotation plugin's own pointer-mode handler, which this overrides.
    off = selection.onMarqueeEnd(({ documentId, pageIndex, rect, modeId }) => {
      if (modeId !== POINTER_MODE && modeId !== SELECT_COMMENTS_MODE) return;
      if (!isCommentPicker(appStore.getState().tool)) return;
      const st = annotationState(documentId);
      const s = scope(documentId);
      if (!st || !s) return;
      const hits = withGroupMembers(
        st,
        marqueeHits(st, pageIndex, rect).map((o) => o.id),
      );
      const base = kept?.docId === documentId ? kept.ids : [];
      kept = null;
      // setSelection leaves out what the tool's lock keeps unselectable (form
      // fields). A transition: hundreds of comment boxes re-render in slices,
      // not in one long task (rule 1).
      startTransition(() => {
        s.setSelection(addIds(base, hits));
      });
    });
  } catch {
    // No selection plugin: no marquee.
  }
  window.addEventListener('pointerdown', onPressCapture, true);
  return () => {
    off();
    window.removeEventListener('pointerdown', onPressCapture, true);
  };
}
