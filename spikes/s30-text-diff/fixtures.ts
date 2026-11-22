// Spike S30 (M12-05): a self-made two-column pair (CLAUDE.md rule 13) whose
// revisions store their text in different orders, to separate the reading
// order routes. Corpus pair 04 draws each column in turn, so the content order
// is already the reading order and every route reads it right. Here Rev A
// draws column by column, Rev B draws row by row across both columns (as some
// layout programs and PDF printers do), and Rev B also inserts one clause and
// changes two values. A route that follows the content order compares
// interleaved lines; a route that reads columns sees only the three edits.

import { buildPdf } from '../shared/mini-pdf.ts';

const BODY =
  'All horizontal overhung process pumps shall conform to ISO 13709 and API 610. Casing and impeller metallurgy shall be ASTM A351 CF8M with a corrosion allowance of 3.0 mm. Hydrostatic shell testing shall be witnessed at 24.0 bar(g) for a minimum hold of 30 minutes.';

function clauses(rev: 'A' | 'B'): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 14; i++) {
    let t = `Clause ${String(i)}: ${BODY}`;
    if (rev === 'B' && i === 8) t = t.replace('24.0 bar(g)', '30.0 bar(g)');
    if (rev === 'B' && i === 11) t = t.replace('ASTM A351 CF8M', 'ASTM A890 Duplex 2205');
    out.push(t);
    if (rev === 'B' && i === 3)
      out.push(
        'Clause 3A: Net positive suction head available shall exceed the required value by at least 1.5 m over the whole preferred operating region of the pump.',
      );
  }
  return out;
}

/** Greedy wrap by an average Helvetica width (0.5 em). */
function wrap(text: string, chars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if (cur && cur.length + 1 + w.length > chars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

interface Placed {
  page: number;
  col: number;
  y: number;
  text: string;
}

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

export function twoColumnPdf(rev: 'A' | 'B', order: 'columns' | 'rows'): Uint8Array {
  const placed: Placed[] = [];
  let page = 0;
  let col = 0;
  let y = 780;
  for (const c of clauses(rev)) {
    for (const line of wrap(c, 46)) {
      if (y < 60) {
        y = 780;
        col++;
        if (col === 2) {
          col = 0;
          page++;
        }
      }
      placed.push({ page, col, y, text: line });
      y -= 12;
    }
    y -= 8;
  }
  const pages = page + 1;
  const objs: (string | { dict: string; stream: string })[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${String(3 + i * 2)} 0 R`).join(' ')}] /Count ${String(pages)} >>`,
  ];
  const fontRef = 3 + pages * 2;
  for (let p = 0; p < pages; p++) {
    let lines = placed.filter((l) => l.page === p);
    // Content order: column by column, or row by row across the columns.
    lines =
      order === 'columns'
        ? lines.sort((a, b) => a.col - b.col || b.y - a.y)
        : lines.sort((a, b) => b.y - a.y || a.col - b.col);
    const ops = lines
      .map(
        (l) =>
          `BT /F1 9 Tf ${String(l.col === 0 ? 50 : 310)} ${String(l.y)} Td (${esc(l.text)}) Tj ET`,
      )
      .join('\n');
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(fontRef)} 0 R >> >> /Contents ${String(4 + p * 2)} 0 R >>`,
      { dict: '<< >>', stream: ops },
    );
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  return buildPdf(objs);
}

/** The pair: Rev A stored by columns, Rev B by rows. */
export function scrambledPair(): { old: Uint8Array; new: Uint8Array } {
  return { old: twoColumnPdf('A', 'columns'), new: twoColumnPdf('B', 'rows') };
}
