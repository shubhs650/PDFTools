// Where on a page the pointer is (M6-02, ADR-021 D-38): Paste from a context
// menu lands at the pointer, and Ctrl+V lands on the page last clicked while
// it is still in view (the beta pasted onto the page the view had scrolled
// to). Page points have a top-left origin on the page as displayed without the
// view's rotation, like every annotation rect from the annotation plugin.
import type { PluginRegistry } from '@embedpdf/core';
import type { PagePoint } from '../../app/commands/dispatch';
import { documentStore } from '../../app/store/documentStore';
import { hostStore } from './host';

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The page point under an offset (CSS px) into a page's on-screen box, which
 * shows the page (`size` in points) turned `rotation` quarter turns clockwise
 * at `scale`. Kept on the page. Pure.
 */
export function toPagePoint(offset: Point, size: Size, rotation: number, scale: number): Point {
  const u = offset.x / scale;
  const v = offset.y / scale;
  const { width: w, height: h } = size;
  const r = ((rotation % 4) + 4) % 4;
  const p =
    r === 1
      ? { x: v, y: h - u }
      : r === 2
        ? { x: w - u, y: h - v }
        : r === 3
          ? { x: w - v, y: u }
          : { x: u, y: v };
  return { x: clamp(p.x, 0, w), y: clamp(p.y, 0, h) };
}

/** The inverse of `toPagePoint`: a page point's offset (CSS px) into the page's box. Pure. */
export function toOffset(point: Point, size: Size, rotation: number, scale: number): Point {
  const { x, y } = point;
  const { width: w, height: h } = size;
  const r = ((rotation % 4) + 4) % 4;
  const d =
    r === 1
      ? { x: h - y, y: x }
      : r === 2
        ? { x: w - x, y: h - y }
        : r === 3
          ? { x: y, y: w - x }
          : { x, y };
  return { x: d.x * scale, y: d.y * scale };
}

// ------------------------------------------------------------------ the DOM

/** A document's scroll container (DocumentView). */
export function viewOf(docId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-testid="document-view"][data-doc-id="${CSS.escape(docId)}"]`,
  );
}

/** A page's size in points (as displayed, without the view's rotation). */
export function pageSizeOf(docId: string, page: number): Size | null {
  const registry: PluginRegistry | null = hostStore.getState().registry;
  const doc = registry?.getStore().getState().core.documents[docId]?.document;
  return doc?.pages[page]?.size ?? null;
}

function geometry(docId: string, page: number) {
  const view = viewOf(docId);
  const el = view?.querySelector<HTMLElement>(`.page[data-page="${String(page)}"]`);
  const size = pageSizeOf(docId, page);
  const d = documentStore.getState().docs[docId];
  if (!view || !el || !size || !d || el.dataset['hidden'] !== undefined) return null;
  return {
    view,
    box: el.getBoundingClientRect(),
    size,
    rotation: d.view.rotation,
    scale: d.view.scale,
  };
}

/** The page and page point under a client position in a document's view (null: not on a page). */
export function pagePointAt(docId: string, clientX: number, clientY: number): PagePoint | null {
  const view = viewOf(docId);
  if (!view) return null;
  for (const el of view.querySelectorAll<HTMLElement>('.page[data-page]')) {
    const r = el.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const page = Number(el.dataset['page']);
    const g = geometry(docId, page);
    if (!g) return null;
    const p = toPagePoint({ x: clientX - r.left, y: clientY - r.top }, g.size, g.rotation, g.scale);
    return { docId, page, x: p.x, y: p.y };
  }
  return null;
}

/** Where a page point is on screen (null: its page is not laid out). */
export function clientPointOf(docId: string, page: number, point: Point): Point | null {
  const g = geometry(docId, page);
  if (!g) return null;
  const o = toOffset(point, g.size, g.rotation, g.scale);
  return { x: g.box.left + o.x, y: g.box.top + o.y };
}

/** Whether some of a page is inside its document's view now. */
export function pageInView(docId: string, page: number): boolean {
  const g = geometry(docId, page);
  if (!g) return false;
  const v = g.view.getBoundingClientRect();
  const b = g.box;
  return b.bottom > v.top && b.top < v.bottom && b.right > v.left && b.left < v.right;
}

// --------------------------------------------------- the page last clicked

const lastClicked = new Map<string, number>();

/** DocumentView's pointerdown: remembers the page under the pointer. */
export function notePointerDown(docId: string, target: EventTarget | null): void {
  const el = target instanceof Element ? target.closest<HTMLElement>('.page[data-page]') : null;
  if (el) lastClicked.set(docId, Number(el.dataset['page']));
}

/** Ctrl+V's page: the page last clicked while it is in view, else the view's current page. */
export function pasteTargetPage(docId: string, current: number): number {
  const p = lastClicked.get(docId);
  return p !== undefined && pageInView(docId, p) ? p : current;
}

// ------------------------------------------- the visible part of a page

export interface ClientBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The middle of the part of `box` inside `view` (client px; null: none of it is). Pure. */
export function visibleMiddle(box: ClientBox, view: ClientBox): Point | null {
  const left = Math.max(box.left, view.left);
  const right = Math.min(box.right, view.right);
  const top = Math.max(box.top, view.top);
  const bottom = Math.min(box.bottom, view.bottom);
  if (right <= left || bottom <= top) return null;
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * Ctrl+V's point for a pasted image (M7-08, D-45): the middle of the part of
 * the page in view, in page points; the page's middle when it isn't laid out.
 */
export function visiblePageMiddle(docId: string, page: number): Point | null {
  const g = geometry(docId, page);
  if (!g) {
    const size = pageSizeOf(docId, page);
    return size ? { x: size.width / 2, y: size.height / 2 } : null;
  }
  const mid = visibleMiddle(g.box, g.view.getBoundingClientRect());
  if (!mid) return { x: g.size.width / 2, y: g.size.height / 2 };
  return toPagePoint({ x: mid.x - g.box.left, y: mid.y - g.box.top }, g.size, g.rotation, g.scale);
}
