// A change made while the page's last commit is still running is written too
// (M7-04, bug B13; found in M7-02). The annotation plugin collects the changed
// comments, sends them to the Render worker and, when that ends, marks every
// comment it sent as written ("synced"), even one that changed again in the
// meantime: so the last of several quick nudges, or a redo straight after an
// undo, never reached the file. Here the plugin's commit keeps the objects it
// sent; when the commit ends, a comment whose object is no longer the one sent
// is marked changed again (the plugin's own patch or move, so its commit loop
// writes it next), and the save waits for that (annotationsSettled).
import type { PluginRegistry } from '@embedpdf/core';
import type { PdfAnnotationObject } from '@embedpdf/models';

const COMMIT = 'ANNOTATION/COMMIT';
const PATCH = 'ANNOTATION/PATCH_ANNOTATION';
const MOVE = 'ANNOTATION/MOVE_ANNOTATION';

type CommitState = 'new' | 'dirty' | 'moved' | 'deleted' | 'synced' | 'ignored';

interface Tracked {
  object: PdfAnnotationObject;
  commitState: CommitState;
}

interface Batch {
  committedUids: string[];
  isEmpty: boolean;
}

interface Action {
  type: string;
  payload?: unknown;
}

interface CommitInternals {
  collectPendingChanges(docId: string, doc: unknown): Batch;
  dispatch(action: Action): unknown;
  getDocumentState(docId: string): { byUid: Record<string, Tracked | undefined> };
}

/**
 * The comments to mark changed again after a commit: those sent whose object
 * changed since (by identity: the plugin replaces it on every change), with
 * the kind of change still pending. A comment deleted meanwhile is the
 * plugin's own business ("deleted" survives the commit).
 */
export function changedDuringCommit(
  sent: ReadonlyMap<string, PdfAnnotationObject>,
  now: Readonly<Record<string, Tracked | undefined>>,
): { uid: string; pageIndex: number; kind: 'move' | 'patch' }[] {
  const out: { uid: string; pageIndex: number; kind: 'move' | 'patch' }[] = [];
  for (const [uid, obj] of sent) {
    const t = now[uid];
    if (!t || t.object === obj || t.commitState === 'deleted' || t.commitState === 'synced')
      continue;
    // Moved since a move: a move again (no new appearance); anything else a full update.
    out.push({
      uid,
      pageIndex: t.object.pageIndex,
      kind: t.commitState === 'moved' ? 'move' : 'patch',
    });
  }
  return out;
}

/** Called once the plugin registry is up (DocumentHost); returns the uninstall. */
export function installCommitGuard(registry: PluginRegistry): () => void {
  const plugin = registry.getPlugin('annotation') as unknown as CommitInternals | null;
  if (
    !plugin ||
    typeof plugin.collectPendingChanges !== 'function' ||
    typeof plugin.dispatch !== 'function' ||
    typeof plugin.getDocumentState !== 'function'
  )
    return () => undefined;
  const collect = plugin.collectPendingChanges.bind(plugin);
  const dispatch = plugin.dispatch.bind(plugin);
  // The objects each document's running commit sent (one commit at a time per document).
  const sent = new Map<string, Map<string, PdfAnnotationObject>>();

  plugin.collectPendingChanges = (docId, doc) => {
    const batch = collect(docId, doc);
    const byUid = plugin.getDocumentState(docId).byUid;
    const objs = new Map<string, PdfAnnotationObject>();
    for (const uid of batch.committedUids) {
      const t = byUid[uid];
      if (t) objs.set(uid, t.object);
    }
    sent.set(docId, objs);
    return batch;
  };
  plugin.dispatch = (action) => {
    if (action.type !== COMMIT) return dispatch(action);
    const { documentId } = action.payload as { documentId: string };
    const objs = sent.get(documentId);
    sent.delete(documentId);
    const again = objs ? changedDuringCommit(objs, plugin.getDocumentState(documentId).byUid) : [];
    const result = dispatch(action);
    // Synced now; the same (empty) change makes each one pending again, as it really is.
    for (const { uid, pageIndex, kind } of again)
      dispatch({
        type: kind === 'move' ? MOVE : PATCH,
        payload: { documentId, pageIndex, id: uid, patch: {} },
      });
    return result;
  };
  return () => {
    plugin.collectPendingChanges = collect;
    plugin.dispatch = dispatch;
  };
}
