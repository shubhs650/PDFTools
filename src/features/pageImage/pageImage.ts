// Copy or save an image on the page (M11-08·O6, ADR-028, plan O6): a right
// click on a picture of the page content (not a comment) adds Copy Image and
// Save Image As… to the page menu. The Render worker finds the picture under
// the pointer for the menu (its copy is the current state); the Work worker
// makes the PNG at the image's own resolution from its synced copy (rule 1).
// The main thread only hands the PNG to the clipboard or the chosen file. Both
// need the copy permission (rule 9). Nothing leaves the device.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { registerCommand, type CommandArgs, type PagePoint } from '../../app/commands/dispatch';
import { documentStore } from '../../app/store/documentStore';
import { RpcError, isAbortError } from '../../engine/errors';
import { msg, t } from '../../i18n';
import { imageFileName, type PageImageHit } from '../../model/pageImageHit';
import { downloadBytes, pickFileSaveTarget, writeToHandle } from '../../storage/fileAccess';
import { DENIED } from '../../workers/work/permissionGate';
import { noteOutsideCopy } from '../annotate/transfer/clipboardClock';
import { syncLive } from '../pages/pageOps';
import { showStatusToast, snapshotBlocked } from '../snapshot/snapshot';
import { renderEngine, workClient } from '../view/host';

export type ImageJob = 'copy' | 'save';

interface PageImageState {
  /** A copy or save in progress: its progress dialog shows after 300 ms (rule 2). */
  busy: { docId: string; job: ImageJob; started: number } | null;
}

export const pageImageStore = createStore<PageImageState>()(() => ({ busy: null }));

export function usePageImage<T>(selector: (s: PageImageState) => T): T {
  return useStore(pageImageStore, selector);
}

const DONE = { copy: msg('pageImage.copied'), save: msg('pageImage.saved') } as const;
const FAILED = { copy: msg('pageImage.copyFailed'), save: msg('pageImage.saveFailed') } as const;

let running: AbortController | null = null;

/** Cancel in the progress dialog. */
export function cancelPageImage(): void {
  running?.abort();
}

/**
 * The picture of the page content under a page point (for the page menu), or
 * null. Never throws: a menu without the image items is the fallback.
 */
export async function imageAt(at: PagePoint): Promise<PageImageHit | null> {
  try {
    return await renderEngine().rpc.call('imageAt', {
      docId: at.docId,
      pageIndex: at.page,
      x: at.x,
      y: at.y,
    }).promise;
  } catch (err) {
    recordError('pageImage.hit', err);
    return null;
  }
}

class NoImage extends Error {
  constructor() {
    super('No image at the point');
  }
}

/** The PNG of the image under `at`, made in the Work worker from the document as it is now. */
async function pngAt(at: PagePoint, signal: AbortSignal): Promise<Blob> {
  await syncLive(at.docId);
  signal.throwIfAborted();
  const r = await workClient().run(
    'pageImage',
    { docId: at.docId, pageIndex: at.page, x: at.x, y: at.y },
    { signal },
  ).promise;
  signal.throwIfAborted();
  if (!r) throw new NoImage();
  return r.blob;
}

/** Runs one job with the progress dialog's state and Cancel; reports the outcome. */
async function withJob(
  at: PagePoint,
  job: ImageJob,
  work: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  pageImageStore.setState({ busy: { docId: at.docId, job, started: performance.now() } });
  try {
    await work(controller.signal);
    if (!controller.signal.aborted) showStatusToast(at.docId, t(DONE[job]), true);
  } catch (err) {
    // A cancel (ours, or the file picker's) says nothing.
    if (controller.signal.aborted || isAbortError(err)) return;
    const denied = err instanceof RpcError && err.code.startsWith(DENIED);
    const none = err instanceof NoImage;
    // Content-free (rule 10): the error's code and message are ours.
    if (!denied && !none) recordError(`pageImage.${job}`, err);
    const text = none ? msg('pageImage.none') : denied ? msg('snapshot.restricted') : FAILED[job];
    showStatusToast(at.docId, t(text), false);
  } finally {
    if (running === controller) {
      running = null;
      pageImageStore.setState({ busy: null });
    }
  }
}

/**
 * Copy Image. Called in the menu item's event itself: the clipboard needs that
 * user activation, so the PNG goes in as a promise (made while the clipboard waits).
 */
export function copyPageImage(at: PagePoint): Promise<void> {
  const blocked = snapshotBlocked(at.docId);
  if (blocked) {
    showStatusToast(at.docId, blocked, false);
    return Promise.resolve();
  }
  return withJob(at, 'copy', async (signal) => {
    const png = pngAt(at, signal);
    // A failed PNG rejects the write too; this only keeps the rejection handled.
    png.catch(() => undefined);
    // A paste after this takes the image, not comments copied before (M7-08).
    noteOutsideCopy();
    await navigator.clipboard
      .write([new ClipboardItem({ 'image/png': png })])
      .catch(async (err: unknown) => {
        // The PNG's own failure (no image, cancelled, denied) says more than the clipboard's.
        await png;
        throw err;
      });
  });
}

/**
 * Save Image As…: the file picker first (it needs the click's user activation),
 * then the PNG. Without the File System Access API the browser downloads it.
 */
export async function savePageImage(at: PagePoint): Promise<void> {
  const blocked = snapshotBlocked(at.docId);
  if (blocked) {
    showStatusToast(at.docId, blocked, false);
    return;
  }
  const name = imageFileName(documentStore.getState().docs[at.docId]?.meta.name ?? '', at.page);
  const fsa = typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
  let handle: FileSystemFileHandle | undefined;
  try {
    handle = await pickFileSaveTarget(name);
  } catch (err) {
    recordError('pageImage.pick', err);
    showStatusToast(at.docId, t('pageImage.saveFailed'), false);
    return;
  }
  if (fsa && !handle) return; // cancelled
  await withJob(at, 'save', async (signal) => {
    const png = await pngAt(at, signal);
    if (handle) await writeToHandle(handle, png, signal);
    else downloadBytes(png, name);
  });
}

// ---- the commands ----------------------------------------------------------------

const pointOf = (args?: CommandArgs): PagePoint | null => {
  const at = args?.at;
  return at && documentStore.getState().docs[at.docId] ? at : null;
};

export function registerPageImageCommands(): () => void {
  const offs = [
    registerCommand('edit.copyImage', {
      requires: 'copy',
      run: (_ctx, args) => {
        const at = pointOf(args);
        return at ? copyPageImage(at) : undefined;
      },
    }),
    registerCommand('edit.saveImage', {
      requires: 'copy',
      run: (_ctx, args) => {
        const at = pointOf(args);
        return at ? savePageImage(at) : undefined;
      },
    }),
  ];
  // A closed document's job stops.
  const offDocs = documentStore.subscribe((s) => {
    const busy = pageImageStore.getState().busy;
    if (busy && !(busy.docId in s.docs)) cancelPageImage();
  });
  return () => {
    for (const off of offs) off();
    offDocs();
  };
}
