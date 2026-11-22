// Drawing sheet furniture: border, zone grid and title block (mm, landscape).

import type { Align, Canvas } from './canvas.ts';
import { MM, type FontKey } from './pdf.ts';

export interface Sheet {
  name: 'A1' | 'A2' | 'A3';
  /** Trimmed size in millimetres, landscape. */
  w: number;
  h: number;
}

export const SHEETS: Record<Sheet['name'], Sheet> = {
  A1: { name: 'A1', w: 841, h: 594 },
  A2: { name: 'A2', w: 594, h: 420 },
  A3: { name: 'A3', w: 420, h: 297 },
};

/** Page size in points (exact ISO sizes). */
export const pagePt = (s: Sheet): { width: number; height: number } => ({
  width: s.w * MM,
  height: s.h * MM,
});

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Real text, or the same text drawn as curves (CAD text exported as geometry). */
export function label(
  c: Canvas,
  curves: boolean,
  font: FontKey,
  h: number,
  x: number,
  y: number,
  s: string,
  align: Align = 'left',
  angle = 0,
): void {
  if (curves) c.curveText(h, x, y, s, align, angle);
  else c.text(font, h, x, y, s, align, angle);
}

const BORDER = { left: 20, right: 10, top: 10, bottom: 10 };
const ZONE = 70;

/** Draws the border and zone grid; returns the area inside the border. */
export function frame(c: Canvas, s: Sheet, curves = false): Box {
  const x0 = BORDER.left;
  const y0 = BORDER.bottom;
  const x1 = s.w - BORDER.right;
  const y1 = s.h - BORDER.top;
  c.save()
    .stroke(0)
    .width(0.7)
    .rect(x0, y0, x1 - x0, y1 - y0)
    .strokePath();
  c.width(0.25)
    .rect(x0 - 5, y0 - 5, x1 - x0 + 10, y1 - y0 + 10)
    .strokePath();
  const cols = Math.max(4, Math.round((x1 - x0) / ZONE));
  const rows = Math.max(4, Math.round((y1 - y0) / ZONE));
  const cw = (x1 - x0) / cols;
  const rh = (y1 - y0) / rows;
  for (let i = 1; i < cols; i++) {
    const x = x0 + i * cw;
    c.line(x, y0 - 5, x, y0).line(x, y1, x, y1 + 5);
  }
  for (let j = 1; j < rows; j++) {
    const y = y0 + j * rh;
    c.line(x0 - 5, y, x0, y).line(x1, y, x1 + 5, y);
  }
  c.strokePath();
  if (curves) c.width(0.25);
  for (let i = 0; i < cols; i++) {
    const x = x0 + (i + 0.5) * cw;
    label(c, curves, 'F1', 2.5, x, y0 - 3.75, String(i + 1), 'center');
    label(c, curves, 'F1', 2.5, x, y1 + 1.25, String(i + 1), 'center');
  }
  for (let j = 0; j < rows; j++) {
    // Letters run top to bottom.
    const y = y1 - (j + 0.5) * rh - 1.25;
    const letter = String.fromCharCode(65 + j);
    label(c, curves, 'F1', 2.5, x0 - 2.5, y, letter, 'center');
    label(c, curves, 'F1', 2.5, x1 + 2.5, y, letter, 'center');
  }
  if (curves) c.strokePath();
  c.restore();
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The zone ("C7") that holds a point, for manifest locations. */
export function zoneOf(s: Sheet, x: number, y: number): string {
  const x0 = BORDER.left;
  const y0 = BORDER.bottom;
  const x1 = s.w - BORDER.right;
  const y1 = s.h - BORDER.top;
  const cols = Math.max(4, Math.round((x1 - x0) / ZONE));
  const rows = Math.max(4, Math.round((y1 - y0) / ZONE));
  const col = Math.min(cols, Math.max(1, Math.floor(((x - x0) / (x1 - x0)) * cols) + 1));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(((y1 - y) / (y1 - y0)) * rows)));
  return `${String.fromCharCode(65 + row)}${String(col)}`;
}

export interface Revision {
  rev: string;
  date: string;
  desc: string;
  by: string;
  chk: string;
}

export interface TitleBlock {
  project: string;
  title: [string, string];
  drawingNo: string;
  rev: string;
  date: string;
  scale: string;
  status: string;
  drawn: string;
  checked: string;
  approved: string;
  sheet: string;
  revisions: Revision[];
}

export const TB_W = 180;
export const TB_H = 62;
const REV_ROW = 5;

/** Height of the title block plus its revision table. */
export const titleBlockHeight = (tb: TitleBlock): number =>
  TB_H + REV_ROW * (Math.max(3, tb.revisions.length) + 1);

/** The title block, bottom right inside the border, with the revision table above. */
export function titleBlock(c: Canvas, s: Sheet, tb: TitleBlock, curves = false): Box {
  const x = s.w - BORDER.right - TB_W;
  const y = BORDER.bottom;
  const t = (font: FontKey, h: number, tx: number, ty: number, str: string, a: Align = 'left') => {
    label(c, curves, font, h, tx, ty, str, a);
  };
  const rows = Math.max(3, tb.revisions.length);
  const rh = REV_ROW * (rows + 1);
  // A wipeout behind the block, as CAD title blocks have.
  c.save()
    .fillGray(1)
    .rect(x, y, TB_W, TB_H + rh)
    .fillPath()
    .fillGray(0);
  c.stroke(0).width(0.5).rect(x, y, TB_W, TB_H).strokePath();
  c.width(0.25);
  // Rows from the bottom: number/rev/sheet (14), scale/date/status (10),
  // drawn/checked/approved (10), title (16), project (12).
  for (const yy of [14, 24, 34, 50]) c.line(x, y + yy, x + TB_W, y + yy);
  for (const xx of [110, 140]) c.line(x + xx, y, x + xx, y + 34);
  c.strokePath();
  if (curves) c.width(0.18);
  const small = 1.6;
  t('F1', small, x + 2, y + 10.5, 'DRAWING No.');
  t('F2', 4, x + 2, y + 3, tb.drawingNo);
  t('F1', small, x + 112, y + 10.5, 'REV');
  t('F2', 4, x + 125, y + 3, tb.rev, 'center');
  t('F1', small, x + 142, y + 10.5, 'SHEET');
  t('F1', 2.5, x + 160, y + 3.5, tb.sheet, 'center');
  t('F1', small, x + 2, y + 21, 'SCALE');
  t('F1', 2.5, x + 2, y + 16, tb.scale);
  t('F1', small, x + 112, y + 21, 'DATE');
  t('F1', 2.5, x + 112, y + 16, tb.date);
  t('F1', small, x + 142, y + 21, 'STATUS');
  t('F2', 2.2, x + 142, y + 16, tb.status);
  t('F1', small, x + 2, y + 31, 'DRAWN');
  t('F1', 2.5, x + 2, y + 26, tb.drawn);
  t('F1', small, x + 112, y + 31, 'CHECKED');
  t('F1', 2.5, x + 112, y + 26, tb.checked);
  t('F1', small, x + 142, y + 31, 'APPROVED');
  t('F1', 2.5, x + 142, y + 26, tb.approved);
  t('F1', small, x + 2, y + 47, 'TITLE');
  t('F2', 3.5, x + 2, y + 41.5, tb.title[0]);
  t('F2', 3.5, x + 2, y + 36, tb.title[1]);
  t('F1', small, x + 2, y + 59, 'PROJECT');
  t('F2', 3.2, x + 2, y + 53, tb.project);
  if (curves) c.strokePath();

  // Revision table above the title block (newest row on top).
  const ry = y + TB_H;
  c.width(0.25).rect(x, ry, TB_W, rh);
  for (let i = 1; i <= rows; i++) c.line(x, ry + i * REV_ROW, x + TB_W, ry + i * REV_ROW);
  for (const xx of [12, 36, 150, 165]) c.line(x + xx, ry, x + xx, ry + rh);
  c.strokePath();
  if (curves) c.width(0.18);
  const head = ry + rows * REV_ROW + 1.5;
  t('F2', 2, x + 6, head, 'REV', 'center');
  t('F2', 2, x + 24, head, 'DATE', 'center');
  t('F2', 2, x + 38, head, 'DESCRIPTION');
  t('F2', 2, x + 157.5, head, 'BY', 'center');
  t('F2', 2, x + 172.5, head, 'CHK', 'center');
  tb.revisions.forEach((r, i) => {
    const yy = ry + (rows - 1 - i) * REV_ROW + 1.5;
    t('F1', 2, x + 6, yy, r.rev, 'center');
    t('F1', 2, x + 24, yy, r.date, 'center');
    t('F1', 2, x + 38, yy, r.desc);
    t('F1', 2, x + 157.5, yy, r.by, 'center');
    t('F1', 2, x + 172.5, yy, r.chk, 'center');
  });
  if (curves) c.strokePath();
  c.restore();
  return { x, y, w: TB_W, h: TB_H + rh };
}
