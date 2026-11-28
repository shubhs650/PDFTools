// Count (M14-07, D-75, plan M14 §7; ADR-035 Amendment 1: a Stamp whose
// appearance is entirely ours). Each click places one small symbol markup,
// tagged with its count group, with its number beside it inside the same
// markup ("Door 7", Q11). Groups (Q14) have a name, a symbol shape, a colour
// and a size, and are chosen before clicking. Numbers start at 1 per group and
// run across every page; a deleted count leaves its gap, the next new one
// takes the highest number plus one, and "Renumber group" closes the gaps when
// asked (Q15). Pure.
//
// The symbol is drawn about its centre; offsets are worked out in a y-up frame
// and turned with `ySign` (1: PDF user space, y up; -1: EmbedPDF's page
// points, y down), so the Render worker and the screen draw the same shape.
import { bounds, type Box, type CaptionBox, type Pt } from './measureGeometry';

export type CountShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'tick';

export const COUNT_SHAPES: readonly CountShape[] = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'cross',
  'tick',
];

export const isCountShape = (s: unknown): s is CountShape =>
  typeof s === 'string' && (COUNT_SHAPES as readonly string[]).includes(s);

/** A count group (Q14): its markups carry its name, shape, colour and size. */
export interface CountGroup {
  name: string;
  shape: CountShape;
  /** `#rrggbb`. */
  color: string;
  /** The symbol's width and height, points. */
  size: number;
}

/** The symbol sizes offered (points); 12 by default. */
export const COUNT_SIZES: readonly number[] = [8, 10, 12, 16, 20, 24];
export const DEFAULT_COUNT_SIZE = 12;
export const MIN_COUNT_SIZE = 4;
export const MAX_COUNT_SIZE = 72;

/** Longest group name kept (it is the start of every count's text). */
export const MAX_GROUP_NAME = 60;

const HEX = /^#[0-9A-Fa-f]{6}$/u;

/** Whitespace to tidy: at either end, runs, or anything but a plain space. */
const UNTIDY = /^\s|\s$|\s\s|[^\S ]/u;

/**
 * A group's name as kept: trimmed, single spaces, at most MAX_GROUP_NAME
 * characters. Read for every count on every change, so a tidy name costs one test.
 */
export function cleanGroupName(s: string): string {
  const tidy = UNTIDY.test(s) ? s.replace(/\s+/gu, ' ').trim() : s;
  // Fewer UTF-16 units than the cap: fewer characters too.
  return tidy.length <= MAX_GROUP_NAME ? tidy : Array.from(tidy).slice(0, MAX_GROUP_NAME).join('');
}

/** A well-formed group, or null. */
export function groupOf(v: unknown): CountGroup | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const name = typeof r['name'] === 'string' ? cleanGroupName(r['name']) : '';
  const size = r['size'];
  if (
    !name ||
    !isCountShape(r['shape']) ||
    typeof r['color'] !== 'string' ||
    !HEX.test(r['color']) ||
    typeof size !== 'number' ||
    !Number.isFinite(size)
  )
    return null;
  return {
    name,
    shape: r['shape'],
    color: r['color'],
    size: Math.min(MAX_COUNT_SIZE, Math.max(MIN_COUNT_SIZE, size)),
  };
}

export const sameGroupName = (a: string, b: string): boolean =>
  cleanGroupName(a).toLocaleLowerCase() === cleanGroupName(b).toLocaleLowerCase();

/** The number the next count of a group takes: the highest it has plus one (Q15), else 1. */
export function nextNumber(numbers: Iterable<number>): number {
  let max = 0;
  for (const n of numbers) if (Number.isFinite(n) && n > max) max = Math.floor(n);
  return max + 1;
}

/** One count as Renumber sees it. */
export interface Counted {
  id: string;
  n: number;
  /** 0-based. */
  page: number;
  /** Its centre (page points): the order of counts that share a number. */
  at: Pt;
}

/**
 * Renumber group (Q15): the group's counts numbered 1, 2, 3 … in the order of
 * their numbers now (so the gaps close and nothing else moves); counts that
 * share a number keep page order, then top to bottom, left to right. Returns
 * only the counts whose number changes.
 */
export function renumber(counts: readonly Counted[]): { id: string; n: number }[] {
  const order = [...counts].sort(
    (a, b) =>
      a.n - b.n ||
      a.page - b.page ||
      Math.round(a.at.y) - Math.round(b.at.y) ||
      a.at.x - b.at.x ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const out: { id: string; n: number }[] = [];
  order.forEach((c, i) => {
    if (c.n !== i + 1) out.push({ id: c.id, n: i + 1 });
  });
  return out;
}

/** Whether a group's numbers have gaps (or repeats): Renumber would change something. */
export const hasGaps = (counts: readonly Counted[]): boolean => renumber(counts).length > 0;

/** What a count's symbol draws (the same on screen and in the file). */
export interface CountSymbol {
  /** Closed outlines (stroked, with the see-through fill). */
  closed: Pt[][];
  /** Open strokes (a cross, a tick). */
  open: Pt[][];
  /** A circle's centre and radius. */
  circle: { c: Pt; r: number } | null;
  /** The line width. */
  width: number;
}

/** A symbol's line width: thin for a small one, never under 1 pt. */
export const symbolWidth = (size: number): number =>
  Math.max(1, Math.round((size / 10) * 100) / 100);

/** The symbol of `shape`, `size` points across, about `c`. */
export function countSymbol(shape: CountShape, c: Pt, size: number, ySign: 1 | -1): CountSymbol {
  const h = size / 2;
  const at = (dx: number, dy: number): Pt => ({ x: c.x + dx * h, y: c.y + dy * h * ySign });
  const width = symbolWidth(size);
  const out: CountSymbol = { closed: [], open: [], circle: null, width };
  switch (shape) {
    case 'circle':
      out.circle = { c, r: h };
      break;
    case 'square':
      out.closed.push([at(-0.85, -0.85), at(0.85, -0.85), at(0.85, 0.85), at(-0.85, 0.85)]);
      break;
    case 'triangle':
      // Pointing up; its middle on the centre.
      out.closed.push([at(0, 1), at(1, -0.75), at(-1, -0.75)]);
      break;
    case 'diamond':
      out.closed.push([at(0, 1), at(1, 0), at(0, -1), at(-1, 0)]);
      break;
    case 'cross':
      out.open.push([at(-0.8, -0.8), at(0.8, 0.8)], [at(-0.8, 0.8), at(0.8, -0.8)]);
      break;
    case 'tick':
      out.open.push([at(-0.9, 0.05), at(-0.3, -0.65), at(0.9, 0.75)]);
      break;
  }
  return out;
}

/** Space between the symbol and its number (points). */
export const NUMBER_GAP = 2;

/** The symbol's box, with its line width. */
export function symbolBounds(c: Pt, size: number): Box {
  const r = size / 2 + symbolWidth(size) / 2 + 0.5;
  return [c.x - r, c.y - r, c.x + r, c.y + r];
}

/** Where a count's number goes (Q11): beside the symbol, to the right, on its middle. */
export function countCaption(c: Pt, size: number, width: number, height: number): CaptionBox {
  return { at: { x: c.x + size / 2 + NUMBER_GAP + width / 2, y: c.y }, angle: 0, width, height };
}

/** The symbol and its number's box together. */
export function countBounds(c: Pt, size: number, caption: Box | null): Box {
  const s = symbolBounds(c, size);
  if (!caption) return s;
  return bounds(
    [
      { x: s[0], y: s[1] },
      { x: s[2], y: s[3] },
      { x: caption[0], y: caption[1] },
      { x: caption[2], y: caption[3] },
    ],
    0,
  );
}

/** The shape a click on the page makes: centred on the click, kept on the page. */
export function placeOnPage(p: Pt, size: number, page: { width: number; height: number }): Pt {
  const h = size / 2;
  const clamp = (v: number, max: number): number => Math.min(Math.max(h, v), Math.max(h, max - h));
  return { x: clamp(p.x, page.width), y: clamp(p.y, page.height) };
}
