// Ruled tables with merged cells (colspan and rowspan) and wrapped text,
// header rows repeated on every page, row groups kept together.

import { textWidth, winAnsi } from './fonts.ts';
import type { Flow } from './flow.ts';
import { num, type FontKey } from './pdf.ts';

export interface Cell {
  text: string;
  colspan?: number;
  rowspan?: number;
  bold?: boolean;
  align?: 'left' | 'center';
}

interface Placed {
  cell: Cell;
  row: number;
  col: number;
  lines: string[];
}

const SIZE = 8;
const LEADING = 10;
const PAD = 3;

function wrapText(s: string, font: FontKey, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of s.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, font, SIZE) <= width || !cur) cur = next;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function place(rows: Cell[][], cols: number[]): { placed: Placed[]; heights: number[] } {
  const occupied = new Set<string>();
  const placed: Placed[] = [];
  rows.forEach((cells, r) => {
    let col = 0;
    for (const cell of cells) {
      while (occupied.has(`${String(r)},${String(col)}`)) col++;
      const cs = cell.colspan ?? 1;
      const rs = cell.rowspan ?? 1;
      for (let dr = 0; dr < rs; dr++)
        for (let dc = 0; dc < cs; dc++) occupied.add(`${String(r + dr)},${String(col + dc)}`);
      const width = cols.slice(col, col + cs).reduce((a, b) => a + b, 0) - 2 * PAD;
      placed.push({
        cell,
        row: r,
        col,
        lines: wrapText(cell.text, cell.bold ? 'F2' : 'F1', width),
      });
      col += cs;
    }
  });
  const heights = rows.map(() => LEADING + 2 * PAD);
  for (const p of placed)
    if ((p.cell.rowspan ?? 1) === 1)
      heights[p.row] = Math.max(heights[p.row] ?? 0, p.lines.length * LEADING + 2 * PAD);
  for (const p of placed) {
    const rs = p.cell.rowspan ?? 1;
    if (rs === 1) continue;
    const need = p.lines.length * LEADING + 2 * PAD;
    const have = heights.slice(p.row, p.row + rs).reduce((a, b) => a + b, 0);
    const lastRow = p.row + rs - 1;
    if (need > have) heights[lastRow] = (heights[lastRow] ?? 0) + need - have;
  }
  return { placed, heights };
}

/** Draws the table into the flow, breaking pages between row groups. */
export function drawTable(flow: Flow, cols: number[], header: Cell[][], body: Cell[][]): void {
  const x0 = flow.setup.left;
  const head = place(header, cols);
  const rows = place(body, cols);
  const headH = head.heights.reduce((a, b) => a + b, 0);

  // Row groups: a rowspan keeps its rows together.
  const groups: [number, number][] = [];
  let r = 0;
  while (r < body.length) {
    let end = r;
    for (let k = r; k <= end; k++)
      for (const p of rows.placed)
        if (p.row === k) end = Math.max(end, k + (p.cell.rowspan ?? 1) - 1);
    groups.push([r, end]);
    r = end + 1;
  }

  const colX = (c: number): number => x0 + cols.slice(0, c).reduce((a, b) => a + b, 0);
  const drawRows = (
    set: { placed: Placed[]; heights: number[] },
    from: number,
    to: number,
    top: number,
  ) => {
    const rowY = (k: number): number => top - set.heights.slice(from, k).reduce((a, b) => a + b, 0);
    let ops = '0 G 0.5 w';
    let text = '';
    for (const p of set.placed) {
      if (p.row < from || p.row > to) continue;
      const cs = p.cell.colspan ?? 1;
      const rs = p.cell.rowspan ?? 1;
      const x = colX(p.col);
      const w = cols.slice(p.col, p.col + cs).reduce((a, b) => a + b, 0);
      const yTop = rowY(p.row);
      const h = set.heights.slice(p.row, p.row + rs).reduce((a, b) => a + b, 0);
      ops += ` ${num(x)} ${num(yTop - h)} ${num(w)} ${num(h)} re`;
      const font: FontKey = p.cell.bold ? 'F2' : 'F1';
      p.lines.forEach((line, i) => {
        const lw = textWidth(line, font, SIZE);
        const tx = p.cell.align === 'center' ? x + (w - lw) / 2 : x + PAD;
        const ty = yTop - PAD - SIZE - i * LEADING + 1;
        text += `\nBT /${font} ${String(SIZE)} Tf ${num(tx)} ${num(ty)} Td ${winAnsi(line)} Tj ET`;
      });
    }
    flow.raw(`${ops} S${text}`);
  };

  let first = true;
  for (const [g0, g1] of groups) {
    const gh = rows.heights.slice(g0, g1 + 1).reduce((a, b) => a + b, 0);
    if (first || flow.room() < gh) {
      if (!first) flow.newPage();
      flow.ensure(headH + gh);
      drawRows(head, 0, header.length - 1, flow.cursor);
      flow.skip(headH);
      first = false;
    }
    drawRows(rows, g0, g1, flow.cursor);
    flow.skip(gh);
  }
  flow.skip(8);
}
