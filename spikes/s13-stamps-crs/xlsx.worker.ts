/* eslint-disable */
// @ts-nocheck -- the package is only installed for the spike run.
// M3-02: a CRS-shaped workbook built with ExcelJS's browser bundle in a module
// worker under the §10.1 CSP: header block with merged cells, the §7.5 columns,
// one PNG snapshot per row. Rows are added with a cancel check between them;
// writeBuffer (the zip) is one step. Measures time and size.
//
// NOTE (ADR-015): ExcelJS is *not* a committed dependency. Run this spike after
// `npm install --no-save exceljs@4.4.0` with the `unzipper` override from ADR-015.
import ExcelJS from 'exceljs';

async function snapshot(i: number): Promise<ArrayBuffer> {
  const c = new OffscreenCanvas(300, 200);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 300, 200);
  g.strokeStyle = '#e44234';
  g.lineWidth = 3;
  g.strokeRect(20 + (i % 50), 20, 200, 120);
  for (let k = 0; k < 40; k++) {
    g.fillStyle = `rgb(${(k * 37) % 255},${(i * 13) % 255},${(k * 91) % 255})`;
    g.fillRect((k * 29) % 280, (k * 17) % 180, 12, 3);
  }
  return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

self.onmessage = async (e) => {
  const { rows, images, cancelAt } = e.data;
  try {
    const t0 = performance.now();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('CRS');
    ws.mergeCells('A1:K1');
    ws.getCell('A1').value = 'Comment Review Sheet';
    ws.getCell('A1').font = { bold: true, size: 14 };
    const head = ['Document', 'Revision', 'Title', 'Reviewer', 'Date', 'Status scheme'];
    head.forEach((h, i) => {
      ws.getCell(2 + i, 1).value = h;
      ws.mergeCells(2 + i, 2, 2 + i, 6);
      ws.getCell(2 + i, 2).value = `value ${i}`;
    });
    const cols = [
      'No.',
      'Page',
      'Location/Type',
      'Reviewer',
      'Discipline',
      'Comment',
      'Replies',
      'Status',
      'Snapshot',
      'Vendor Response',
      'Final Status',
    ];
    ws.addRow([]);
    ws.addRow(cols).font = { bold: true };
    const first = ws.rowCount + 1;
    let snapMs = 0;
    for (let i = 0; i < rows; i++) {
      if (cancelAt !== undefined && i === cancelAt) {
        self.postMessage({ cancelledAt: i, ms: performance.now() - t0 });
        return;
      }
      const row = ws.addRow([
        i + 1,
        1 + (i % 2000),
        'Square',
        'Reviewer A',
        'Mechanical',
        `Comment ${i}: check the nozzle orientation against the datasheet`,
        'Vendor B (2026-09-27): agreed',
        'Accepted',
        '',
        '',
        '',
      ]);
      row.height = images ? 80 : 15;
      if (images) {
        const s0 = performance.now();
        const png = await snapshot(i);
        snapMs += performance.now() - s0;
        const id = wb.addImage({ buffer: png, extension: 'png' });
        ws.addImage(id, { tl: { col: 8, row: first + i - 1 }, ext: { width: 150, height: 100 } });
      }
    }
    const t1 = performance.now();
    const out = await wb.xlsx.writeBuffer();
    const t2 = performance.now();
    // The browser bundle returns a Buffer polyfill (a Uint8Array): transfer its bytes.
    const buf =
      out instanceof ArrayBuffer
        ? out
        : out.byteOffset === 0 && out.byteLength === out.buffer.byteLength
          ? out.buffer
          : out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    self.postMessage(
      {
        build: t1 - t0 - snapMs,
        snapshots: snapMs,
        write: t2 - t1,
        bytes: buf.byteLength,
        buffer: buf,
      },
      { transfer: [buf] },
    );
  } catch (err) {
    self.postMessage({ error: String((err && err.stack) || err) });
  }
};
