// Reply threads and review status (M3-12, §7.1, M3-Q3): replies are Text
// annotations with /IRT to their parent; a review status is a Text reply with
// /StateModel /Review and /State (hidden, as Acrobat writes them). Pure.
import {
  PdfAnnotationStateModel,
  PdfAnnotationSubtype as S,
  type PdfAnnotationObject,
  PdfAnnotationState,
} from '@embedpdf/models';
import { isAnyState, isMarkReply, isStateReply } from './commentsModel';

export interface ThreadEntry {
  annot: PdfAnnotationObject;
  /** 0 for a reply to the comment, 1 for a reply to that reply, … */
  depth: number;
}

export interface StateEntry {
  author: string;
  state: PdfAnnotationState;
  date: Date;
}

export interface Thread {
  replies: ThreadEntry[];
  /** The latest state per author (M3-Q3), by author name. */
  states: StateEntry[];
  /** Every state reply, oldest first. */
  history: PdfAnnotationObject[];
}

const time = (a: PdfAnnotationObject): number => (a.created ?? a.modified)?.getTime() ?? 0;

/** Replies by parent id (build once to walk many threads). */
export function childrenOf(
  all: readonly PdfAnnotationObject[],
): Map<string, PdfAnnotationObject[]> {
  const kids = new Map<string, PdfAnnotationObject[]>();
  for (const a of all) {
    if (!a.inReplyToId) continue;
    const list = kids.get(a.inReplyToId) ?? [];
    list.push(a);
    kids.set(a.inReplyToId, list);
  }
  return kids;
}

export function buildThread(
  all: readonly PdfAnnotationObject[],
  rootId: string,
  kids: Map<string, PdfAnnotationObject[]> = childrenOf(all),
): Thread {
  const replies: ThreadEntry[] = [];
  const walk = (id: string, depth: number, seen: Set<string>): void => {
    const list = (kids.get(id) ?? [])
      .filter((a) => a.type === S.TEXT && !isAnyState(a))
      .sort((x, y) => time(x) - time(y));
    for (const r of list) {
      if (seen.has(r.id)) continue; // a cycle in a damaged file
      seen.add(r.id);
      replies.push({ annot: r, depth });
      walk(r.id, depth + 1, seen);
    }
  };
  walk(rootId, 0, new Set([rootId]));
  const history = (kids.get(rootId) ?? []).filter(isStateReply).sort((x, y) => time(x) - time(y));
  const latest = new Map<string, StateEntry>();
  for (const s of history) {
    const author = s.author ?? '';
    latest.set(author, {
      author,
      state: (s as { state: PdfAnnotationState }).state,
      date: new Date(time(s)),
    });
  }
  const states = [...latest.values()].sort((x, y) => x.author.localeCompare(y.author));
  return { replies, states, history };
}

/** One entry of a comment's review history (M6-06): a status or a mark. */
export interface HistoryEntry {
  id: string;
  author: string;
  state: PdfAnnotationState;
  /** Review (status) or Marked (the reviewer's tick). */
  model: PdfAnnotationStateModel;
  date: Date | null;
}

/** Every status and mark set on `rootId`, oldest first. */
export function reviewHistory(all: readonly PdfAnnotationObject[], rootId: string): HistoryEntry[] {
  return all
    .filter((a) => a.inReplyToId === rootId && isAnyState(a))
    .sort((x, y) => time(x) - time(y))
    .map((a) => ({
      id: a.id,
      author: a.author ?? '',
      state: (a as { state: PdfAnnotationState }).state,
      model: isMarkReply(a) ? PdfAnnotationStateModel.Marked : PdfAnnotationStateModel.Review,
      date: a.created ?? a.modified ?? null,
    }));
}

/** Whether `author`'s latest mark on `rootId` is Marked (Acrobat's per-reviewer tick). */
export function isMarkedBy(
  all: readonly PdfAnnotationObject[],
  rootId: string,
  author: string,
): boolean {
  let latest: PdfAnnotationObject | null = null;
  for (const a of all) {
    if (a.inReplyToId !== rootId || !isMarkReply(a) || (a.author ?? '') !== author) continue;
    if (!latest || time(a) >= time(latest)) latest = a;
  }
  return (latest as { state?: string } | null)?.state === PdfAnnotationState.Marked;
}

/** Every reply and state under `id`, at any depth (deleted with it). */
export function descendants(all: readonly PdfAnnotationObject[], id: string): string[] {
  const kids = childrenOf(all);
  const out: string[] = [];
  const seen = new Set([id]);
  const walk = (p: string): void => {
    for (const k of kids.get(p) ?? []) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k.id);
      walk(k.id);
    }
  };
  walk(id);
  return out;
}

const base = (parent: PdfAnnotationObject, author: string, now: Date, id: string) => ({
  type: S.TEXT,
  id,
  pageIndex: parent.pageIndex,
  rect: parent.rect,
  inReplyToId: parent.id,
  author,
  created: now,
  modified: now,
});

/** A reply: drawn by no viewer (they skip /IRT notes), listed in their comment lists. */
export function makeReply(
  parent: PdfAnnotationObject,
  text: string,
  author: string,
  now: Date,
  id: string,
): PdfAnnotationObject {
  return {
    ...base(parent, author, now, id),
    contents: text,
    flags: ['print', 'noZoom', 'noRotate'],
    strokeColor: '#FFE14D',
    opacity: 1,
  } as PdfAnnotationObject;
}

/** A review state (M3-Q3): /StateModel /Review, /State, hidden like Acrobat's. */
export function makeState(
  parent: PdfAnnotationObject,
  state: PdfAnnotationState,
  author: string,
  contents: string,
  now: Date,
  id: string,
): PdfAnnotationObject {
  return {
    ...base(parent, author, now, id),
    contents,
    state,
    stateModel: PdfAnnotationStateModel.Review,
    flags: ['hidden', 'print', 'noZoom', 'noRotate'],
    strokeColor: '#FFE14D',
    opacity: 1,
  } as PdfAnnotationObject;
}

/** A review mark (M6-06): /StateModel /Marked, /State Marked or Unmarked, hidden like a status. */
export function makeMark(
  parent: PdfAnnotationObject,
  marked: boolean,
  author: string,
  contents: string,
  now: Date,
  id: string,
): PdfAnnotationObject {
  return {
    ...base(parent, author, now, id),
    contents,
    state: marked ? PdfAnnotationState.Marked : PdfAnnotationState.Unmarked,
    stateModel: PdfAnnotationStateModel.Marked,
    flags: ['hidden', 'print', 'noZoom', 'noRotate'],
    strokeColor: '#FFE14D',
    opacity: 1,
  } as PdfAnnotationObject;
}
