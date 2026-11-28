// Export measurements (M14-10, D-76, ADR-035; plan M14 §10, Q32, Q33, Q17,
// Q18): the dialog's choices, the items (from the annotation plugin's state
// and the page scales, already in memory: no document reading here, rule 1),
// the fixed layout (model/measureExport.ts), then CSV here or the workbook
// with pictures in the Work worker (progress, Cancel; rules 1, 2). The file is
// saved where the person picks (asked first), and/or attached to the PDF:
// attaching again replaces the earlier copy, and the Measurements pane says
// when it is out of date (attachedExport.ts). Nothing leaves the device.
import type { PdfAnnotationObject } from '@embedpdf/models';
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { isAbortError } from '../../../engine/errors';
import { format, t } from '../../../i18n';
import {
  csvLines,
  exportBook,
  exportStamp,
  type ExportItem,
  type ExportScope,
  type ExportWords,
  type MeasureBookSpec,
  type PictureRegion,
} from '../../../model/measureExport';
import {
  groupMeasurements,
  type MeasureEntry,
  type MeasureGroup,
} from '../../../model/measureList';
import { allows } from '../../../model/permissions';
import { ratioLabel } from '../../../model/scale';
import {
  accessStrategy,
  downloadBytes,
  pickFileSaveTarget,
  writeToHandle,
} from '../../../storage/fileAccess';
import { annotationState } from '../../annotate/selection';
import { invalidateAttachments } from '../../attachments/attachments';
import { toCsv } from '../../crs/csv';
import { editsSettled } from '../../save/pendingEdits';
import { renderEngine, workClient } from '../../view/host';
import { choiceFor, TOOL_SUBJECT, withFileCurve } from '../measurements';
import { measureEntries, measurePaneStore } from '../pane/measureEntries';
import { loadScales, scaleStore } from '../scaleStore';
import { noteAttached } from './attachedExport';
import { exportSettingsStore, setExportSettings, type ExportFormat } from './exportSettings';

export interface ExportOptions {
  scope: ExportScope;
  format: ExportFormat;
  /** Include pictures (Excel only, remembered, Q33). */
  pictures: boolean;
  /** Save a copy as a file. */
  saveFile: boolean;
  /** Attach to this PDF (Excel only; replaces the earlier copy, Q17). */
  attach: boolean;
}

export type ExportError = 'failed' | 'empty' | 'nothing' | 'restricted';

interface ExportState {
  docId: string | null;
  initial: ExportOptions | null;
  running: { done: number; total: number } | null;
  error: ExportError | null;
  /** The last run's outcome, for the status line ("Attached as …"). */
  done: { attached: string | null; saved: boolean } | null;
}

export const measureExportStore = createStore<ExportState>()(() => ({
  docId: null,
  initial: null,
  running: null,
  error: null,
  done: null,
}));

export function useMeasureExport<T>(selector: (s: ExportState) => T): T {
  return useStore(measureExportStore, selector);
}

/** The last file made (e2e builds only: the test hook reads it). */
export let lastMeasureExport: { name: string; bytes: Uint8Array; attached: boolean } | null = null;

let job: AbortController | null = null;

/** May the document take an attachment (rule 9: modify)? */
export function canAttach(docId: string): boolean {
  const meta = documentStore.getState().docs[docId]?.meta;
  return !!meta && allows(securityOf(meta), 'modify');
}

/** Opens the dialog: the pane's This page or All pages, the remembered format and pictures. */
export function openMeasureExport(docId: string): void {
  const d = documentStore.getState().docs[docId];
  if (!d) return;
  void loadScales(docId);
  const pane = measurePaneStore.getState().scope;
  const remembered = exportSettingsStore.getState();
  measureExportStore.setState({
    docId,
    running: null,
    error: null,
    done: null,
    initial: {
      scope: pane === 'page' ? { all: false, page: d.view.page } : { all: true },
      format: remembered.format,
      pictures: remembered.pictures,
      saveFile: true,
      attach: false,
    },
  });
}

export function closeMeasureExport(): void {
  job?.abort();
  job = null;
  measureExportStore.setState({
    docId: null,
    initial: null,
    running: null,
    error: null,
    done: null,
  });
}

export function cancelMeasureExport(): void {
  job?.abort();
}

/** "plan.pdf" → "plan (Measurements).xlsx" (localized). */
export function exportFileName(name: string, fmt: ExportFormat): string {
  return t('measureExport.fileName', { base: name.replace(/\.pdf$/iu, ''), ext: fmt });
}

function wordsFor(docName: string, scope: ExportScope): ExportWords {
  const page = scope.all ? null : format.number(scope.page + 1, 0);
  return {
    measurementsSheet: t('measureExport.sheet.measurements'),
    totalsSheet: t('measureExport.sheet.totals'),
    measurementsTitle:
      page === null
        ? t('measureExport.title.all', { name: docName })
        : t('measureExport.title.page', { name: docName, page }),
    totalsTitle:
      page === null
        ? t('measureExport.title.totalsAll', { name: docName })
        : t('measureExport.title.totalsPage', { name: docName, page }),
    columns: {
      number: t('measureExport.col.number'),
      page: t('measureExport.col.page'),
      area: t('measureExport.col.area'),
      tool: t('measureExport.col.tool'),
      group: t('measureExport.col.group'),
      value: t('measureExport.col.value'),
      unit: t('measureExport.col.unit'),
      depth: t('measureExport.col.depth'),
      scale: t('measureExport.col.scale'),
      author: t('measureExport.col.author'),
      date: t('measureExport.col.date'),
    },
    picture: t('measureExport.col.picture'),
    totalColumns: {
      group: t('measureExport.col.totalGroup'),
      count: t('measureExport.col.count'),
      total: t('measureExport.col.total'),
      unit: t('measureExport.col.unit'),
      note: t('measureExport.col.note'),
    },
    tool: (tool) => t(TOOL_SUBJECT[tool]),
    atPaper: (name) => t('measureExport.atPaper', { name }),
    leftOut: (n) => t('measureExport.leftOut', { count: n, n: format.number(n, 0) }),
    noTotal: t('measureExport.noTotal'),
  };
}

/** Where a measurement's scale comes from, as the sheet's Scale area and Scale columns say. */
function placeOf(
  docId: string,
  a: PdfAnnotationObject,
  e: MeasureEntry,
): { area: string; scale: string } {
  const c = choiceFor(docId, a);
  if (e.spans)
    return {
      area: format.list(e.spans.map((n) => (n === '(page)' ? t('measureExport.pageArea') : n))),
      scale: t('measurements.flag.spans', {
        count: e.spans.length,
        n: format.number(e.spans.length, 0),
      }),
    };
  const area =
    c.kind === 'viewport' ? c.viewport.name : c.kind === 'page' ? t('measureExport.pageArea') : '';
  if (e.paper) return { area, scale: t('measurements.flag.paper') };
  const ratio = ratioLabel(e.scale, format);
  return { area, scale: c.kind === 'own' ? t('measurements.ownScale', { ratio }) : ratio };
}

export interface BuiltExport {
  book: MeasureBookSpec;
  groups: MeasureGroup[];
  items: ExportItem[];
}

/**
 * The export of a document's measurements as they are now (null while its
 * scales are still being read). Plain work over what is in memory.
 */
export function buildExport(
  docId: string,
  scope: ExportScope,
  pictures: boolean,
): BuiltExport | null {
  const d = documentStore.getState().docs[docId];
  const st = annotationState(docId);
  const scales = scaleStore.getState().docs[docId];
  if (!d || !st || !scales || typeof scales === 'string') return null;
  // Not those deleted but not yet committed.
  const objects = Object.values(st.byUid)
    .filter((t) => t.commitState !== 'deleted')
    .map((t) => withFileCurve(docId, t.object));
  const byId = new Map(objects.map((a) => [a.id, a]));
  const entries = measureEntries(docId, objects);
  const groups = groupMeasurements(entries, scope.all ? {} : { page: scope.page });
  const items: ExportItem[] = [];
  for (const e of groups.flatMap((g) => g.entries)) {
    const a = byId.get(e.id);
    if (!a) continue;
    const r = a.rect;
    const region: PictureRegion = {
      page: a.pageIndex,
      x: r.origin.x,
      y: r.origin.y,
      width: r.size.width,
      height: r.size.height,
    };
    const when = a.modified ?? a.created;
    items.push({
      entry: e,
      ...placeOf(docId, a, e),
      group: e.label,
      depth: null,
      author: a.author ?? '',
      date: when instanceof Date && !Number.isNaN(when.getTime()) ? when : null,
      region,
    });
  }
  const book = exportBook(groups, items, wordsFor(d.meta.name, scope), pictures);
  return { book, groups, items };
}

/** The stamp the document's export would have now (null: scales not read yet). */
export function currentStamp(docId: string, scope: ExportScope, pictures: boolean): string | null {
  const built = buildExport(docId, scope, pictures);
  return built ? exportStamp(built.book, { pictures, scope }) : null;
}

async function workbook(
  docId: string,
  built: BuiltExport,
  pictures: boolean,
  signal: AbortSignal,
  onProgress: (p: { done: number; total: number }) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  let piece: ArrayBuffer | undefined;
  if (pictures) {
    await editsSettled();
    // Unsaved edits: the Render worker's narrow tail, appended to the copy.
    const { tail } = await renderEngine().rpc.call('snapshotTail', { docId }).promise;
    signal.throwIfAborted();
    if (tail.byteLength > 0) piece = tail;
  }
  const { bytes } = await workClient().run(
    'measureExport',
    {
      docId,
      ...(piece ? { piece } : {}),
      spec: built.book,
      pictures: pictures ? built.items.map((it) => it.region) : null,
    },
    { signal, onProgress, ...(piece ? { transfer: [piece] } : {}) },
  ).promise;
  return new Uint8Array(bytes);
}

/**
 * Attaches `bytes` to the document (replacing our earlier copy) with the
 * export's stamp; the tab is marked changed and the Attachments pane lists
 * again. Resolves the name it got.
 */
async function attach(
  docId: string,
  docName: string,
  bytes: Uint8Array<ArrayBuffer>,
  stamp: string,
): Promise<string> {
  const { name } = await renderEngine().rpc.call(
    'attachExport',
    {
      docId,
      name: exportFileName(docName, 'xlsx'),
      description: t('measureExport.attachDescription'),
      bytes: bytes.slice().buffer,
      stamp,
    },
    {},
  ).promise;
  documentStore.getState().markDirty(docId);
  invalidateAttachments(docId);
  noteAttached(docId, { name, stamp });
  return name;
}

/**
 * Asks where to save (first: the picker needs the click's gesture), builds
 * the file, writes and/or attaches it. Resolves once done, cancelled or failed.
 */
export async function startMeasureExport(o: ExportOptions): Promise<void> {
  const { docId, running } = measureExportStore.getState();
  const docName = docId ? documentStore.getState().docs[docId]?.meta.name : undefined;
  if (!docId || docName === undefined || running) return;
  const attachIt = o.attach && o.format === 'xlsx';
  const pictures = o.pictures && o.format === 'xlsx';
  if (!o.saveFile && !attachIt) {
    measureExportStore.setState({ error: 'nothing' });
    return;
  }
  if (attachIt && !canAttach(docId)) {
    measureExportStore.setState({ error: 'restricted' });
    return;
  }
  const built = buildExport(docId, o.scope, pictures);
  if (!built || built.items.length === 0) {
    measureExportStore.setState({ error: 'empty' });
    return;
  }
  setExportSettings({ format: o.format, ...(o.format === 'xlsx' ? { pictures: o.pictures } : {}) });
  const fileName = exportFileName(docName, o.format);
  const controller = new AbortController();
  job = controller;
  measureExportStore.setState({ running: { done: 0, total: 0 }, error: null, done: null });
  try {
    let handle: FileSystemFileHandle | undefined;
    if (o.saveFile && accessStrategy() === 'fsa') {
      handle = await pickFileSaveTarget(fileName);
      if (!handle) {
        measureExportStore.setState({ running: null });
        return;
      }
    }
    const bytes =
      o.format === 'csv'
        ? toCsv(csvLines(built.book))
        : await workbook(docId, built, pictures, controller.signal, (p) => {
            if (!controller.signal.aborted) measureExportStore.setState({ running: p });
          });
    controller.signal.throwIfAborted();
    let attached: string | null = null;
    if (attachIt)
      attached = await attach(
        docId,
        docName,
        bytes,
        exportStamp(built.book, { pictures, scope: o.scope }),
      );
    if (import.meta.env.MODE === 'e2e')
      lastMeasureExport = { name: fileName, bytes, attached: attached !== null };
    if (o.saveFile) {
      if (handle) await writeToHandle(handle, bytes, controller.signal);
      else downloadBytes(bytes, fileName);
    }
    closeMeasureExport();
  } catch (err) {
    const cancelled = controller.signal.aborted || isAbortError(err);
    if (!cancelled) recordError('measure.export', err);
    measureExportStore.setState({ running: null, error: cancelled ? null : 'failed' });
  } finally {
    if (job === controller) job = null;
  }
}

/** Refresh (the pane's out-of-date note, Q18): the attached copy made again the same way. */
export async function refreshAttachment(
  docId: string,
  how: { pictures: boolean; scope: ExportScope },
  signal?: AbortSignal,
): Promise<boolean> {
  const docName = documentStore.getState().docs[docId]?.meta.name;
  if (docName === undefined || !canAttach(docId)) return false;
  await loadScales(docId);
  const built = buildExport(docId, how.scope, how.pictures);
  if (!built) return false;
  try {
    const controller = new AbortController();
    signal?.addEventListener('abort', () => {
      controller.abort();
    });
    const bytes = await workbook(docId, built, how.pictures, controller.signal, () => undefined);
    await attach(docId, docName, bytes, exportStamp(built.book, how));
    return true;
  } catch (err) {
    if (!isAbortError(err)) recordError('measure.refreshAttachment', err);
    return false;
  }
}
