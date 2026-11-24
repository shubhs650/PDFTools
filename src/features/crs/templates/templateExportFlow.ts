// Export CRS into a project template from the dialog (M13-08, D-71, plan M13
// §6 "Exporting"): the save target is asked first (the click's gesture),
// then the workbook is built in the Work worker with progress and Cancel
// (rules 1, 2) and written. Shares the dialog's state with the Standard CRS
// (crsExport.ts). The numbers and revisions given are kept for next time, as
// the stamps share them (M3-14); the template used is remembered.
import { recordError } from '../../../app/diagnostics';
import { documentStore } from '../../../app/store/documentStore';
import {
  accessStrategy,
  downloadBytes,
  pickFileSaveTarget,
  writeToHandle,
} from '../../../storage/fileAccess';
import { stampStore } from '../../stamps/stampStore';
import { crsFileName, crsStore, finishCrs, setCrsJob, type CrsJob } from '../crsExport';
import { setLastCrsTemplate, templateById } from './crsTemplateStore';
import {
  buildTemplateCrs,
  countTemplateRows,
  EmptyExportError,
  type DocDetails,
  type TemplateExportOptions,
} from './templateExport';

/** The last file made from a template (e2e builds only: the test hook reads it). */
export let lastTemplateCrs: { name: string; bytes: Uint8Array; sheets: string[] } | null = null;

export async function startTemplateCrs(
  templateId: string,
  docs: readonly { docId: string; details: DocDetails }[],
  o: TemplateExportOptions,
): Promise<void> {
  const tpl = templateById(templateId);
  const first = docs[0];
  const name = first ? documentStore.getState().docs[first.docId]?.meta.name : undefined;
  if (!tpl || !first || name === undefined || crsStore.getState().running) return;
  if (
    countTemplateRows(
      tpl,
      docs.map((d) => d.docId),
      o,
    ) === 0
  ) {
    crsStore.setState({ error: 'empty' });
    return;
  }
  const fileName = crsFileName(name, o.format);
  const job: CrsJob = setCrsJob();
  crsStore.setState({ running: { done: 0, total: 0 }, error: null });
  try {
    let handle: FileSystemFileHandle | undefined;
    if (accessStrategy() === 'fsa') {
      handle = await pickFileSaveTarget(fileName);
      if (!handle) {
        crsStore.setState({ running: null });
        return;
      }
    }
    const out = await buildTemplateCrs(tpl, docs, o, job.signal, (p) => {
      if (!job.signal.aborted) crsStore.setState({ running: p });
    });
    job.signal.throwIfAborted();
    if (import.meta.env.MODE === 'e2e')
      lastTemplateCrs = { name: fileName, bytes: out.bytes, sheets: out.names };
    stampStore.setState((s) => {
      const docInfo = { ...s.docInfo };
      for (const d of docs)
        docInfo[d.docId] = { docNo: d.details.docNumber, rev: d.details.revision };
      return { docInfo };
    });
    void setLastCrsTemplate(templateId);
    if (handle) await writeToHandle(handle, out.bytes, job.signal);
    else downloadBytes(out.bytes, fileName);
    finishCrs();
  } catch (err) {
    const cancelled = job.signal.aborted;
    if (!cancelled && !(err instanceof EmptyExportError)) recordError('crs.templateExport', err);
    crsStore.setState({
      running: null,
      error: cancelled ? null : err instanceof EmptyExportError ? 'empty' : 'failed',
    });
  } finally {
    job.done();
  }
}
