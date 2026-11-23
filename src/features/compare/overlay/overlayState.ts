// The overlay view's state per comparison (M12-11, D-59): the sheet shown,
// the colours and the floating bar's switches, the comment and layer
// switches, and the Review layout's layout, splitters and lock (M12-12,
// D-62). Pure transitions plus one small store; the overlay window reads it
// and asks the Render worker for tiles. The zoom is the windows' own
// (EmbedPDF's, per document).
import { createStore, useStore } from 'zustand';
import type { SheetAlignment } from '../../../model/compare/align/aligner';
import { IDENTITY, type Affine } from '../../../model/compare/material';
import {
  DEFAULT_STYLE,
  PRESETS,
  darkOverlap,
  type ColourPreset,
  type OverlayStyle,
  type Rgb,
} from '../../../model/compare/overlay';
import { DEFAULT_SPLITS, type Splits } from '../../../model/compare/link';
import type { PairRow } from '../../../model/compare/pairing';
import type { LayerList } from '../../../model/ocg';
import type { LayerStates } from '../../../workers/shared/layerCopy';
import type { SidePage } from '../engine/session';
import type { ManualAlign } from '../align/manualAlign';

/** A sheet of the result: a pair of pages, or a page only one revision has. */
export interface Sheet {
  a: SidePage | null;
  b: SidePage | null;
  /** The sheet's index in the session's compared pairs (both sides present), else null. */
  pair: number | null;
}

/** The sheets of a pairing table, in its order; sheets left out of the comparison are skipped. */
export function sheetsOf(rows: readonly PairRow[], pages: Record<'a' | 'b', SidePage[]>): Sheet[] {
  const out: Sheet[] = [];
  let pair = 0;
  for (const r of rows) {
    if (r.excluded) continue;
    const a = r.a === null ? null : (pages.a[r.a] ?? null);
    const b = r.b === null ? null : (pages.b[r.b] ?? null);
    if (!a && !b) continue;
    out.push({ a, b, pair: a && b ? pair++ : null });
  }
  return out;
}

/** The result's layout (D-62, Q14): the overlay alone, or the overlay with A and B. */
export type ReviewLayout = 'review' | 'overlay';

export interface OverlayView {
  sheet: number;
  /** Review (a result opens in it) or Overlay only. */
  layout: ReviewLayout;
  /** The Review layout's splitters. */
  splits: Splits;
  /** The windows stay on the same spot of the drawing (D-62, Q21: on by default). */
  lock: boolean;
  style: OverlayStyle;
  thicken: boolean;
  /** Comments of each document on top, and Hide check highlights (D-59, Q10, Q11). */
  comments: { a: boolean; b: boolean; hideChecks: boolean };
  /** Blink (hold X): the side shown alone while held, flipping; null when not blinking. */
  blink: 'a' | 'b' | null;
  /** Each compared pair's alignment as the session finds it (M12-10); as is until then. */
  aligned: Record<number, SheetAlignment>;
  /** Manual alignment of the sheet shown, while it is being set (M12-13); null otherwise. */
  manual: ManualAlign | null;
  /**
   * Layer switches per document (D-59, Q24): a layer's object number → shown,
   * only where it differs from the file's default. The overlay and the
   * analysis draw the document with them.
   */
  layers: Record<string, LayerStates>;
  /**
   * The "Vector overlay (beta)" display mode (M12-16, D-59): the sheet drawn
   * from the vector overlay PDF's page, as Export Overlay… writes it. Colours,
   * alignment, layers and show/hide apply; balance, Fade unchanged, Thicken
   * thin lines and Blink are the screen drawing's own and are off.
   */
  vector: boolean;
}

export const DEFAULT_VIEW: OverlayView = {
  sheet: 0,
  layout: 'review',
  splits: DEFAULT_SPLITS,
  lock: true,
  style: DEFAULT_STYLE,
  thicken: false,
  comments: { a: true, b: true, hideChecks: false },
  blink: null,
  aligned: {},
  manual: null,
  layers: {},
  vector: false,
};

/** The style the tiles are drawn with: Blink shows one side alone. */
export function drawnStyle(v: OverlayView): OverlayStyle {
  // The vector page is drawn as it is; only show/hide decide its comments.
  if (v.vector) return { ...v.style, balance: 0, fade: 0 };
  if (v.blink === null) return v.style;
  return { ...v.style, showA: v.blink === 'a', showB: v.blink === 'b', balance: 0, fade: 0 };
}

/** The sheet's alignment, once found (pairs only). */
export const alignmentOf = (v: OverlayView, s: Sheet | undefined): SheetAlignment | undefined =>
  s?.pair === null || s?.pair === undefined ? undefined : v.aligned[s.pair];

/** Where A is drawn in B's frame: the alignment being set by hand, the alignment found, else as is (D-60). */
export const placeOf = (v: OverlayView, s: Sheet | undefined): Affine =>
  (v.manual && s?.pair === v.manual.pair ? v.manual.place : null) ??
  alignmentOf(v, s)?.place ??
  IDENTITY;

/** The display mode (M12-16): the vector page, or the two tinted revisions. */
export const setVector = (v: OverlayView, on: boolean): OverlayView =>
  v.vector === on ? v : { ...v, vector: on, blink: null };

/** A sheet's alignment arrived (the session's watchAlignment). */
export const setAligned = (v: OverlayView, pair: number, al: SheetAlignment): OverlayView => ({
  ...v,
  aligned: { ...v.aligned, [pair]: al },
});

/** A sheet's alignment is not known (set by hand, then given back before the automatic one came). */
export const dropAligned = (v: OverlayView, pair: number): OverlayView => {
  if (!(pair in v.aligned)) return v;
  const aligned = Object.fromEntries(
    Object.entries(v.aligned).filter(([k]) => k !== String(pair)),
  ) as Record<number, SheetAlignment>;
  return { ...v, aligned };
};

export const setPreset = (v: OverlayView, p: ColourPreset): OverlayView => ({
  ...v,
  style: { ...v.style, colA: PRESETS[p].a, colB: PRESETS[p].b },
});

export const setColour = (v: OverlayView, side: 'a' | 'b', c: Rgb): OverlayView => ({
  ...v,
  style: { ...v.style, [side === 'a' ? 'colA' : 'colB']: c },
});

/** The custom-colour warning (D-59): the two colours would not give a dark overlap. */
export const overlapWarning = (v: OverlayView): boolean => !darkOverlap(v.style.colA, v.style.colB);

export const toggleSide = (v: OverlayView, side: 'a' | 'b'): OverlayView => {
  const key = side === 'a' ? 'showA' : 'showB';
  return { ...v, style: { ...v.style, [key]: !v.style[key] } };
};

export const setBalance = (v: OverlayView, balance: number): OverlayView => ({
  ...v,
  style: { ...v.style, balance: Math.max(-1, Math.min(1, Math.round(balance * 10) / 10)) },
});

export const setFade = (v: OverlayView, on: boolean): OverlayView => ({
  ...v,
  style: { ...v.style, fade: on ? 1 : 0 },
});

/** Another sheet (its windows fit it again); a manual alignment not applied is left. */
export const goSheet = (v: OverlayView, sheet: number, count: number): OverlayView => {
  const s = Math.max(0, Math.min(count - 1, sheet));
  return s === v.sheet ? v : { ...v, sheet: s, manual: null };
};

/** Overlay only has no Document A and B windows to pick points in. */
export const setLayout = (v: OverlayView, layout: ReviewLayout): OverlayView =>
  v.layout === layout
    ? v
    : {
        ...v,
        layout,
        manual: v.manual && layout === 'overlay' ? { ...v.manual, picking: false } : v.manual,
      };

export const setSplits = (v: OverlayView, splits: Partial<Splits>): OverlayView => ({
  ...v,
  splits: { ...v.splits, ...splits },
});

export const setLock = (v: OverlayView, lock: boolean): OverlayView =>
  v.lock === lock ? v : { ...v, lock };

interface OverlayStoreState {
  byId: Record<string, OverlayView>;
}

export const overlayStore = createStore<OverlayStoreState>()(() => ({ byId: {} }));

export function useOverlayView(id: string): OverlayView {
  return useStore(overlayStore, (s) => s.byId[id] ?? DEFAULT_VIEW);
}

export function overlayView(id: string): OverlayView {
  return overlayStore.getState().byId[id] ?? DEFAULT_VIEW;
}

export function updateView(id: string, fn: (v: OverlayView) => OverlayView): void {
  overlayStore.setState((s) => {
    const cur = s.byId[id] ?? DEFAULT_VIEW;
    const next = fn(cur);
    return next === cur ? {} : { byId: { ...s.byId, [id]: next } };
  });
}

export function dropView(id: string): void {
  if (!overlayStore.getState().byId[id]) return;
  overlayStore.setState((s) => ({
    byId: Object.fromEntries(Object.entries(s.byId).filter(([k]) => k !== id)),
  }));
}

/**
 * Shows or hides a layer of a document (D-59, Q24). A switch back to the
 * file's default is dropped, so a document with every layer at its default
 * has no entry (and is drawn from the file itself).
 */
export function setLayer(
  v: OverlayView,
  docId: string,
  layer: { id: number; on: boolean },
  shown: boolean,
): OverlayView {
  const cur = Object.fromEntries(
    Object.entries(v.layers[docId] ?? {}).filter(([k]) => k !== String(layer.id)),
  ) as Record<number, boolean>;
  if (shown !== layer.on) cur[layer.id] = shown;
  const layers = Object.fromEntries(Object.entries(v.layers).filter(([k]) => k !== docId));
  if (Object.keys(cur).length) layers[docId] = cur;
  return { ...v, layers };
}

/** Every layer of a document back to the file's defaults. */
export function resetLayers(v: OverlayView, docId: string): OverlayView {
  if (!(docId in v.layers)) return v;
  return {
    ...v,
    layers: Object.fromEntries(Object.entries(v.layers).filter(([k]) => k !== docId)),
  };
}

/** Whether a layer is shown in the overlay: its switch, else the file's default. */
export const layerShown = (
  v: OverlayView,
  docId: string,
  layer: { id: number; on: boolean },
): boolean => v.layers[docId]?.[layer.id] ?? layer.on;

/** Names of layers that are on by default in one list and off in the other (D-59, Q24). */
export function differingDefaults(a: LayerList | null, b: LayerList | null): string[] {
  if (!a || !b) return [];
  const onIn = (l: LayerList): Map<string, boolean> => new Map(l.layers.map((x) => [x.name, x.on]));
  const mb = onIn(b);
  const out: string[] = [];
  for (const [name, on] of onIn(a)) {
    const other = mb.get(name);
    if (other !== undefined && other !== on) out.push(name);
  }
  return out;
}
