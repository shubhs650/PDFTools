// Open pipeline (ARCHITECTURE §4.1, §3.1, M1-13). The main thread only reads
// the file (`File.arrayBuffer()`, async I/O) and transfers the bytes; PDFium
// parses them in the Render worker (rule 1). The Work worker gets its own copy
// afterwards, read again from the file, so the first page never waits for it.
// Opening writes nothing to OPFS: recovery starts on the first edit (§4.3).
import {
  documentStore,
  inComparison,
  type DocumentSource,
  type FileFacts,
} from '../../app/store/documentStore';
import { documentsOf } from '../compare/model';
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
import { rememberClosed } from './closedTabs';
import { forgetView, readLastView, trackView } from '../view/lastView';
import { showStatusToast } from '../snapshot/snapshot';
import { t } from '../../i18n';

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

export interface OpenOptions {
  /**
   * False: the document opens without a tab of its own and nothing is selected (a file
   * dropped or picked into a comparison, M12-08, D-58). A file that is open already is
   * then used as it is.
   */
  tab?: boolean;
  /**
   * A comparison's notes document (M12-12, D-62): opens without a tab, out of the
   * recent list and the file's last view.
   */
  notes?: boolean;
}

/**
 * Opens files one after another, each in its own tab, in the given order.
 * `source`: where they came from, for the tab's hover card (M11-03).
 */
export async function openFiles(
  files: readonly (OpenedFile | RecoveredOpen)[],
  source: DocumentSource = 'picked',
  options: OpenOptions = {},
): Promise<(string | undefined)[]> {
  const ids: (string | undefined)[] = [];
  for (const f of files)
    ids.push(await openOne(f, source, options.tab !== false && !options.notes, !!options.notes));
  return ids;
}

/** Sources whose File is a file on disk (or a download): its size and time are worth showing. */
const ON_DISK: ReadonlySet<DocumentSource> = new Set([
  'picked',
  'dropped',
  'launched',
  'recent',
  'saved',
  'downloaded',
]);

/** The hover card's facts for a document opened from `file` (M11-03). */
export function fileFacts(file: File, source: DocumentSource): FileFacts {
  return ON_DISK.has(source)
    ? { source, fileSize: file.size, modified: file.lastModified }
    : { source };
}

async function openOne(
  req: OpenedFile | RecoveredOpen,
  source: DocumentSource,
  tab: boolean,
  notes = false,
): Promise<string | undefined> {
  const { file, handle } = req;
  const recovered = 'recordRecent' in req;
  const job = startJob(file.name);
  let header = true;
  let docId: string | undefined;
  try {
    const fingerprint = await storageClient().call('fingerprint', { file }).promise;
    // The file's last view (D-53), read while it opens; a recovered document has its own.
    const lastView = recovered || notes ? Promise.resolve(null) : readLastView(fingerprint);
    const dup = await findDuplicate({ ...(handle ? { handle } : {}), fingerprint });
    if (dup) {
      advance(job, { type: 'duplicate', docId: dup });
      if (!tab) return dup; // one document in its tab and in a comparison (D-58)
      // Open in a comparison only: it gets its tab back (showTab selects it).
      documentStore.getState().showTab(dup);
      // A copy under another name: say why no new tab opened (pre-release audit bug 13).
      const openName = documentStore.getState().docs[dup]?.meta.name;
      if (openName && openName !== file.name)
        showStatusToast(dup, t('open.alreadyOpen', { name: openName }), true);
      return dup;
    }
    // Documents in comparisons without a tab of their own count too (the engine's limit).
    if (Object.keys(documentStore.getState().docs).length >= MAX_DOCUMENTS)
      throw new OpenError('too-many');
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
    if (!notes) trackView(id, fingerprint, await lastView, info.pageCount);
    const meta = {
      id,
      name: file.name,
      pageCount: info.pageCount,
      permissions: info.permissions, // rule 9: stored with the document, never overridden
      securityRevision: info.securityRevision,
      ownerUnlocked: info.ownerUnlocked,
      signatureCount: info.signatureCount,
      formType: info.formType,
      ...fileFacts(file, source),
      ...(notes ? { role: 'notes' as const } : {}),
    };
    if (tab) documentStore.getState().open(meta);
    else documentStore.getState().openWithoutTab(meta);
    advance(job, { type: 'opened', docId: id });
    void openInWorkWorker(id, file, password);
    if (recovered || notes) return id;
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
  const { docs, order } = documentStore.getState();
  const doc = docs[docId];
  // Reopen Closed Tab (M11-05) reopens it from its file, where it has one (a document
  // that was only in a comparison had no tab to reopen).
  if (doc && order.includes(docId))
    rememberClosed({
      name: doc.meta.name,
      handle: sources.get(docId)?.handle,
      source: doc.meta.source,
      index: order.indexOf(docId),
    });
  forgetView(docId); // writes its last view first (D-53)
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
  requestCloseMany([docId]);
}

/**
 * Closes several documents (M11-05: Close Others, to the Right, All): the ones without
 * unsaved changes at once, then the unsaved ones one by one through the same prompt as
 * Close (Save, Don't Save, Cancel). Cancel keeps that one and every one after it open.
 */
export function requestCloseMany(ids: readonly string[]): void {
  const unsaved: string[] = [];
  const close = (id: string): void => {
    const doc = documentStore.getState().docs[id];
    if (!doc) return;
    if (doc.dirty) unsaved.push(id);
    else void closeDocument(id);
  };
  for (const id of ids) {
    const s = documentStore.getState();
    const comparison = s.comparisons[id];
    if (comparison) {
      // A comparison tab (M12-08, D-58): its documents close with it, unless a tab of
      // their own or another comparison still shows them.
      s.closeComparison(id);
      for (const docId of documentsOf(comparison)) if (!stillShown(docId)) close(docId);
      continue;
    }
    // A document a comparison shows loses only its tab: it stays one open document.
    if (s.docs[id] && inComparison(s, id)) s.removeTab(id);
    else close(id);
  }
  if (unsaved.length === 0) return;
  const { closePrompt, closeQueue } = openStore.getState();
  // A prompt already showing goes first; these join the queue after it.
  if (closePrompt !== null) {
    const queued = new Set([closePrompt, ...closeQueue]);
    openStore.setState({ closeQueue: [...closeQueue, ...unsaved.filter((d) => !queued.has(d))] });
    return;
  }
  const [first, ...rest] = unsaved;
  openStore.setState({ closePrompt: first ?? null, closeQueue: rest });
}

/**
 * The prompted document was saved and closed, or closed without saving: ask about the
 * next one in the queue (closing any that are no longer unsaved).
 */
export function nextClosePrompt(): void {
  const queue = [...openStore.getState().closeQueue];
  for (;;) {
    const id = queue.shift();
    if (id === undefined) {
      openStore.setState({ closePrompt: null, closeQueue: [] });
      return;
    }
    const doc = documentStore.getState().docs[id];
    if (!doc) continue;
    if (!doc.dirty) {
      void closeDocument(id);
      continue;
    }
    openStore.setState({ closePrompt: id, closeQueue: queue });
    return;
  }
}

/** Whether a tab of its own or a comparison shows the document (D-58). */
export function stillShown(docId: string): boolean {
  const s = documentStore.getState();
  return s.order.includes(docId) || inComparison(s, docId);
}

/**
 * Closes the documents in `docIds` that nothing shows any more (no tab of their own and
 * no comparison), with the unsaved-changes prompt (M12-08).
 */
export function releaseDocuments(docIds: readonly string[]): void {
  const s = documentStore.getState();
  const gone = docIds.filter((id) => s.docs[id] !== undefined && !stillShown(id));
  if (gone.length > 0) requestCloseMany(gone);
}

/**
 * Cancel on the prompt (or a save that failed): nothing more closes. A document that
 * was being closed because nothing showed it any more gets a tab, so it stays reachable.
 */
export function cancelClosePrompts(): void {
  const { closePrompt, closeQueue } = openStore.getState();
  openStore.setState({ closePrompt: null, closeQueue: [] });
  for (const id of [closePrompt, ...closeQueue])
    if (id !== null && documentStore.getState().docs[id] && !stillShown(id))
      documentStore.getState().showTab(id);
}
