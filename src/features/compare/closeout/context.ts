// Which comparison window a document is in, and where its comments land on
// another window (M12-15, D-62, Q16, Q43): through the sheet's alignment in
// an overlay result, through the matching text in a text comparison. Reads
// the comparison's stores; the maths is in model/compare/alignedCopy.ts.
import type { WindowRole } from '../../../model/compare/link';
import { documentStore } from '../../../app/store/documentStore';
import {
  landingIn,
  mapBetween,
  textLanding,
  type DocPage,
  type Landing,
} from '../../../model/compare/alignedCopy';
import type { Affine } from '../../../model/compare/material';
import type { Comparison } from '../model';
import { overlayView, placeOf, sheetsOf, type Sheet } from '../overlay/overlayState';
import { pairingStore } from '../pairingFlow';
import { notesStore } from '../review/notes';
import { textLinkOf } from '../text/textLink';

export interface InComparison {
  comparison: Comparison;
  /** The document's window: Document A, Document B, or the overlay's notes. */
  role: WindowRole;
}

/** The comparison shown in the tab in use, if any. */
export function activeComparison(): Comparison | null {
  const s = documentStore.getState();
  return s.activeTab ? (s.comparisons[s.activeTab] ?? null) : null;
}

/** The notes document of an overlay comparison, once made. */
export const notesOf = (id: string): string | null => notesStore.getState().byId[id]?.docId ?? null;

/** The window `docId` is in, in the comparison of the tab in use (its result only). */
export function windowOf(docId: string | null): InComparison | null {
  const c = activeComparison();
  if (!c || !docId || c.stage !== 'result') return null;
  if (c.a.some((f) => f.docId === docId)) return { comparison: c, role: 'a' };
  if (c.b.some((f) => f.docId === docId)) return { comparison: c, role: 'b' };
  if (c.type === 'overlay' && notesOf(c.id) === docId) return { comparison: c, role: 'overlay' };
  return null;
}

/** An overlay's sheets, once paired (the result's list). */
export function sheetsOfComparison(id: string): Sheet[] {
  const p = pairingStore.getState().byId[id];
  return p?.status === 'done' ? sheetsOf(p.rows, p.pages) : [];
}

/** Where a sheet's A is drawn in B's frame (the alignment found, set by hand, or as is). */
const placer = (id: string, sheets: readonly Sheet[]) => {
  const v = overlayView(id);
  return (i: number): Affine => placeOf(v, sheets[i]);
};

/**
 * Where a comment at `y` on page `from` of one window lands in window `to`:
 * the page there and the map between the pages as displayed. Null when there
 * is no matching place (a sheet one revision lacks, the text windows not laid
 * out yet).
 */
export function landing(c: Comparison, from: DocPage, to: WindowRole, y: number): Landing | null {
  if (c.type === 'overlay') {
    const sheets = sheetsOfComparison(c.id);
    return landingIn(sheets, notesOf(c.id), placer(c.id, sheets), from, to);
  }
  if (to === 'overlay') return null;
  const side = c.a[0]?.docId === from.docId ? 'a' : c.b[0]?.docId === from.docId ? 'b' : null;
  const target = c[to][0]?.docId;
  if (!side || side === to || !target) return null;
  const link = textLinkOf(c.id);
  const placed = link?.located();
  const stacks = { a: link?.stack('a'), b: link?.stack('b') };
  if (!placed || !stacks.a || !stacks.b) return null;
  const l = textLanding(
    placed.curve,
    { a: stacks.a, b: stacks.b },
    side,
    from.page,
    y,
    placed.places,
  );
  return l ? { docId: target, page: l.page, map: l.map } : null;
}

/**
 * An aligned paste (Q16): the map from a page of one window to the page of
 * another where the comments go, for the comparison in use. Overlay: the two
 * pages must be windows of one sheet (null otherwise: a plain paste). Text:
 * the matching text of `y`, which also picks the page.
 */
export function pasteLanding(
  from: DocPage,
  to: { docId: string; page: number },
  y: number,
): { page: number; map: Affine } | null {
  const src = windowOf(from.docId);
  const dst = windowOf(to.docId);
  if (src?.comparison.id !== dst?.comparison.id || !src || !dst || src.role === dst.role)
    return null;
  const c = src.comparison;
  if (c.type === 'overlay') {
    const sheets = sheetsOfComparison(c.id);
    const map = mapBetween(sheets, notesOf(c.id), placer(c.id, sheets), from, to);
    return map ? { page: to.page, map } : null;
  }
  const l = landing(c, from, dst.role, y);
  return l ? { page: l.page, map: l.map } : null;
}

/** The name of a document (the automatic reply names the new file). */
export const nameOf = (docId: string): string =>
  documentStore.getState().docs[docId]?.meta.name ?? '';
