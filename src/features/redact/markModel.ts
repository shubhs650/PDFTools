// Redaction marks (M4-16, §7.9 step 1, M4-Q3): standard /Redact annotations —
// /QuadPoints with one quad per selected line for text, one quad for an area —
// with /IC the fill that Apply paints (black) and /C the outline shown while
// pending, as Acrobat and PDF-XChange make them, so their marks load here as
// pending and ours there. Pure: the tools are wired in markTools.ts.
// Coordinates are EmbedPDF's: points from the unrotated page's top-left.
import { PdfAnnotationSubtype, type PdfRedactAnnoObject, type Rect } from '@embedpdf/models';
import type { PageSelection } from '../annotate/tools/markupModel';

/** What Apply paints over the area (/IC). */
export const REDACT_FILL = '#000000';
/** The pending mark's outline (/C). */
export const REDACT_OUTLINE = '#D93025';
/** Smallest area mark (points), either side. */
export const MIN_AREA = 4;

export interface MarkOptions {
  now: Date;
  newId: () => string;
  /** The selected text per page (null: the document denies copying, rule 9). */
  texts: readonly string[] | null;
}

const base = (pageIndex: number, id: string, now: Date) => ({
  type: PdfAnnotationSubtype.REDACT as const,
  pageIndex,
  id,
  created: now,
  modified: now,
  flags: ['print' as const],
  opacity: 1,
  color: REDACT_FILL,
  strokeColor: REDACT_OUTLINE,
});

/** One mark per page of a text selection, a quad per selected line segment. */
export function textMarks(
  selections: readonly PageSelection[],
  opts: MarkOptions,
): PdfRedactAnnoObject[] {
  const out: PdfRedactAnnoObject[] = [];
  selections.forEach((sel, i) => {
    if (sel.segmentRects.length === 0) return;
    const text = opts.texts?.[i]?.trim();
    out.push({
      ...base(sel.pageIndex, opts.newId(), opts.now),
      rect: sel.rect,
      segmentRects: sel.segmentRects.map((r) => ({ origin: { ...r.origin }, size: { ...r.size } })),
      ...(text ? { contents: text } : {}),
    });
  });
  return out;
}

/** The rectangle spanned by two corner points (any order). */
export function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    origin: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    size: { width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) },
  };
}

/** Clamps a rect to the page (width × height), or null when nothing of it is left. */
export function clampToPage(r: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(0, r.origin.x);
  const y0 = Math.max(0, r.origin.y);
  const x1 = Math.min(width, r.origin.x + r.size.width);
  const y1 = Math.min(height, r.origin.y + r.size.height);
  if (x1 - x0 < MIN_AREA || y1 - y0 < MIN_AREA) return null;
  return { origin: { x: x0, y: y0 }, size: { width: x1 - x0, height: y1 - y0 } };
}

/** An area mark: one quad covering the rect (null when smaller than MIN_AREA). */
export function areaMark(
  pageIndex: number,
  rect: Rect,
  page: { width: number; height: number },
  opts: Omit<MarkOptions, 'texts'>,
): PdfRedactAnnoObject | null {
  const r = clampToPage(rect, page.width, page.height);
  if (!r) return null;
  return { ...base(pageIndex, opts.newId(), opts.now), rect: r, segmentRects: [r] };
}

/** The areas a mark covers: its quads, else its rectangle. */
export function markAreas(m: { rect: Rect; segmentRects?: Rect[] }): Rect[] {
  return m.segmentRects?.length ? m.segmentRects : [m.rect];
}

export type MarkKind = 'text' | 'area';

/** A mark made from text has a quad per line or text in /Contents; an area mark one quad, no text. */
export function markKind(m: { segmentRects?: Rect[]; contents?: string }): MarkKind {
  return (m.segmentRects?.length ?? 0) > 1 || !!m.contents ? 'text' : 'area';
}
