// Visual signatures (M6-13, ADR-021 D-40 b, ADR-022 decision 3, §7.11): what a
// signature or initials entry may hold, how saved entries are checked when
// they come back from IndexedDB, and the pixel steps for typed and uploaded
// images (run by the encoder worker: making a white background transparent,
// cropping to the ink). Pure. These are pictures placed as standard Ink and
// Stamp annotations, never certificate-based digital signatures.

/** How an entry's picture was made (the plugin's SignatureCreationType values). */
export type SignatureMethod = 'draw' | 'type' | 'upload';

/** A drawn signature: strokes in the pad's CSS px, top-left origin. */
export interface InkField {
  creationType: 'draw';
  label?: string;
  previewDataUrl: string;
  inkData: {
    inkList: { points: { x: number; y: number }[] }[];
    strokeWidth: number;
    strokeColor: string;
    size: { width: number; height: number };
  };
}

/** A typed or uploaded signature: a PNG, base64 when stored. */
export interface ImageField<D> {
  creationType: 'type' | 'upload';
  label?: string;
  previewDataUrl: string;
  imageMimeType: 'image/png';
  imageSize: { width: number; height: number };
  imageData: D;
}

export type StoredField = InkField | ImageField<string>;

export interface StoredEntry {
  id: string;
  createdAt: number;
  signature: StoredField;
  initials?: StoredField;
}

/** The record in IndexedDB `visualSignatures` (key: the entry's id). */
export interface StoredSignatureRecord {
  v: typeof SIGNATURE_RECORD_VERSION;
  entry: StoredEntry;
}

export const SIGNATURE_RECORD_VERSION = 1;

/** Saved signatures kept on this device (the oldest is dropped beyond this). */
export const MAX_SAVED_SIGNATURES = 8;

/** Largest image file accepted for Upload (decimal MB, as the app shows sizes). */
export const SIGNATURE_UPLOAD_MAX_BYTES = 10 * 1000 * 1000;

/** Longest edge of an uploaded or typed picture after scaling, in px. */
export const SIGNATURE_MAX_EDGE = 1200;

/** The box a placed signature fits in at first, in points (resizable afterwards). */
export const SIGNATURE_PLACE_SIZE = { width: 150, height: 50 } as const;

/** Typed name and initials: at most this many characters. */
export const MAX_TYPED_LENGTH = 64;
export const MAX_INITIALS_LENGTH = 5;

/** Ink colours offered (signatures are black or blue ink; the user's choice). */
export const SIGNATURE_COLORS = { black: '#000000', blue: '#0B3D91' } as const;
export type SignatureColor = keyof typeof SIGNATURE_COLORS;

/** Pen widths for Draw, in the pad's CSS px. */
export const PEN_WIDTHS = { thin: 2, medium: 3, thick: 5 } as const;
export type PenWidth = keyof typeof PEN_WIDTHS;

/** Font size the typed pictures are drawn at, in px (about 3 px per point when placed). */
export const TYPED_FONT_PX = 96;

// ---- checking saved entries -----------------------------------------------------

const LIMIT = { strokes: 200, points: 5000, size: 4000, base64: 4 * 1000 * 1000 } as const;

/** What a stored value might hold: every key optional and unknown (checked one by one). */
interface Loose {
  v?: unknown;
  entry?: unknown;
  id?: unknown;
  createdAt?: unknown;
  signature?: unknown;
  initials?: unknown;
  creationType?: unknown;
  label?: unknown;
  inkData?: unknown;
  inkList?: unknown;
  points?: unknown;
  x?: unknown;
  y?: unknown;
  strokeWidth?: unknown;
  strokeColor?: unknown;
  size?: unknown;
  width?: unknown;
  height?: unknown;
  imageMimeType?: unknown;
  imageSize?: unknown;
  imageData?: unknown;
}

const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const HEX = /^#[0-9a-f]{6}$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function size(v: unknown): { width: number; height: number } | null {
  if (!isObj(v)) return null;
  const { width, height } = v;
  if (!finite(width) || !finite(height)) return null;
  if (width <= 0 || height <= 0 || width > LIMIT.size || height > LIMIT.size) return null;
  return { width, height };
}

const label = (v: unknown): { label?: string } =>
  typeof v === 'string' && v.length <= MAX_TYPED_LENGTH ? { label: v } : {};

/** One field as stored, or null when anything about it is off. */
export function parseField(v: unknown): StoredField | null {
  if (!isObj(v)) return null;
  if (v.creationType === 'draw') {
    const ink = v.inkData;
    if (!isObj(ink) || !Array.isArray(ink.inkList)) return null;
    if (ink.inkList.length === 0 || ink.inkList.length > LIMIT.strokes) return null;
    const inkList: InkField['inkData']['inkList'] = [];
    for (const s of ink.inkList as unknown[]) {
      if (!isObj(s) || !Array.isArray(s.points)) return null;
      const pts = s.points as unknown[];
      if (pts.length < 2 || pts.length > LIMIT.points) return null;
      const points: { x: number; y: number }[] = [];
      for (const p of pts) {
        if (!isObj(p) || !finite(p.x) || !finite(p.y)) return null;
        points.push({ x: p.x, y: p.y });
      }
      inkList.push({ points });
    }
    const box = size(ink.size);
    const w = ink.strokeWidth;
    const c = ink.strokeColor;
    if (!box || !finite(w) || w <= 0 || w > 40 || typeof c !== 'string' || !HEX.test(c))
      return null;
    return {
      creationType: 'draw',
      ...label(v.label),
      previewDataUrl: '',
      inkData: { inkList, strokeWidth: w, strokeColor: c, size: box },
    };
  }
  if (v.creationType === 'type' || v.creationType === 'upload') {
    const box = size(v.imageSize);
    const data = v.imageData;
    if (!box || v.imageMimeType !== 'image/png') return null;
    if (typeof data !== 'string' || data.length === 0 || data.length > LIMIT.base64) return null;
    if (!BASE64.test(data)) return null;
    return {
      creationType: v.creationType,
      ...label(v.label),
      previewDataUrl: '',
      imageMimeType: 'image/png',
      imageSize: box,
      imageData: data,
    };
  }
  return null;
}

/** A saved record, or null (an unknown version or a damaged entry is skipped). */
export function parseSignatureRecord(v: unknown): StoredEntry | null {
  if (!isObj(v) || v.v !== SIGNATURE_RECORD_VERSION || !isObj(v.entry)) return null;
  const e = v.entry;
  if (typeof e.id !== 'string' || e.id.length === 0 || e.id.length > 64) return null;
  if (!finite(e.createdAt)) return null;
  const signature = parseField(e.signature);
  if (!signature) return null;
  const initials = e.initials === undefined ? undefined : parseField(e.initials);
  if (initials === null) return null;
  return { id: e.id, createdAt: e.createdAt, signature, ...(initials ? { initials } : {}) };
}

/** Newest first; at most MAX_SAVED_SIGNATURES (the ids beyond it are to be deleted). */
export function keepNewest(entries: readonly StoredEntry[]): {
  kept: StoredEntry[];
  dropped: string[];
} {
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
  return {
    kept: sorted.slice(0, MAX_SAVED_SIGNATURES),
    dropped: sorted.slice(MAX_SAVED_SIGNATURES).map((e) => e.id),
  };
}

// ---- typed text -----------------------------------------------------------------

const clean = (s: string): string => s.replace(/\s+/gu, ' ').trim();

/** What Type draws: the text tidied and cut to `max` characters (null: nothing to draw). */
export function typedText(s: string, max = MAX_TYPED_LENGTH): string | null {
  const t = Array.from(clean(s)).slice(0, max).join('');
  return t.length > 0 ? t : null;
}

// ---- pixels (encoder worker) --------------------------------------------------------

/** Pixels whose darkest channel is at least this light become fully transparent … */
export const WHITE_CUTOFF = 235;
/** … and from here down to the cut-off they fade (soft edges, no white fringe). */
export const WHITE_SOFT = 190;

/**
 * Makes a white (or near-white) background transparent in place: an RGBA
 * pixel's alpha is scaled by how far its lightest-looking channel is from
 * white, so paper turns clear and the ink keeps its colour and edges.
 */
export function clearWhiteBackground(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const min = Math.min(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0);
    if (min >= WHITE_CUTOFF) rgba[i + 3] = 0;
    else if (min > WHITE_SOFT) {
      const keep = (WHITE_CUTOFF - min) / (WHITE_CUTOFF - WHITE_SOFT);
      rgba[i + 3] = Math.round((rgba[i + 3] ?? 0) * keep);
    }
  }
}

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The smallest box holding every pixel with alpha above `minAlpha`, grown by
 * `pad` px and kept inside the image; null when nothing is visible.
 */
export function inkBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  pad = 4,
  minAlpha = 8,
): PixelBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if ((rgba[row + x * 4 + 3] ?? 0) <= minAlpha) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  return {
    x,
    y,
    width: Math.min(width, maxX + pad + 1) - x,
    height: Math.min(height, maxY + pad + 1) - y,
  };
}

/** `size` scaled down (never up) so its longest edge is at most `max`, in whole px. */
export function fitEdge(
  s: { width: number; height: number },
  max = SIGNATURE_MAX_EDGE,
): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(s.width, s.height));
  return {
    width: Math.max(1, Math.round(s.width * k)),
    height: Math.max(1, Math.round(s.height * k)),
  };
}

/** The SVG path of a drawn field's strokes (the dialog's previews; no canvas needed). */
export function inkPath(ink: InkField['inkData']): string {
  const n = (v: number): string => String(Math.round(v * 10) / 10);
  return ink.inkList
    .map((s) => s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`).join(' '))
    .join(' ');
}
