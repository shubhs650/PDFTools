// Flatten Comments on the main thread (M6-09, ADR-021 D-38 c, §7.1): the
// dialog's state, the plan from the annotation store (flattenModel.ts) and the
// run — a page operation in the Render worker (rule 1), one undo step with
// progress and Cancel (rule 2), capability modify + annotate (rule 9). The
// document is then marked "optimize recommended" (§7.8).
import type { PdfAnnotationObject } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { documentStore } from '../../../app/store/documentStore';
import { msg, t } from '../../../i18n';
import { flattenBlocked, runFlatten } from '../../pages/pageOps';
import { recommendOptimize } from '../../save/save';
import { annotationState } from '../selection';
import { announceTransfer } from '../transfer/transferAnnounce';
import {
  planFlatten,
  type FlattenAnnot,
  type FlattenPlan,
  type FlattenRequest,
} from './flattenModel';

interface FlattenState {
  /** The document whose Flatten Comments dialog is open. */
  docId: string | null;
  /** What the dialog starts with: the selected comments when there are any. */
  initial: 'selected' | 'pages';
}

export const flattenStore = createStore<FlattenState>()(() => ({
  docId: null,
  initial: 'pages',
}));

export function useFlatten<T>(selector: (s: FlattenState) => T): T {
  return useStore(flattenStore, selector);
}

/** Every annotation of the document, as the planner reads it. */
export function flattenAnnotations(docId: string): FlattenAnnot[] {
  const st = annotationState(docId);
  if (!st) return [];
  return Object.values(st.byUid).map(({ object: o }) => toFlattenAnnot(o));
}

function toFlattenAnnot(o: PdfAnnotationObject): FlattenAnnot {
  const x = o as PdfAnnotationObject & { stateModel?: string };
  return {
    id: o.id,
    pageIndex: o.pageIndex,
    type: o.type,
    inReplyToId: o.inReplyToId,
    replyType: o.replyType,
    flags: o.flags,
    stateModel: x.stateModel,
  };
}

/** Ids of the selected annotations. */
export function selectedIds(docId: string): string[] {
  const st = annotationState(docId);
  if (!st) return [];
  return st.selectedUids
    .map((uid) => st.byUid[uid]?.object.id)
    .filter((id): id is string => id !== undefined);
}

export function previewFlatten(docId: string, req: FlattenRequest): FlattenPlan {
  return planFlatten(flattenAnnotations(docId), req);
}

export function openFlatten(docId: string): void {
  flattenStore.setState({
    docId,
    initial: selectedIds(docId).length > 0 ? 'selected' : 'pages',
  });
}

export function closeFlatten(): void {
  flattenStore.setState({ docId: null });
}

/** Why Flatten Selected Comments can't run (null: it can). */
export function flattenSelectedBlocked(docId: string): ReturnType<typeof flattenBlocked> {
  const blocked = flattenBlocked(docId);
  if (blocked) return blocked;
  return previewFlatten(docId, {
    scope: { kind: 'selected', ids: selectedIds(docId) },
    keepReplies: false,
  }).comments > 0
    ? null
    : msg('annotate.noneSelected');
}

/**
 * Runs a plan. True when it was applied (the dialog closes); false when
 * blocked, cancelled or failed (a failure says so in the pages error dialog).
 */
export async function applyFlatten(docId: string, plan: FlattenPlan): Promise<boolean> {
  if (plan.comments === 0) return false;
  const counts = await runFlatten(docId, plan.pages, msg('flatten.running'));
  if (!counts) return false;
  recommendOptimize(docId);
  const name = documentStore.getState().docs[docId]?.meta.name ?? '';
  // Comments, as the dialog counted them (a comment's grouped parts are drawn with it).
  const parts = [t('flatten.done', { count: Math.max(0, plan.comments - counts.failed), name })];
  if (counts.failed > 0) parts.push(t('flatten.failedSome', { count: counts.failed }));
  announceTransfer(docId, parts.join(' '));
  return true;
}

/** The comment menu's Flatten (M6-09): the selected comments, replies removed, no dialog. */
export async function flattenSelected(docId: string): Promise<boolean> {
  const plan = previewFlatten(docId, {
    scope: { kind: 'selected', ids: selectedIds(docId) },
    keepReplies: false,
  });
  return applyFlatten(docId, plan);
}
