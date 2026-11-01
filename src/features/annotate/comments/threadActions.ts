// Replying, editing replies, setting a review status and deleting a comment
// with its thread (M3-12). The reviewer profile comes first (M3-07); every
// change needs the annotate permission (commands, the pane's fieldset and the
// Render worker, rule 9).
import { uuidV4, type PdfAnnotationObject, type PdfAnnotationState } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { t } from '../../../i18n';
import { requestProfile } from '../../settings/profile/profileStore';
import { currentAuthor } from '../authoring';
import { joinStep } from '../historyJoin';
import { annotationCapability, annotationState } from '../selection';
import { STATUS_KEYS } from './statusLabels';
import { descendants, makeReply, makeState } from './thread';

const scope = (docId: string) => annotationCapability()?.forDocument(docId) ?? null;

export async function addReply(
  docId: string,
  parent: PdfAnnotationObject,
  text: string,
): Promise<void> {
  if (!text.trim()) return;
  await requestProfile();
  const reply = makeReply(parent, text.trim(), currentAuthor(), new Date(), uuidV4());
  scope(docId)?.createAnnotation(parent.pageIndex, reply);
}

export function editReply(docId: string, reply: PdfAnnotationObject, text: string): void {
  scope(docId)?.updateAnnotation(reply.pageIndex, reply.id, {
    contents: text,
    modified: new Date(),
  });
}

export async function setStatus(
  docId: string,
  parent: PdfAnnotationObject,
  state: PdfAnnotationState,
): Promise<void> {
  await requestProfile();
  const author = currentAuthor();
  // /Contents as Acrobat writes it ("Accepted set by …"), so other viewers' lists read well.
  const contents = t('comments.stateSetBy', { state: t(STATUS_KEYS[state]), author });
  scope(docId)?.createAnnotation(
    parent.pageIndex,
    makeState(parent, state, author, contents, new Date(), uuidV4()),
  );
}

export function reselect(docId: string, a: PdfAnnotationObject): void {
  scope(docId)?.selectAnnotation(a.pageIndex, a.id);
}

/** Whether `a` was written by the current reviewer (only they edit or delete it). */
export const isMine = (a: PdfAnnotationObject): boolean => (a.author ?? '') === currentAuthor();

// ------------------------------------------------------------ delete with replies

interface DeleteState {
  pending: { docId: string; plan: DeletePlan; replies: number } | null;
}

export const deleteStore = createStore<DeleteState>()(() => ({ pending: null }));
export const useDeleteConfirm = <T>(sel: (s: DeleteState) => T): T => useStore(deleteStore, sel);

interface DeletePlan {
  /** Deleted one by one, deepest first: replies below the direct replies. */
  deep: PdfAnnotationObject[];
  /** Deleted with the plugin's delete, which takes their direct replies with them. */
  tops: PdfAnnotationObject[];
  /** Replies and states that go too (for the question). */
  replies: number;
}

function planDelete(docId: string, targets: readonly PdfAnnotationObject[]): DeletePlan {
  const st = annotationState(docId);
  const all = st ? Object.values(st.byUid).map((x) => x.object) : [];
  const byId = new Map(all.map((a) => [a.id, a]));
  const under = new Set<string>();
  for (const a of targets) for (const id of descendants(all, a.id)) under.add(id);
  const tops = targets.filter((a) => !under.has(a.id));
  const topIds = new Set(tops.map((a) => a.id));
  // Direct replies of a top go with it (one undo step); deeper ones first, deepest first.
  const depth = (a: PdfAnnotationObject): number => {
    let d = 0;
    let p = a.inReplyToId ? byId.get(a.inReplyToId) : undefined;
    while (p && !topIds.has(p.id) && d < 64) {
      d++;
      p = p.inReplyToId ? byId.get(p.inReplyToId) : undefined;
    }
    return d;
  };
  const deep = [...under]
    .map((id) => byId.get(id))
    .filter((a): a is PdfAnnotationObject => !!a && !topIds.has(a.inReplyToId ?? ''))
    .sort((x, y) => depth(y) - depth(x));
  return { deep, tops, replies: under.size };
}

function remove(docId: string, plan: DeletePlan): void {
  const sc = scope(docId);
  for (const a of [...plan.deep, ...plan.tops]) sc?.deleteAnnotation(a.pageIndex, a.id);
}

/**
 * Cut (M6-02): deletes the comments and their threads without asking (the copy
 * holds them), as one undo step.
 */
export function removeThreads(docId: string, targets: readonly PdfAnnotationObject[]): void {
  const plan = planDelete(docId, targets);
  const sc = scope(docId);
  const [first, ...rest] = [...plan.deep, ...plan.tops];
  if (!first || !sc) return;
  sc.deleteAnnotation(first.pageIndex, first.id);
  joinStep(() => {
    for (const a of rest) sc.deleteAnnotation(a.pageIndex, a.id);
  });
}

/** Delete: at once, or after asking when the comments have replies (M3-12). */
export function deleteComments(docId: string, targets: readonly PdfAnnotationObject[]): void {
  const plan = planDelete(docId, targets);
  if (plan.replies === 0) remove(docId, plan);
  else deleteStore.setState({ pending: { docId, plan, replies: plan.replies } });
}

export function confirmDelete(ok: boolean): void {
  const p = deleteStore.getState().pending;
  deleteStore.setState({ pending: null });
  if (ok && p) remove(p.docId, p.plan);
}
