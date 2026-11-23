// Review across revisions (M12-15, D-62, Q15, Q16, Q43): aligned Copy to New
// Revision (and back), aligned paste between the windows, and close-out of
// the old revision's comments.
//
// Copy runs the comment transfer (ADR-018) in the Work worker: the comments
// are copied with their replies and appearances into a small clipboard PDF,
// then into the other revision with the map between the two pages as
// displayed (the sheet's alignment, or the matching text), one undo step in
// the target. Copying needs copy in the source, annotate in the target (rule 9).
//
// Close-out adds three standard annotations to the old comment as one undo
// step (closeOutModel.ts): the Completed status, the automatic reply and the
// grouped check highlight. Carried over first copies the comment.
import { PdfAnnotationState, uuidV4, type PdfAnnotationObject } from '@embedpdf/models';
import { recordError } from '../../../app/diagnostics';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { RpcError } from '../../../engine/errors';
import { msg, t, type MessageKey } from '../../../i18n';
import type { WindowRole } from '../../../model/compare/link';
import type { Affine } from '../../../model/compare/material';
import { allows } from '../../../model/permissions';
import { currentAuthor } from '../../annotate/authoring';
import { objectsOf } from '../../annotate/comments/commentsStore';
import { STATUS_KEYS } from '../../annotate/comments/statusLabels';
import { joinStep } from '../../annotate/historyJoin';
import { annotationCapability, annotationState } from '../../annotate/selection';
import { rootsOf, setAlignedPaste, type Clip } from '../../annotate/transfer/copyPaste';
import { announceTransfer } from '../../annotate/transfer/transferAnnounce';
import { runTransfer, showPagesError, syncLive, transferBlocked } from '../../pages/pageOps';
import { requestProfile } from '../../settings/profile/profileStore';
import { workClient } from '../../view/host';
import { closeOutParts, partsOf, type Outcome } from './closeOutModel';
import { landing, nameOf, pasteLanding, windowOf } from './context';
import { closeOutStore } from './closeOutStore';

/** The other revision: Copy to New Revision from A (and the notes), back to Old from B. */
export type CopyDirection = 'a' | 'b';

const scope = (docId: string) => annotationCapability()?.forDocument(docId) ?? null;

function allObjects(docId: string): PdfAnnotationObject[] {
  const st = annotationState(docId);
  return st ? objectsOf(st.byUid) : [];
}

/** The thread roots of the selected comments of a document. */
export function selectedRootObjects(docId: string): PdfAnnotationObject[] {
  const st = annotationState(docId);
  if (!st) return [];
  const all = objectsOf(st.byUid);
  const selected = st.selectedUids
    .map((uid) => st.byUid[uid]?.object)
    .filter((o): o is PdfAnnotationObject => o !== undefined);
  const byId = new Map(all.map((a) => [a.id, a]));
  return rootsOf(selected, all)
    .map((id) => byId.get(id))
    .filter((a): a is PdfAnnotationObject => !!a);
}

/** The vertical middle of a comment (page points): the text it sits on in a text comparison. */
const middle = (a: Pick<PdfAnnotationObject, 'rect'>): number =>
  a.rect.origin.y + a.rect.size.height / 2;

interface Batch {
  roots: PdfAnnotationObject[];
  target: string;
  /** Target page per source page, and the map onto it. */
  land: Map<number, { page: number; map: Affine }>;
}

/**
 * The copies to make: an overlay's comments go page by page (one alignment per
 * sheet); a text comparison's one by one (each to its own matching text).
 */
function batchesOf(
  docId: string,
  roots: readonly PdfAnnotationObject[],
  to: CopyDirection,
): Batch[] | null {
  const w = windowOf(docId);
  if (!w || w.role === to) return null;
  const c = w.comparison;
  const groups = new Map<string, PdfAnnotationObject[]>();
  for (const r of roots) {
    const key = c.type === 'overlay' ? String(r.pageIndex) : r.id;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: Batch[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    if (!first) continue;
    const l = landing(c, { docId, page: first.pageIndex }, to, middle(first));
    if (!l) return null;
    const last = out.at(-1);
    if (c.type === 'overlay' && last?.target === l.docId) {
      last.roots.push(...list);
      last.land.set(first.pageIndex, { page: l.page, map: l.map });
    } else
      out.push({
        roots: [...list],
        target: l.docId,
        land: new Map([[first.pageIndex, { page: l.page, map: l.map }]]),
      });
  }
  return out;
}

/** Why the selected comments can't be copied to the other revision now (null: they can). */
export function copyToBlocked(
  docId: string | null,
  to: CopyDirection,
  roots: readonly PdfAnnotationObject[] = docId ? selectedRootObjects(docId) : [],
): MessageKey | null {
  const w = windowOf(docId);
  if (!docId || !w || w.role === to) return msg('compare.closeout.notInComparison');
  const d = documentStore.getState().docs[docId];
  if (!d || !allows(securityOf(d.meta), 'copy')) return msg('protect.restricted');
  if (roots.length === 0) return msg('transfer.copy.none');
  const batches = batchesOf(docId, roots, to);
  if (!batches || batches.length === 0) return msg('compare.closeout.noMatch');
  for (const b of batches) {
    const why = transferBlocked(b.target);
    if (why) return why;
  }
  return null;
}

/**
 * Copies comments of one window onto the matching spot of the other revision,
 * with their replies. Resolves to the number of comments copied (0: none).
 */
export async function copyToRevision(
  docId: string,
  to: CopyDirection,
  roots: readonly PdfAnnotationObject[] = selectedRootObjects(docId),
): Promise<number> {
  const batches = batchesOf(docId, roots, to);
  if (!batches || batches.length === 0) {
    showPagesError(msg('compare.closeout.noMatch'));
    return 0;
  }
  let copied = 0;
  try {
    await syncLive(docId);
    for (const b of batches) {
      const clip = await workClient().run('copyComments', {
        docId,
        ids: b.roots.map((r) => r.id),
        withReplies: true,
      }).promise;
      const pageMap = clip.pages.map((p) => b.land.get(p)?.page ?? null);
      const place = clip.pages.map((p) => b.land.get(p)?.map ?? null);
      let count = 0;
      const ok = await runTransfer(
        b.target,
        msg('compare.closeout.copying'),
        async (progress, onCancel) => {
          const job = workClient().run(
            'transferComments',
            {
              docId: b.target,
              source: { bytes: clip.bytes.slice(0) },
              spec: { newNames: true, withReplies: true, pageMap, place },
            },
            { onProgress: progress },
          );
          onCancel(() => {
            job.cancel();
          });
          const r = await job.promise;
          count = r.counts.roots;
          return { objects: r.objects, firstNew: r.firstNew };
        },
      );
      if (!ok) break;
      copied += count;
      announceTransfer(b.target, t('compare.closeout.copied', { count, name: nameOf(b.target) }));
    }
  } catch (err) {
    if (err instanceof RpcError && err.code.startsWith('permission-denied'))
      showPagesError(msg('protect.restricted'));
    else {
      recordError('compare.copyToRevision', err);
      showPagesError(msg('transfer.copy.failed'));
    }
  }
  return copied;
}

/**
 * The aligned paste (Q16): comments copied in one window of the comparison in
 * use land on the matching spot when pasted into another. The clipboard's
 * bounding box stands for its comments' place on the text.
 */
export const alignedPaste = (clip: Clip, target: { docId: string; page: number }) => {
  const y = clip.bounds ? clip.bounds.y + clip.bounds.height / 2 : 0;
  const pageMap: number[] = [];
  const place: Affine[] = [];
  for (const p of clip.pages) {
    const l = pasteLanding({ docId: clip.sourceDocId, page: p }, target, y);
    if (!l) return null;
    pageMap.push(l.page);
    place.push(l.map);
  }
  return pageMap.length ? { pageMap, place } : null;
};

export const installAlignedPaste = (): (() => void) => setAlignedPaste(alignedPaste);

// ---------------------------------------------------------------- close-out

/** Why comments of `docId` can't be closed out now (null: they can). */
export function closeOutBlocked(docId: string | null): MessageKey | null {
  const w = windowOf(docId);
  if (!docId || w?.role !== 'a') return msg('compare.closeout.oldOnly');
  const d = documentStore.getState().docs[docId];
  if (!d || !allows(securityOf(d.meta), 'annotate')) return msg('protect.restricted');
  return null;
}

/** The file named in the automatic reply: where the comment's sheet is in B (else B's first file). */
function newFileFor(docId: string, root: PdfAnnotationObject): string {
  const w = windowOf(docId);
  if (!w) return '';
  const l = landing(w.comparison, { docId, page: root.pageIndex }, 'b', middle(root));
  const target = l?.docId ?? w.comparison.b[0]?.docId;
  return target ? nameOf(target) : '';
}

const REPLY: Record<Outcome, MessageKey> = {
  addressed: msg('compare.closeout.reply_addressed'),
  carried: msg('compare.closeout.reply_carried'),
  changed: msg('compare.closeout.reply_changed'),
};

/**
 * Closes old comments out (Q16): Completed, the automatic reply naming the
 * outcome and the new file, and the check highlight. Carried over copies them
 * to the new revision first (and stops if that fails). One undo step in A.
 */
export async function closeOut(
  docId: string,
  roots: readonly PdfAnnotationObject[],
  outcome: Outcome,
): Promise<boolean> {
  if (roots.length === 0 || closeOutBlocked(docId)) return false;
  await requestProfile();
  if (outcome === 'carried') {
    const copied = await copyToRevision(docId, 'b', roots);
    if (copied === 0) return false;
  }
  const sc = scope(docId);
  if (!sc) return false;
  const author = currentAuthor();
  const now = new Date();
  const colour = closeOutStore.getState().colour;
  const parts = roots.flatMap((root) =>
    closeOutParts(root, outcome, {
      author,
      now,
      colour,
      uuid: uuidV4,
      text: {
        state: t('comments.stateSetBy', {
          state: t(STATUS_KEYS[PdfAnnotationState.Completed]),
          author,
        }),
        reply: t(REPLY[outcome], { name: newFileFor(docId, root) }),
      },
    }),
  );
  const [first, ...rest] = parts;
  if (!first) return false;
  sc.createAnnotation(first.pageIndex, first);
  joinStep(() => {
    for (const p of rest) sc.createAnnotation(p.pageIndex, p);
  });
  announceTransfer(docId, t('compare.closeout.done', { count: roots.length }));
  return true;
}

/** Takes a close-out back: its status, reply and check highlight (one undo step). */
export function reopen(docId: string, roots: readonly PdfAnnotationObject[]): boolean {
  if (closeOutBlocked(docId)) return false;
  const sc = scope(docId);
  const all = allObjects(docId);
  const parts = roots.flatMap((r) => partsOf(all, r.id));
  const [first, ...rest] = parts;
  if (!sc || !first) return false;
  sc.deleteAnnotation(first.pageIndex, first.id);
  joinStep(() => {
    for (const p of rest) sc.deleteAnnotation(p.pageIndex, p.id);
  });
  announceTransfer(docId, t('compare.closeout.reopened', { count: roots.length }));
  return true;
}

/** The window a copy goes to from a document's window: the other revision. */
export const otherRevision = (role: WindowRole): CopyDirection | null =>
  role === 'a' ? 'b' : role === 'b' ? 'a' : null;
