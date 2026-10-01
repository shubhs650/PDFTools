// The Comments pane's model (M3-11, §7.1, M3-Q5): which annotations are
// comments, their auto-numbers, replies and review status, and the rows the
// pane shows after filtering and sorting. Pure; the CRS (M3-19) uses the same
// numbers.
import {
  PdfAnnotationStateModel,
  PdfAnnotationSubtype as S,
  type PdfAnnotationObject,
  type PdfAnnotationState,
} from '@embedpdf/models';

/** Not comments: links (link layer), form fields, popups (a markup's window). */
// Redaction marks are listed in Pending Redactions (M4-16), not as comments.
const NOT_COMMENTS = new Set([S.LINK, S.WIDGET, S.POPUP, S.REDACT]);

export interface Comment {
  id: string;
  page: number;
  type: S;
  author: string;
  /** /CreationDate, else /M (null when neither is set). */
  date: Date | null;
  contents: string;
  firstLine: string;
  number: number;
  /** Replies (not review states). */
  replies: number;
  /** The latest review state (a /StateModel /Review reply), or null (M3-Q3). */
  status: PdfAnnotationState | null;
  annot: PdfAnnotationObject;
}

/** A comment: not a link/field/popup, and not a reply — unless its parent is gone. */
const commentTest = (all: readonly PdfAnnotationObject[]) => {
  const ids = new Set(all.map((a) => a.id));
  return (a: PdfAnnotationObject): boolean =>
    !NOT_COMMENTS.has(a.type) && (!a.inReplyToId || !ids.has(a.inReplyToId));
};

const dateOf = (a: PdfAnnotationObject): Date | null => a.created ?? a.modified ?? null;

const time = (d: Date | null): number => (d ? d.getTime() : Number.POSITIVE_INFINITY);

/** A review-state reply (/StateModel /Review with /State). */
export const isStateReply = (a: PdfAnnotationObject): boolean =>
  a.type === S.TEXT &&
  !!a.inReplyToId &&
  (a as { stateModel?: string }).stateModel === PdfAnnotationStateModel.Review &&
  typeof (a as { state?: string }).state === 'string';

/**
 * M3-Q5: comments numbered by page, then creation date (/CreationDate, else
 * /M; undated last), then /NM. Derived, never stored: deleting one renumbers
 * the rest.
 */
export function numberComments(all: readonly PdfAnnotationObject[]): Map<string, number> {
  const list = all.filter(commentTest(all));
  list.sort(
    (a, b) =>
      a.pageIndex - b.pageIndex ||
      time(dateOf(a)) - time(dateOf(b)) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return new Map(list.map((a, i) => [a.id, i + 1]));
}

/** Comments with numbers, reply counts and status, in number order. */
export function commentsOf(all: readonly PdfAnnotationObject[]): Comment[] {
  const nums = numberComments(all);
  const replies = new Map<string, number>();
  const states = new Map<string, { at: number; state: PdfAnnotationState }>();
  for (const a of all) {
    if (!a.inReplyToId) continue;
    if (isStateReply(a)) {
      const at = dateOf(a)?.getTime() ?? 0;
      const prev = states.get(a.inReplyToId);
      if (!prev || at >= prev.at)
        states.set(a.inReplyToId, { at, state: (a as { state: PdfAnnotationState }).state });
    } else if (a.type === S.TEXT) {
      replies.set(a.inReplyToId, (replies.get(a.inReplyToId) ?? 0) + 1);
    }
  }
  const out: Comment[] = [];
  for (const a of all) {
    const number = nums.get(a.id);
    if (number === undefined) continue;
    const contents = a.contents ?? '';
    out.push({
      id: a.id,
      page: a.pageIndex,
      type: a.type,
      author: a.author ?? '',
      date: dateOf(a),
      contents,
      firstLine: contents.split(/\r\n|\r|\n/u)[0]?.trim() ?? '',
      number,
      replies: replies.get(a.id) ?? 0,
      status: states.get(a.id)?.state ?? null,
      annot: a,
    });
  }
  return out.sort((x, y) => x.number - y.number);
}

export interface CommentFilter {
  authors?: readonly string[];
  types?: readonly S[];
  /** 0-based, inclusive. */
  pages?: readonly [number, number];
  /** 'none' matches comments without a review state. */
  statuses?: readonly (PdfAnnotationState | 'none')[];
}

export type CommentSort = 'page' | 'date' | 'author' | 'type';

export type CommentRow =
  { kind: 'page'; page: number; count: number } | { kind: 'comment'; comment: Comment };

export function matches(c: Comment, f: CommentFilter): boolean {
  if (f.authors?.length && !f.authors.includes(c.author)) return false;
  if (f.types?.length && !f.types.includes(c.type)) return false;
  if (f.pages && (c.page < f.pages[0] || c.page > f.pages[1])) return false;
  if (f.statuses?.length && !f.statuses.includes(c.status ?? 'none')) return false;
  return true;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** The pane's rows: by page with page headers, or flat for the other sorts. */
export function buildRows(
  comments: readonly Comment[],
  filter: CommentFilter,
  sort: CommentSort,
): CommentRow[] {
  const shown = comments.filter((c) => matches(c, filter));
  if (sort === 'page') {
    const rows: CommentRow[] = [];
    let i = 0;
    while (i < shown.length) {
      const page = shown[i]?.page ?? 0;
      let j = i;
      while (j < shown.length && shown[j]?.page === page) j++;
      rows.push({ kind: 'page', page, count: j - i });
      for (const c of shown.slice(i, j)) rows.push({ kind: 'comment', comment: c });
      i = j;
    }
    return rows;
  }
  const by: Record<Exclude<CommentSort, 'page'>, (a: Comment, b: Comment) => number> = {
    date: (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0) || a.number - b.number,
    author: (a, b) => collator.compare(a.author, b.author) || a.number - b.number,
    type: (a, b) => a.type - b.type || a.number - b.number,
  };
  return [...shown].sort(by[sort]).map((comment) => ({ kind: 'comment', comment }));
}
