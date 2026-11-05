// Comment → Export Annotations (M4-08, §7.6, M3-Q1, M4-Q7): every comment (or
// the ones the Comments pane shows) as CSV, XLSX or our JSON format v2 (with
// the comments' own PDF objects, built in the Work worker: ADR-025). Rows
// come from the CRS row builder (numbers, replies, statuses — the same as the
// pane and the CRS); XLSX is built in the Work worker with ExcelJS (the CRS
// route, no snapshots); CSV and JSON are produced here in small pieces with a
// yield between them, so 10,000 comments never make one long task (rule 1).
// The save target is asked first; nothing leaves the device.
import type { PdfAnnotationObject, PdfAnnotationState } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore } from '../../../app/store/documentStore';
import { format, msg, t, type MessageKey } from '../../../i18n';
import {
  accessStrategy,
  downloadBytes,
  pickFileSaveTarget,
  writeToHandle,
} from '../../../storage/fileAccess';
import { crsRowBatches, type CrsRow } from '../../crs/crsModel';
import { csvCell } from '../../crs/csv';
import { kindOf, measurementText, scaleForMeasurement } from '../../measure/measurements';
import { workClient } from '../../view/host';
import { annotationTypeKey } from '../annotationTypes';
import { objectsOf, commentsStore, viewOf } from '../comments/commentsStore';
import { STATUS_KEYS } from '../comments/statusLabels';
import { annotationState } from '../selection';
import { syncLive } from '../../pages/pageOps';
import {
  exportedComments,
  jsonPieces,
  ROW_COLUMNS,
  type JsonPdf,
  type RowColumn,
} from './annotationData';

export type AnnotationFormat = 'csv' | 'xlsx' | 'json';

export interface AnnotationExportOptions {
  scope: 'all' | 'filtered';
  format: AnnotationFormat;
}

interface State {
  docId: string | null;
  running: boolean;
  error: 'failed' | 'empty' | null;
}

export const annotationExportStore = createStore<State>()(() => ({
  docId: null,
  running: false,
  error: null,
}));

export function useAnnotationExport<T>(selector: (s: State) => T): T {
  return useStore(annotationExportStore, selector);
}

const COLUMN_KEYS: Record<RowColumn, MessageKey> = {
  number: msg('annotExport.col.number'),
  page: msg('annotExport.col.page'),
  type: msg('annotExport.col.type'),
  author: msg('annotExport.col.author'),
  subject: msg('annotExport.col.subject'),
  comment: msg('annotExport.col.comment'),
  replies: msg('annotExport.col.replies'),
  status: msg('annotExport.col.status'),
  created: msg('annotExport.col.created'),
  modified: msg('annotExport.col.modified'),
};

const MIME: Record<AnnotationFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
};

/** The last file made (e2e builds only: the test hook reads it). */
export let lastAnnotationExport: { name: string; blob: Blob } | null = null;

let job: AbortController | null = null;

export function openAnnotationExport(docId: string): void {
  if (!documentStore.getState().docs[docId]) return;
  annotationExportStore.setState({ docId, running: false, error: null });
}

export function closeAnnotationExport(): void {
  job?.abort();
  job = null;
  annotationExportStore.setState({ docId: null, running: false, error: null });
}

/** "plan.pdf" → "plan (annotations).csv" (localized). */
export function annotationFileName(name: string, fmt: AnnotationFormat): string {
  return t('annotExport.fileName', { base: name.replace(/\.pdf$/iu, ''), ext: fmt });
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** The rows, built 500 at a time with a yield between batches (rule 1). */
async function rowsOf(
  all: readonly PdfAnnotationObject[],
  docId: string,
  o: AnnotationExportOptions,
  signal: AbortSignal,
): Promise<string[][]> {
  const filter = o.scope === 'filtered' ? viewOf(commentsStore.getState(), docId).filter : null;
  const byId = new Map(all.map((a) => [a.id, a]));
  const date = (d: Date | undefined) => (d ? format.dateTime(d) : '');
  const batches = crsRowBatches(
    all,
    {
      filter,
      typeLabel: (a) => t(annotationTypeKey(a)),
      statusLabel: (s: PdfAnnotationState | null) => (s ? t(STATUS_KEYS[s]) : ''),
      date: (x) => format.date(x),
      discipline: () => '',
      noAuthor: t('annotate.noAuthor'),
    },
    500,
  );
  const cells = (r: CrsRow) => {
    const a = byId.get(r.id);
    const v: Record<RowColumn, string> = {
      number: String(r.number),
      page: String(r.page),
      type: r.type,
      author: r.reviewer,
      subject: (a as { subject?: string } | undefined)?.subject ?? '',
      comment: r.comment,
      replies: r.replies,
      status: r.status,
      created: date(a?.created),
      modified: date(a?.modified),
    };
    return ROW_COLUMNS.map((k) => v[k]);
  };
  const out: string[][] = [];
  for (const batch of batches) {
    signal.throwIfAborted();
    for (const r of batch) out.push(cells(r));
    await tick();
  }
  return out;
}

/** CSV (BOM, CRLF, RFC 4180, formula guard — the CRS writer's rules) in pieces. */
async function csvBlob(lines: string[][], signal: AbortSignal): Promise<Blob> {
  const parts: string[] = [String.fromCharCode(0xfeff)];
  for (let i = 0; i < lines.length; i += 500) {
    signal.throwIfAborted();
    parts.push(
      lines
        .slice(i, i + 500)
        .map((cells) => cells.map(csvCell).join(',') + '\r\n')
        .join(''),
    );
    await tick();
  }
  return new Blob(parts, { type: MIME.csv });
}

/**
 * The comments' own PDF objects (ADR-025): the clipboard PDF of `ids` with
 * their replies, review states, pop-ups, appearances, pictures and attached
 * files, as base64 — built in the Work worker from the current state (rule 1).
 */
async function commentsPdf(docId: string, ids: string[], signal: AbortSignal): Promise<JsonPdf> {
  await syncLive(docId);
  signal.throwIfAborted();
  const r = await workClient().run(
    'copyComments',
    { docId, ids, withReplies: true, base64: true },
    { signal },
  ).promise;
  return { base64: r.base64 ?? '', pages: r.pages };
}

async function build(
  docId: string,
  name: string,
  pages: number,
  o: AnnotationExportOptions,
  signal: AbortSignal,
): Promise<Blob | null> {
  const st = annotationState(docId);
  const all: PdfAnnotationObject[] = st ? objectsOf(st.byUid) : [];
  if (o.format === 'json') {
    const filter = o.scope === 'filtered' ? viewOf(commentsStore.getState(), docId).filter : null;
    const measureOf = (a: PdfAnnotationObject) => {
      const kind = kindOf(docId, a);
      return kind ? { kind, value: measurementText(kind, a, scaleForMeasurement(docId, a)) } : null;
    };
    const ids = exportedComments(all, { filter }).map((c) => c.id);
    if (ids.length === 0) return null;
    const pdf = await commentsPdf(docId, ids, signal);
    const parts: string[] = [];
    for (const piece of jsonPieces(
      all,
      { name, pages, exported: new Date() },
      { filter },
      measureOf,
      pdf,
    )) {
      signal.throwIfAborted();
      parts.push(piece);
      await tick();
    }
    return new Blob(parts, { type: MIME.json });
  }
  const rows = await rowsOf(all, docId, o, signal);
  if (rows.length === 0) return null;
  const columns = ROW_COLUMNS.map((c) => t(COLUMN_KEYS[c]));
  if (o.format === 'csv') return csvBlob([columns, ...rows], signal);
  const { bytes } = await workClient().run(
    'crs',
    {
      docId,
      spec: {
        sheetName: t('annotExport.sheet'),
        title: t('annotExport.sheetTitle', { name }),
        header: [
          [t('annotExport.head.document'), name],
          [t('annotExport.head.exported'), format.dateTime(new Date())],
        ],
        columns,
        snapshotColumn: -1,
        rows,
      },
      snapshots: null,
    },
    { signal },
  ).promise;
  return new Blob([bytes], { type: MIME.xlsx });
}

/** Asks where to save (first), builds the file and writes it. */
export async function startAnnotationExport(o: AnnotationExportOptions): Promise<void> {
  const { docId, running } = annotationExportStore.getState();
  const d = docId ? documentStore.getState().docs[docId] : undefined;
  if (!docId || !d || running) return;
  const fileName = annotationFileName(d.meta.name, o.format);
  const controller = new AbortController();
  job = controller;
  annotationExportStore.setState({ running: true, error: null });
  try {
    let handle: FileSystemFileHandle | undefined;
    if (accessStrategy() === 'fsa') {
      handle = await pickFileSaveTarget(fileName);
      if (!handle) {
        annotationExportStore.setState({ running: false });
        return;
      }
    }
    const blob = await build(docId, d.meta.name, d.meta.pageCount, o, controller.signal);
    if (!blob) {
      annotationExportStore.setState({ running: false, error: 'empty' });
      return;
    }
    controller.signal.throwIfAborted();
    if (import.meta.env.MODE === 'e2e') lastAnnotationExport = { name: fileName, blob };
    if (handle) await writeToHandle(handle, blob, controller.signal);
    else downloadBytes(blob, fileName);
    annotationExportStore.setState({ docId: null, running: false, error: null });
  } catch (err) {
    const cancelled = controller.signal.aborted;
    if (!cancelled) recordError('annotExport.run', err);
    annotationExportStore.setState({ running: false, error: cancelled ? null : 'failed' });
  } finally {
    if (job === controller) job = null;
  }
}

export function cancelAnnotationExport(): void {
  job?.abort();
}
