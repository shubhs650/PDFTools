// Comments in every pointer mode (M11-06, ADR-028 D-51). Until M11 only Select
// and Select Comments picked comments up (M3-05): Hand and Select Text locked
// every one. Now a comment is selected by a click in Select, Select Comments,
// Hand and Select Text; form fields are filled in all of them and only Select
// Fields picks them up (M6-14, unchanged). Hand: a drag that starts on a
// comment moves it, elsewhere it pans. Select Text: on a text markup a drag
// selects the text under it and a click selects the markup (owner's Q6). Pure.
import { PdfAnnotationSubtype, type PdfAnnotationObject, type Position } from '@embedpdf/models';
import {
  LockModeType,
  type AnnotationDocumentState,
  type LockMode,
} from '@embedpdf/plugin-annotation';
import type { Tool } from '../../app/store/appStore';
import { isDesignTool } from '../forms/fieldModel';
import { isTextTool, TEXT_COMMENT_CATEGORY } from './tools/drawModel';

/** The pointer tools that pick comments up with a click (D-51). */
const PICKERS: ReadonlySet<string> = new Set<Tool>([
  'select',
  'selectObjects',
  'hand',
  'selectText',
]);

/** Whether a click on a comment selects it with this tool on. */
export const picksComments = (tool: string): boolean => PICKERS.has(tool);

/**
 * Which comments the annotation plugin keeps out of reach with a tool on:
 * the pointer tools reach every comment but form fields; a field tool reaches
 * the fields (the one just drawn is selected, M6-14); a text tool the text
 * comment it just made (M7-02); any other tool none, so a press there starts
 * a new comment instead of picking one up.
 */
export function lockModeFor(tool: string): LockMode {
  if (picksComments(tool)) return { type: LockModeType.Include, categories: ['form'] };
  if (isDesignTool(tool)) return { type: LockModeType.Exclude, categories: ['form'] };
  if (isTextTool(tool)) return { type: LockModeType.Exclude, categories: [TEXT_COMMENT_CATEGORY] };
  return { type: LockModeType.All };
}

const TEXT_MARKUPS: ReadonlySet<PdfAnnotationSubtype> = new Set([
  PdfAnnotationSubtype.HIGHLIGHT,
  PdfAnnotationSubtype.UNDERLINE,
  PdfAnnotationSubtype.STRIKEOUT,
  PdfAnnotationSubtype.SQUIGGLY,
]);

/** A highlight, underline, strikeout or squiggly: drawn over the text it marks. */
export const isTextMarkup = (o: Pick<PdfAnnotationObject, 'type'>): boolean =>
  TEXT_MARKUPS.has(o.type);

/** Pixels a press may travel and still be a click (as the marquee's threshold). */
export const CLICK_SLOP_PX = 5;

/** Whether a press that moved (dx, dy) screen pixels is still a click. */
export const isClick = (dx: number, dy: number): boolean => Math.hypot(dx, dy) < CLICK_SLOP_PX;

const HIDDEN = new Set(['hidden', 'noView']);

/** Points of slack around a markup's line boxes (thin underlines are hard to hit). */
const MARKUP_SLACK = 1;

const inRect = (
  p: Position,
  r: { origin: Position; size: { width: number; height: number } },
  slack: number,
): boolean =>
  p.x >= r.origin.x - slack &&
  p.x <= r.origin.x + r.size.width + slack &&
  p.y >= r.origin.y - slack &&
  p.y <= r.origin.y + r.size.height + slack;

/**
 * The text markup under a page point (points, top-left origin), with Select
 * Text: the one drawn last (on top) whose line boxes hold the point. Hidden
 * ones and replies never; a markup without line boxes by its rectangle.
 */
export function markupAt(
  state: Pick<AnnotationDocumentState, 'pages' | 'byUid'>,
  pageIndex: number,
  p: Position,
): PdfAnnotationObject | null {
  const uids = state.pages[pageIndex] ?? [];
  for (let i = uids.length - 1; i >= 0; i--) {
    const o = state.byUid[uids[i] ?? '']?.object;
    if (!o || !isTextMarkup(o) || o.inReplyToId) continue;
    if ((o.flags ?? []).some((f) => HIDDEN.has(f))) continue;
    const segments = (o as { segmentRects?: PdfAnnotationObject['rect'][] }).segmentRects ?? [];
    const boxes = segments.length > 0 ? segments : [o.rect];
    if (boxes.some((r) => inRect(p, r, MARKUP_SLACK))) return o;
  }
  return null;
}
