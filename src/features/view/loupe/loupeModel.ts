// The shared loupe's geometry and settings (M13-02, D-68, ADR-034). Pure: where
// the loupe sits beside the pointer (flipping near the window's edges), which
// region of the page it asks the Render worker for (the loupe's square plus a
// margin, so small pointer moves pan the picture already drawn instead of
// asking again), and the settings kept on this device.

export interface Pt {
  x: number;
  y: number;
}

/** Requests made and pictures shown (all loupes), for the perf scenario's probe. */
export const loupeStats = { requests: 0, drawn: 0 };

export type LoupeSize = 'small' | 'medium' | 'large';
export type LoupeMag = 2 | 4 | 8;

/** The loupe's side in CSS px, per size. */
export const LOUPE_SIDES: Record<LoupeSize, number> = { small: 128, medium: 176, large: 240 };
export const LOUPE_MAGS: readonly LoupeMag[] = [2, 4, 8];
export const LOUPE_SIZE_LIST: readonly LoupeSize[] = ['small', 'medium', 'large'];

export interface LoupeSettings {
  /** The loupe shows with the measuring tools (Measure ribbon, Snap group). */
  on: boolean;
  size: LoupeSize;
  /** How much larger than the window the loupe shows the page. */
  mag: LoupeMag;
  /** Picking a measuring tool turns snapping on (and back afterwards). */
  autoSnap: boolean;
  /** View → Loupe (M13-02·O1): the loupe in every tool, off by default. */
  anywhere: boolean;
}

export const DEFAULT_LOUPE: LoupeSettings = {
  on: true,
  size: 'medium',
  mag: 4,
  autoSnap: true,
  anywhere: false,
};

/**
 * Is the loupe shown with `tool`? In every tool while View → Loupe is on
 * (M13-02·O1); otherwise with the tools it serves (`served`: Measure,
 * Calibrate, Scale Viewport) while the Measure ribbon's Loupe is on.
 */
export function loupeShown(s: LoupeSettings, tool: string, served: ReadonlySet<string>): boolean {
  return s.anywhere || (s.on && served.has(tool));
}

/** Stored settings (localStorage JSON) → settings; anything not valid falls back to the default. */
export function parseLoupeSettings(raw: string | null): LoupeSettings {
  if (!raw) return { ...DEFAULT_LOUPE };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LOUPE };
  }
  if (!v || typeof v !== 'object') return { ...DEFAULT_LOUPE };
  const o = v as Record<string, unknown>;
  const size = o['size'];
  const mag = o['mag'];
  return {
    on: typeof o['on'] === 'boolean' ? o['on'] : DEFAULT_LOUPE.on,
    size:
      typeof size === 'string' && (LOUPE_SIZE_LIST as readonly string[]).includes(size)
        ? (size as LoupeSize)
        : DEFAULT_LOUPE.size,
    mag:
      typeof mag === 'number' && (LOUPE_MAGS as readonly number[]).includes(mag)
        ? (mag as LoupeMag)
        : DEFAULT_LOUPE.mag,
    autoSnap: typeof o['autoSnap'] === 'boolean' ? o['autoSnap'] : DEFAULT_LOUPE.autoSnap,
    anywhere: typeof o['anywhere'] === 'boolean' ? o['anywhere'] : DEFAULT_LOUPE.anywhere,
  };
}

/** Gap between the pointer and the loupe (CSS px), and the least distance from the window's edge. */
export const LOUPE_GAP = 24;
const EDGE = 4;

/**
 * Above and to the right of the pointer; below it near the window's top, to its
 * left near the right edge; always inside the window.
 */
export function loupePlace(
  client: Pt,
  side: number,
  view: { width: number; height: number },
): { left: number; top: number } {
  let left = client.x + LOUPE_GAP;
  if (left + side > view.width - EDGE) left = client.x - LOUPE_GAP - side;
  let top = client.y - LOUPE_GAP - side;
  if (top < EDGE) top = client.y + LOUPE_GAP;
  left = Math.max(EDGE, Math.min(left, view.width - EDGE - side));
  top = Math.max(EDGE, Math.min(top, view.height - EDGE - side));
  return { left, top };
}

/** A region of the page drawn at `scale` device px per point: its device-pixel box. */
export interface LoupeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

/**
 * The region to draw for the loupe centred on `center` (points): a square of
 * `px` device pixels (the loupe's side) plus `margin` × side on each side.
 */
export function loupeRegion(center: Pt, scale: number, px: number, margin: number): LoupeRegion {
  const side = Math.round(px * (1 + 2 * margin));
  return {
    x: Math.round(center.x * scale - side / 2),
    y: Math.round(center.y * scale - side / 2),
    width: side,
    height: side,
    scale,
  };
}

/** The region drawn still holds the whole loupe centred on `center` at `scale`. */
export function covers(r: LoupeRegion, center: Pt, scale: number, px: number): boolean {
  if (r.scale !== scale) return false;
  const cx = center.x * scale;
  const cy = center.y * scale;
  return (
    cx - px / 2 >= r.x &&
    cy - px / 2 >= r.y &&
    cx + px / 2 <= r.x + r.width &&
    cy + px / 2 <= r.y + r.height
  );
}
