// Compare an area (O1, ADR-031 D-60): the two rectangles being drawn in an
// overlay result, one on Document A's window and one on Document B's, on the
// sheet shown or on another (the sheet list moves between them). Compare the
// areas opens them as a comparison tab of their own. Pure transitions plus one
// small store per comparison.
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../../app/store/documentStore';
import { msg, type MessageKey } from '../../../i18n';
import { newAreaComparison, newComparisonId, type PageArea, type SideId } from '../model';

export interface AreaPick {
  /** The side whose window takes a rectangle now, or null. */
  drawing: SideId | null;
  a: PageArea | null;
  b: PageArea | null;
}

/** What to do while a side is being drawn. */
export const DRAW_HINT: Record<SideId, MessageKey> = {
  a: msg('compare.area.drawHint_a'),
  b: msg('compare.area.drawHint_b'),
};

export const NO_PICK: AreaPick = { drawing: null, a: null, b: null };

/** Starts drawing on a side (a rectangle already there is drawn again). */
export const startDrawing = (p: AreaPick, side: SideId): AreaPick => ({ ...p, drawing: side });

export const stopDrawing = (p: AreaPick): AreaPick =>
  p.drawing === null ? p : { ...p, drawing: null };

/** A side's rectangle drawn or typed; drawing goes on to the other side while it has none. */
export function setArea(p: AreaPick, side: SideId, area: PageArea): AreaPick {
  const next = { ...p, [side]: area };
  const other: SideId = side === 'a' ? 'b' : 'a';
  return { ...next, drawing: p.drawing === side && !next[other] ? other : null };
}

/** Both rectangles are there. */
export const pickReady = (p: AreaPick): boolean => !!p.a && !!p.b;

interface AreaStoreState {
  byId: Record<string, AreaPick>;
}

export const areaStore = createStore<AreaStoreState>()(() => ({ byId: {} }));

export function useAreaPick(id: string): AreaPick {
  return useStore(areaStore, (s) => s.byId[id] ?? NO_PICK);
}

export function updatePick(id: string, fn: (p: AreaPick) => AreaPick): void {
  areaStore.setState((s) => {
    const cur = s.byId[id] ?? NO_PICK;
    const next = fn(cur);
    return next === cur ? {} : { byId: { ...s.byId, [id]: next } };
  });
}

let watching = false;

/** A comparison that closed forgets its rectangles. */
function watchClosing(): void {
  if (watching) return;
  watching = true;
  documentStore.subscribe((s) => {
    const gone = Object.keys(areaStore.getState().byId).filter((id) => !s.comparisons[id]);
    if (gone.length === 0) return;
    areaStore.setState((st) => ({
      byId: Object.fromEntries(Object.entries(st.byId).filter(([k]) => !gone.includes(k))),
    }));
  });
}

/** Starts drawing the first rectangle missing (A's first), from the panel or the ribbon. */
export function beginAreas(id: string): void {
  watchClosing();
  updatePick(id, (p) => startDrawing(p, p.a && !p.b ? 'b' : 'a'));
}

/**
 * Opens the two rectangles as a comparison of their own, after this one's tab
 * (O1): an overlay of A's page and B's page, limited to the rectangles. The
 * rectangles stay, to compare them again or draw them again.
 */
export function compareAreas(id: string): string | null {
  const p = areaStore.getState().byId[id];
  if (!p?.a || !p.b) return null;
  const cid = newComparisonId();
  updatePick(id, stopDrawing);
  documentStore.getState().openComparison(newAreaComparison(cid, p.a, p.b));
  return cid;
}
