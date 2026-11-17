// Each file's last view (M11-08·O3, D-53): the page, zoom, layout and view
// rotation a file was left at, kept on this device by document fingerprint and
// restored when the same file is opened again. Pure: what is stored, how a
// stored record is read back (it may come from an older version, or be damaged)
// and how it fits a file that now has fewer pages.
import type { Rotation, ViewMode, ViewState, ZoomSetting } from '../../app/store/documentStore';
import { VIEW_MODES } from './viewModes';
import { clampZoom } from './zoom';

/** Record version: bump when the shape changes (old records are then ignored). */
export const LAST_VIEW_VERSION = 1;

export interface LastView {
  v: typeof LAST_VIEW_VERSION;
  /** 0-based page. */
  page: number;
  /** The user's zoom choice: a factor or a fit mode. */
  zoom: ZoomSetting;
  mode: ViewMode;
  rotation: Rotation;
  /** Epoch ms; the oldest records are dropped first. */
  savedAt: number;
}

const FIT_MODES: ReadonlySet<unknown> = new Set(['fitPage', 'fitWidth', 'fitVisible']);
const ROTATIONS: ReadonlySet<unknown> = new Set([0, 90, 180, 270]);
const MODES: ReadonlySet<unknown> = new Set(VIEW_MODES);

/** The record for a document's view now. */
export function lastViewOf(view: ViewState, now: number): LastView {
  return {
    v: LAST_VIEW_VERSION,
    page: view.page,
    zoom: view.zoom,
    mode: view.mode,
    rotation: view.rotation,
    savedAt: now,
  };
}

type Remembered = Pick<ViewState, 'page' | 'zoom' | 'mode' | 'rotation'>;

/** The same place, layout and zoom (a record's time and a fit mode's resolved scale aside). */
export function sameView(a: Remembered | undefined, b: Remembered): boolean {
  return a?.page === b.page && a.zoom === b.zoom && a.mode === b.mode && a.rotation === b.rotation;
}

/** A stored record, or null when it is not one this version can use. */
export function parseLastView(raw: unknown): LastView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const { page, zoom, mode, rotation, savedAt } = r;
  if (r['v'] !== LAST_VIEW_VERSION) return null;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 0) return null;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
  if (!MODES.has(mode) || !ROTATIONS.has(rotation)) return null;
  let z: ZoomSetting;
  if (typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0) z = clampZoom(zoom);
  else if (FIT_MODES.has(zoom)) z = zoom as ZoomSetting;
  else return null;
  return {
    v: LAST_VIEW_VERSION,
    page,
    zoom: z,
    mode: mode as ViewMode,
    rotation: rotation as Rotation,
    savedAt,
  };
}

/** The view for a file of `pageCount` pages: a page past the end becomes the last page. */
export function fitToDocument(view: LastView, pageCount: number): LastView {
  return { ...view, page: Math.max(0, Math.min(view.page, pageCount - 1)) };
}
