// Express Extract (M4-13, §7.7, ADR-015): the tables of the thumbnail
// selection, else the current page, detected in the Work worker (progress and
// Cancel, rules 1 and 2) → XLSX (one sheet per table) or CSV (one file per
// table; several go into a folder, else one ZIP — M4-Q5). Two steps: Extract
// finds the tables, Save asks where to write them. The save picker needs a
// fresh click, and nothing is created when no table is found.
import { createStore, useStore } from 'zustand';
import { recordError } from '../../app/diagnostics';
import { documentStore } from '../../app/store/documentStore';
import { RpcError } from '../../engine/errors';
import { t } from '../../i18n';
import type { TableData } from '../../model/tableGrid';
import {
  accessStrategy,
  canPickFolder,
  downloadBytes,
  pickFileSaveTarget,
  pickFolderTarget,
  writeFilesToFolder,
  writeToHandle,
} from '../../storage/fileAccess';
import { DENIED } from '../../workers/work/permissionGate';
import type { TableFormat, TablePackaging } from '../../workers/work/tables/job';
import { nameTables } from '../../workers/work/tables/writers';
import { baseNameOf } from '../extract/exportJob';
import { targetPages } from '../pages/selection';
import { workClient } from '../view/host';

export type ExpressError = 'denied' | 'failed' | 'noDocument';

interface Found {
  tables: TableData[];
  /** Pages searched. */
  pages: number;
  /** Pages without a text layer (OCR is planned). */
  ocrPages: number[];
}

interface ExpressState {
  docId: string | null;
  /** Pages to search (0-based), fixed when the dialog opens. */
  pages: number[];
  running: { phase: 'detect' | 'save'; done: number; total: number } | null;
  found: Found | null;
  error: ExpressError | null;
}

const CLOSED: ExpressState = { docId: null, pages: [], running: null, found: null, error: null };

export const expressStore = createStore<ExpressState>()(() => CLOSED);

export function useExpress<T>(selector: (s: ExpressState) => T): T {
  return useStore(expressStore, selector);
}

/** The last output (e2e builds only: the test hook reads it). */
export let lastTableExport: {
  files: { path: string; blob: Blob }[];
  packaging: TablePackaging;
} | null = null;

let job: AbortController | null = null;

export function openExpressExtract(docId: string): void {
  if (!documentStore.getState().docs[docId]) return;
  job?.abort();
  expressStore.setState({ ...CLOSED, docId, pages: targetPages(docId) });
}

export function closeExpressExtract(): void {
  job?.abort();
  job = null;
  expressStore.setState(CLOSED);
}

export function cancelExpressExtract(): void {
  job?.abort();
}

function fail(err: unknown, controller: AbortController): void {
  const cancelled = controller.signal.aborted;
  const denied = err instanceof RpcError && err.code.startsWith(DENIED);
  // Content-free (rule 10): the error's code and message are ours.
  if (!cancelled && !denied) recordError('tables.express', err);
  expressStore.setState({ running: null, error: cancelled ? null : denied ? 'denied' : 'failed' });
}

/** Step 1: find the tables. Resolves when done, cancelled or failed (the store says which). */
export async function findTables(): Promise<void> {
  const { docId, pages, running } = expressStore.getState();
  if (!docId || running) return;
  if (!documentStore.getState().docs[docId]) {
    expressStore.setState({ error: 'noDocument' });
    return;
  }
  const controller = new AbortController();
  job = controller;
  expressStore.setState({
    running: { phase: 'detect', done: 0, total: pages.length },
    found: null,
    error: null,
  });
  try {
    const r = await workClient().run(
      'detectTables',
      { docId, pages },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (!controller.signal.aborted)
            expressStore.setState({ running: { phase: 'detect', ...p } });
        },
      },
    ).promise;
    controller.signal.throwIfAborted();
    const tables = r.pages.flatMap((p) =>
      p.tables.map((tb) => ({
        page: p.page,
        cells: tb.cells,
        merges: tb.grid.merges,
        headerRows: tb.grid.headerRows,
      })),
    );
    const ocrPages = r.pages.filter((p) => p.ocr).map((p) => p.page);
    expressStore.setState({ running: null, found: { tables, pages: pages.length, ocrPages } });
  } catch (err) {
    fail(err, controller);
  } finally {
    if (job === controller) job = null;
  }
}

type Target =
  | { packaging: 'single' | 'zip'; handle?: FileSystemFileHandle; name: string }
  | { packaging: 'folder'; dir: FileSystemDirectoryHandle };

/** File name of the output: "plan.xlsx", "plan p3-t1.csv", "plan tables.zip". */
export function outputName(
  base: string,
  format: TableFormat,
  tables: readonly TableData[],
): string {
  if (format === 'xlsx') return t('tables.express.fileXlsx', { base });
  const [only] = nameTables(tables);
  return tables.length === 1 && only
    ? t('tables.express.fileCsv', { base, table: only.name })
    : t('tables.express.fileZip', { base });
}

async function pickTarget(
  base: string,
  format: TableFormat,
  tables: readonly TableData[],
): Promise<Target | null> {
  const multi = format === 'csv' && tables.length > 1;
  if (multi && canPickFolder()) {
    const dir = await pickFolderTarget();
    return dir ? { packaging: 'folder', dir } : null;
  }
  const packaging = multi ? 'zip' : 'single';
  const name = outputName(base, format, tables);
  if (accessStrategy() !== 'fsa') return { packaging, name };
  const handle = await pickFileSaveTarget(name);
  return handle ? { packaging, handle, name } : null;
}

/** Step 2: write the tables found as `format`. Closes the dialog once written. */
export async function saveTables(format: TableFormat): Promise<void> {
  const { docId, found, running } = expressStore.getState();
  const d = docId ? documentStore.getState().docs[docId] : undefined;
  if (!docId || !found?.tables.length || running) return;
  if (!d) {
    expressStore.setState({ error: 'noDocument' });
    return;
  }
  const base = baseNameOf(d.meta.name);
  const controller = new AbortController();
  job = controller;
  expressStore.setState({
    running: { phase: 'save', done: 0, total: found.tables.length },
    error: null,
  });
  try {
    const target = await pickTarget(base, format, found.tables);
    if (!target) {
      expressStore.setState({ running: null });
      return;
    }
    const r = await workClient().run(
      'exportTables',
      { docId, tables: found.tables, format, packaging: target.packaging, baseName: base },
      { signal: controller.signal },
    ).promise;
    controller.signal.throwIfAborted();
    if (target.packaging === 'folder') {
      const files = r.files ?? [];
      if (import.meta.env.MODE === 'e2e') lastTableExport = { files, packaging: 'folder' };
      await writeFilesToFolder(target.dir, files, { signal: controller.signal });
    } else {
      const blob = r.blob;
      if (!blob) throw new Error('no output');
      if (import.meta.env.MODE === 'e2e')
        lastTableExport = { files: [{ path: target.name, blob }], packaging: target.packaging };
      if (target.handle) await writeToHandle(target.handle, blob, controller.signal);
      else downloadBytes(blob, target.name);
    }
    expressStore.setState(CLOSED);
  } catch (err) {
    fail(err, controller);
  } finally {
    if (job === controller) job = null;
  }
}
