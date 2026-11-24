// M13-07 (D-71, plan M13 §6): the rows a project template gets — comment-type
// ticks and Ignore highlights (C8, C12), the order (C12), every field (C4,
// C7) — and how they split into sheets and cells (C5, C6, C15), the fill spec
// and the CSV.
import {
  PdfAnnotationState as St,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype as S,
  type PdfAnnotationObject,
} from '@embedpdf/models';
import { describe, expect, it } from 'vitest';
import {
  groupByPage,
  isHighlight,
  statusWord,
  templateRows,
  type TemplateRowOptions,
} from '../../src/features/crs/templates/templateRows';
import {
  fillSpec,
  planSheets,
  prefillDetails,
  sheetCells,
  templateCsv,
  writtenColumns,
} from '../../src/features/crs/templates/templateSheets';
import { defaultSettings, type CrsField, type StatusWord } from '../../src/model/crs/template';

const APP: Record<StatusWord, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
  none: '',
};

const box = (x: number, y: number) => ({ origin: { x, y }, size: { width: 20, height: 10 } });
const a = (o: Partial<PdfAnnotationObject> & { id: string; type?: S }) =>
  ({ type: S.TEXT, pageIndex: 0, rect: box(10, 10), ...o }) as PdfAnnotationObject;
const d = (s: string) => new Date(s);

// Page 1 (index 0): a cloud without text high up, a note lower down, a text
// box at the top right, a see-through area highlight with text; page 2: a
// rectangle. Replies and a review status on the note.
const doc = [
  a({ id: 'cloud', type: S.POLYGON, rect: box(300, 50), author: 'Ana', created: d('2026-01-01') }),
  a({
    id: 'note',
    rect: box(50, 400),
    author: 'Ana',
    contents: 'Check the flange\r\nrating',
    created: d('2026-01-02'),
    modified: d('2026-01-09'),
  }),
  a({
    id: 'box',
    type: S.FREETEXT,
    rect: box(400, 20),
    author: 'Bo',
    contents: 'Title block typo',
    created: d('2026-01-03'),
  }),
  a({
    id: 'hl',
    type: S.SQUARE,
    rect: box(10, 600),
    contents: 'Checked',
    created: d('2026-01-04'),
    opacity: 0.3,
  }),
  a({
    id: 'p2',
    type: S.SQUARE,
    pageIndex: 1,
    author: 'Bo',
    contents: 'Page two',
    created: d('2026-01-05'),
  }),
  a({
    id: 'r2',
    inReplyToId: 'note',
    author: 'Ven',
    contents: 'Later one',
    created: d('2026-01-08'),
  }),
  a({ id: 'r1', inReplyToId: 'note', author: '', contents: 'Agreed', created: d('2026-01-06') }),
  a({ id: 'r1a', inReplyToId: 'r1', author: 'Ana', contents: 'Thanks', created: d('2026-01-07') }),
  a({
    id: 's1',
    inReplyToId: 'note',
    author: 'Bo',
    created: d('2026-01-10'),
    state: St.Completed,
    stateModel: PdfAnnotationStateModel.Review,
  }),
];

const status = { ...APP, completed: 'Closed', none: 'Open' };
const opts = (over: Partial<TemplateRowOptions> = {}): TemplateRowOptions => ({
  settings: { ...defaultSettings('CRS', 10, APP), status },
  typeLabel: (x) => `type ${String(x.type)}`,
  date: (x) => x.toISOString().slice(0, 10),
  discipline: (author) => (author === 'Ana' ? 'Piping' : ''),
  noAuthor: 'Anonymous',
  pageLabel: (p) => (p === 0 ? 'A-101' : null),
  ...over,
});

describe('template rows (C4, C7, C8, C12)', () => {
  it('orders by page, typed text first, then top to bottom and left to right; leaves out highlights', () => {
    const rows = templateRows(doc, opts());
    expect(rows.map((r) => r.id)).toEqual(['box', 'note', 'cloud', 'p2']);
    // Ignore highlights off in the dialog: the see-through mark comes back, after the note.
    expect(templateRows(doc, opts({ ignoreHighlights: false })).map((r) => r.id)).toEqual([
      'box',
      'note',
      'hl',
      'cloud',
      'p2',
    ]);
  });

  it('takes only the ticked comment types', () => {
    const s = defaultSettings('CRS', 10, APP);
    s.types.rectangle = false;
    s.types.polygon = false;
    expect(templateRows(doc, opts({ settings: s })).map((r) => r.id)).toEqual(['box', 'note']);
  });

  it('fills every field', () => {
    const note = templateRows(doc, opts()).find((r) => r.id === 'note');
    expect(note?.values).toEqual({
      commentNo: 2,
      page: 1,
      pageLabel: 'A-101',
      type: `type ${String(S.TEXT)}`,
      text: 'Check the flange\nrating',
      author: 'Ana',
      discipline: 'Piping',
      created: d('2026-01-02'),
      modified: d('2026-01-09'),
      status: 'Closed',
      allReplies:
        'Anonymous (2026-01-06): Agreed\n  Ana (2026-01-07): Thanks\nVen (2026-01-08): Later one',
      firstReply: 'Agreed',
      lastReply: 'Later one',
      lastReplyAuthor: 'Ven',
      commentId: 'note',
    } satisfies Partial<Record<CrsField, unknown>>);
    expect(note?.region).toEqual({ page: 0, x: 50, y: 400, width: 20, height: 10 });
    const p2 = templateRows(doc, opts()).find((r) => r.id === 'p2');
    // No page label: the page number; no status: the template's word for none.
    expect(p2?.values.pageLabel).toBe('2');
    expect(p2?.values.status).toBe('Open');
    expect(p2?.values.allReplies).toBe('');
    expect(p2?.values.lastReplyAuthor).toBe('');
  });

  it('maps statuses and finds highlights by opacity (under 70 %)', () => {
    expect(statusWord(null)).toBe('none');
    expect(statusWord(St.None)).toBe('none');
    expect(statusWord(St.Accepted)).toBe('accepted');
    expect(statusWord(St.Cancelled)).toBe('cancelled');
    expect(isHighlight(a({ id: 'x', opacity: 0.69 }))).toBe(true);
    expect(isHighlight(a({ id: 'x', opacity: 0.7 }))).toBe(false);
    expect(isHighlight(a({ id: 'x', type: S.HIGHLIGHT }))).toBe(false);
  });
});

describe('sheets and cells (C5, C6, C15)', () => {
  const s = defaultSettings('CRS', 10, APP);
  const place = (field: CrsField, col: number, text?: string) => {
    const c = s.columns.find((x) => x.field === field);
    if (c) Object.assign(c, { on: true, col }, text === undefined ? {} : { text });
  };
  place('srNo', 1);
  place('text', 3);
  place('snapshot', 4);
  place('pageLabel', 2);
  place('fixed', 6, 'Open');
  s.details = { docNumber: 'C4', commentCount: 'K4', docName: 'C3' };
  const rows = templateRows(doc, opts());
  const details = {
    docNumber: 'D-1',
    revision: 'B',
    title: 'Pump',
    reviewer: 'Ana',
    reviewDate: '24/11/2026',
  };
  const one = (name: string) => ({
    name,
    pageCount: 3,
    details,
    rows,
    pageLabel: (p: number) => (p === 0 ? 'A-101' : null),
  });

  it('writes the ticked columns in column order, Sr. No. restarting per sheet', () => {
    expect(writtenColumns(s).map((c) => c.field)).toEqual([
      'srNo',
      'pageLabel',
      'text',
      'snapshot',
      'fixed',
    ]);
    expect(sheetCells(s, rows.slice(0, 2))).toEqual([
      [1, 'A-101', 'Title block typo', null, 'Open'],
      [2, 'A-101', 'Check the flange\nrating', null, 'Open'],
    ]);
  });

  it('one document on one sheet keeps the name; per page and per document get names', () => {
    expect(planSheets([one('pump.pdf')], s, 'Scheme').map((p) => [p.name, p.rows.length])).toEqual([
      [null, 4],
    ]);
    const perPage = planSheets([one('pump.pdf')], { sheetPerPage: true }, 'Scheme');
    expect(perPage.map((p) => [p.name, p.rows.length])).toEqual([
      ['A-101', 3],
      ['Page 2', 1],
    ]);
    expect(perPage[0]?.details).toMatchObject({ docName: 'pump', commentCount: 3, pageCount: 3 });
    const two = planSheets([one('pump.pdf'), one('valve.PDF')], s, 'Scheme');
    expect(two.map((p) => [p.doc, p.name])).toEqual([
      [0, 'pump'],
      [1, 'valve'],
    ]);
    const both = planSheets([one('pump.pdf'), one('valve.pdf')], { sheetPerPage: true }, 'S');
    expect(both.map((p) => p.name)).toEqual([
      'pump - A-101',
      'pump - Page 2',
      'valve - A-101',
      'valve - Page 2',
    ]);
    expect(groupByPage(rows).map((g) => [g.page, g.rows.length])).toEqual([
      [0, 3],
      [1, 1],
    ]);
  });

  it('gives the worker the columns, the Snapshot index and each sheet', () => {
    const sheets = planSheets([one('pump.pdf')], { sheetPerPage: true }, 'Scheme');
    const spec = fillSpec(s, sheets);
    expect(spec).toMatchObject({
      sheet: 'CRS',
      startRow: 10,
      lastPreDrawn: null,
      columns: [1, 2, 3, 4, 6],
      snapshotIndex: 3,
      snapshotMaxPx: 240,
    });
    expect(spec.sheets[1]).toEqual({
      name: 'Page 2',
      details: [
        { cell: 'C4', value: 'D-1' },
        { cell: 'K4', value: 1 },
        { cell: 'C3', value: 'pump' },
      ],
      rows: [[1, '2', 'Page two', null, 'Open']],
    });
  });

  it('writes the CSV with the same columns and no pictures', () => {
    const sheets = planSheets([one('pump.pdf'), one('valve.pdf')], s, 'Scheme');
    // TextDecoder drops the BOM.
    const text = new TextDecoder().decode(templateCsv(s, sheets));
    const lines = text.split('\r\n');
    expect(lines.slice(0, 6)).toEqual([
      'pump',
      'Document number,D-1',
      'Comment count,4',
      'Document name,pump',
      'Sr. No.,Page label,Comment text,Fixed text',
      '1,A-101,Title block typo,Open',
    ]);
    expect(lines).toContain('valve');
    expect(lines).toContain('2,A-101,"Check the flange\nrating",Open');
  });

  it('prefills number and revision from the file-name rule (C10)', () => {
    const fallback = { ...details, docNumber: 'old', revision: 'A' };
    expect(
      prefillDetails({ fileNameRule: '{docNo}_Rev{rev}' }, 'PA-12_RevC.pdf', fallback),
    ).toMatchObject({ docNumber: 'PA-12', revision: 'C', title: 'Pump' });
    expect(prefillDetails({ fileNameRule: '{docNo}_Rev{rev}' }, 'other.pdf', fallback)).toEqual(
      fallback,
    );
    expect(prefillDetails({ fileNameRule: '' }, 'PA-12_RevC.pdf', fallback)).toEqual(fallback);
  });
});
