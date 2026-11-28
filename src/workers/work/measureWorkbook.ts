// The measurements workbook (M14-10, D-76, ADR-035; plan M14 §10): each sheet
// a title row, the column titles (bold, shaded, frozen, with a filter) and
// its rows, numbers as real numbers with their scale's decimals and dates as
// real dates; sheet 1's pictures anchored in its Picture column with the row
// sized to them. Built with ExcelJS (passed in: lazy-loaded in the Work
// worker, the Node package in tests); a checkpoint between rows makes it
// cancellable (rule 2), progress counts sheet 1's rows.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type ExcelJS from 'exceljs';
import { APP_NAME } from '../../i18n/appName';
import {
  DATE_FORMAT,
  type BookCell,
  type MeasureBookSpec,
  type PictureRegion,
} from '../../model/measureExport';
import { snapshotOf } from './crs';
import type { Snapshot } from './crsWorkbook';
import type { JobSlice } from './scheduler';

const WRAP = { wrapText: true, vertical: 'top' } as const;

function cellValue(c: BookCell): ExcelJS.CellValue {
  if (c === null) return null;
  if (typeof c === 'string') return c === '' ? null : c; // an empty cell, not empty text
  if ('date' in c) return c.date;
  return c.n;
}

function cellFormat(c: BookCell): string | undefined {
  if (c === null || typeof c === 'string') return undefined;
  return 'date' in c ? DATE_FORMAT : c.fmt;
}

export async function buildMeasureBook(
  lib: typeof ExcelJS,
  spec: MeasureBookSpec,
  picture: ((row: number) => Promise<Snapshot | null>) | null,
  checkpoint: () => Promise<void>,
  progress: (done: number) => void,
): Promise<ArrayBuffer> {
  const wb = new lib.Workbook();
  wb.creator = APP_NAME;
  let first = true;
  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(sheet.name);
    const n = sheet.columns.length;
    ws.columns = sheet.columns.map((_, i) => ({ width: sheet.widths[i] ?? 14 }));
    ws.addRow([sheet.title]);
    ws.mergeCells(1, 1, 1, n);
    const title = ws.getRow(1);
    title.font = { bold: true, size: 14 };
    title.height = 22;
    ws.addRow([]);
    const head = ws.addRow(sheet.columns);
    head.font = { bold: true };
    head.alignment = WRAP;
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
      c.border = { bottom: { style: 'thin' } };
    });
    ws.views = [{ state: 'frozen', ySplit: head.number }];
    ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: n } };
    const shots = first && sheet.pictureColumn !== null ? picture : null;
    for (const [i, cells] of sheet.rows.entries()) {
      await checkpoint();
      const r = ws.addRow(cells.map(cellValue));
      r.alignment = WRAP;
      cells.forEach((c, k) => {
        const fmt = cellFormat(c);
        if (fmt) r.getCell(k + 1).numFmt = fmt;
      });
      const shot = shots && sheet.pictureColumn !== null ? await shots(i) : null;
      if (shot && sheet.pictureColumn !== null) {
        const id = wb.addImage({ buffer: shot.png, extension: 'png' });
        ws.addImage(id, {
          tl: { col: sheet.pictureColumn + 0.05, row: r.number - 1 + 0.05 },
          ext: { width: shot.width, height: shot.height },
          editAs: 'oneCell',
        });
        // Row height in points: the picture (px at 96 dpi) plus a margin.
        r.height = Math.max(15, shot.height * 0.75 + 6);
      }
      if (first) progress(i + 1);
    }
    first = false;
  }
  await checkpoint();
  // A Buffer view in ExcelJS's browser build: copy out a plain, transferable ArrayBuffer.
  const out: ArrayBufferLike | Uint8Array = await wb.xlsx.writeBuffer();
  return (out instanceof Uint8Array ? out : new Uint8Array(out)).slice().buffer;
}

/** A picture's least surroundings (the comment sheet's, M13-07): a count symbol shows what is round it. */
export const PICTURE_CONTEXT = { width: 160, height: 100 };

/**
 * The export job: each row's picture (when asked) rendered from a copy of the
 * current revision with the unsaved edits, the markups drawn, framed with at
 * least PICTURE_CONTEXT round the measurement (a large area fits whole).
 */
export async function exportMeasures(
  mod: WrappedPdfiumModule,
  docPtr: number | null,
  spec: MeasureBookSpec,
  regions: readonly (PictureRegion | null)[] | null,
  slice: JobSlice,
  progress: (p: { done: number; total: number }) => void,
): Promise<ArrayBuffer> {
  const { default: lib } = await import('exceljs');
  const total = spec.sheets[0]?.rows.length ?? 0;
  progress({ done: 0, total });
  const picture =
    regions && docPtr !== null
      ? (i: number): Promise<Snapshot | null> => {
          const r = regions[i];
          return r
            ? snapshotOf(mod, docPtr, r, 240, 160, PICTURE_CONTEXT)()
            : Promise.resolve(null);
        }
      : null;
  return buildMeasureBook(
    lib,
    spec,
    picture,
    () => slice.checkpoint(),
    (done) => {
      progress({ done, total });
    },
  );
}
