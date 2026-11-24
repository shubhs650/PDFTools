// Export CRS into a project template (M13-07, D-71, plan M13 §6 "Exporting"):
// the rows of each document picked (C15) from the annotation store, split into
// sheets (C5), their cells in the template's column order (Sr. No. per sheet,
// C6), the detail cells, then the workbook filled in the Work worker with
// progress and Cancel (rules 1, 2) — or a CSV with the same columns and no
// pictures. The export dialog (M13-08) calls `buildTemplateCrs`; nothing
// leaves the device and nothing here is logged (rule 10).
import type { PdfAnnotationObject } from '@embedpdf/models';
import { documentStore } from '../../../app/store/documentStore';
import { format, t } from '../../../i18n';
import type { CrsTemplate } from '../../../model/crs/template';
import type { TemplateShot } from '../../../workers/work/crsTemplate/job';
import { annotationTypeKey } from '../../annotate/annotationTypes';
import { commentsOf } from '../../annotate/comments/commentsModel';
import { commentsStore, objectsOf, viewOf } from '../../annotate/comments/commentsStore';
import { annotationState } from '../../annotate/selection';
import { editsSettled } from '../../save/pendingEdits';
import { profileStore } from '../../settings/profile/profileStore';
import { renderEngine, workClient } from '../../view/host';
import { schemeText } from '../crsExport';
import { templateRows, type TemplateRow } from './templateRows';
import {
  fillSpec,
  planSheets,
  templateCsv,
  type DocDetails,
  type TemplateExportOptions,
} from './templateSheets';

export type { DocDetails, TemplateExportOptions } from './templateSheets';

export class EmptyExportError extends Error {
  constructor() {
    super('crs-template-empty');
    this.name = 'EmptyExportError';
  }
}

/** The rows of one open document as the template takes them. */
async function docRows(
  docId: string,
  tpl: CrsTemplate,
  o: TemplateExportOptions,
): Promise<{ rows: TemplateRow[]; labels: Map<number, string | null> }> {
  const st = annotationState(docId);
  const all: PdfAnnotationObject[] = st ? objectsOf(st.byUid) : [];
  const pages = [...new Set(commentsOf(all).map((c) => c.page))];
  const list = pages.length ? await workClient().run('pageLabels', { docId, pages }).promise : [];
  const labels = new Map(pages.map((p, i) => [p, list[i] ?? null]));
  const profile = profileStore.getState().profile;
  const rows = templateRows(all, {
    settings: tpl,
    filter: o.scope === 'filtered' ? viewOf(commentsStore.getState(), docId).filter : null,
    ignoreHighlights: o.ignoreHighlights,
    typeLabel: (a) => t(annotationTypeKey(a)),
    date: (x) => format.date(x),
    discipline: (author) => (author === profile?.name ? profile.discipline : ''),
    noAuthor: t('annotate.noAuthor'),
    pageLabel: (p) => labels.get(p) ?? null,
  });
  return { rows, labels };
}

/**
 * Builds the export of `docs` (each with its dialog details) into `tpl`.
 * Throws EmptyExportError when no document has a comment to export.
 */
export async function buildTemplateCrs(
  tpl: CrsTemplate,
  docs: readonly { docId: string; details: DocDetails }[],
  o: TemplateExportOptions,
  signal: AbortSignal,
  onProgress: (p: { done: number; total: number }) => void,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; names: string[] }> {
  const metas = documentStore.getState().docs;
  const picked = [];
  for (const d of docs) {
    const meta = metas[d.docId]?.meta;
    if (!meta) continue;
    const { rows, labels } = await docRows(d.docId, tpl, o);
    signal.throwIfAborted();
    picked.push({
      docId: d.docId,
      name: meta.name,
      pageCount: meta.pageCount,
      details: d.details,
      rows,
      pageLabel: (p: number) => labels.get(p) ?? null,
    });
  }
  if (picked.every((d) => d.rows.length === 0)) throw new EmptyExportError();
  const sheets = planSheets(picked, tpl, schemeText());
  if (o.format === 'csv') {
    return { bytes: templateCsv(tpl, sheets), names: sheets.map((s) => s.name ?? tpl.sheet) };
  }
  const spec = fillSpec(tpl, sheets);
  const wantShots = o.snapshots && spec.snapshotIndex >= 0;
  const pieces: (ArrayBuffer | undefined)[] = [];
  if (wantShots) {
    await editsSettled();
    for (const d of picked) {
      // Unsaved edits: the Render worker's narrow tail, appended to the copy.
      const { tail } = await renderEngine().rpc.call('snapshotTail', { docId: d.docId }).promise;
      signal.throwIfAborted();
      pieces.push(tail.byteLength > 0 ? tail : undefined);
    }
  }
  const shots: (TemplateShot | null)[][] | null = wantShots
    ? sheets.map((sh) => sh.rows.map((r) => ({ doc: sh.doc, region: r.region })))
    : null;
  const transfer = pieces.filter((p): p is ArrayBuffer => p !== undefined);
  const workbook = tpl.workbook.slice(0);
  const { bytes, names } = await workClient().run(
    'crsTemplate',
    {
      template: workbook,
      spec,
      docs: picked.map((d, i) => {
        const piece = pieces[i];
        return piece ? { docId: d.docId, piece } : { docId: d.docId };
      }),
      shots,
    },
    { signal, onProgress, transfer: [workbook, ...transfer] },
  ).promise;
  return { bytes: new Uint8Array(bytes), names };
}
