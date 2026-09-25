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
import { HEADER_WINDOW, OpenError, classifyOpenError, hasPdfHeader } from './errors';
import { advance, openStore, startJob } from './openStore';
import { findDuplicate, sources } from './sources';

const newDocId = (): string => `doc-${crypto.randomUUID()}`;

/** Opens files one after another, each in its own tab, in the given order. */
export async function openFiles(files: readonly OpenedFile[]): Promise<(string | undefined)[]> {
  const ids: (string | undefined)[] = [];
  for (const f of files) ids.push(await openOne(f));
  return ids;
}

async function openOne({ file, handle }: OpenedFile): Promise<string | undefined> {
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
    const buffer = await file.arrayBuffer();
    advance(job, { type: 'read' });

    const dm = await documentManager();
    const id = newDocId();
    docId = id;
    const res = await dm
      .openDocumentBuffer({ buffer, name: file.name, documentId: id, autoActivate: false })
      .toPromise();
    await res.task.toPromise();
    const info = await renderEngine().rpc.call('docInfo', { docId: id }).promise;

    sources.set(id, {
      file,
      ...(handle ? { handle } : {}),
      fingerprint,
      size: file.size,
    });
    documentStore.getState().open({
      id,
      name: file.name,
      pageCount: info.pageCount,
      permissions: info.permissions, // rule 9: stored with the document, never overridden
      signatureCount: info.signatureCount,
    });
    advance(job, { type: 'opened', docId: id });
    void openInWorkWorker(id, file);
    return id;
  } catch (err) {
    if (docId) void releaseEngineDocument(docId);
    advance(job, { type: 'failed', kind: classifyOpenError(err, header) });
    return undefined;
  }
}

async function openInWorkWorker(docId: string, file: File): Promise<void> {
  try {
    await workClient().open(docId, await file.arrayBuffer(), {
      reload: () => file.arrayBuffer(),
    });
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
  documentStore.getState().close(docId);
  sources.delete(docId);
  tileCache.dropDoc(docId);
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
