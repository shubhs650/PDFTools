// Compare → Export Change Register… (M12-21, D-65, Q34, ARCHITECTURE §7.16):
// every difference the list shows (its filters, search and scope), in its
// order, as an Excel workbook or a CSV file. Rows come from the pure builder
// (model/compare/register.ts) in pieces with a yield between them, so a long
// list never makes one long task (rule 1); the workbook is built in the Work
// worker with ExcelJS (the CRS route, no snapshots); CSV here with the CRS
// writer's rules. Needs the content-copying permission of every file (rule
// 9). The save target is asked first; nothing leaves the device.
import { useSyncExternalStore } from 'react';
import { createStore, useStore } from 'zustand';
import { recordError } from '../../../app/diagnostics';
import { documentStore, securityOf } from '../../../app/store/documentStore';
import { format, msg, t, type MessageKey } from '../../../i18n';
import type { DiffKind, DiffType, Sensitivity } from '../../../model/compare/detect/entries';
import {
  overlayRegister,
  registerCells,
  textRegister,
  type RegisterColumn,
  type RegisterLabels,
  type RegisterSheet,
} from '../../../model/compare/register';
import type { TextChangeKind } from '../../../model/compare/text/match';
import { entriesOf, pageMap, visibleEntries } from '../../../model/compare/textView';
import {
  accessStrategy,
  downloadBytes,
  pickFileSaveTarget,
  writeToHandle,
} from '../../../storage/fileAccess';
import { csvCell } from '../../crs/csv';
import { workClient } from '../../view/host';
import { diffStore, diffView, scopedEntries, shownEntries } from '../diff/diffState';
import { baseName, documentsOf, type Comparison } from '../model';
import { overlayStore, overlayView, sheetsOf, type Sheet } from '../overlay/overlayState';
import { pairingStore } from '../pairingFlow';
import { blockFor, type Block } from '../permissions';
import { badges, KIND_LABEL } from '../text/changeLabels';
import { DEFAULT_TEXT_VIEW, changeKey, textStore } from '../text/textFlow';

export type RegisterFormat = 'xlsx' | 'csv';

const MIME: Record<RegisterFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const COLUMN_TITLE: Record<RegisterColumn, MessageKey> = {
  number: msg('compare.register.col.number'),
  sheet: msg('compare.register.col.sheet'),
  pageA: msg('compare.register.col.pageA'),
  pageB: msg('compare.register.col.pageB'),
  kind: msg('compare.register.col.kind'),
  type: msg('compare.register.col.type'),
  old: msg('compare.register.col.old'),
  new: msg('compare.register.col.new'),
  percent: msg('compare.register.col.percent'),
  notes: msg('compare.register.col.notes'),
  checked: msg('compare.register.col.checked'),
};

const DIFF_KIND: Record<DiffKind, MessageKey> = {
  added: msg('compare.diff.kind_added'),
  removed: msg('compare.diff.kind_removed'),
  changed: msg('compare.diff.kind_changed'),
};

const DIFF_TYPE: Record<DiffType, MessageKey> = {
  text: msg('compare.diff.type_text'),
  geometry: msg('compare.diff.type_geometry'),
  both: msg('compare.diff.type_both'),
};

const SENSITIVITY: Record<Sensitivity, MessageKey> = {
  low: msg('compare.register.sensitivity_low'),
  normal: msg('compare.register.sensitivity_normal'),
  high: msg('compare.register.sensitivity_high'),
};

const nameOf = (docId: string): string => documentStore.getState().docs[docId]?.meta.name ?? '';

/** Which file blocks the change register (rule 9: every file's content-copying permission). */
export function registerBlock(c: Comparison): Block | null {
  const docs = documentStore.getState().docs;
  return blockFor(
    'changeRegister',
    documentsOf(c).flatMap((docId) => {
      const d = docs[docId];
      return d ? [{ docId, name: d.meta.name, security: securityOf(d.meta) }] : [];
    }),
  );
}

/** "RevA vs RevB (changes).xlsx" (localized); a set names its first files. */
export function registerName(c: Comparison, fmt: RegisterFormat): string {
  const first = (side: 'a' | 'b'): string => baseName(nameOf(c[side][0]?.docId ?? ''));
  return t('compare.register.fileName', { a: first('a'), b: first('b'), ext: fmt });
}

/** What the register will list: the rows the list shows of all found, and whether finding is done. */
export interface RegisterCount {
  shown: number;
  total: number;
  complete: boolean;
}

function overlaySheets(id: string): Sheet[] {
  const p = pairingStore.getState().byId[id];
  return p?.status === 'done' ? sheetsOf(p.rows, p.pages) : [];
}

export function registerCount(c: Comparison): RegisterCount {
  if (c.type === 'overlay') {
    const sheets = overlaySheets(c.id);
    const v = diffView(c.id);
    const current = Math.min(overlayView(c.id).sheet, Math.max(0, sheets.length - 1));
    const pairs = sheets.filter((s) => s.pair !== null);
    return {
      shown: shownEntries(v, sheets, current).length,
      total: scopedEntries({ ...v, filter: { ...v.filter, scope: 'all' } }, sheets, current).length,
      complete: pairs.length > 0 && pairs.every((s) => s.pair !== null && v.results[s.pair]),
    };
  }
  const run = textStore.getState().runs[c.id];
  const view = textStore.getState().views[c.id] ?? DEFAULT_TEXT_VIEW;
  const entries = entriesOf(run?.result ?? null);
  const keys = new Set(view.checked);
  const checked = new Set(entries.filter((e) => keys.has(changeKey(e.change))).map((e) => e.id));
  return {
    shown: visibleEntries(entries, view.filter, checked).length,
    total: entries.length,
    complete: run?.status === 'done',
  };
}

const subscribeAll = (fn: () => void): (() => void) => {
  const offs = [
    diffStore.subscribe(fn),
    overlayStore.subscribe(fn),
    textStore.subscribe(fn),
    pairingStore.subscribe(fn),
  ];
  return () => {
    for (const off of offs) off();
  };
};

/** The count, kept current as the list fills in and its filters change. */
export function useRegisterCount(c: Comparison | undefined): RegisterCount | null {
  const key = useSyncExternalStore(subscribeAll, () => (c ? JSON.stringify(registerCount(c)) : ''));
  return key ? (JSON.parse(key) as RegisterCount) : null;
}

// ---- the dialog's state ----

interface RegisterState {
  /** The comparison the dialog is open for. */
  id: string | null;
  format: RegisterFormat;
  running: boolean;
  error: 'failed' | 'denied' | 'empty' | null;
}

export const registerStore = createStore<RegisterState>()(() => ({
  id: null,
  format: 'xlsx',
  running: false,
  error: null,
}));

export function useRegister<T>(selector: (s: RegisterState) => T): T {
  return useStore(registerStore, selector);
}

/** The last file made (e2e builds only: the test hook reads it). */
export let lastRegister: { name: string; blob: Blob } | null = null;

let job: AbortController | null = null;

export function openRegister(id: string): void {
  registerStore.setState((s) => ({ id, format: s.format, running: false, error: null }));
}

export function closeRegister(): void {
  job?.abort();
  job = null;
  registerStore.setState({ id: null, running: false, error: null });
}

export function cancelRegister(): void {
  job?.abort();
}

export function setRegisterFormat(fmt: RegisterFormat): void {
  registerStore.setState({ format: fmt });
}

// ---- building ----

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
/** Rows built between two yields. */
const BATCH = 500;

function labels(c: Comparison): RegisterLabels {
  const several = { a: c.a.length > 1, b: c.b.length > 1 };
  return {
    kind: (k) =>
      k in DIFF_KIND && c.type === 'overlay'
        ? t(DIFF_KIND[k as DiffKind])
        : t(KIND_LABEL[k as TextChangeKind]),
    type: (ty) => t(DIFF_TYPE[ty]),
    page: (side, ref) => {
      const page = format.number(ref.page + 1);
      const file = c[side][ref.file];
      return several[side] && file
        ? t('compare.register.filePage', { name: nameOf(file.docId), page })
        : page;
    },
    yes: t('compare.register.yes'),
    notes: (change) => badges(t, change, false),
  };
}

/** Each row's cells, numbered in the list's order, built in pieces (rule 1). */
async function rowsOf(c: Comparison, signal: AbortSignal): Promise<string[][]> {
  const l = labels(c);
  const out: string[][] = [];
  const renumber = (rows: string[][]): void => {
    for (const r of rows) {
      r[0] = String(out.length + 1);
      out.push(r);
    }
  };
  if (c.type === 'overlay') {
    const sheets = overlaySheets(c.id);
    const v = diffView(c.id);
    const current = Math.min(overlayView(c.id).sheet, Math.max(0, sheets.length - 1));
    const shown = shownEntries(v, sheets, current);
    const checked = new Set(v.checked);
    const files: RegisterSheet[] = sheets.map((s) => ({
      a: s.a ? { file: s.a.file, page: s.a.page } : null,
      b: s.b ? { file: s.b.file, page: s.b.page } : null,
    }));
    for (let i = 0; i < shown.length; i += BATCH) {
      signal.throwIfAborted();
      renumber(overlayRegister(shown.slice(i, i + BATCH), files, checked, l));
      await tick();
    }
    return out;
  }
  const run = textStore.getState().runs[c.id];
  if (!run?.result) return out;
  const view = textStore.getState().views[c.id] ?? DEFAULT_TEXT_VIEW;
  const entries = entriesOf(run.result);
  const keys = new Set(view.checked);
  const checkedIds = new Set(entries.filter((e) => keys.has(changeKey(e.change))).map((e) => e.id));
  const visible = visibleEntries(entries, view.filter, checkedIds);
  const pages = { a: pageMap(run.inputs.a.pages), b: pageMap(run.inputs.b.pages) };
  for (let i = 0; i < visible.length; i += BATCH) {
    signal.throwIfAborted();
    const items = visible.slice(i, i + BATCH).flatMap((k) => {
      const e = entries[k];
      return e ? [{ key: changeKey(e.change), change: e.change }] : [];
    });
    renumber(textRegister(items, pages, keys, l));
    await tick();
  }
  return out;
}

/** The workbook's header block: what was compared, when, with which settings, and what is listed. */
function headerOf(c: Comparison, count: RegisterCount): [string, string][] {
  const names = (side: 'a' | 'b'): string => c[side].map((f) => nameOf(f.docId)).join(', ');
  const head: [string, string][] = [
    [
      t('compare.register.head.type'),
      c.type === 'overlay' ? t('compare.register.type_overlay') : t('compare.register.type_text'),
    ],
    [t('compare.register.head.a'), names('a')],
    [t('compare.register.head.b'), names('b')],
    [t('compare.register.head.exported'), format.dateTime(new Date())],
  ];
  if (c.type === 'overlay') {
    const v = diffView(c.id);
    head.push([
      t('compare.register.head.settings'),
      t('compare.register.overlaySettings', {
        sensitivity: t(SENSITIVITY[v.sensitivity]),
        size:
          v.minSize === 0
            ? t('compare.diff.minSize_off')
            : t('compare.diff.minSize_mm', { size: format.number(v.minSize, 1) }),
        zones: format.number(v.zones.length),
      }),
    ]);
  } else {
    const o = (textStore.getState().views[c.id] ?? DEFAULT_TEXT_VIEW).options;
    head.push([
      t('compare.register.head.settings'),
      t('compare.register.textSettings', {
        headers: o.headersFooters ? t('compare.register.yes') : t('compare.register.no'),
        renumbering: o.renumbering ? t('compare.register.yes') : t('compare.register.no'),
      }),
    ]);
  }
  head.push([
    t('compare.register.head.listed'),
    t('compare.register.listed', {
      shown: format.number(count.shown),
      total: format.number(count.total),
    }),
  ]);
  if (!count.complete) head.push([t('compare.register.head.note'), t('compare.register.partial')]);
  return head;
}

async function build(
  c: Comparison,
  fmt: RegisterFormat,
  signal: AbortSignal,
): Promise<Blob | null> {
  const count = registerCount(c);
  const rows = await rowsOf(c, signal);
  if (rows.length === 0) return null;
  const { columns, numberColumns } = registerCells(c.type);
  const titles = columns.map((k) => t(COLUMN_TITLE[k]));
  if (fmt === 'csv') {
    const parts: string[] = [String.fromCharCode(0xfeff), titles.map(csvCell).join(',') + '\r\n'];
    for (let i = 0; i < rows.length; i += BATCH) {
      signal.throwIfAborted();
      parts.push(
        rows
          .slice(i, i + BATCH)
          .map((cells) => cells.map(csvCell).join(',') + '\r\n')
          .join(''),
      );
      await tick();
    }
    return new Blob(parts, { type: MIME.csv });
  }
  const docId = documentsOf(c)[0];
  if (!docId) return null;
  const { bytes } = await workClient().run(
    'crs',
    {
      docId,
      spec: {
        sheetName: t('compare.register.sheet'),
        title: t('compare.register.sheetTitle', {
          a: baseName(nameOf(c.a[0]?.docId ?? '')),
          b: baseName(nameOf(c.b[0]?.docId ?? '')),
        }),
        header: headerOf(c, count),
        columns: titles,
        snapshotColumn: -1,
        rows,
        widths: columns.map((k) => WIDTH[k]),
        numberColumns,
      },
      snapshots: null,
    },
    { signal },
  ).promise;
  return new Blob([bytes], { type: MIME.xlsx });
}

/** Character widths of the register's columns. */
const WIDTH: Record<RegisterColumn, number> = {
  number: 6,
  sheet: 7,
  pageA: 14,
  pageB: 14,
  kind: 18,
  type: 12,
  old: 40,
  new: 40,
  percent: 11,
  notes: 30,
  checked: 9,
};

/** Asks where to save (first), builds the register and writes it. */
export async function startRegister(): Promise<void> {
  const { id, format: fmt, running } = registerStore.getState();
  const c = id ? documentStore.getState().comparisons[id] : undefined;
  if (!id || !c || running) return;
  if (registerBlock(c)) {
    registerStore.setState({ error: 'denied' });
    return;
  }
  const fileName = registerName(c, fmt);
  const controller = new AbortController();
  job = controller;
  registerStore.setState({ running: true, error: null });
  try {
    let handle: FileSystemFileHandle | undefined;
    if (accessStrategy() === 'fsa') {
      handle = await pickFileSaveTarget(fileName);
      if (!handle) {
        registerStore.setState({ running: false });
        return;
      }
    }
    const blob = await build(c, fmt, controller.signal);
    if (!blob) {
      registerStore.setState({ running: false, error: 'empty' });
      return;
    }
    controller.signal.throwIfAborted();
    if (import.meta.env.MODE === 'e2e') lastRegister = { name: fileName, blob };
    if (handle) await writeToHandle(handle, blob, controller.signal);
    else downloadBytes(blob, fileName);
    registerStore.setState({ id: null, running: false, error: null });
  } catch (err) {
    const cancelled = controller.signal.aborted;
    if (!cancelled) recordError('compare.register', err);
    registerStore.setState({ running: false, error: cancelled ? null : 'failed' });
  } finally {
    if (job === controller) job = null;
  }
}
