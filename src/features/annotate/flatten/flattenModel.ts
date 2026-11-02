// Flatten Comments (M6-09, ADR-021 D-38 c, §7.1): which annotations a flatten
// draws into the page, which it removes and which replies it keeps. Pure; the
// Render worker applies the plan (src/workers/render/flatten.ts).
//
// - Comments only: links, form fields, pop-ups and redaction marks are never
//   flattened (a flattened redaction mark would look redacted and isn't, rule 8).
// - A selected reply stands for its comment (its thread root).
// - Locked comments are left as they are (/F Locked: not to be deleted, which a
//   flatten does); hidden ones too (/F Hidden or NoView: nothing to draw).
// - A flattened comment takes its parts along: grouped annotations (/RT
//   /Group, e.g. a measurement's label) are flattened with it; replies and
//   review states are removed, or — "keep replies" — its direct replies stay as
//   separate notes (their /IRT is dropped); review states always go.
import {
  PdfAnnotationReplyType,
  PdfAnnotationSubtype as S,
  type PdfAnnotationFlagName,
} from '@embedpdf/models';
import type { FlattenPage } from '../../../workers/render/flatten';

/** What the planner reads of an annotation (a subset of EmbedPDF's object). */
export interface FlattenAnnot {
  id: string;
  pageIndex: number;
  type: S;
  inReplyToId?: string | undefined;
  replyType?: PdfAnnotationReplyType | undefined;
  flags?: readonly PdfAnnotationFlagName[] | undefined;
  stateModel?: string | undefined;
}

export type FlattenScope =
  /** The selected comments (ids of any annotation in their threads). */
  | { kind: 'selected'; ids: readonly string[] }
  /** Every comment on the pages given (0-based), or on every page (null). */
  | { kind: 'pages'; pages: readonly number[] | null };

export interface FlattenRequest {
  scope: FlattenScope;
  /** Keep the flattened comments' replies as separate notes (default: removed). */
  keepReplies: boolean;
}

export interface FlattenPlan {
  /** Per page, in page order; only pages with something to do. */
  pages: FlattenPage[];
  /** Comments (thread roots) that will be flattened. */
  comments: number;
  /** Comments in scope left as they are because they are locked. */
  locked: number;
  /** Comments in scope left as they are because they are hidden. */
  hidden: number;
}

/** Never flattened, never counted as comments. */
const NOT_COMMENTS = new Set<S>([S.LINK, S.WIDGET, S.POPUP, S.REDACT]);

const isGroup = (a: FlattenAnnot): boolean => a.replyType === PdfAnnotationReplyType.Group;
const isState = (a: FlattenAnnot): boolean => a.inReplyToId !== undefined && !!a.stateModel;
const has = (a: FlattenAnnot, f: PdfAnnotationFlagName): boolean => a.flags?.includes(f) ?? false;

/** The thread root of an annotation (cycles and missing parents end the walk). */
function rootOf(a: FlattenAnnot, byId: ReadonlyMap<string, FlattenAnnot>): FlattenAnnot {
  let cur = a;
  const seen = new Set<string>();
  while (cur.inReplyToId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.inReplyToId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

export function planFlatten(all: readonly FlattenAnnot[], req: FlattenRequest): FlattenPlan {
  const byId = new Map(all.map((a) => [a.id, a]));
  const children = new Map<string, FlattenAnnot[]>();
  for (const a of all) {
    if (!a.inReplyToId || !byId.has(a.inReplyToId) || a.inReplyToId === a.id) continue;
    const list = children.get(a.inReplyToId) ?? [];
    list.push(a);
    children.set(a.inReplyToId, list);
  }

  // The comments (thread roots) in scope.
  let roots: FlattenAnnot[];
  if (req.scope.kind === 'selected') {
    const seen = new Set<string>();
    roots = [];
    for (const id of req.scope.ids) {
      const a = byId.get(id);
      if (!a) continue;
      const r = rootOf(a, byId);
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      roots.push(r);
    }
  } else {
    const pages = req.scope.pages === null ? null : new Set(req.scope.pages);
    roots = all.filter((a) => rootOf(a, byId) === a && (!pages || pages.has(a.pageIndex)));
  }
  roots = roots.filter((r) => !NOT_COMMENTS.has(r.type));

  const flatten = new Set<FlattenAnnot>();
  const remove = new Set<FlattenAnnot>();
  const unlink = new Set<FlattenAnnot>();
  let locked = 0;
  let hidden = 0;
  let comments = 0;

  /** Everything below `a` goes (a removed reply's own replies, groups and states). */
  const removeBelow = (a: FlattenAnnot, seen: Set<string>): void => {
    for (const c of children.get(a.id) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      remove.add(c);
      removeBelow(c, seen);
    }
  };
  /** A flattened annotation's parts: groups flattened, states removed, replies removed or kept. */
  const takeParts = (a: FlattenAnnot, seen: Set<string>): void => {
    for (const c of children.get(a.id) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (NOT_COMMENTS.has(c.type)) continue;
      if (isGroup(c) && !has(c, 'hidden') && !has(c, 'noView')) {
        flatten.add(c);
        takeParts(c, seen);
      } else if (isGroup(c) || isState(c) || !req.keepReplies) {
        remove.add(c);
        removeBelow(c, seen);
      } else {
        unlink.add(c);
      }
    }
  };

  for (const r of roots) {
    if (has(r, 'locked')) {
      locked++;
      continue;
    }
    if (has(r, 'hidden') || has(r, 'noView')) {
      hidden++;
      continue;
    }
    comments++;
    flatten.add(r);
    takeParts(r, new Set([r.id]));
  }

  const perPage = new Map<number, FlattenPage>();
  const entry = (page: number): FlattenPage => {
    let e = perPage.get(page);
    if (!e) perPage.set(page, (e = { page, flatten: [], remove: [], unlink: [] }));
    return e;
  };
  for (const a of flatten) entry(a.pageIndex).flatten.push(a.id);
  for (const a of remove) if (!flatten.has(a)) entry(a.pageIndex).remove.push(a.id);
  for (const a of unlink)
    if (!flatten.has(a) && !remove.has(a)) entry(a.pageIndex).unlink.push(a.id);
  const pages = [...perPage.values()].sort((a, b) => a.page - b.page);
  return { pages, comments, locked, hidden };
}

/** Pages the plan changes (the viewer redraws them). */
export const planPages = (plan: Pick<FlattenPlan, 'pages'>): number[] =>
  plan.pages.map((p) => p.page);
