// Copy and paste comments (M4-21, §7.1, ADR-018 decisions 5 and 8): the
// selected comments (on the page or in the Comments pane), with their replies,
// states and appearances, are copied by the Work worker into a small PDF held
// here — an in-app clipboard only, never the system clipboard. Paste runs the
// M4-20 transfer from it: onto the current page at the same position (10 pt
// right and down when that is the page they came from), or onto the pages
// they came from; every copy gets a new /NM, replies follow their copies; one
// undo step. Copying needs copy in the source, pasting annotate in the target
// (rule 9).
import type { PdfAnnotationObject } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { RpcError } from '../../../engine/errors';
import { msg, t, type MessageKey } from '../../../i18n';
import { allows } from '../../../model/permissions';
import { runTransfer, showPagesError, syncLive, transferBlocked } from '../../pages/pageOps';
import { workClient } from '../../view/host';
import { objectsOf } from '../comments/commentsStore';
import { annotationState } from '../selection';
import { announceTransfer } from './transferAnnounce';

export interface Clip {
  /** The clipboard PDF: empty pages with the copied comments. */
  bytes: ArrayBuffer;
  /** Page `i` of the clipboard came from this page of the source. */
  pages: number[];
  sourceDocId: string;
  /** Comments (thread roots) copied. */
  count: number;
}

export const clipboardStore = createStore<{ clip: Clip | null }>()(() => ({ clip: null }));

export const useClip = (): Clip | null => useStore(clipboardStore, (s) => s.clip);

/** Where a paste goes. */
export type PasteMode = 'current' | 'original';

/** Pasted this far right and down (points) onto the page the comments came from. */
export const PASTE_OFFSET = 10;

/**
 * The comments to copy for a selection: each selected annotation's thread root
 * (a selected reply copies its comment), once, in selection order. Pure.
 */
export function rootsOf(
  selected: readonly Pick<PdfAnnotationObject, 'id' | 'inReplyToId'>[],
  all: readonly Pick<PdfAnnotationObject, 'id' | 'inReplyToId'>[],
): string[] {
  const byId = new Map(all.map((a) => [a.id, a]));
  const out: string[] = [];
  for (const s of selected) {
    let cur = s;
    const seen = new Set<string>();
    while (cur.inReplyToId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = byId.get(cur.inReplyToId);
      if (!parent) break;
      cur = parent;
    }
    if (!out.includes(cur.id)) out.push(cur.id);
  }
  return out;
}

/**
 * Target page per clipboard page, and whether the paste is shifted (it lands
 * on a page it came from, in the same document). Pure.
 */
export function pastePlan(
  clip: Pick<Clip, 'pages' | 'sourceDocId'>,
  target: { docId: string; page: number; pageCount: number },
  mode: PasteMode,
): { pageMap: (number | null)[]; shift: boolean } {
  const pageMap = clip.pages.map((p) =>
    mode === 'current' ? target.page : p < target.pageCount ? p : null,
  );
  const same = clip.sourceDocId === target.docId;
  const shift = same && pageMap.some((p, i) => p !== null && p === clip.pages[i]);
  return { pageMap, shift };
}

function selectedObjects(docId: string): PdfAnnotationObject[] {
  const st = annotationState(docId);
  if (!st) return [];
  return st.selectedUids
    .map((uid) => st.byUid[uid]?.object)
    .filter((o): o is PdfAnnotationObject => o !== undefined);
}

/** Why the selection can't be copied now (null: it can). */
export function copyBlocked(docId: string | null): MessageKey | null {
  if (!docId) return msg('ribbon.needsDocument');
  const d = documentStore.getState().docs[docId];
  if (!d) return msg('ribbon.needsDocument');
  if (!allows(securityOf(d.meta), 'copy')) return msg('protect.restricted');
  if (selectedObjects(docId).length === 0) return msg('transfer.copy.none');
  return null;
}

/** Why the clipboard can't be pasted into the document now (null: it can). */
export function pasteBlocked(docId: string | null): MessageKey | null {
  if (!docId) return msg('ribbon.needsDocument');
  if (!clipboardStore.getState().clip) return msg('transfer.paste.empty');
  return transferBlocked(docId);
}

/** Copies the selected comments (with their replies) to the in-app clipboard. */
export async function copySelectedComments(docId: string): Promise<boolean> {
  if (copyBlocked(docId)) return false;
  const st = annotationState(docId);
  const ids = rootsOf(selectedObjects(docId), st ? objectsOf(st.byUid) : []);
  try {
    await syncLive(docId);
    const r = await workClient().run('copyComments', { docId, ids, withReplies: true }).promise;
    clipboardStore.setState({
      clip: { bytes: r.bytes, pages: r.pages, sourceDocId: docId, count: r.count },
    });
    announceTransfer(docId, t('transfer.copied', { count: r.count }));
    return true;
  } catch (err) {
    if (err instanceof RpcError && err.code.startsWith('permission-denied'))
      showPagesError(msg('protect.restricted'));
    else {
      recordError('transfer.copy', err);
      showPagesError(msg('transfer.copy.failed'));
    }
    return false;
  }
}

/** Pastes the clipboard into the document (one undo step). */
export async function pasteComments(docId: string, mode: PasteMode): Promise<boolean> {
  const clip = clipboardStore.getState().clip;
  if (!clip || pasteBlocked(docId)) return false;
  const d = documentStore.getState().docs[docId];
  if (!d) return false;
  const { pageMap, shift } = pastePlan(
    clip,
    { docId, page: d.view.page, pageCount: d.meta.pageCount },
    mode,
  );
  let count = 0;
  try {
    const ok = await runTransfer(docId, msg('transfer.pasting'), async (progress, onCancel) => {
      const job = workClient().run(
        'transferComments',
        {
          docId,
          source: { bytes: clip.bytes.slice(0) },
          spec: {
            newNames: true,
            withReplies: true,
            pageMap,
            ...(shift ? { shift: { dx: PASTE_OFFSET, dy: PASTE_OFFSET } } : {}),
          },
        },
        { onProgress: progress },
      );
      onCancel(() => {
        job.cancel();
      });
      const r = await job.promise;
      count = r.counts.roots;
      return { objects: r.objects, firstNew: r.firstNew };
    });
    if (ok) announceTransfer(docId, t('transfer.pasted', { count }));
    else if (count === 0 && mode === 'original') showPagesError(msg('transfer.paste.noPages'));
    return ok;
  } catch (err) {
    recordError('transfer.paste', err);
    showPagesError(msg('transfer.paste.failed'));
    return false;
  }
}

/** Ctrl+C: selected comments → comments; otherwise the text selection (M4-21). Pure. */
export function copyRoute(s: { comments: number; text: boolean }): 'comments' | 'text' {
  return s.comments > 0 && !s.text ? 'comments' : 'text';
}

/** Selected annotations in the document (for key routing). */
export const selectedCount = (docId: string): number => selectedObjects(docId).length;
