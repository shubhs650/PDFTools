// Click to zoom (M12-27, ADR-033 decision 4): a comment picked in the
// close-out list is brought into view, selected in Document A and flashed
// once. An overlay result goes to the comment's sheet and zooms the linked
// windows so the comment fills about a third of the overlay window, never
// past 400 % (centreOnBox in review/windowLink.ts); a text comparison
// scrolls both sides to it, zooming in when it is small.
import { matchPlace, sheetOf } from '../../../model/compare/alignedCopy';
import { toReference } from '../../../model/compare/link';
import { applyAffine } from '../../../model/compare/material';
import { stackY } from '../../../model/compare/textView';
import { annotationCapability } from '../../annotate/selection';
import { flashBox } from '../../view/pageFlash';
import type { Comparison } from '../model';
import { goSheet, overlayView, placeOf, updateView } from '../overlay/overlayState';
import { focusOverlay, type Box } from '../review/overlayFocus';
import { laidBoxToDisplayed } from '../review/windowLink';
import { textLinkOf } from '../text/textLink';
import type { CloseOutRow } from './closeOutModel';
import { notesOf, sheetsOfComparison } from './context';

/** The most the windows zoom in for a comment: 400 %. */
export const COMMENT_MAX_ZOOM = 4;

/** A text comparison zooms in when the comment is smaller than this share of the window. */
const SMALL_SHARE = 1 / 8;

/** A text comparison zooms in at most this many times at once (the page stays readable). */
const TEXT_MAX_STEP = 2;

/** An annotation's rectangle as a box [x0, y0, x1, y1] (page points as laid out). */
export function rectBox(r: CloseOutRow['annot']['rect']): Box {
  return [r.origin.x, r.origin.y, r.origin.x + r.size.width, r.origin.y + r.size.height];
}

/** A box through an affine map: the box around its four corners. */
export function mapBox(m: Parameters<typeof applyAffine>[0], b: Box): Box {
  const pts = [
    applyAffine(m, b[0], b[1]),
    applyAffine(m, b[2], b[1]),
    applyAffine(m, b[0], b[3]),
    applyAffine(m, b[2], b[3]),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * How far a text comparison zooms in for a comment `px` × `py` on screen at
 * zoom `level` in a window `vw` × `vh` (CSS px): null when it is big enough;
 * otherwise about a third of the window, at most twice the zoom and 400 %. Pure.
 */
export function textZoomFor(
  level: number,
  px: number,
  py: number,
  vw: number,
  vh: number,
): number | null {
  if (px <= 0 || py <= 0 || vw <= 0 || vh <= 0) return null;
  if (px >= vw * SMALL_SHARE || py >= vh * SMALL_SHARE) return null;
  const want = level * Math.min(vw / 3 / px, vh / 3 / py);
  const to = Math.min(want, level * TEXT_MAX_STEP, COMMENT_MAX_ZOOM);
  return to > level * 1.05 ? to : null;
}

/** Shows a comment of A: its sheet (overlay) or its text on both sides (text), selected in A. */
export function revealComment(c: Comparison, docId: string, row: CloseOutRow): void {
  annotationCapability()?.forDocument(docId).selectAnnotation(row.page, row.id);
  const laid = rectBox(row.annot.rect);
  if (c.type === 'overlay') revealOnSheet(c, docId, row, laid);
  else void revealInText(c, docId, row, laid);
}

function revealOnSheet(c: Comparison, docId: string, row: CloseOutRow, laid: Box): void {
  const sheets = sheetsOfComparison(c.id);
  const notes = notesOf(c.id);
  const i = sheetOf(sheets, notes, { docId, page: row.page });
  const sheet = sheets[i];
  if (!sheet) return;
  const moved = overlayView(c.id).sheet !== i;
  if (moved) updateView(c.id, (v) => goSheet(v, i, sheets.length));
  const shown = laidBoxToDisplayed(docId, row.page, laid);
  if (!shown) return;
  // A's page as displayed → the overlay's frame, through the sheet's alignment.
  const place = placeOf(overlayView(c.id), sheet);
  const onOverlay = mapBox(toReference('a', place, !!sheet.a && !!sheet.b), shown);
  focusOverlay(c.id, onOverlay, moved, {
    maxZoom: COMMENT_MAX_ZOOM,
    a: shown,
    onShown: () => {
      flashBox(docId, row.page, laid);
      // The notes page is the sheet's frame: laid out as displayed.
      if (notes) flashBox(notes, i, onOverlay);
    },
  });
}

async function revealInText(
  c: Comparison,
  docId: string,
  row: CloseOutRow,
  laid: Box,
): Promise<void> {
  // The comment's text on both sides: the matching place of its middle (as Copy finds it).
  const link = textLinkOf(c.id);
  if (!link) return;
  const r = row.annot.rect;
  const l = link.laid('a');
  if (l) {
    const level = textZoomFor(
      l.scale,
      r.size.width * l.scale,
      r.size.height * l.scale,
      l.vp.clientWidth,
      l.vp.clientHeight,
    );
    if (level !== null) await link.zoomTo(level);
  }
  const stack = link.stack('a');
  const top = stack ? stackY(stack, row.page, r.origin.y) : undefined;
  const placed = link.located();
  if (top === undefined || !placed) return;
  const half = r.size.height / 2;
  const b = matchPlace(placed.curve, placed.places, 'a', top + half);
  link.centreOn({
    a: { top, bottom: top + 2 * half },
    b: { top: b - half, bottom: b + half },
  });
  flashBox(docId, row.page, laid);
}
