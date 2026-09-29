// Comment Review Sheet export (M3-19, D-15, §7.5): the dialog's choices, the
// rows (crsModel.ts, from the annotation store), then CSV here or XLSX with
// snapshots in the Work worker (progress, cancel). The file is saved with the
// save picker, or downloaded on the fallback path; nothing leaves the device.
import type { PdfAnnotationObject, PdfAnnotationState } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { format, msg, t, type MessageKey } from '../../i18n';
import {
  accessStrategy,
  downloadBytes,
  pickFileSaveTarget,
  writeToHandle,
} from '../../storage/fileAccess';
import { annotationTypeKey } from '../annotate/annotationTypes';
import { objectsOf, viewOf, commentsStore } from '../annotate/comments/commentsStore';
import { STATUS_KEYS } from '../annotate/comments/statusLabels';
import { annotationState } from '../annotate/selection';
import { editsSettled } from '../save/pendingEdits';
import { profileStore } from '../settings/profile/profileStore';
import { activeScheme } from '../stamps/schemes/schemeStore';
import { stampStore } from '../stamps/stampStore';
import { renderEngine, workClient } from '../view/host';
import { buildCrsRows, CRS_COLUMNS, rowCells, type CrsColumn } from './crsModel';
import { toCsv } from './csv';

export interface CrsOptions {
  docNumber: string;
  revision: string;
  title: string;
  reviewer: string;
  date: string;
  scope: 'all' | 'filtered';
  snapshots: boolean;
  format: 'xlsx' | 'csv';
}

interface CrsState {
  docId: string | null;
  /** The dialog's starting values (prefilled). */
  initial: CrsOptions | null;
  running: { done: number; total: number } | null;
  error: 'failed' | 'empty' | null;
}

export const crsStore = createStore<CrsState>()(() => ({
  docId: null,
  initial: null,
  running: null,
  error: null,
}));

export function useCrs<T>(selector: (s: CrsState) => T): T {
  return useStore(crsStore, selector);
}

const COLUMN_KEYS: Record<CrsColumn, MessageKey> = {
  number: msg('crs.col.number'),
  page: msg('crs.col.page'),
  type: msg('crs.col.type'),
  reviewer: msg('crs.col.reviewer'),
  discipline: msg('crs.col.discipline'),
  comment: msg('crs.col.comment'),
  replies: msg('crs.col.replies'),
  status: msg('crs.col.status'),
  snapshot: msg('crs.col.snapshot'),
  vendorResponse: msg('crs.col.vendorResponse'),
  finalStatus: msg('crs.col.finalStatus'),
};

/** The last file made (e2e builds only: the test hook reads it). */
export let lastCrs: { name: string; bytes: Uint8Array } | null = null;

let job: AbortController | null = null;

/** Opens the dialog with the document's details prefilled. */
export async function openCrs(docId: string): Promise<void> {
  const d = documentStore.getState().docs[docId];
  if (!d) return;
  const info = stampStore.getState().docInfo[docId];
  let title = '';
  try {
    title = (await workClient().run('docProperties', { docId }).promise).title;
  } catch (err) {
    recordError('crs.properties', err);
  }
  crsStore.setState({
    docId,
    running: null,
    error: null,
    initial: {
      docNumber: info?.docNo ?? '',
      revision: info?.rev ?? '',
      title: title || d.meta.name.replace(/\.pdf$/iu, ''),
      reviewer: profileStore.getState().profile?.name ?? '',
      date: format.date(new Date()),
      scope: 'all',
      snapshots: true,
      format: 'xlsx',
    },
  });
}

export function closeCrs(): void {
  job?.abort();
  job = null;
  crsStore.setState({ docId: null, initial: null, running: null, error: null });
}

export function cancelCrs(): void {
  job?.abort();
}

/** "plan.pdf" → "plan (CRS).xlsx" (localized). */
export function crsFileName(name: string, fmt: 'xlsx' | 'csv'): string {
  return t('crs.fileName', { base: name.replace(/\.pdf$/iu, ''), ext: fmt });
}

function rowsFor(docId: string, o: CrsOptions) {
  const st = annotationState(docId);
  const all: PdfAnnotationObject[] = st ? objectsOf(st.byUid) : [];
  const profile = profileStore.getState().profile;
  return buildCrsRows(all, {
    filter: o.scope === 'filtered' ? viewOf(commentsStore.getState(), docId).filter : null,
    typeLabel: (a) => t(annotationTypeKey(a)),
    statusLabel: (s: PdfAnnotationState | null) => (s ? t(STATUS_KEYS[s]) : ''),
    date: (x) => format.date(x),
    discipline: (author) => (author === profile?.name ? profile.discipline : ''),
    noAuthor: t('annotate.noAuthor'),
  });
}

function headerOf(o: CrsOptions): [string, string][] {
  const scheme = activeScheme();
  const name = scheme.nameKey ? t(scheme.nameKey as MessageKey) : (scheme.name ?? '');
  const codes = scheme.codes
    .map((c) => `${c.code} ${c.labelKey ? t(c.labelKey as MessageKey) : (c.label ?? '')}`)
    .join(', ');
  return [
    [t('crs.head.docNumber'), o.docNumber],
    [t('crs.head.revision'), o.revision],
    [t('crs.head.title'), o.title],
    [t('crs.head.reviewer'), o.reviewer],
    [t('crs.head.date'), o.date],
    [t('crs.head.scheme'), `${name}: ${codes}`],
  ];
}

async function build(
  docId: string,
  o: CrsOptions,
  signal: AbortSignal,
  onProgress: (p: { done: number; total: number }) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const rows = rowsFor(docId, o);
  const columns = CRS_COLUMNS.map((c) => t(COLUMN_KEYS[c]));
  const cells = rows.map(rowCells);
  const header = headerOf(o);
  if (o.format === 'csv') {
    const csvColumns = CRS_COLUMNS.filter((c) => c !== 'snapshot');
    const keep = CRS_COLUMNS.map((c) => c !== 'snapshot');
    return toCsv([
      ...header,
      [],
      csvColumns.map((c) => t(COLUMN_KEYS[c])),
      ...cells.map((r) => r.filter((_, i) => keep[i])),
    ]);
  }
  let piece: ArrayBuffer | undefined;
  if (o.snapshots) {
    await editsSettled();
    // Unsaved edits: the Render worker's narrow tail, appended to the copy.
    const { tail } = await renderEngine().rpc.call('snapshotTail', { docId }).promise;
    signal.throwIfAborted();
    if (tail.byteLength > 0) piece = tail;
  }
  const { bytes } = await workClient().run(
    'crs',
    {
      docId,
      ...(piece ? { piece } : {}),
      spec: {
        sheetName: t('crs.sheet'),
        title: t('crs.sheetTitle', { title: o.title }),
        header,
        columns,
        snapshotColumn: CRS_COLUMNS.indexOf('snapshot'),
        rows: cells,
      },
      snapshots: o.snapshots ? rows.map((r) => r.region) : null,
    },
    { signal, onProgress, ...(piece ? { transfer: [piece] } : {}) },
  ).promise;
  return new Uint8Array(bytes);
}

/**
 * Asks where to save (first: the picker needs the click's gesture), builds
 * the file and writes it. Resolves once written, cancelled or failed.
 */
export async function startCrs(o: CrsOptions): Promise<void> {
  const { docId, running } = crsStore.getState();
  const name = docId ? documentStore.getState().docs[docId]?.meta.name : undefined;
  if (!docId || name === undefined || running) return;
  if (rowsFor(docId, o).length === 0) {
    crsStore.setState({ error: 'empty' });
    return;
  }
  const fileName = crsFileName(name, o.format);
  const controller = new AbortController();
  job = controller;
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
    const bytes = await build(docId, o, controller.signal, (p) => {
      if (!controller.signal.aborted) crsStore.setState({ running: p });
    });
    controller.signal.throwIfAborted();
    if (import.meta.env.MODE === 'e2e') lastCrs = { name: fileName, bytes };
    // The document's number and revision, shared with its stamps (M3-14), for next time.
    stampStore.setState((s) => ({
      docInfo: { ...s.docInfo, [docId]: { docNo: o.docNumber, rev: o.revision } },
    }));
    if (handle) await writeToHandle(handle, bytes, controller.signal);
    else downloadBytes(bytes, fileName);
    crsStore.setState({ docId: null, initial: null, running: null, error: null });
  } catch (err) {
    const cancelled = controller.signal.aborted;
    if (!cancelled) recordError('crs.export', err);
    crsStore.setState({ running: null, error: cancelled ? null : 'failed' });
  } finally {
    if (job === controller) job = null;
  }
}
