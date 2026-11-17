// Split Document (M11-08·O7, D-55) on the main thread: the dialog's parts →
// where they go, asked first while the click's gesture is fresh (a folder
// where the browser can write one, else one ZIP) → the Work worker builds
// every part from its copy with the unsaved changes (rule 1), with progress
// and Cancel (rule 2) → the files written next to whatever the folder holds,
// never replacing a file ("name (2).pdf"). The open document is not changed.
import { documentStore } from '../../app/store/documentStore';
import { isAbortError } from '../../engine/errors';
import { format, msg, t } from '../../i18n';
import {
  accessStrategy,
  canPickFolder,
  downloadBytes,
  pickFileSaveTarget,
  pickFolderTarget,
  writeFilesToFolder,
  writeToHandle,
} from '../../storage/fileAccess';
import { showStatusToast } from '../snapshot/snapshot';
import { renderEngine, workClient } from '../view/host';
import { runBusy, settleEdits, showPagesError, syncLive } from './pageOps';
import {
  partNumber,
  rangeText,
  safeTitle,
  topBookmarks,
  uniqueNames,
  type SplitMode,
  type SplitPart,
  type TopBookmark,
} from './splitPlan';

const WORK_COPY_WAIT_MS = 10_000;

/** The dialog's choices, kept for the next time in this session. */
export interface SplitChoice {
  mode: SplitMode;
  every: string;
  ranges: string;
}

let last: SplitChoice = { mode: 'every', every: '1', ranges: '' };

export const lastSplit = (): SplitChoice => last;

export function rememberSplit(choice: SplitChoice): void {
  last = { ...choice };
}

/** "plan.pdf" → "plan". */
const baseOf = (name: string): string => name.replace(/\.pdf$/iu, '') || name;

/** The top-level bookmarks of the document as it is now (unsaved edits included). */
export async function readTopBookmarks(docId: string): Promise<TopBookmark[]> {
  await workClient().whenAdded(docId, WORK_COPY_WAIT_MS);
  await syncLive(docId);
  const { items } = await workClient().run('readOutline', { docId }).promise;
  return topBookmarks(items);
}

/** Each part's file name, from the original's: unique within the split. */
export function partNames(docName: string, parts: readonly SplitPart[]): string[] {
  const base = baseOf(docName);
  return uniqueNames(
    parts.map((p, i) => {
      if (p.title === undefined)
        return t('split.fileName', {
          base,
          range: rangeText(p.pages),
          count: p.pages.length,
        });
      const title = safeTitle(p.title);
      const n = partNumber(i, parts.length);
      return title
        ? t('split.bookmarkName', { base, n, title })
        : t('split.bookmarkNameEmpty', { base, n });
    }),
  );
}

type Target =
  | { kind: 'folder'; dir: FileSystemDirectoryHandle }
  | { kind: 'zip'; name: string; handle?: FileSystemFileHandle };

/** Where the files go; null when the user cancelled the picker. */
async function pickTarget(base: string): Promise<Target | null> {
  if (canPickFolder()) {
    const dir = await pickFolderTarget();
    return dir ? { kind: 'folder', dir } : null;
  }
  const name = t('split.zipName', { base });
  if (accessStrategy() !== 'fsa') return { kind: 'zip', name };
  const handle = await pickFileSaveTarget(name);
  return handle ? { kind: 'zip', name, handle } : null;
}

/**
 * Splits the document into `parts`. Resolves the number of files written
 * (0: cancelled, failed or nothing to do; an error or the toast says which).
 */
export async function splitDocument(docId: string, parts: readonly SplitPart[]): Promise<number> {
  const meta = documentStore.getState().docs[docId]?.meta;
  if (!meta || parts.length === 0) return 0;
  const names = partNames(meta.name, parts);
  let target: Target | null;
  try {
    target = await pickTarget(baseOf(meta.name));
  } catch {
    showPagesError(msg('split.failed'));
    return 0;
  }
  if (!target) return 0;
  const chosen = target;
  const controller = new AbortController();
  try {
    const where = await runBusy(docId, msg('split.running'), async (progress, onCancel) => {
      onCancel(() => {
        controller.abort();
      });
      await settleEdits(docId);
      // The Work copy with every unsaved change (markups too) as its live section.
      const { tail } = await renderEngine().rpc.call('snapshotTail', { docId }).promise;
      await workClient().setLive(docId, tail);
      controller.signal.throwIfAborted();
      const r = await workClient().run(
        'split',
        {
          docId,
          parts: parts.map((p, i) => ({ pages: [...p.pages], name: names[i] ?? '' })),
          packaging: chosen.kind,
        },
        { signal: controller.signal, onProgress: progress },
      ).promise;
      controller.signal.throwIfAborted();
      if (chosen.kind === 'folder')
        return writeFilesToFolder(chosen.dir, r.files ?? [], {
          signal: controller.signal,
          progress: (done, total) => {
            progress({ done, total });
          },
        });
      if (!r.blob) throw new Error('no output');
      if (chosen.handle) await writeToHandle(chosen.handle, r.blob, controller.signal);
      else downloadBytes(r.blob, chosen.name);
      return chosen.name;
    });
    const count = format.number(parts.length, 0);
    showStatusToast(
      docId,
      chosen.kind === 'folder'
        ? t('split.doneFolder', { count: parts.length, n: count, folder: where })
        : t('split.doneZip', { count: parts.length, n: count, name: where }),
      true,
    );
    return parts.length;
  } catch (err) {
    if (!isAbortError(err) && !controller.signal.aborted) showPagesError(msg('split.failed'));
    return 0;
  }
}
