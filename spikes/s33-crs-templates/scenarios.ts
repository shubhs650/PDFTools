// Spike S33 (M13-06): the fills the spike runs, shared by the Node run, the
// unit tests and the browser worker. Comment data is invented.
import type ExcelJS from 'exceljs';
import { workbookKind } from './detect';
import {
  compactValidations,
  copySheet,
  dropFormulaResults,
  keepWidth9,
  fillSheet,
  renameSheet,
  sheetName,
  takeModel,
  type FillResult,
  type Snapshot,
} from './engine';
import { snapshotPng } from './png';
import { A, B } from './templates';

type Lib = typeof ExcelJS;
type Row = Record<string, string | number | Date | Snapshot | undefined>;

const TEXTS = [
  'Nozzle N3 elevation does not match the GA drawing; please check.',
  'Add the weld detail reference for the flange joint.',
  'Pipe support spacing exceeds the table in the piping spec.',
  'Clarify the design pressure: 16 barg on sheet 2, 18 barg here.',
  'Revision cloud missing around the changed hole pattern.',
  'Cable tray width to be confirmed with the electrical layout.',
  'Typo in the title block: "Plant Extention".',
  'Show the drain valve on the low point.',
];
const TYPES = ['Text', 'Cloud', 'Callout', 'Arrow', 'Highlight'];
const STATUS = ['Open', 'Closed', 'Hold', 'Info'];
const DISC = ['Civil', 'Mechanical', 'Electrical', 'Piping', 'Instrument'];

const snaps = new Map<string, Snapshot>();
/** A snapshot stand-in; three shapes (wide, square, tall) to test fitting. */
export function snap(i: number): Snapshot {
  const shapes: [number, number][] = [
    [480, 240],
    [300, 300],
    [240, 520],
  ];
  const [w, h] = shapes[i % 3] ?? [300, 300];
  const key = `${String(w)}x${String(h)}x${String(i % 5)}`;
  let s = snaps.get(key);
  if (!s) {
    s = { png: snapshotPng(w, h, i % 5), width: w, height: h };
    snaps.set(key, s);
  }
  return s;
}

/** n comments as template A's fields; every `snapEvery`-th has a snapshot. */
export function commentsA(n: number, page = 1, snapEvery = 3): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    srNo: i + 1,
    page,
    type: TYPES[i % TYPES.length],
    discipline: DISC[i % DISC.length],
    text: `${TEXTS[i % TEXTS.length] ?? ''} (#${String(i + 1)})`,
    snapshot: snapEvery > 0 && i % snapEvery === 0 ? snap(i) : undefined,
    author: i % 2 ? 'R. Reviewer' : 'S. Checker',
    date: new Date(Date.UTC(2026, 10, 1 + (i % 20))),
    status: STATUS[i % STATUS.length],
    reply: i % 4 === 0 ? 'Agreed, will revise in Rev C.' : '',
  }));
}

export function commentsB(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    srNo: i + 1,
    page: 1 + Math.floor(i / 4),
    text: TEXTS[i % TEXTS.length],
    author: 'R. Reviewer',
    status: `Code ${['A', 'B', 'C'][i % 3] ?? 'A'}`,
    reply: '',
    snapshot: i % 2 ? snap(i) : undefined,
  }));
}

export const specA = (details = true) => ({
  startRow: A.startRow,
  columns: { ...A.cols } as Record<string, number>,
  snapshotColumn: A.cols.snapshot,
  snapshotMaxPx: 180,
  ...(details
    ? {
        details: {
          [A.details.docNo]: 'PA-1200-ME-DWG-0042',
          [A.details.rev]: 'B',
          [A.details.title]: 'Pump skid general arrangement',
          [A.details.reviewer]: 'R. Reviewer',
          [A.details.date]: new Date(Date.UTC(2026, 10, 24)),
        },
      }
    : {}),
});

export const specB = () => ({
  startRow: B.startRow,
  columns: { ...B.cols } as Record<string, number>,
  snapshotColumn: B.cols.snapshot,
  snapshotMaxPx: 120,
  details: { [B.details.docNo]: 'PA-1200-CV-SPC-0007', [B.details.rev]: '2' },
});

export async function load(lib: Lib, bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const kind = workbookKind(bytes);
  if (kind !== 'xlsx' && kind !== 'xltx') throw new Error(`refused: ${kind}`);
  const wb = new lib.Workbook();
  await wb.xlsx.load(bytes.slice().buffer);
  // First thing after loading: the sheet model (used for every row insert
  // and sheet copy) already leaves out a width of exactly 9.
  for (const ws of wb.worksheets) keepWidth9(ws);
  return wb;
}

export async function write(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  for (const ws of wb.worksheets) compactValidations(ws);
  // Formulas keep the results the template was saved with (COUNTA = 0), and
  // LibreOffice trusts saved results in a file that says Excel wrote it (as
  // ExcelJS's does): the results are dropped so every reader works them out,
  // and Excel is told to recalculate everything on opening.
  for (const ws of wb.worksheets) dropFormulaResults(ws);
  wb.calcProperties.fullCalcOnLoad = true;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** One template sheet filled with `rows`. */
export async function fillOne(
  lib: Lib,
  template: Uint8Array,
  sheet: string,
  spec: Parameters<typeof fillSheet>[2],
  rows: Row[],
): Promise<{ bytes: Uint8Array; result: FillResult }> {
  const wb = await load(lib, template);
  const ws = wb.getWorksheet(sheet);
  if (!ws) throw new Error(`no sheet ${sheet}`);
  const result = fillSheet(wb, ws, spec, rows);
  return { bytes: await write(wb), result };
}

/**
 * One copy of the template sheet per group (a page, C5; or a document, C15):
 * copies are taken from the sheet as it was before filling, the first group
 * fills the template sheet itself (renamed, references follow), the others
 * go right after it in order. Sr. No. restarts per sheet (C6).
 */
export async function fillGroups(
  lib: Lib,
  template: Uint8Array,
  sheet: string,
  groups: { name: string; rows: Row[]; details?: Record<string, string | number | Date> }[],
  spec: (g: number) => Parameters<typeof fillSheet>[2],
): Promise<{ bytes: Uint8Array; names: string[]; results: FillResult[] }> {
  const wb = await load(lib, template);
  const first = wb.getWorksheet(sheet);
  if (!first) throw new Error(`no sheet ${sheet}`);
  const pristine = takeModel(first);
  const taken = new Set(wb.worksheets.filter((w) => w !== first).map((w) => w.name.toLowerCase()));
  const names: string[] = [];
  const results: FillResult[] = [];
  let prev = first;
  for (const [g, group] of groups.entries()) {
    const name = sheetName(group.name, taken);
    taken.add(name.toLowerCase());
    names.push(name);
    let ws: ExcelJS.Worksheet;
    if (g === 0) {
      renameSheet(wb, first, name);
      ws = first;
    } else {
      ws = copySheet(wb, first, name, pristine, prev);
    }
    const rows = group.rows.map((r, i) => ({ ...r, srNo: i + 1 }));
    const s = spec(g);
    results.push(fillSheet(wb, ws, { ...s, details: { ...s.details, ...group.details } }, rows));
    prev = ws;
  }
  return { bytes: await write(wb), names, results };
}
