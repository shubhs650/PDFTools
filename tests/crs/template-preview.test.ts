// M13-08 (D-71, plan M13 §6 "Setting up", C13): the set-up's sheet preview,
// read with ExcelJS as the Work worker does — text, merges, borders, fills,
// widths, pictures and the detected pre-drawn rows — and the first
// suggestions made from it (header row, start row, columns, detail cells).
// Templates are self-made by script (rule 13).
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { A, B, templateA, templateB } from '../../e2e/fixtures/crsTemplates';
import {
  guessColumns,
  guessDetails,
  guessHeaderRow,
  guessStartRow,
} from '../../src/model/crs/guess';
import { loadTemplate } from '../../src/workers/work/crsTemplate/fill';
import { cssColor, sheetPreview } from '../../src/workers/work/crsTemplate/preview';
import { previewOf } from '../../src/workers/work/crsTemplate/previewCache';

const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer;

async function previewA(probe: { startRow: number; columns: number[] } | null = null) {
  const wb = await loadTemplate(ExcelJS, buf(await templateA(ExcelJS)));
  const p = sheetPreview(wb, {
    sheet: A.sheet,
    needRow: 0,
    probe: probe ? { ...probe, lastPreDrawn: null } : null,
  });
  if (!p) throw new Error('no preview');
  return p;
}

describe('sheet preview', () => {
  it('draws the first rows: text, merges, fills, borders, widths and the logo', async () => {
    const p = await previewA();
    expect(p.sheet).toBe('CRS');
    // Template A uses 30 rows and 11 columns; a few rows more are shown to click into.
    expect(p.rows).toBe(35);
    expect(p.cols).toBe(11);
    expect(p.colPx).toHaveLength(11);
    expect(p.rowPx).toHaveLength(35);
    // Column E is 45 characters wide, column A 6.
    expect(p.colPx[4]).toBeGreaterThan(300);
    expect(p.colPx[0]).toBeLessThan(50);
    // Row 9 (the header) is 30 pt high.
    expect(p.rowPx[8]).toBe(40);
    const at = (r: number, c: number) => p.cells.find((x) => x.r === r && x.c === c);
    const title = at(1, 3);
    expect(title).toMatchObject({
      text: 'COMMENT RESOLUTION SHEET',
      rs: 3,
      cs: 6,
      bold: true,
      size: 18,
      color: '#1F4EA0',
      h: 'center',
      v: 'middle',
    });
    // Cells inside a merge are drawn by its first cell.
    expect(at(1, 4)).toBeUndefined();
    expect(at(9, 5)).toMatchObject({ text: 'Reviewer comment', fill: '#D9E1F2', bold: true });
    expect(at(9, 5)?.top?.style).toBe('medium');
    // An empty boxed table cell is kept (its borders), the formula column is flagged.
    expect(at(12, 2)).toMatchObject({ text: '', left: { style: 'thin' } });
    expect(at(10, 11)?.formula).toBe(true);
    // The detail formula is flagged (its result is worked out when Excel opens it).
    expect(at(4, 11)).toMatchObject({ formula: true });
    // The logo in A1 and the small mark in the Approved by box.
    expect(p.pictures).toHaveLength(2);
    expect(p.pictures[0]).toMatchObject({ r1: 1, c1: 1 });
    expect(p.merges).toContainEqual({ r1: 1, c1: 3, r2: 3, c2: 8 });
    expect(p.lastPreDrawn).toBeNull();
  });

  it('finds the pre-drawn rows for a start row, with or without placed columns (C3)', async () => {
    expect((await previewA({ startRow: A.startRow, columns: [] })).lastPreDrawn).toBe(
      A.lastPreDrawn,
    );
    expect(
      (await previewA({ startRow: A.startRow, columns: [A.cols.srNo, A.cols.text] })).lastPreDrawn,
    ).toBe(A.lastPreDrawn);
    // Template B has no pre-drawn rows: just the start row.
    const wb = await loadTemplate(ExcelJS, buf(await templateB(ExcelJS)));
    const p = sheetPreview(wb, {
      sheet: B.sheet,
      needRow: 0,
      probe: { startRow: B.startRow, columns: [], lastPreDrawn: null },
    });
    expect(p?.lastPreDrawn).toBe(B.startRow);
  });

  it('reaches a start row further down, and is null for a missing sheet', async () => {
    const wb = await loadTemplate(ExcelJS, buf(await templateA(ExcelJS)));
    expect(sheetPreview(wb, { sheet: 'Nope', needRow: 0, probe: null })).toBeNull();
    const far = sheetPreview(wb, { sheet: A.sheet, needRow: 120, probe: null });
    expect(far?.rows).toBe(128);
  });

  it('keeps the loaded workbook for its key and refuses what is not a workbook', async () => {
    const bytes = buf(await templateA(ExcelJS));
    const req = { sheet: A.sheet, needRow: 0, probe: null };
    const one = await previewOf(ExcelJS, 'k1', bytes, req);
    expect(one.ok).toBe(true);
    // Same key: the kept workbook answers even if the bytes passed are not read.
    const two = await previewOf(ExcelJS, 'k1', new ArrayBuffer(4), { ...req, sheet: 'Lists' });
    expect(two.ok && two.preview?.sheet).toBe('Lists');
    expect(await previewOf(ExcelJS, 'k2', new ArrayBuffer(4), req)).toEqual({ ok: false });
  });

  it('resolves theme, tinted and indexed colours', () => {
    expect(cssColor({ argb: 'FF1F4EA0' })).toBe('#1F4EA0');
    expect(cssColor({ theme: 4 })).toBe('#4472C4');
    expect(cssColor({ theme: 0, tint: -0.5 })).toBe('#808080');
    expect(cssColor({ indexed: 2 })).toBe('#FF0000');
    expect(cssColor(undefined)).toBeNull();
    expect(cssColor({ indexed: 64 })).toBeNull();
  });
});

describe('set-up suggestions', () => {
  it('finds the header row and the start row under it', async () => {
    const p = await previewA();
    expect(guessHeaderRow(p.cells)).toBe(A.headerRow);
    expect(guessStartRow(p.cells)).toBe(A.startRow);
    expect(guessStartRow([{ r: 1, c: 1, text: 'Alone', bold: true }])).toBeNull();
  });

  it('a two-row header (merged cells) puts the start row under both rows', () => {
    const cells = [
      { r: 5, c: 1, text: 'No.', bold: true, rs: 2 },
      { r: 5, c: 2, text: 'Comment', bold: true, rs: 2 },
      { r: 5, c: 3, text: 'Response', bold: true, cs: 2 },
      { r: 6, c: 3, text: 'By', bold: true },
      { r: 6, c: 4, text: 'Date', bold: true },
    ] as const;
    expect(guessStartRow(cells)).toBe(7);
  });

  it('places the fields its header names, each once', async () => {
    const p = await previewA();
    expect(guessColumns(p.cells, A.headerRow)).toEqual([
      { field: 'srNo', col: A.cols.srNo },
      { field: 'page', col: A.cols.page },
      { field: 'type', col: A.cols.type },
      { field: 'discipline', col: A.cols.discipline },
      { field: 'text', col: A.cols.text },
      { field: 'snapshot', col: A.cols.snapshot },
      { field: 'author', col: A.cols.author },
      { field: 'created', col: A.cols.date },
      { field: 'status', col: A.cols.status },
    ]);
    const more = guessColumns(
      [
        { r: 1, c: 1, text: 'Sl. No' },
        { r: 1, c: 2, text: 'Comment No.' },
        { r: 1, c: 3, text: 'Sheet No.' },
        { r: 1, c: 4, text: 'Remarks' },
        { r: 1, c: 5, text: 'Replies' },
        { r: 1, c: 6, text: 'Comment ID' },
        { r: 1, c: 7, text: 'Contractor response' },
        { r: 1, c: 8, text: 'Remarks' },
      ],
      1,
    );
    expect(more).toEqual([
      { field: 'srNo', col: 1 },
      { field: 'commentNo', col: 2 },
      { field: 'pageLabel', col: 3 },
      { field: 'text', col: 4 },
      { field: 'allReplies', col: 5 },
      { field: 'commentId', col: 6 },
    ]);
  });

  it('places detail cells right of their labels, skipping formulas', async () => {
    const p = await previewA();
    const d = guessDetails(p.cells, A.startRow);
    expect(d).toMatchObject({
      docNumber: A.details.docNo,
      revision: A.details.rev,
      title: A.details.title,
      reviewer: A.details.reviewer,
      reviewDate: A.details.date,
    });
    // "Total comments" in I4: the form counts them itself (a formula in K4).
    expect(d.commentCount).toBeUndefined();
    expect(
      guessDetails(
        [
          { r: 2, c: 1, text: 'Total comments' },
          { r: 2, c: 3, text: '' },
        ],
        5,
      ),
    ).toEqual({ commentCount: 'B2' });
  });
});
