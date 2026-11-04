// Pure annotation helpers for the keyboard (M3-05): which annotations Tab
// reaches on a page, and in what order.
import {
  PdfAnnotationReplyType,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import type { AnnotationDocumentState } from '@embedpdf/plugin-annotation';

/** Not reachable by Tab: links (link layer), widgets (form layer), popups, replies and state replies. */
const SKIP = new Set([
  PdfAnnotationSubtype.LINK,
  PdfAnnotationSubtype.WIDGET,
  PdfAnnotationSubtype.POPUP,
]);

/** Reading order: top to bottom, then left to right (points, top-left origin). */
export function readingOrder(a: PdfAnnotationObject, b: PdfAnnotationObject): number {
  const dy = a.rect.origin.y - b.rect.origin.y;
  if (Math.abs(dy) > 2) return dy;
  return a.rect.origin.x - b.rect.origin.x;
}

export function pageAnnotations(
  state: AnnotationDocumentState,
  pageIndex: number,
): PdfAnnotationObject[] {
  return (state.pages[pageIndex] ?? [])
    .map((uid) => state.byUid[uid]?.object)
    .filter((o): o is PdfAnnotationObject => o !== undefined)
    .filter((o) => !SKIP.has(o.type) && !o.inReplyToId)
    .sort(readingOrder);
}

/**
 * The annotation Tab (dir 1) or Shift+Tab (-1) selects next; null past either
 * end, so the key moves focus out of the document as usual.
 */
export function cycleTarget(
  list: readonly PdfAnnotationObject[],
  currentId: string | null,
  dir: 1 | -1,
): PdfAnnotationObject | null {
  if (list.length === 0) return null;
  const i = currentId === null ? -1 : list.findIndex((a) => a.id === currentId);
  if (i === -1) return dir === 1 ? (list[0] ?? null) : (list[list.length - 1] ?? null);
  return list[i + dir] ?? null;
}

/** A page rectangle (points, top-left origin), as the plugins give them. */
export interface PageRect {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

/** Whether two page rectangles touch (sharing an edge counts). */
export function touches(a: PageRect, b: PageRect): boolean {
  return !(
    a.origin.x + a.size.width < b.origin.x ||
    b.origin.x + b.size.width < a.origin.x ||
    a.origin.y + a.size.height < b.origin.y ||
    b.origin.y + b.size.height < a.origin.y
  );
}

const HIDDEN_FLAGS = new Set(['hidden', 'noView']);

/**
 * The comments a marquee (drag) selection picks on a page (M7-04, B7): every
 * comment whose box it touches, in reading order. Not links, form fields,
 * popups or replies (the same set Tab reaches), and not hidden comments.
 */
export function marqueeHits(
  state: AnnotationDocumentState,
  pageIndex: number,
  rect: PageRect,
): PdfAnnotationObject[] {
  return pageAnnotations(state, pageIndex).filter(
    (o) => !(o.flags ?? []).some((f) => HIDDEN_FLAGS.has(f)) && touches(rect, o.rect),
  );
}

/** `current` with `ids` added after it, each once (a marquee with Shift or Ctrl held). */
export function addIds(current: readonly string[], ids: readonly string[]): string[] {
  return [...new Set([...current, ...ids])];
}

/**
 * `ids` with every member of their comment groups (/IRT with /RT /Group, the
 * plugin's grouping), in one pass over the document: the plugin's own
 * per-comment check scans every comment, too slow for a marquee over 1,000.
 */
export function withGroupMembers(state: AnnotationDocumentState, ids: readonly string[]): string[] {
  const members = new Map<string, string[]>();
  const leaderOf = new Map<string, string>();
  for (const t of Object.values(state.byUid)) {
    const o = t.object;
    if (!o.inReplyToId || o.replyType !== PdfAnnotationReplyType.Group) continue;
    if (o.type === PdfAnnotationSubtype.LINK) continue;
    leaderOf.set(o.id, o.inReplyToId);
    const list = members.get(o.inReplyToId) ?? [];
    list.push(o.id);
    members.set(o.inReplyToId, list);
  }
  if (members.size === 0) return [...new Set(ids)];
  const out: string[] = [];
  for (const id of ids) {
    const leader = leaderOf.get(id) ?? (members.has(id) ? id : null);
    if (leader === null) out.push(id);
    else out.push(leader, ...(members.get(leader) ?? []));
  }
  return [...new Set(out)];
}
