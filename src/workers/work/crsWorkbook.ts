// The CRS workbook (M3-19, D-15, §7.5, ADR-015 decision 2): a title row, the
// header block, the §7.5 columns and one row per comment with its snapshot
// anchored in the Snapshot column, the row sized to it. Built with ExcelJS
// (passed in: lazy-loaded in the Work worker, the Node package in tests); a
// checkpoint between rows makes it cancellable (rule 2). `writeBuffer` (the
// zip) is one step at the end.
import type ExcelJS from 'exceljs';

export interface WorkbookSpec {
  sheetName: string;
  /** Row 1, merged across the columns. */
  title: string;
  /** The header block: label → value, one row each. */
  header: [string, string][];
  /** Column titles (§7.5 order) and the Snapshot column's index in them. */
  columns: string[];
  snapshotColumn: number;
  rows: string[][];
}

export interface Snapshot {
  png: ArrayBuffer;
  /** Image size in pixels. */
  width: number;
  height: number;
}

/** Character widths of the columns (No., Page, Type, …). */
const WIDTHS = [6, 6, 16, 18, 14, 48, 40, 14, 36, 36, 14];
const WRAP = { wrapText: true, vertical: 'top' } as const;

export async function buildWorkbook(
  lib: typeof ExcelJS,
  spec: WorkbookSpec,
  snapshot: ((row: number) => Promise<Snapshot | null>) | null,
  checkpoint: () => Promise<void>,
  progress: (done: number) => void,
): Promise<ArrayBuffer> {
  const wb = new lib.Workbook();
  wb.creator = 'PDFTools';
  const ws = wb.addWorksheet(spec.sheetName);
  const n = spec.columns.length;
  ws.columns = spec.columns.map((_, i) => ({ width: WIDTHS[i] ?? 16 }));

  ws.addRow([spec.title]);
  ws.mergeCells(1, 1, 1, n);
  const title = ws.getRow(1);
  title.font = { bold: true, size: 14 };
  title.height = 22;

  for (const [label, value] of spec.header) {
    const r = ws.addRow([label, value]);
    ws.mergeCells(r.number, 2, r.number, n);
    r.getCell(1).font = { bold: true };
  }
  ws.addRow([]);

  const head = ws.addRow(spec.columns);
  head.font = { bold: true };
  head.alignment = WRAP;
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
    c.border = { bottom: { style: 'thin' } };
  });
  ws.views = [{ state: 'frozen', ySplit: head.number }];

  for (const [i, cells] of spec.rows.entries()) {
    await checkpoint();
    const r = ws.addRow(cells.map((v, k) => (k <= 1 && /^\d+$/u.test(v) ? Number(v) : v)));
    r.alignment = WRAP;
    const shot = snapshot ? await snapshot(i) : null;
    if (shot) {
      const id = wb.addImage({ buffer: shot.png, extension: 'png' });
      ws.addImage(id, {
        tl: { col: spec.snapshotColumn + 0.05, row: r.number - 1 + 0.05 },
        ext: { width: shot.width, height: shot.height },
        editAs: 'oneCell',
      });
      // Row height in points: the image (px at 96 dpi) plus a margin.
      r.height = Math.max(15, shot.height * 0.75 + 6);
    }
    progress(i + 1);
  }
  await checkpoint();
  // A Buffer view in ExcelJS's browser build: copy out a plain, transferable ArrayBuffer.
  const out: ArrayBufferLike | Uint8Array = await wb.xlsx.writeBuffer();
  return (out instanceof Uint8Array ? out : new Uint8Array(out)).slice().buffer;
}
