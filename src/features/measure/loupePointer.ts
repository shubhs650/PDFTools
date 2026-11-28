// The Measure loupe's pointer (M13-02, D-68, ADR-034): the measuring tools'
// pointer handlers report where the pointer is on which page (page points,
// before snapping) and where on screen; the loupe (MeasureLoupe.tsx) draws
// from that. Off the page — over the gap between pages, a pane, outside the
// window — or after a wheel turn, another tool, Space for Hand or another
// document, the loupe hides until the pointer moves over a page again.
// View → Loupe (M13-02·O1) shows it in every other tool too: there the
// pointer is read from the page under it (`trackAnywhere`).
import { createStore, useStore } from 'zustand';
import { appStore, effectiveTool } from '../../app/store/appStore';
import { documentStore } from '../../app/store/documentStore';
import { AUTO_SNAP_TOOLS } from '../../model/autoSnap';
import { displayedToLaid } from '../../model/compare/align/manual';
import type { Pt } from '../../model/scale';
import { setPointerTap } from '../annotate/tools/drawTools';
import { hostStore } from '../view/host';
import { loupeSettingsStore } from './loupeSettings';

/**
 * The line comment tools the loupe also serves (M13-02·O2, D-68): Line, Arrow,
 * Polyline and Callout, whose points snap to the page's geometry. Picking one
 * does not turn snapping on (that stays with the measuring tools, P3).
 */
export const LINE_COMMENT_TOOLS: ReadonlySet<string> = new Set([
  'line',
  'lineArrow',
  'polyline',
  'freeTextCallout',
]);

/**
 * The tools the loupe serves (their pointer handlers report where the
 * pointer is): automatic snapping's (Measure, Calibrate, Scale Viewport) and
 * the line comments (O2).
 */
export const LOUPE_TOOLS: ReadonlySet<string> = new Set([
  ...AUTO_SNAP_TOOLS,
  ...LINE_COMMENT_TOOLS,
]);

export interface LoupePointer {
  docId: string;
  page: number;
  /** Where the pointer is on the page (EmbedPDF points, top-left origin, unturned). */
  pos: Pt;
  /** Where it is in the window (CSS px). */
  client: Pt;
}

export const loupeStore = createStore<{
  pointer: LoupePointer | null;
  /** A point of a placed measurement is being dragged (M14-04): the loupe shows in Select too. */
  editing: boolean;
}>()(() => ({
  pointer: null,
  editing: false,
}));

/** A measurement's point is being dragged (M14-04, D-78). */
export function useLoupeEditing(): boolean {
  return useStore(loupeStore, (s) => s.editing);
}

export function useLoupePointer(): LoupePointer | null {
  return useStore(loupeStore, (s) => s.pointer);
}

/** From a tool's pointer handler: the pointer is at `pos` on `page` of the document in use. */
export function trackLoupe(tool: string, page: number, pos: Pt, evt: unknown): void {
  if (!LOUPE_TOOLS.has(tool)) return;
  const e = evt as { clientX?: unknown; clientY?: unknown } | null | undefined;
  if (typeof e?.clientX !== 'number' || typeof e.clientY !== 'number') return;
  const docId = documentStore.getState().activeId;
  if (!docId) return;
  loupeStore.setState({
    pointer: { docId, page, pos: { x: pos.x, y: pos.y }, client: { x: e.clientX, y: e.clientY } },
  });
}

/** The page as the view lays it out: size (points, unturned), turns, zoom, crop origin. */
export function pageFrame(docId: string, page: number) {
  const d = hostStore.getState().registry?.getStore().getState().core.documents[docId];
  const p = d?.document?.pages[page];
  if (!d || !p) return null;
  return {
    width: p.size.width,
    height: p.size.height,
    rotation: (p.rotation + d.rotation) % 4,
    zoom: d.scale,
    originX: p.boxes?.crop.left ?? 0,
    originY: p.boxes?.crop.bottom ?? 0,
  };
}

/** View → Loupe is on and the tool in use does not report its pointer itself. */
const anywhereNow = (): boolean =>
  loupeSettingsStore.getState().anywhere && !LOUPE_TOOLS.has(effectiveTool(appStore.getState()));

/**
 * View → Loupe (M13-02·O1, D-68): in a tool the loupe does not serve itself,
 * where the pointer is from the page under it. Not over a comparison's
 * overlay window (its page is not the document's own) or while alignment
 * points are picked (that has its own magnifier). Returns false where the
 * pointer is not over a page it can show.
 */
export function trackAnywhere(e: PointerEvent): boolean {
  const target = e.target;
  if (!(target instanceof Element) || !target.closest('.page-content')) return false;
  if (target.closest('.align-pick-layer')) return false;
  const pageEl = target.closest<HTMLElement>('.page[data-page]');
  const view = pageEl?.closest<HTMLElement>('[data-doc-id]');
  const docId = view?.dataset['docId'];
  if (!pageEl || !view || !docId || view.dataset['loupeOff'] !== undefined) return false;
  const page = Number(pageEl.dataset['page']);
  const f = pageFrame(docId, page);
  if (!f || f.zoom <= 0) return false;
  const box = pageEl.getBoundingClientRect();
  const shown = { x: (e.clientX - box.left) / f.zoom, y: (e.clientY - box.top) / f.zoom };
  const pos = displayedToLaid(f.rotation, f.width, f.height, shown);
  loupeStore.setState({ pointer: { docId, page, pos, client: { x: e.clientX, y: e.clientY } } });
  return true;
}

export function hideLoupe(): void {
  if (loupeStore.getState().pointer) loupeStore.setState({ pointer: null });
}

let installed = false;

/** Called once the plugin registry is up (DocumentHost). */
export function installMeasureLoupe(): void {
  if (installed) return;
  installed = true;
  setPointerTap(trackLoupe);
  // View → Loupe in any other tool (O1): before the page's own handlers, which
  // may keep the move to themselves.
  window.addEventListener(
    'pointermove',
    (e) => {
      if (anywhereNow() && !trackAnywhere(e)) hideLoupe();
    },
    { passive: true, capture: true },
  );
  // After the page's own handlers (bubble phase): a move outside every page hides it.
  window.addEventListener(
    'pointermove',
    (e) => {
      if (anywhereNow() || !loupeStore.getState().pointer) return;
      const target = e.target;
      if (!(target instanceof Element) || !target.closest('.page-content')) hideLoupe();
    },
    { passive: true },
  );
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget) hideLoupe(); // out of the window
  });
  // The page moves under a still pointer: shown again with the next move.
  window.addEventListener('wheel', hideLoupe, { passive: true });
  appStore.subscribe((s, prev) => {
    if (s.tool !== prev.tool || s.spaceHand !== prev.spaceHand) hideLoupe();
  });
  loupeSettingsStore.subscribe((s, prev) => {
    if (s.anywhere !== prev.anywhere) hideLoupe();
  });
  documentStore.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) hideLoupe();
  });
}
