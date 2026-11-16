// Create Blank PDF on the main thread (M10-08·O4, D-49, §7.8): the Work worker
// builds the document (rule 1); it opens as a new unsaved tab named
// "Untitled n.pdf", so its first save is a Save As (no file handle).
import { documentStore } from '../../app/store/documentStore';
import { isAbortError } from '../../engine/errors';
import { msg, t } from '../../i18n';
import { nextUntitled } from '../../model/blankSize';
import { workClient } from '../view/host';
import { openResult } from './assemble';
import { runBusy, showPagesError } from './pageOps';

/** The name the next blank document gets ("Untitled 1.pdf", then 2, …). */
export function untitledName(): string {
  const { docs, order } = documentStore.getState();
  const names = order.map((id) => docs[id]?.meta.name ?? '');
  return nextUntitled(names, (n) => t('blank.fileName', { n }));
}

/**
 * Builds `count` blank pages of `width` × `height` points and opens them as a
 * new unsaved tab. Resolves the new tab's id (undefined: cancelled or failed).
 */
export async function createBlankPdf(spec: {
  width: number;
  height: number;
  count: number;
}): Promise<string | undefined> {
  const docId = documentStore.getState().activeId ?? '';
  try {
    const bytes = await runBusy(docId, msg('blank.creating'), async (progress, onCancel) => {
      const job = workClient().run('createBlank', spec, { onProgress: progress });
      onCancel(() => {
        job.cancel();
      });
      return (await job.promise).bytes;
    });
    return await openResult(untitledName(), bytes);
  } catch (err) {
    if (!isAbortError(err)) showPagesError(msg('blank.failed'));
    return undefined;
  }
}
