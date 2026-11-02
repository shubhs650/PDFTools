// The Comments pane's model (M3-11, §7.1, M3-Q5; cards and groups M6-05):
// which annotations are comments, their auto-numbers, replies and review
// status, and the rows the pane shows after filtering, grouping and sorting.
// Pure; the CRS (M3-19) uses the same numbers.
import {
  PdfAnnotationState,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype as S,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import type { MessageKey } from '../../../i18n';
import { annotationTypeKey } from '../annotationTypes';

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
  /** /F Locked (M6-05: the card shows a lock). */
  locked: boolean;
  /** What Find looks in (M6-05): contents, author, subject and every reply, lower case. */
  search: string;
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

/** A review mark (/StateModel /Marked, Marked or Unmarked; M6-06): the reviewer's own tick. */
export const isMarkReply = (a: PdfAnnotationObject): boolean =>
  a.type === S.TEXT &&
  !!a.inReplyToId &&
  (a as { stateModel?: string }).stateModel === PdfAnnotationStateModel.Marked &&
  typeof (a as { state?: string }).state === 'string';

/** A state reply of either model: never listed as a reply. */
export const isAnyState = (a: PdfAnnotationObject): boolean => isStateReply(a) || isMarkReply(a);

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

const subjectOf = (a: PdfAnnotationObject): string => (a as { subject?: string }).subject ?? '';

/** The thread root above a reply (itself for a comment; stops at a cycle or a missing parent). */
export function rootOf(
  a: Pick<PdfAnnotationObject, 'id' | 'inReplyToId'>,
  byId: ReadonlyMap<string, Pick<PdfAnnotationObject, 'id' | 'inReplyToId'>>,
): string {
  let cur = a;
  const seen = new Set<string>();
  while (cur.inReplyToId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.inReplyToId);
    if (!parent) break;
    cur = parent;
  }
  return cur.id;
}

/** Comments with numbers, reply counts and status, in number order. */
export function commentsOf(all: readonly PdfAnnotationObject[]): Comment[] {
  const nums = numberComments(all);
  const byId = new Map(all.map((a) => [a.id, a]));
  const replies = new Map<string, number>();
  const replyText = new Map<string, string[]>();
  const states = new Map<string, { at: number; state: PdfAnnotationState }>();
  for (const a of all) {
    if (!a.inReplyToId) continue;
    if (isStateReply(a)) {
      const at = dateOf(a)?.getTime() ?? 0;
      const prev = states.get(a.inReplyToId);
      if (!prev || at >= prev.at)
        states.set(a.inReplyToId, { at, state: (a as { state: PdfAnnotationState }).state });
    } else if (a.type === S.TEXT && !isMarkReply(a)) {
      replies.set(a.inReplyToId, (replies.get(a.inReplyToId) ?? 0) + 1);
      const root = rootOf(a, byId);
      if (root !== a.id && a.contents) {
        const texts = replyText.get(root) ?? [];
        texts.push(a.contents);
        replyText.set(root, texts);
      }
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
      locked: a.flags?.includes('locked') ?? false,
      search: [contents, a.author ?? '', subjectOf(a), ...(replyText.get(a.id) ?? [])]
        .join('\n')
        .toLocaleLowerCase(),
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
  /** Find (M6-05, set on Enter only — rule 3): words in the text, author, subject or replies. */
  text?: string;
}

export type CommentSort = 'page' | 'date' | 'author' | 'type';

/** What the cards are grouped under (M6-05); 'none' lists them without headers. */
export type CommentGroup = 'page' | 'author' | 'type' | 'status' | 'none';

/** A group header's subject: what the comments under it share. */
export type GroupValue =
  | { by: 'page'; page: number }
  | { by: 'author'; author: string }
  | { by: 'type'; type: MessageKey }
  | { by: 'status'; status: PdfAnnotationState | 'none' };

/** A reply in a thread (depth 0: a reply to the comment). */
export interface ReplyEntry {
  annot: PdfAnnotationObject;
  depth: number;
}

export type CommentRow =
  | { kind: 'group'; key: string; value: GroupValue; count: number; collapsed: boolean }
  | { kind: 'comment'; key: string; comment: Comment; group: string | null; replies: number }
  | {
      kind: 'reply';
      key: string;
      reply: PdfAnnotationObject;
      depth: number;
      root: Comment;
      /** The thread's last row (the card ends here). */
      last: boolean;
    };

export interface CommentLayout {
  rows: CommentRow[];
  /** Every comment shown, in list order, those in collapsed groups too (Previous / Next). */
  order: Comment[];
  /** Group key by comment id (empty when not grouped). */
  groupOf: Map<string, string>;
  /** Comments that pass the filter. */
  shown: number;
}

export interface LayoutOptions {
  group?: CommentGroup;
  /** Group keys whose comments are hidden under their header. */
  collapsed?: ReadonlySet<string>;
  /** A comment's replies in thread order (nested ones after their parent). */
  repliesOf?: (id: string) => readonly ReplyEntry[];
}

/** The find text as typed, normalized: trimmed, lower case; empty means no find. */
export const findText = (s: string): string => s.trim().toLocaleLowerCase();

export function matches(c: Comment, f: CommentFilter): boolean {
  if (f.authors?.length && !f.authors.includes(c.author)) return false;
  if (f.types?.length && !f.types.includes(c.type)) return false;
  if (f.pages && (c.page < f.pages[0] || c.page > f.pages[1])) return false;
  if (f.statuses?.length && !f.statuses.includes(c.status ?? 'none')) return false;
  if (f.text) {
    const words = findText(f.text).split(/\s+/u).filter(Boolean);
    if (!words.every((w) => c.search.includes(w))) return false;
  }
  return true;
}

/** Whether any filter is set (the chip row shows only then). */
export function isFiltered(f: CommentFilter): boolean {
  return (
    (f.authors?.length ?? 0) > 0 ||
    (f.types?.length ?? 0) > 0 ||
    f.pages !== undefined ||
    (f.statuses?.length ?? 0) > 0 ||
    findText(f.text ?? '') !== ''
  );
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

const SORTS: Record<CommentSort, (a: Comment, b: Comment) => number> = {
  page: (a, b) => a.number - b.number,
  date: (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0) || a.number - b.number,
  author: (a, b) => collator.compare(a.author, b.author) || a.number - b.number,
  type: (a, b) => a.type - b.type || a.number - b.number,
};

/** Status groups in the order the filter offers them; others after. */
const STATUS_ORDER: readonly (PdfAnnotationState | 'none')[] = [
  'none',
  PdfAnnotationState.Accepted,
  PdfAnnotationState.Rejected,
  PdfAnnotationState.Cancelled,
  PdfAnnotationState.Completed,
  PdfAnnotationState.None,
  PdfAnnotationState.Marked,
  PdfAnnotationState.Unmarked,
];

interface GroupDef {
  key: (c: Comment) => string;
  value: (c: Comment) => GroupValue;
  order: (a: GroupValue, b: GroupValue) => number;
}

const GROUPS: Record<Exclude<CommentGroup, 'none'>, GroupDef> = {
  page: {
    key: (c) => `page:${String(c.page)}`,
    value: (c) => ({ by: 'page', page: c.page }),
    order: (a, b) => (a.by === 'page' && b.by === 'page' ? a.page - b.page : 0),
  },
  author: {
    key: (c) => `author:${c.author}`,
    value: (c) => ({ by: 'author', author: c.author }),
    order: (a, b) =>
      a.by === 'author' && b.by === 'author' ? collator.compare(a.author, b.author) : 0,
  },
  type: {
    key: (c) => `type:${annotationTypeKey(c.annot)}`,
    value: (c) => ({ by: 'type', type: annotationTypeKey(c.annot) }),
    order: (a, b) => (a.by === 'type' && b.by === 'type' ? collator.compare(a.type, b.type) : 0),
  },
  status: {
    key: (c) => `status:${c.status ?? 'none'}`,
    value: (c) => ({ by: 'status', status: c.status ?? 'none' }),
    order: (a, b) =>
      a.by === 'status' && b.by === 'status'
        ? STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
        : 0,
  },
};

/**
 * The pane's rows (M6-05): the comments that pass the filter, under a header
 * per group (unless 'none'), sorted inside each group; each comment followed
 * by its replies (the card), except in a collapsed group. Pure.
 */
export function layoutComments(
  comments: readonly Comment[],
  filter: CommentFilter,
  sort: CommentSort,
  opts: LayoutOptions = {},
): CommentLayout {
  const group = opts.group ?? 'page';
  const collapsed = opts.collapsed ?? new Set<string>();
  const shown = comments.filter((c) => matches(c, filter)).sort(SORTS[sort]);
  const rows: CommentRow[] = [];
  const order: Comment[] = [];
  const groupOf = new Map<string, string>();
  const pushCard = (c: Comment, key: string | null): void => {
    const replies = opts.repliesOf?.(c.id) ?? [];
    rows.push({
      kind: 'comment',
      key: `c:${c.id}`,
      comment: c,
      group: key,
      replies: replies.length,
    });
    replies.forEach((r, i) => {
      rows.push({
        kind: 'reply',
        key: `r:${r.annot.id}`,
        reply: r.annot,
        depth: r.depth,
        root: c,
        last: i === replies.length - 1,
      });
    });
  };
  if (group === 'none') {
    for (const c of shown) {
      order.push(c);
      pushCard(c, null);
    }
    return { rows, order, groupOf, shown: shown.length };
  }
  const def = GROUPS[group];
  const buckets = new Map<string, { value: GroupValue; items: Comment[] }>();
  for (const c of shown) {
    const key = def.key(c);
    let b = buckets.get(key);
    if (!b) {
      b = { value: def.value(c), items: [] };
      buckets.set(key, b);
    }
    b.items.push(c);
  }
  const keys = [...buckets.keys()].sort((x, y) => {
    const bx = buckets.get(x);
    const by = buckets.get(y);
    return bx && by ? def.order(bx.value, by.value) : 0;
  });
  for (const key of keys) {
    const b = buckets.get(key);
    if (!b) continue;
    const isCollapsed = collapsed.has(key);
    rows.push({
      kind: 'group',
      key: `g:${key}`,
      value: b.value,
      count: b.items.length,
      collapsed: isCollapsed,
    });
    for (const c of b.items) {
      order.push(c);
      groupOf.set(c.id, key);
      if (!isCollapsed) pushCard(c, key);
    }
  }
  return { rows, order, groupOf, shown: shown.length };
}

/** The group keys of a layout (Collapse all). */
export const groupKeys = (layout: CommentLayout): string[] =>
  layout.rows.flatMap((r) => (r.kind === 'group' ? [r.key.slice(2)] : []));
