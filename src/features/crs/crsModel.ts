// Comment Review Sheet rows (M3-19, D-15, §7.5; M3-Q1: shared with M4's
// annotation export). One row per comment, in the Comments pane's numbering
// (M3-Q5), with its replies flattened in thread order and its review status
// (M3-Q3). Pure: labels, dates and disciplines come from the caller.
import type { PdfAnnotationObject, PdfAnnotationState } from '@embedpdf/models';
import { commentsOf, matches, type CommentFilter } from '../annotate/comments/commentsModel';
import { buildThread, childrenOf } from '../annotate/comments/thread';

/** The §7.5 columns, in order. */
export const CRS_COLUMNS = [
  'number',
  'page',
  'type',
  'reviewer',
  'discipline',
  'comment',
  'replies',
  'status',
  'snapshot',
  'vendorResponse',
  'finalStatus',
] as const;

export type CrsColumn = (typeof CRS_COLUMNS)[number];

export interface CrsHeader {
  title: string;
  docNumber: string;
  revision: string;
  reviewer: string;
  date: string;
  /** The status scheme's name and its codes ("AP Approved, AN …"). */
  scheme: string;
  codes: string;
}

export interface CrsRow {
  id: string;
  number: number;
  /** 1-based. */
  page: number;
  type: string;
  reviewer: string;
  discipline: string;
  comment: string;
  replies: string;
  status: string;
  /** The markup's region for its snapshot (page points, top-left origin, 0-based page). */
  region: { page: number; x: number; y: number; width: number; height: number };
}

export interface RowOptions {
  /** Only the comments the Comments pane shows (scope "filtered"). */
  filter?: CommentFilter | null;
  typeLabel(a: PdfAnnotationObject): string;
  statusLabel(s: PdfAnnotationState | null): string;
  date(d: Date): string;
  /** The reviewer's discipline, when known (the profile's, for its own name). */
  discipline(author: string): string;
  /** "Anonymous" / "an unknown author" for comments without /T. */
  noAuthor: string;
}

const oneLine = (s: string): string => s.replace(/\r\n|\r/gu, '\n').trim();

/** The CRS rows of `all` (every annotation of the document). */
export function buildCrsRows(all: readonly PdfAnnotationObject[], o: RowOptions): CrsRow[] {
  const comments = commentsOf(all).filter((c) => !o.filter || matches(c, o.filter));
  const kids = childrenOf(all);
  return comments.map((c) => {
    const thread = buildThread(all, c.id, kids);
    const replies = thread.replies
      .map(({ annot, depth }) => {
        const who = (annot.author ?? '') === '' ? o.noAuthor : (annot.author ?? '');
        const when = annot.created ?? annot.modified;
        const head = when ? `${who} (${o.date(when)})` : who;
        return `${'  '.repeat(depth)}${head}: ${oneLine(annot.contents ?? '')}`;
      })
      .join('\n');
    const r = c.annot.rect;
    return {
      id: c.id,
      number: c.number,
      page: c.page + 1,
      type: o.typeLabel(c.annot),
      reviewer: c.author || o.noAuthor,
      discipline: c.author ? o.discipline(c.author) : '',
      comment: oneLine(c.contents),
      replies,
      status: c.status ? o.statusLabel(c.status) : '',
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

/** A row's cells in column order (snapshot and the vendor's columns empty). */
export function rowCells(r: CrsRow): string[] {
  const v: Record<CrsColumn, string> = {
    number: String(r.number),
    page: String(r.page),
    type: r.type,
    reviewer: r.reviewer,
    discipline: r.discipline,
    comment: r.comment,
    replies: r.replies,
    status: r.status,
    snapshot: '',
    vendorResponse: '',
    finalStatus: '',
  };
  return CRS_COLUMNS.map((k) => v[k]);
}
