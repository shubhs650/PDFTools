// Close-out tracking (M12-15, D-62, Q16; the plan's question 1): the list of
// every comment of the old revision with its state. One click closes a comment
// out as **Addressed**, **Carried over** or **Changed differently**: the
// comment's review status becomes Completed (a standard /State reply, which
// every viewer and the CRS export read), an automatic reply names the outcome
// and the new file, and a see-through check highlight is grouped with the
// comment (/IRT with /RT /Group: it moves and is deleted with it, and is not a
// comment of its own). Reopen takes those three away again.
//
// The three are recognised by their /NM: "closeout-state-…", "closeout-<outcome>-…"
// and "closeout-check-…". Pure; the actions are in closeOut.ts.
import {
  PdfAnnotationReplyType,
  PdfAnnotationState,
  PdfAnnotationSubtype as S,
  PdfBlendMode,
  type PdfAnnotationObject,
  type Rect,
} from '@embedpdf/models';
import { commentsOf, isStateReply } from '../../annotate/comments/commentsModel';
import { makeReply, makeState } from '../../annotate/comments/thread';

/** How an old comment was closed out (Q16). */
export type Outcome = 'addressed' | 'carried' | 'changed';

export const OUTCOMES: readonly Outcome[] = ['addressed', 'carried', 'changed'];

/** A comment's state in the list: open, closed out here, or Completed some other way. */
export type CloseOutState = 'open' | Outcome | 'completed';

const PREFIX = 'closeout-';

/** The /NM of the parts a close-out adds. */
export function partIds(
  outcome: Outcome,
  uuid: () => string,
): { state: string; reply: string; check: string } {
  return {
    state: `${PREFIX}state-${uuid()}`,
    reply: `${PREFIX}${outcome}-${uuid()}`,
    check: `${PREFIX}check-${uuid()}`,
  };
}

/** Whether an annotation is a part of a close-out (its state, reply or check highlight). */
export const isCloseOutPart = (a: Pick<PdfAnnotationObject, 'id'>): boolean =>
  a.id.startsWith(PREFIX);

/** The outcome a close-out reply records, from its /NM (null for anything else). */
export function outcomeOf(a: Pick<PdfAnnotationObject, 'id'>): Outcome | null {
  if (!a.id.startsWith(PREFIX)) return null;
  const rest = a.id.slice(PREFIX.length);
  return OUTCOMES.find((o) => rest.startsWith(`${o}-`)) ?? null;
}

/** A close-out's check highlight (by its /NM). */
export const isCheckPart = (a: Pick<PdfAnnotationObject, 'id'>): boolean =>
  a.id.startsWith(`${PREFIX}check-`);

/** More see-through than this is a reviewer's check mark (D-59, Q11, as Hide check highlights). */
export const CHECK_OPACITY = 0.7;

/**
 * A reviewer's "this part is checked" mark, not a comment to close out: a
 * Highlight, anything more see-through than 70 %, or anything blended (the
 * same rule as the overlay's Hide check highlights).
 */
export function isCheckMark(a: PdfAnnotationObject): boolean {
  if (a.type === S.HIGHLIGHT) return true;
  const o = a as { opacity?: number; blendMode?: PdfBlendMode };
  if (typeof o.opacity === 'number' && o.opacity < CHECK_OPACITY) return true;
  return o.blendMode !== undefined && o.blendMode !== PdfBlendMode.Normal;
}

/**
 * A highlight-type comment (ADR-033 decision 4, the list's Hide highlights):
 * a Highlight, or a markup drawn see-through or blended (an area highlight, a
 * highlighter stroke). Notes and text boxes never are: they hold typed text.
 */
export function isHighlightType(a: PdfAnnotationObject): boolean {
  if (a.type === S.HIGHLIGHT) return true;
  if (a.type === S.TEXT || a.type === S.FREETEXT) return false;
  const o = a as { opacity?: number; blendMode?: PdfBlendMode };
  if (typeof o.opacity === 'number' && o.opacity < 1) return true;
  return o.blendMode !== undefined && o.blendMode !== PdfBlendMode.Normal;
}

/** The list's two groups (ADR-033): comments with typed text first, then markup without text. */
export type CloseOutGroup = 'text' | 'markup';

export const CLOSE_OUT_GROUPS: readonly CloseOutGroup[] = ['text', 'markup'];

export interface CloseOutRow {
  id: string;
  /** Typed text (a note, a text box, a callout, any markup with contents) or markup only. */
  group: CloseOutGroup;
  /** A highlight-type comment (Hide highlights hides it). */
  highlight: boolean;
  /** The Comments pane's number (M3-Q5), so the list and the CRS agree. */
  number: number;
  page: number;
  type: S;
  author: string;
  firstLine: string;
  state: CloseOutState;
  /** The latest review status (any author), for a comment that is open. */
  status: PdfAnnotationState | null;
  /** The close-out's check highlight, when it has one. */
  checkId: string | null;
  annot: PdfAnnotationObject;
}

const time = (a: PdfAnnotationObject): number => (a.created ?? a.modified)?.getTime() ?? 0;

/**
 * The close-out list of the old revision (`all`: every annotation of
 * Document A): each comment with its state, comments with typed text first,
 * then markup without text, each group by page and then by place on the page
 * (top to bottom, then left to right; ADR-033). Highlights are listed and
 * marked, for the list's Hide highlights; a close-out's own parts are not.
 */
export function closeOutRows(all: readonly PdfAnnotationObject[]): CloseOutRow[] {
  const kids = new Map<string, PdfAnnotationObject[]>();
  for (const a of all) {
    if (!a.inReplyToId || !isCloseOutPart(a)) continue;
    const list = kids.get(a.inReplyToId) ?? [];
    list.push(a);
    kids.set(a.inReplyToId, list);
  }
  const out: CloseOutRow[] = [];
  for (const c of commentsOf(all)) {
    if (isCloseOutPart(c.annot)) continue;
    const parts = kids.get(c.id) ?? [];
    let reply: PdfAnnotationObject | null = null;
    for (const p of parts) if (outcomeOf(p) && (!reply || time(p) >= time(reply))) reply = p;
    const outcome = reply ? outcomeOf(reply) : null;
    const done = c.status === PdfAnnotationState.Completed;
    out.push({
      id: c.id,
      group: c.contents.trim() === '' ? 'markup' : 'text',
      highlight: isHighlightType(c.annot),
      number: c.number,
      page: c.page,
      type: c.type,
      author: c.author,
      firstLine: c.firstLine,
      state: done ? (outcome ?? 'completed') : 'open',
      status: c.status,
      checkId: parts.find(isCheckPart)?.id ?? null,
      annot: c.annot,
    });
  }
  return out.sort(byListOrder);
}

/** Text first, then markup; by page; then top to bottom and left to right (pt, rounded). */
function byListOrder(p: CloseOutRow, q: CloseOutRow): number {
  const g = CLOSE_OUT_GROUPS.indexOf(p.group) - CLOSE_OUT_GROUPS.indexOf(q.group);
  if (g !== 0) return g;
  if (p.page !== q.page) return p.page - q.page;
  const dy = Math.round(p.annot.rect.origin.y) - Math.round(q.annot.rect.origin.y);
  if (dy !== 0) return dy;
  const dx = Math.round(p.annot.rect.origin.x) - Math.round(q.annot.rect.origin.x);
  return dx !== 0 ? dx : p.number - q.number;
}

/** The parts a close-out added to comment `rootId` (Reopen deletes them). */
export function partsOf(
  all: readonly PdfAnnotationObject[],
  rootId: string,
): PdfAnnotationObject[] {
  return all.filter((a) => a.inReplyToId === rootId && isCloseOutPart(a));
}

/** Whether Reopen has something to take away: a state, reply or highlight of a close-out. */
export const canReopen = (all: readonly PdfAnnotationObject[], rootId: string): boolean =>
  partsOf(all, rootId).some((a) => isStateReply(a) || outcomeOf(a) !== null || isCheckPart(a));

/** The list's filter: everything, the comments still open, or those closed. */
export type CloseOutFilter = 'all' | 'open' | 'closed';

export const CLOSE_OUT_FILTERS: readonly CloseOutFilter[] = ['all', 'open', 'closed'];

export const isClosed = (s: CloseOutState): boolean => s !== 'open';

/** Without the highlight-type comments when `hideHighlights` (ADR-033). */
export const withoutHighlights = (
  rows: readonly CloseOutRow[],
  hideHighlights: boolean,
): CloseOutRow[] => (hideHighlights ? rows.filter((r) => !r.highlight) : [...rows]);

export function filterRows(
  rows: readonly CloseOutRow[],
  f: CloseOutFilter,
  hideHighlights = false,
): CloseOutRow[] {
  const shown = withoutHighlights(rows, hideHighlights);
  if (f === 'all') return shown;
  return shown.filter((r) => isClosed(r.state) === (f === 'closed'));
}

export function counts(rows: readonly CloseOutRow[]): { open: number; closed: number } {
  let closed = 0;
  for (const r of rows) if (isClosed(r.state)) closed++;
  return { open: rows.length - closed, closed };
}

/** Points the check highlight reaches past the comment on each side. */
export const CHECK_PAD = 2;

/** The check highlight's box: the comment's, a little larger (page points, top-left origin). */
export function checkRect(r: Rect, pad = CHECK_PAD): Rect {
  return {
    origin: { x: r.origin.x - pad, y: r.origin.y - pad },
    size: { width: r.size.width + 2 * pad, height: r.size.height + 2 * pad },
  };
}

/** The default check highlight colour (Q16: green; the swatch picker changes it). */
export const DEFAULT_CHECK_COLOUR = '#00ff00';

/** The check highlight's opacity: see-through, so the comment stays readable. */
export const CHECK_HIGHLIGHT_OPACITY = 0.4;

export interface CloseOutText {
  /** The status reply's /Contents ("Completed set by …", as the Set status menu writes it). */
  state: string;
  /** The automatic reply: the outcome and the new file ("Carried over to RevB.pdf"). */
  reply: string;
}

/**
 * What closing `root` out as `outcome` adds (Q16, the plan's question 1): the
 * Completed status, the automatic reply and the check highlight grouped with
 * the comment, all by `author` at `now`. Pure.
 */
export function closeOutParts(
  root: PdfAnnotationObject,
  outcome: Outcome,
  o: { author: string; now: Date; text: CloseOutText; colour: string; uuid: () => string },
): PdfAnnotationObject[] {
  const ids = partIds(outcome, o.uuid);
  const state = makeState(
    root,
    PdfAnnotationState.Completed,
    o.author,
    o.text.state,
    o.now,
    ids.state,
  );
  const reply = makeReply(root, o.text.reply, o.author, o.now, ids.reply);
  const box = checkRect(root.rect);
  const check = {
    type: S.HIGHLIGHT,
    id: ids.check,
    pageIndex: root.pageIndex,
    rect: box,
    segmentRects: [box],
    strokeColor: o.colour,
    color: o.colour,
    opacity: CHECK_HIGHLIGHT_OPACITY,
    blendMode: PdfBlendMode.Multiply,
    author: o.author,
    created: o.now,
    modified: o.now,
    flags: ['print'],
    // Grouped with the comment: it moves, copies and is deleted with it.
    inReplyToId: root.id,
    replyType: PdfAnnotationReplyType.Group,
  } as PdfAnnotationObject;
  return [state, reply, check];
}
