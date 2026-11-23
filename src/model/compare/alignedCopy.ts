// Aligned copy between a comparison's revisions (M12-15, D-62, Q16, Q43):
// where a comment of one window lands on another window's page so that it
// sits on the same spot of the drawing or text. Pure maths, unit-tested.
//
// Every map is between two pages **as displayed** (points, origin top left,
// y down, /Rotate and the CropBox applied): the space of the alignment
// (material.ts) and of the Work worker's comment transfer (`visual`), which
// folds each page's own user space in.
import { between, toReference, type WindowRole } from './link';
import { IDENTITY, type Affine } from './material';
import {
  mapAlong,
  pageAtY,
  stackY,
  type PageStack,
  type Side,
  type StackSpan,
  type SyncCurve,
} from './textView';

/** A page of a document. */
export interface DocPage {
  docId: string;
  page: number;
}

/** A sheet of an overlay result: a pair of pages, or a page one revision has. */
export interface SheetPages {
  a: DocPage | null;
  b: DocPage | null;
}

/** A window of a sheet: its role, its page and its map into the overlay's frame (link.ts). */
export interface SheetWindow extends DocPage {
  role: WindowRole;
  toRef: Affine;
}

/**
 * The windows of sheet `index`: the overlay's notes page (the sheet's frame),
 * Document A's page through the alignment `place` when B has the sheet too,
 * Document B's page as it is.
 */
export function sheetWindows(
  sheet: SheetPages,
  index: number,
  notesId: string | null,
  place: Affine,
): SheetWindow[] {
  const paired = !!sheet.a && !!sheet.b;
  const out: SheetWindow[] = [];
  if (notesId) out.push({ role: 'overlay', docId: notesId, page: index, toRef: IDENTITY });
  if (sheet.a) out.push({ role: 'a', ...sheet.a, toRef: toReference('a', place, paired) });
  if (sheet.b) out.push({ role: 'b', ...sheet.b, toRef: IDENTITY });
  return out;
}

const same = (w: DocPage, p: DocPage): boolean => w.docId === p.docId && w.page === p.page;

/** The first sheet with a window on `p`, or -1. */
export function sheetOf(sheets: readonly SheetPages[], notesId: string | null, p: DocPage): number {
  if (notesId && p.docId === notesId) return p.page < sheets.length ? p.page : -1;
  return sheets.findIndex((s) => (!!s.a && same(s.a, p)) || (!!s.b && same(s.b, p)));
}

export interface Landing extends DocPage {
  /** From the source page as displayed to this page as displayed. */
  map: Affine;
}

/**
 * Where a comment on page `from` lands in window `to` of its sheet: the page
 * there and the map onto it; null when the sheet has no such window (a sheet
 * only one revision has) or `from` is on no sheet.
 */
export function landingIn(
  sheets: readonly SheetPages[],
  notesId: string | null,
  placeOf: (sheet: number) => Affine,
  from: DocPage,
  to: WindowRole,
): Landing | null {
  const i = sheetOf(sheets, notesId, from);
  const sheet = sheets[i];
  if (!sheet) return null;
  const wins = sheetWindows(sheet, i, notesId, placeOf(i));
  const src = wins.find((w) => same(w, from));
  const dst = wins.find((w) => w.role === to);
  if (!src || !dst || src.role === dst.role) return null;
  return { docId: dst.docId, page: dst.page, map: between(src.toRef, dst.toRef) };
}

/**
 * The map from page `from` to page `to` when both are windows of one sheet
 * (an aligned paste between the windows); null otherwise.
 */
export function mapBetween(
  sheets: readonly SheetPages[],
  notesId: string | null,
  placeOf: (sheet: number) => Affine,
  from: DocPage,
  to: DocPage,
): Affine | null {
  if (same(from, to)) return null;
  const i = sheetOf(sheets, notesId, from);
  const sheet = sheets[i];
  if (!sheet) return null;
  const wins = sheetWindows(sheet, i, notesId, placeOf(i));
  const src = wins.find((w) => same(w, from));
  const dst = wins.find((w) => same(w, to));
  return src && dst ? between(src.toRef, dst.toRef) : null;
}

// ---------------------------------------------------------------- text comparison

/**
 * A place of one side → the matching place of the other (stack points). Text
 * that changed or moved is matched by its change: the smallest change whose
 * text on `from` holds the place, at the same share of its text on the other
 * side (a moved paragraph's comment follows the paragraph, wherever it went).
 * Anything else follows the content-sync curve (the paragraphs matched whole).
 */
export function matchPlace(
  curve: SyncCurve,
  spans: readonly (Record<Side, StackSpan> | null)[],
  from: Side,
  g: number,
): number {
  const to: Side = from === 'a' ? 'b' : 'a';
  let best: Record<Side, StackSpan> | null = null;
  for (const s of spans) {
    const here = s?.[from];
    if (!s || !here || g < here.top || g > here.bottom) continue;
    const size = here.bottom - here.top;
    if (!best || size < best[from].bottom - best[from].top) best = s;
  }
  if (!best) return mapAlong(curve, from, g);
  const here = best[from];
  const there = best[to];
  const share = here.bottom > here.top ? (g - here.top) / (here.bottom - here.top) : 0;
  return there.top + share * (there.bottom - there.top);
}

/**
 * A text comparison (D-64): the place on the other side that matches a place
 * of `from` (page and y, as displayed), in the two windows' page stacks
 * (matchPlace). The comment keeps its x and moves with its text: the map is a
 * move down or up onto the matching page. Null when the page is not in the stack.
 */
export function textLanding(
  curve: SyncCurve,
  stacks: Record<Side, PageStack>,
  from: Side,
  page: number,
  y: number,
  spans: readonly (Record<Side, StackSpan> | null)[] = [],
): { page: number; map: Affine } | null {
  const g = stackY(stacks[from], page, y);
  if (g === undefined) return null;
  const to: Side = from === 'a' ? 'b' : 'a';
  if (stacks[to].tops.length === 0) return null;
  const at = pageAtY(stacks[to], matchPlace(curve, spans, from, g));
  // A place in the gap below a page is that page's foot.
  const h = stacks[to].heights[at.page];
  const ty = h === undefined ? at.y : Math.max(0, Math.min(h, at.y));
  return { page: at.page, map: [1, 0, 0, 1, 0, ty - y] };
}
