import {
  PdfAnnotationState as St,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype as S,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  CRS_COLUMNS,
  buildCrsRows,
  rowCells,
  type RowOptions,
} from '../../src/features/crs/crsModel';
import { csvCell, toCsv } from '../../src/features/crs/csv';

// M3-19 (D-15, §7.5): the row builder (numbers, replies, statuses, filters,
// empty cells) and the CSV writer (escaping, formula guard, BOM, CRLF).

const rect = { origin: { x: 10, y: 20 }, size: { width: 30, height: 40 } };
const a = (o: Partial<PdfAnnotationObject> & { id: string; type?: S }) =>
  ({ type: S.TEXT, pageIndex: 0, rect, ...o }) as PdfAnnotationObject;
const d = (s: string) => new Date(s);

const doc = [
  a({
    id: 'p2',
    type: S.SQUARE,
    pageIndex: 1,
    author: 'Bo',
    contents: 'Second page',
    created: d('2026-01-01'),
  }),
  a({
    id: 'root',
    type: S.HIGHLIGHT,
    author: 'Ana',
    contents: 'Move it\r\nplease',
    created: d('2026-01-02'),
  }),
  a({ id: 'r1', inReplyToId: 'root', author: 'Bo', contents: 'Why?', created: d('2026-01-03') }),
  a({ id: 'r1a', inReplyToId: 'r1', author: 'Ana', contents: 'Clash', created: d('2026-01-04') }),
  a({
    id: 's1',
    inReplyToId: 'root',
    author: 'Bo',
    created: d('2026-01-05'),
    state: St.Accepted,
    stateModel: PdfAnnotationStateModel.Review,
  }),
  a({ id: 'first', type: S.CIRCLE, author: '', contents: '', created: d('2026-01-01') }),
];

const opts: RowOptions = {
  typeLabel: (x) =>
    new Map<number, string>([
      [S.SQUARE, 'Rectangle'],
      [S.HIGHLIGHT, 'Highlight'],
      [S.CIRCLE, 'Oval'],
    ]).get(x.type) ?? 'Other',
  statusLabel: (s) => (s === St.Accepted ? 'Accepted' : String(s)),
  date: (x) => x.toISOString().slice(0, 10),
  discipline: (author) => (author === 'Ana' ? 'Piping' : ''),
  noAuthor: 'Anonymous',
};

describe('CRS rows', () => {
  it('numbers like the Comments pane; replies flattened in thread order; latest status', () => {
    const rows = buildCrsRows(doc, opts);
    expect(rows.map((r) => [r.number, r.id, r.page])).toEqual([
      [1, 'first', 1],
      [2, 'root', 1],
      [3, 'p2', 2],
    ]);
    const root = rows[1];
    expect(root).toMatchObject({
      type: 'Highlight',
      reviewer: 'Ana',
      discipline: 'Piping',
      comment: 'Move it\nplease',
      status: 'Accepted',
      replies: 'Bo (2026-01-03): Why?\n  Ana (2026-01-04): Clash',
    });
    expect(root?.region).toEqual({ page: 0, x: 10, y: 20, width: 30, height: 40 });
  });

  it('empty cells: no author, no text, no replies, no status; vendor columns blank', () => {
    const first = buildCrsRows(doc, opts)[0];
    if (!first) throw new Error('no row');
    const cells = rowCells(first);
    expect(cells).toHaveLength(CRS_COLUMNS.length);
    expect(cells).toEqual(['1', '1', 'Oval', 'Anonymous', '', '', '', '', '', '', '']);
  });

  it('scope "filtered" keeps the pane’s filter (numbers stay the pane’s)', () => {
    const rows = buildCrsRows(doc, { ...opts, filter: { authors: ['Bo'] } });
    expect(rows.map((r) => [r.number, r.id])).toEqual([[3, 'p2']]);
    expect(
      buildCrsRows(doc, { ...opts, filter: { statuses: [St.Accepted] } }).map((r) => r.id),
    ).toEqual(['root']);
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('guards formulas: =, +, -, @, tab and CR get a leading apostrophe', () => {
    for (const s of ['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx', '\rx'])
      expect(csvCell(s).replace(/^"/u, '').startsWith(`'`), s).toBe(true);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('1-2')).toBe('1-2');
  });

  it('UTF-8 with BOM and CRLF line ends', () => {
    const bytes = toCsv([
      ['No.', 'Comment'],
      ['1', 'Ünïcode ✓'],
    ]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text).toBe('﻿No.,Comment\r\n1,Ünïcode ✓\r\n');
  });
});
