// The Measure loupe's pointer (M13-02, D-68, ADR-034): the measuring tools'
// pointer handlers report where the pointer is on which page (page points,
// before snapping) and where on screen; the loupe (MeasureLoupe.tsx) draws
// from that. Off the page — over the gap between pages, a pane, outside the
// window — or after a wheel turn, another tool, Space for Hand or another
// document, the loupe hides until the pointer moves over a page again.
import { createStore, useStore } from 'zustand';
import { appStore } from '../../app/store/appStore';
import { documentStore } from '../../app/store/documentStore';
import { AUTO_SNAP_TOOLS } from '../../model/autoSnap';
import type { Pt } from '../../model/scale';
import { setPointerTap } from '../annotate/tools/drawTools';

/** The tools the loupe serves: the same as automatic snapping's (Measure, Calibrate, Scale Viewport). */
export const LOUPE_TOOLS: ReadonlySet<string> = AUTO_SNAP_TOOLS;

export interface LoupePointer {
  docId: string;
  page: number;
  /** Where the pointer is on the page (EmbedPDF points, top-left origin, unturned). */
  pos: Pt;
  /** Where it is in the window (CSS px). */
  client: Pt;
}

export const loupeStore = createStore<{ pointer: LoupePointer | null }>()(() => ({
  pointer: null,
}));

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

export function hideLoupe(): void {
  if (loupeStore.getState().pointer) loupeStore.setState({ pointer: null });
}

let installed = false;

/** Called once the plugin registry is up (DocumentHost). */
export function installMeasureLoupe(): void {
  if (installed) return;
  installed = true;
  setPointerTap(trackLoupe);
  // After the page's own handlers (bubble phase): a move outside every page hides it.
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!loupeStore.getState().pointer) return;
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
  documentStore.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) hideLoupe();
  });
}
