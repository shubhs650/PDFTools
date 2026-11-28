// The rows a CRS project template gets (M13-07, D-71; plan M13 §6, C4, C6 –
// C8, C12): which comments go in (comment-type ticks, Ignore highlights,
// "only what the Comments pane shows"), their order (by page; comments with
// typed text first, then the other types, each top to bottom and left to
// right), every field's value, and how they split into sheets (C5: one per
// commented page; C15: one per document). Pure: labels, dates, disciplines and
// page labels come from the caller.
import type { PdfAnnotationObject, PdfAnnotationState } from '@embedpdf/models';
import {
  HIGHLIGHT_OPACITY,
  type CrsField,
  type CrsTemplateSettings,
  type StatusWord,
} from '../../../model/crs/template';
import { crsTypeId } from '../../annotate/annotationTypes';
import {
  commentsOf,
  matches,
  type Comment,
  type CommentFilter,
} from '../../annotate/comments/commentsModel';
import { buildThread, childrenOf } from '../../annotate/comments/thread';

/** A cell's value: text, a number, a date (written as an Excel date), or empty. */
export type CellValue = string | number | Date | null;

export interface TemplateRow {
  /** The annotation's id: the Comment ID field (stable, C4 note: for a later response import). */
  id: string;
  /** 0-based page. */
  page: number;
  /** Every field but Sr. No. (per sheet) and Snapshot (a picture). */
  values: Partial<Record<CrsField, CellValue>>;
  /** The markup's box for its snapshot (page points, top-left origin, 0-based page). */
  region: { page: number; x: number; y: number; width: number; height: number };
}

export interface TemplateRowOptions {
  settings: Pick<CrsTemplateSettings, 'types' | 'ignoreHighlights' | 'status'>;
  /** Only the comments the Comments pane shows. */
  filter?: CommentFilter | null;
  /** The export dialog's own Ignore highlights (defaults to the template's). */
  ignoreHighlights?: boolean;
  /** Measurements in the rows (M14-08, Q34); absent: included. */
  measurements?: boolean;
  typeLabel(a: PdfAnnotationObject): string;
  date(d: Date): string;
  discipline(author: string): string;
  noAuthor: string;
  /** The page's label (the PDF's page labels), or null without one. */
  pageLabel(page: number): string | null;
}

const oneLine = (s: string): string => s.replace(/\r\n|\r/gu, '\n').trim();

const STATUS: Record<string, StatusWord> = {
  Accepted: 'accepted',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
  Completed: 'completed',
};

/** The app status as a template's word key (C7): no status and "None" are both `none`. */
export const statusWord = (s: PdfAnnotationState | null): StatusWord =>
  (s !== null ? STATUS[s] : undefined) ?? 'none';

/** C12, the owner's rule: under 70 % opacity is a highlight. */
export function isHighlight(a: PdfAnnotationObject): boolean {
  const o = (a as { opacity?: number }).opacity;
  return typeof o === 'number' && o < HIGHLIGHT_OPACITY;
}

const hasText = (c: Comment): boolean => c.contents.trim() !== '';

/**
 * C12: by page; on each page comments with typed text first, then the other
 * types, each top to bottom and left to right (a tolerance of a point keeps a
 * line of marks together); the Comments pane number breaks ties.
 */
export function orderComments(list: readonly Comment[]): Comment[] {
  const top = (c: Comment) => Math.round(c.annot.rect.origin.y);
  return [...list].sort(
    (a, b) =>
      a.page - b.page ||
      Number(hasText(b)) - Number(hasText(a)) ||
      top(a) - top(b) ||
      a.annot.rect.origin.x - b.annot.rect.origin.x ||
      a.number - b.number,
  );
}

const time = (a: PdfAnnotationObject): number => (a.created ?? a.modified)?.getTime() ?? 0;

/** The comments a template takes from `all` (one document's annotations), in C12 order. */
export function templateRows(
  all: readonly PdfAnnotationObject[],
  o: TemplateRowOptions,
): TemplateRow[] {
  const ignore = o.ignoreHighlights ?? o.settings.ignoreHighlights;
  const picked = commentsOf(all).filter(
    (c) =>
      (!o.filter || matches(c, o.filter)) &&
      (o.measurements !== false || !c.measure) &&
      o.settings.types[crsTypeId(c.annot)] &&
      !(ignore && isHighlight(c.annot)),
  );
  const kids = childrenOf(all);
  const who = (a: PdfAnnotationObject) => ((a.author ?? '') === '' ? o.noAuthor : (a.author ?? ''));
  return orderComments(picked).map((c) => {
    const thread = buildThread(all, c.id, kids).replies;
    const all_ = thread
      .map(({ annot, depth }) => {
        const when = annot.created ?? annot.modified;
        const head = when ? `${who(annot)} (${o.date(when)})` : who(annot);
        return `${'  '.repeat(depth)}${head}: ${oneLine(annot.contents ?? '')}`;
      })
      .join('\n');
    // First and last by date (the thread is shown by branch).
    const byTime = thread.map((r) => r.annot).sort((x, y) => time(x) - time(y));
    const first = byTime[0];
    const last = byTime[byTime.length - 1];
    const r = c.annot.rect;
    const label = o.pageLabel(c.page);
    const values: Partial<Record<CrsField, CellValue>> = {
      commentNo: c.number,
      page: c.page + 1,
      pageLabel: label ?? String(c.page + 1),
      type: o.typeLabel(c.annot),
      text: oneLine(c.contents),
      author: c.author || o.noAuthor,
      discipline: c.author ? o.discipline(c.author) : '',
      created: c.annot.created ?? null,
      modified: c.annot.modified ?? null,
      status: o.settings.status[statusWord(c.status)],
      allReplies: all_,
      firstReply: first ? oneLine(first.contents ?? '') : '',
      lastReply: last ? oneLine(last.contents ?? '') : '',
      lastReplyAuthor: last ? who(last) : '',
      commentId: c.id,
    };
    return {
      id: c.id,
      page: c.page,
      values,
      region: {
        page: c.page,
        x: r.origin.x,
        y: r.origin.y,
        width: r.size.width,
        height: r.size.height,
      },
    };
  });
}

/** A sheet's rows: one group per commented page (C5), or one for all (C6: Sr. No. per group). */
export function groupByPage(rows: readonly TemplateRow[]): { page: number; rows: TemplateRow[] }[] {
  const out: { page: number; rows: TemplateRow[] }[] = [];
  for (const r of rows) {
    const g = out[out.length - 1];
    if (g?.page === r.page) g.rows.push(r);
    else out.push({ page: r.page, rows: [r] });
  }
  return out;
}
