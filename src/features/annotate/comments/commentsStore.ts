// Comments pane state (M3-11, M6-05): filter, sort, grouping and collapsed
// groups per document, the card being edited, the on-page number overlay
// switch, and the comments derived from the plugin's store (cached per state,
// so selection changes don't recompute 10,000 comments).
import type { PdfAnnotationObject } from '@embedpdf/models';
import type { AnnotationDocumentState } from '@embedpdf/plugin-annotation';
import { useEffect, useState } from 'react';
import { createStore, useStore } from 'zustand';
import { useHost } from '../../view/host';
import { annotationCapability } from '../selection';
import {
  commentsOf,
  numberComments,
  type Comment,
  type CommentFilter,
  type CommentGroup,
  type CommentSort,
} from './commentsModel';

export interface CommentsView {
  filter: CommentFilter;
  sort: CommentSort;
  group: CommentGroup;
  /** Collapsed group keys. */
  collapsed: readonly string[];
  /** "Current page only": the page filter follows the current page. */
  currentPageOnly: boolean;
}

/**
 * The inline editor of a card (M6-05): a new reply to a comment, or the text
 * of a comment or of one of its replies (`target`).
 */
export type CommentEdit =
  | { docId: string; kind: 'reply'; root: string }
  | { docId: string; kind: 'text'; root: string; target: string };

interface CommentsState {
  byDoc: Record<string, CommentsView>;
  editing: CommentEdit | null;
  /** Show each comment's number on the page (comment.autoNumber). */
  numbersOnPage: boolean;
  /** Bumped to move focus to Find (comment.filter). */
  focusFilters: number;
  /** Bumped to open Set status on the pane's toolbar (comment.setStatus, M3-12). */
  focusStatus: number;
}

export const commentsStore = createStore<CommentsState>()(() => ({
  byDoc: {},
  editing: null,
  numbersOnPage: false,
  focusFilters: 0,
  focusStatus: 0,
}));

export function useComments<T>(selector: (s: CommentsState) => T): T {
  return useStore(commentsStore, selector);
}

const DEFAULT: CommentsView = {
  filter: {},
  sort: 'page',
  group: 'page',
  collapsed: [],
  currentPageOnly: false,
};

export const viewOf = (s: CommentsState, docId: string): CommentsView => s.byDoc[docId] ?? DEFAULT;

export function setView(docId: string, patch: Partial<CommentsView>): void {
  commentsStore.setState((s) => ({
    byDoc: { ...s.byDoc, [docId]: { ...viewOf(s, docId), ...patch } },
  }));
}

export function setEditing(edit: CommentEdit | null): void {
  commentsStore.setState({ editing: edit });
}

type ByUid = AnnotationDocumentState['byUid'];
const objectsCache = new WeakMap<ByUid, PdfAnnotationObject[]>();
const commentsCache = new WeakMap<ByUid, Comment[]>();
const numbersCache = new WeakMap<ByUid, Map<string, number>>();

export const objectsOf = (byUid: ByUid): PdfAnnotationObject[] => {
  let o = objectsCache.get(byUid);
  if (!o) {
    o = Object.values(byUid).map((t) => t.object);
    objectsCache.set(byUid, o);
  }
  return o;
};

export function commentsFor(byUid: ByUid): Comment[] {
  let c = commentsCache.get(byUid);
  if (!c) {
    c = commentsOf(objectsOf(byUid));
    commentsCache.set(byUid, c);
  }
  return c;
}

export function numbersFor(byUid: ByUid): Map<string, number> {
  let n = numbersCache.get(byUid);
  if (!n) {
    n = numberComments(objectsOf(byUid));
    numbersCache.set(byUid, n);
  }
  return n;
}

/** The document's annotation map (null before the plugin has loaded it). */
export function useAnnotationMap(docId: string | null): ByUid | null {
  const registry = useHost((s) => s.registry);
  const [state, setState] = useState<{ doc: string | null; byUid: ByUid | null }>({
    doc: null,
    byUid: null,
  });
  useEffect(() => {
    if (!registry || !docId) return;
    const scope = annotationCapability()?.forDocument(docId);
    if (!scope) return;
    const update = (st: AnnotationDocumentState): void => {
      const byUid = st.byUid;
      setState((prev) =>
        prev.doc === docId && prev.byUid === byUid ? prev : { doc: docId, byUid },
      );
    };
    try {
      update(scope.getState());
    } catch {
      // The document's state appears with its first change.
    }
    return scope.onStateChange(update);
  }, [registry, docId]);
  return state.doc === docId ? state.byUid : null;
}
