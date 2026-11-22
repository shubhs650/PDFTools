// The text comparison view's own model (M12-19, D-64, ARCHITECTURE §7.16).
// Pure code, unit-tested without a browser:
//
// - **Entries**: the list's rows, one per change in the new revision's
//   reading order, with a moved block's inner edits after it.
// - **Marks**: what each page of Document A and Document B shows, by colour
//   and shape: deleted red struck through (A), inserted green underlined (B),
//   replaced amber on both sides (A struck, B underlined), moved blue on both
//   sides, a changed figure a blue frame. The marks belong to the view; they
//   are never comments (D-64).
// - **Content sync**: the engine's sync points (each paragraph matched whole)
//   as a monotone curve between the two documents' scroll positions, so an
//   inserted page does not throw the sides out of step.
// - **Bands**: where each change sits on both sides, for the bands drawn
//   across the gap between the windows.
// - **The list**: filters by kind, search (on Enter), the checked tick and
//   next / previous (F8, Shift+F8).
import type { TextChange, TextChangeKind, TextComparison, TextSpan } from './text/match';

/** A mark's colour and shape on the page (D-64, Q42). */
export type MarkStyle = 'deleted' | 'inserted' | 'replaced' | 'moved' | 'figure';

/** The legend's order. */
export const MARK_STYLES: readonly MarkStyle[] = [
  'deleted',
  'inserted',
  'replaced',
  'moved',
  'figure',
];

/** The colours a reviewer can change (a changed figure takes the moved colour, D-64). */
export type MarkColourKey = Exclude<MarkStyle, 'figure'>;

export const MARK_COLOUR_KEYS: readonly MarkColourKey[] = [
  'deleted',
  'inserted',
  'replaced',
  'moved',
];

export type MarkColours = Record<MarkColourKey, string>;

/**
 * Red, green, amber and blue (D-64), from the standard swatches (dark red,
 * green, dark orange, dark blue), dark enough to read over white paper.
 */
export const DEFAULT_MARK_COLOURS: MarkColours = {
  deleted: '#c00000',
  inserted: '#008000',
  replaced: '#c06000',
  moved: '#0000c0',
};

export const colourOf = (style: MarkStyle, colours: MarkColours): string =>
  colours[style === 'figure' ? 'moved' : style];

/** The list and the marks group the engine's kinds into the legend's five. */
export function styleOf(kind: TextChangeKind): MarkStyle {
  switch (kind) {
    case 'inserted':
    case 'deleted':
    case 'moved':
    case 'figure':
      return kind;
    default:
      // replaced, a changed header or footer, renumbering, a reference that does not follow
      return 'replaced';
  }
}

/** One row of the list. */
export interface ChangeEntry {
  /** Its index in the entries. */
  id: number;
  change: TextChange;
  style: MarkStyle;
  /** The moved block an inner edit belongs to, else null. */
  parent: number | null;
}

/** The list's rows: the changes in B's reading order, a move's inner edits after it. */
export function entriesOf(r: TextComparison | null): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  if (!r) return out;
  for (const change of r.changes) {
    const id = out.length;
    out.push({ id, change, style: styleOf(change.kind), parent: null });
    for (const inner of change.inner ?? [])
      out.push({ id: out.length, change: inner, style: styleOf(inner.kind), parent: id });
  }
  return out;
}

/** How a mark is drawn on its page. */
export type MarkShape = 'strike' | 'underline' | 'fill' | 'frame';

/** A mark on one page, in that page's displayed space (pt). */
export interface Mark {
  entry: number;
  style: MarkStyle;
  shape: MarkShape;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Side = 'a' | 'b';

/** The shape of a change's marks on each side (none: no mark on that side). */
export function shapesOf(style: MarkStyle): Record<Side, MarkShape | null> {
  switch (style) {
    case 'deleted':
      return { a: 'strike', b: null };
    case 'inserted':
      return { a: null, b: 'underline' };
    case 'replaced':
      return { a: 'strike', b: 'underline' };
    case 'moved':
      return { a: 'fill', b: 'fill' };
    case 'figure':
      return { a: 'frame', b: 'frame' };
  }
}

/** A side page (the index in the compared pages) → the document's page index. */
export type PageOf = (sidePage: number) => number | undefined;

/**
 * Every page's marks, per side, by the document's page index. A move's inner
 * edits come after the move, so they are drawn over its fill.
 */
export function marksBySide(
  entries: readonly ChangeEntry[],
  pageOf: Record<Side, PageOf>,
): Record<Side, Map<number, Mark[]>> {
  const out: Record<Side, Map<number, Mark[]>> = { a: new Map(), b: new Map() };
  for (const e of entries) {
    const shapes = shapesOf(e.style);
    for (const side of ['a', 'b'] as const) {
      const shape = shapes[side];
      const span = e.change[side];
      if (!shape || !span) continue;
      for (const r of span.rects) {
        const page = pageOf[side](r.page);
        if (page === undefined) continue;
        let list = out[side].get(page);
        if (!list) out[side].set(page, (list = []));
        list.push({ entry: e.id, style: e.style, shape, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- content sync

/**
 * Where the documents' pages sit one under the other in continuous scroll,
 * in points: the top of each page (with the gaps) and its displayed height.
 */
export interface PageStack {
  tops: readonly number[];
  heights: readonly number[];
}

/** A page point → its place in the stack (pt from the top of the first page). */
export function stackY(stack: PageStack, page: number, y: number): number | undefined {
  const top = stack.tops[page];
  return top === undefined ? undefined : top + y;
}

/** The page holding a place in the stack (the one above, in a gap) and the y on it. */
export function pageAtY(stack: PageStack, g: number): { page: number; y: number } {
  const n = stack.tops.length;
  if (n === 0) return { page: 0, y: g };
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((stack.tops[mid] ?? 0) <= g) lo = mid;
    else hi = mid - 1;
  }
  return { page: lo, y: g - (stack.tops[lo] ?? 0) };
}

/** Points that tie a place in A to a place in B, both increasing. */
export interface SyncCurve {
  a: Float64Array;
  b: Float64Array;
}

/**
 * The engine's sync points (page A, y A, page B, y B per paragraph matched
 * whole; side pages) as stack places, keeping the longest run that rises on
 * both sides (a paragraph that moved would fold the curve back).
 */
export function syncCurve(
  sync: Float32Array,
  stacks: Record<Side, PageStack>,
  pageOf: Record<Side, PageOf>,
): SyncCurve {
  const pts: [number, number][] = [];
  for (let k = 0; k + 3 < sync.length; k += 4) {
    const pa = pageOf.a(sync[k] ?? 0);
    const pb = pageOf.b(sync[k + 2] ?? 0);
    if (pa === undefined || pb === undefined) continue;
    const ga = stackY(stacks.a, pa, sync[k + 1] ?? 0);
    const gb = stackY(stacks.b, pb, sync[k + 3] ?? 0);
    if (ga === undefined || gb === undefined) continue;
    pts.push([ga, gb]);
  }
  pts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const keep = risingRun(pts);
  return { a: Float64Array.from(keep, (p) => p[0]), b: Float64Array.from(keep, (p) => p[1]) };
}

/** The longest run of points strictly rising in both coordinates (patience sorting). */
function risingRun(pts: readonly [number, number][]): [number, number][] {
  // Equal A places keep one point: the first.
  const xs: [number, number][] = [];
  for (const p of pts) {
    const last = xs[xs.length - 1];
    if (!last || p[0] > last[0]) xs.push(p);
  }
  const tails: number[] = [];
  const prev = new Int32Array(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i]?.[1] ?? 0;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((xs[tails[mid] ?? 0]?.[1] ?? 0) < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1] ?? -1;
    tails[lo] = i;
  }
  const out: [number, number][] = [];
  for (let i = tails[tails.length - 1] ?? -1; i >= 0; i = prev[i] ?? -1) {
    const p = xs[i];
    if (p) out.push(p);
  }
  return out.reverse();
}

/**
 * A place in one document → the matching place in the other: between two
 * sync points by their share of the distance, before the first and after
 * the last by the nearest point's offset; without points, the same place.
 */
export function mapAlong(c: SyncCurve, from: Side, g: number): number {
  const xs = from === 'a' ? c.a : c.b;
  const ys = from === 'a' ? c.b : c.a;
  const n = xs.length;
  if (n === 0) return g;
  if (g <= (xs[0] ?? 0)) return g + (ys[0] ?? 0) - (xs[0] ?? 0);
  if (g >= (xs[n - 1] ?? 0)) return g + (ys[n - 1] ?? 0) - (xs[n - 1] ?? 0);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] ?? 0) <= g) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo] ?? 0;
  const x1 = xs[hi] ?? 0;
  const y0 = ys[lo] ?? 0;
  const y1 = ys[hi] ?? 0;
  return x1 > x0 ? y0 + ((g - x0) / (x1 - x0)) * (y1 - y0) : y0;
}

// ---------------------------------------------------------------- bands

/** A stretch of a document in the stack (pt); top = bottom for a place only. */
export interface StackSpan {
  top: number;
  bottom: number;
}

/** A span's extent in its document's stack: its marks, or the top of its page. */
export function spanInStack(span: TextSpan, stack: PageStack, pageOf: PageOf): StackSpan | null {
  let top = Infinity;
  let bottom = -Infinity;
  for (const r of span.rects) {
    const page = pageOf(r.page);
    if (page === undefined) continue;
    const t = stackY(stack, page, r.y0);
    const b = stackY(stack, page, r.y1);
    if (t === undefined || b === undefined) continue;
    top = Math.min(top, t);
    bottom = Math.max(bottom, b);
  }
  if (top <= bottom) return { top, bottom };
  const page = pageOf(span.page);
  const at = page === undefined ? undefined : stackY(stack, page, 0);
  return at === undefined ? null : { top: at, bottom: at };
}

/**
 * Where a change sits on both sides: its own text where it has some, else
 * the place the other side's text maps to (an insertion points at where it
 * would have been in A).
 */
export function entryPlaces(
  change: TextChange,
  stacks: Record<Side, PageStack>,
  pageOf: Record<Side, PageOf>,
  curve: SyncCurve,
): Record<Side, StackSpan> | null {
  const a = change.a ? spanInStack(change.a, stacks.a, pageOf.a) : null;
  const b = change.b ? spanInStack(change.b, stacks.b, pageOf.b) : null;
  if (a && b) return { a, b };
  if (a) {
    const at = mapAlong(curve, 'a', (a.top + a.bottom) / 2);
    return { a, b: { top: at, bottom: at } };
  }
  if (b) {
    const at = mapAlong(curve, 'b', (b.top + b.bottom) / 2);
    return { a: { top: at, bottom: at }, b };
  }
  return null;
}

// ---------------------------------------------------------------- the list

export interface ListFilter {
  /** The kinds shown (the legend's five). */
  styles: Record<MarkStyle, boolean>;
  /** Search in the old and new text, applied on Enter; empty: none. */
  query: string;
  /** Leave out the entries ticked as checked. */
  hideChecked: boolean;
}

export const DEFAULT_FILTER: ListFilter = {
  styles: { deleted: true, inserted: true, replaced: true, moved: true, figure: true },
  query: '',
  hideChecked: false,
};

const fold = (s: string): string => s.normalize('NFKC').toLocaleLowerCase();

/** The entries the list shows, by id, in order. */
export function visibleEntries(
  entries: readonly ChangeEntry[],
  filter: ListFilter,
  checked: ReadonlySet<number>,
): number[] {
  const q = fold(filter.query.trim());
  const out: number[] = [];
  for (const e of entries) {
    if (!filter.styles[e.style]) continue;
    if (filter.hideChecked && checked.has(e.id)) continue;
    if (q) {
      const text = fold(`${e.change.a?.text ?? ''}\n${e.change.b?.text ?? ''}`);
      if (!text.includes(q)) continue;
    }
    out.push(e.id);
  }
  return out;
}

/**
 * Next (+1) or previous (−1) entry of the list from `current`, wrapping round
 * as Find Next does; from no entry, the first (or the last).
 */
export function stepEntry(
  visible: readonly number[],
  current: number | null,
  dir: 1 | -1,
): number | null {
  const n = visible.length;
  if (n === 0) return null;
  if (current === null) return (dir > 0 ? visible[0] : visible[n - 1]) ?? null;
  // The first visible entry after (or before) the current one, by id order.
  if (dir > 0) {
    for (const id of visible) if (id > current) return id;
    return visible[0] ?? null;
  }
  for (let i = n - 1; i >= 0; i--) {
    const id = visible[i] ?? 0;
    if (id < current) return id;
  }
  return visible[n - 1] ?? null;
}

/** How many entries of each kind (the legend's counts). */
export function countByStyle(entries: readonly ChangeEntry[]): Record<MarkStyle, number> {
  const out: Record<MarkStyle, number> = {
    deleted: 0,
    inserted: 0,
    replaced: 0,
    moved: 0,
    figure: 0,
  };
  for (const e of entries) out[e.style]++;
  return out;
}

/** The side pages → document pages of a side (its page range, in order). */
export const pageMap =
  (pages: readonly number[]): PageOf =>
  (sidePage) =>
    pages[sidePage];
