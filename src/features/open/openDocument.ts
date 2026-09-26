// Open pipeline (ARCHITECTURE §4.1, §3.1, M1-13). The main thread only reads
// the file (`File.arrayBuffer()`, async I/O) and transfers the bytes; PDFium
// parses them in the Render worker (rule 1). The Work worker gets its own copy
// afterwards, read again from the file, so the first page never waits for it.
// Opening writes nothing to OPFS: recovery starts on the first edit (§4.3).
import { documentStore } from '../../app/store/documentStore';
import { storageClient } from '../../engine/storageClient';
import type { OpenedFile } from '../../storage/fileAccess';
import {
  capability,
  documentManager,
  hostStore,
  renderEngine,
  startedWorkClient,
  tileCache,
  workClient,
} from '../view/host';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { MAX_DOCUMENTS } from '../view/plugins';
import { dropPageCosts } from '../view/progressivePreview';
import { askPassword } from '../protect/passwordPrompt';
import { startIndexing, stopIndexing } from '../search/indexing';
import { HEADER_WINDOW, OpenError, classifyOpenError, hasPdfHeader } from './errors';
import { advance, openStore, startJob } from './openStore';
import { forgetSaveState } from '../save/save';
import { findDuplicate, originalBlob, sources } from './sources';

const newDocId = (): string => `doc-${crypto.randomUUID()}`;

/** A recovered document (M1-24): bytes from OPFS, maybe re-linked to its file. */
export interface RecoveredOpen extends OpenedFile {
  /**
   * With a re-linked handle: the recovered tail not yet in the file on disk,
   * which the first Ctrl+S writes at offset `at` before its own tail.
   */
  pendingPrefix?: { bytes: ArrayBuffer; at: number };
  /** Recovered documents stay out of the recent list (it holds the file as on disk). */
  recordRecent: false;
}

/** Opens files one after another, each in its own tab, in the given order. */
export async function openFiles(
  files: readonly (OpenedFile | RecoveredOpen)[],
): Promise<(string | undefined)[]> {
  const ids: (string | undefined)[] = [];
  for (const f of files) ids.push(await openOne(f));
  return ids;
}

async function openOne(req: OpenedFile | RecoveredOpen): Promise<string | undefined> {
  const { file, handle } = req;
  const recovered = 'recordRecent' in req;
  const job = startJob(file.name);
  let header = true;
  let docId: string | undefined;
  try {
    const fingerprint = await storageClient().call('fingerprint', { file }).promise;
    const dup = await findDuplicate({ ...(handle ? { handle } : {}), fingerprint });
    if (dup) {
      advance(job, { type: 'duplicate', docId: dup });
      documentStore.getState().activate(dup);
      return dup;
    }
    if (documentStore.getState().order.length >= MAX_DOCUMENTS) throw new OpenError('too-many');
    header = hasPdfHeader(new Uint8Array(await file.slice(0, HEADER_WINDOW).arrayBuffer()));
    if (!header) throw new OpenError('not-pdf');
    advance(job, { type: 'read' });

    // Open; on "password" (PDFium code 4, for a missing and a wrong password
    // alike — ADR-013) ask and open again with fresh bytes: the buffer is
    // transferred to the Render worker on every attempt (rule 1).
    const dm = await documentManager();
    let password: string | undefined;
    let id = '';
    for (;;) {
      const buffer = await file.arrayBuffer();
      id = newDocId();
      docId = id;
      try {
        const res = await dm
          .openDocumentBuffer({
            buffer,
            name: file.name,
            documentId: id,
            autoActivate: false,
            ...(password === undefined ? {} : { password }),
          })
          .toPromise();
        await res.task.toPromise();
        break;
      } catch (err) {
        if (classifyOpenError(err, header) !== 'needs-password') throw err;
        await releaseEngineDocument(id);
        docId = undefined;
        advance(job, { type: 'needs-password', retry: password !== undefined });
        const answer = await askPassword(job);
        if (answer === null) {
          advance(job, { type: 'cancelled' });
          return undefined;
        }
        password = answer;
        advance(job, { type: 'password-given' });
      }
    }
    const info = await renderEngine().rpc.call('docInfo', { docId: id }).promise;

    sources.set(id, {
      file,
      ...(handle ? { handle } : {}),
      fingerprint,
      size: file.size,
      ...(recovered && req.pendingPrefix ? { pendingPrefix: req.pendingPrefix } : {}),
    });
    documentStore.getState().open({
      id,
      name: file.name,
      pageCount: info.pageCount,
      permissions: info.permissions, // rule 9: stored with the document, never overridden
      securityRevision: info.securityRevision,
      ownerUnlocked: info.ownerUnlocked,
      signatureCount: info.signatureCount,
    });
    advance(job, { type: 'opened', docId: id });
    void openInWorkWorker(id, file, password);
    if (recovered) return id;
    void import('../recent/recent')
      .then(({ recordOpened }) =>
        recordOpened({ file, ...(handle ? { handle } : {}), fingerprint }),
      )
      .catch(() => undefined); // the recent list is best effort
    return id;
  } catch (err) {
    if (docId) void releaseEngineDocument(docId);
    advance(job, { type: 'failed', kind: classifyOpenError(err, header) });
    return undefined;
  }
}

async function openInWorkWorker(docId: string, file: File, password?: string): Promise<void> {
  try {
    // The Work client keeps the password in memory for its respawn reloads
    // (ADR-004 decision 4); it is never written anywhere (M2-Q7).
    await workClient().open(docId, await file.arrayBuffer(), {
      reload: async () => (await originalBlob(docId)).arrayBuffer(),
      ...(password === undefined ? {} : { password }),
    });
    // Background indexing (M2-06): from the page in view, when the tab is still open.
    const view = documentStore.getState().docs[docId]?.view;
    if (view) startIndexing(docId, [view.page]);
  } catch {
    // The Work worker copy is opened again lazily by the first Work job that
    // needs it (M1-21); a failure here must not affect the open tab.
  }
}

/** Closes the engine's copy, if the engine is running (closing never starts it). */
async function releaseEngineDocument(docId: string): Promise<void> {
  const registry = hostStore.getState().registry;
  if (!registry) return;
  const dm = capability<DocumentManagerCapability>(registry, 'document-manager');
  if (!dm.isDocumentOpen(docId)) return;
  try {
    await dm.closeDocument(docId).toPromise();
  } catch {
    // Already gone.
  }
}

/** Closes a document now, without asking (see requestClose). */
export async function closeDocument(docId: string): Promise<void> {
  stopIndexing(docId);
  documentStore.getState().close(docId);
  forgetSaveState(docId);
  sources.delete(docId);
  tileCache.dropDoc(docId);
  dropPageCosts(docId);
  await releaseEngineDocument(docId);
  await startedWorkClient()
    ?.close(docId)
    .catch(() => undefined);
}

/** Close with the unsaved-changes prompt (§4.3, M1-13). */
export function requestClose(docId: string): void {
  const doc = documentStore.getState().docs[docId];
  if (!doc) return;
  if (doc.dirty) openStore.setState({ closePrompt: docId });
  else void closeDocument(docId);
}
