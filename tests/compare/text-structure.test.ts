// M12-18 (D-63): the text comparison's structure on self-made pages — table
// rows matched as rows and cells compared in place, figures compared as
// pictures, clause renumbering reported once with the references that do not
// follow, the OCR labels, header and footer bands drawn by hand, and OCR words
// read like a text layer.
import { describe, expect, it } from 'vitest';
import {
  TEXT_INVISIBLE,
  type PageFigure,
  type PageTable,
  type PageText,
} from '../../src/model/compare/material';
import {
  UNIT_FIGURE,
  UNIT_ROW,
  buildDoc,
  clauseTokens,
} from '../../src/model/compare/text/document';
import { WORD_INVISIBLE, pageLayout } from '../../src/model/compare/text/layout';
import { matchText } from '../../src/model/compare/text/match';
import { Interner } from '../../src/model/compare/text/myers';
import { ocrPageText } from '../../src/model/compare/text/ocrText';
import { mapped, renumbering } from '../../src/model/compare/text/renumber';
import { ocrFold, tokenize } from '../../src/model/compare/text/tokens';
import { looksTabular } from '../../src/workers/work/compareStructure';
import { docOf, linesText, type SynthLine } from './support/textPages';

describe('clause numbers', () => {
  const at = (s: string, raised: number[] = []) =>
    clauseTokens(tokenize(s), (i) => raised.includes(i)).map((i) => tokenize(s)[i]?.key);

  it('finds a paragraph’s own number and the numbers it cites', () => {
    expect(at('3.4 Inspection shall follow Clause 2.1 and Section 5.')).toEqual([
      '3.4',
      '2.1',
      '5',
    ]);
    expect(at('Clause 3.4: Inspection and Witness Points')).toEqual(['3.4']);
    expect(at('Sub-clause 3.10.1 applies.')).toEqual(['3.10.1']);
  });

  it('takes a raised small number for a footnote mark, but not a value', () => {
    expect(at('The pipe shall be flushed 2 at 1.5 m/s.', [5])).toEqual(['2']);
    expect(at('24.0 bar(g) is the test pressure.')).toEqual([]);
    expect(at('12 50 mm pipes.')).toEqual([]);
  });
});

describe('the renumbering map', () => {
  const pair = (a: string, b: string, own = true) => ({ a, b, i: 0, j: 0, ta: 0, tb: 0, own });

  it('maps sub-clauses through their parent and groups consecutive shifts', () => {
    const rn = renumbering([
      pair('3.4', '3.6'),
      pair('3.5', '3.7'),
      pair('3.6', '3.8'),
      pair('3.5.1', '3.7.1'),
      pair('3.5', '3.7', false),
      pair('3.6', '3.6', false),
    ]);
    expect(rn).not.toBeNull();
    expect([...(rn?.map ?? [])]).toEqual([
      ['3.4', '3.6'],
      ['3.5', '3.7'],
      ['3.6', '3.8'],
    ]);
    expect(rn?.groups.map((g) => g.map((p) => p.a))).toEqual([['3.4', '3.5', '3.6']]);
    expect(rn?.shifted).toBe(4);
    expect(rn?.follow).toBe(1);
    expect(rn?.follows('3.6', '3.6')).toBe(false);
    expect(mapped(rn?.map ?? new Map(), '3.5.2')).toBe('3.7.2');
    expect(renumbering([pair('2', '2')])).toBeNull();
  });
});

describe('clause renumbering in a comparison', () => {
  const clause = (n: string, what: string) =>
    `Clause ${n}: The contractor shall supply the ${what} with all spares and the documents listed.`;
  const subjects = ['pumps', 'valves', 'piping', 'instruments', 'cables', 'motors'];
  const a = [
    ...subjects.map((s, i) => clause(`3.${String(i + 1)}`, s)),
    'The tests of Clause 3.4 and Clause 3.5 are witnessed by the engineer.',
  ];
  const b = [
    clause('3.1', subjects[0] ?? ''),
    clause('3.2', 'heat exchangers'),
    ...subjects.slice(1).map((s, i) => clause(`3.${String(i + 3)}`, s)),
    // 3.4 → 3.5 follows; 3.5 should now be 3.6 but still reads 3.5.
    'The tests of Clause 3.5 and Clause 3.5 are witnessed by the engineer.',
  ];

  it('reports the shift once and a reference that does not follow', () => {
    const intern = new Interner();
    const r = matchText(docOf([a], intern), docOf([b], intern));
    expect(r.changes.map((c) => [c.kind, c.a?.text ?? '', c.b?.text ?? ''])).toEqual([
      ['inserted', '', clause('3.2', 'heat exchangers')],
      ['renumbered', '3.2–3.6', '3.3–3.7'],
      ['reference', '3.5', '3.5'],
    ]);
    expect(r.changes[1]?.renumber).toEqual({ shifted: 5, follow: 1 });
    expect(r.changes[2]?.reference).toEqual({ expected: '3.6' });
    // The numbers are marked where they are.
    expect(r.changes[1]?.b?.rects).toHaveLength(5);
  });

  it('flags a reference in text that did not change at all', () => {
    const intern = new Interner();
    const same = 'Payment follows Clause 3.4 of this section without exception.';
    const r = matchText(
      docOf([[...a.slice(0, 6), same]], intern),
      docOf([[...b.slice(0, 7), same]], intern),
    );
    const refs = r.changes.filter((c) => c.kind === 'reference');
    expect(refs.map((c) => [c.a?.text, c.b?.text, c.reference?.expected])).toEqual([
      ['3.4', '3.4', '3.5'],
    ]);
  });

  it('with the switch off, every shifted number is listed', () => {
    const intern = new Interner();
    const r = matchText(docOf([a], intern), docOf([b], intern), { renumbering: false });
    expect(r.changes.some((c) => c.kind === 'renumbered' || c.kind === 'reference')).toBe(false);
    expect(
      r.changes.filter((c) => c.kind === 'replaced').map((c) => [c.a?.text, c.b?.text]),
    ).toEqual([
      ['3.2', '3.3'],
      ['3.3', '3.4'],
      ['3.4', '3.5'],
      ['3.5', '3.6'],
      ['3.6', '3.7'],
      ['3.4', '3.5'],
    ]);
  });
});

/** A table of `rows` at the top of the page: 100 pt columns, 20 pt rows, from (50, 100). */
function tableOf(rows: string[][], headerRows = 1, y = 100): PageTable {
  const nc = rows[0]?.length ?? 0;
  const cellBoxes = new Float32Array(rows.length * nc * 4);
  rows.forEach((_, r) => {
    for (let c = 0; c < nc; c++)
      cellBoxes.set([50 + c * 100, y + r * 20, 150 + c * 100, y + (r + 1) * 20], (r * nc + c) * 4);
  });
  return {
    box: [50, y, 50 + nc * 100, y + rows.length * 20],
    cells: rows,
    headerRows,
    merges: [],
    cellBoxes,
  };
}

/** A page with lines of text and the given tables and figures. */
function page(lines: SynthLine[], tables: PageTable[] = [], figures: PageFigure[] = []): PageText {
  // The tables' own words are on the page too (the layout leaves them out of the running text).
  const cellLines = tables.flatMap((tb) =>
    tb.cells.flatMap((r, ri) =>
      r.map((c, ci) => ({ text: c, x: 52 + ci * 100, y: tb.box[1] + ri * 20 + 5 })),
    ),
  );
  const all = linesText([...lines, ...cellLines.filter((l) => l.text)], 595);
  return { ...all, structure: { imageCover: 0, figures, tables } };
}

describe('tables', () => {
  const head = ['Item', 'Description', 'Qty', 'Rate'];
  const A = [head, ['1', 'Gate valve', '12', '1,450.00'], ['2', 'Check valve', '4', '980.00']];
  const B = [
    head,
    ['1', 'Gate valve', '15', '1,450.00'],
    ['2', 'Check valve', '4', '980.00'],
    ['3', 'Strainer', '2', '310.00'],
  ];
  const doc = (rows: string[][], intern: Interner, more: string[][] = []) =>
    buildDoc(
      [
        pageLayout(
          page([{ text: 'Bill of quantities for the pump station.', y: 60 }], [tableOf(rows)]),
        ),
        ...(more.length ? [pageLayout(page([], [tableOf(more)]))] : []),
      ],
      intern,
    );

  it('makes each row a unit with its cells, its name and the column names', () => {
    const d = doc(A, new Interner());
    const rows = [...d.rows.values()];
    expect(rows.map((r) => [r.label, r.head])).toEqual([
      ['', true],
      ['1 · Gate valve', false],
      ['2 · Check valve', false],
    ]);
    expect(rows[1]?.header).toEqual(head);
    expect([...d.unitKind]).toEqual([0, UNIT_ROW, UNIT_ROW, UNIT_ROW]);
    expect(d.unitText[2]).toBe('1 | Gate valve | 12 | 1,450.00');
  });

  it('reports a changed cell with its row and column, marked by the cell; an added row once', () => {
    const intern = new Interner();
    const r = matchText(doc(A, intern), doc(B, intern));
    expect(r.changes.map((c) => [c.kind, c.table, c.a?.text, c.b?.text, c.pct])).toEqual([
      ['replaced', { row: '1 · Gate valve', column: 2, col: 'Qty' }, '12', '15', 25],
      ['inserted', { row: '3 · Strainer' }, undefined, '3 | Strainer | 2 | 310.00', undefined],
    ]);
    // The Qty cell of row 1: column 2, row 1 of the table.
    expect(r.changes[0]?.b?.rects).toEqual([{ page: 0, x0: 250, y0: 120, x1: 350, y1: 140 }]);
  });

  it('leaves out a header row repeated on the next page; a first row that repeats is a header', () => {
    const intern = new Interner();
    const d = doc(A, intern, [head, ['3', 'Strainer', '2', '310.00']]);
    expect([...d.rows.values()].filter((r) => r.head)).toHaveLength(1);
    // Without bold, the repeated first row makes the header.
    const plain = (rows: string[][]) => ({ ...tableOf(rows), headerRows: 0 });
    const e = buildDoc(
      [
        pageLayout(page([], [plain(A)])),
        pageLayout(page([], [plain([head, ['3', 'x', '1', '2']])])),
      ],
      new Interner(),
    );
    expect([...e.rows.values()].map((r) => r.head)).toEqual([true, false, false, false]);
  });

  it('tells a table from prose in columns', () => {
    expect(
      looksTabular([
        ['Item', 'Qty'],
        ['Pump', '2'],
        ['Valve', '14'],
      ]),
    ).toBe(true);
    expect(
      looksTabular([
        ['The contractor shall supply all pumps', 'The employer will review every drawing'],
        ['and their drivers with spares', 'within fourteen days of receipt'],
      ]),
    ).toBe(false);
  });
});

describe('figures', () => {
  const fig = (hash: string, shade = 128, y = 200): PageFigure => ({
    box: [100, y, 300, y + 150],
    hash,
    thumb: new Uint8Array(256).fill(shade),
  });
  const doc = (figs: PageFigure[], intern: Interner) =>
    buildDoc(
      [
        pageLayout(
          page(
            [
              { text: 'Figure 1 shows the bending moment diagram.', y: 150 },
              { text: 'The design is adequate for the loads given.', y: 400 },
            ],
            [],
            figs,
          ),
        ),
      ],
      intern,
    );

  it('makes a picture a unit at its place in the reading order', () => {
    const d = doc([fig('a')], new Interner());
    expect([...d.unitKind]).toEqual([0, UNIT_FIGURE, 0]);
  });

  it('reports nothing for the same picture, a changed figure for another, with how different it looks', () => {
    const intern = new Interner();
    expect(matchText(doc([fig('a')], intern), doc([fig('a')], intern)).changes).toEqual([]);
    const r = matchText(doc([fig('a', 100)], intern), doc([fig('b', 130)], intern));
    expect(r.changes).toMatchObject([{ kind: 'figure', figure: { diff: 30 } }]);
    expect(r.changes[0]?.b?.rects).toEqual([{ page: 0, x0: 100, y0: 200, x1: 300, y1: 350 }]);
  });

  it('reports an added picture as an inserted figure', () => {
    const intern = new Interner();
    const r = matchText(doc([], intern), doc([fig('a')], intern));
    expect(r.changes).toMatchObject([{ kind: 'inserted', figure: {}, b: { text: '' } }]);
  });
});

describe('OCR', () => {
  it('reads OCR words like a text layer, flagged as OCR, in displayed space', () => {
    const frame = {
      width: 595,
      height: 842,
      rotation: 0 as const,
      toDisplay: [1, 0, 0, -1, 0, 842] as [number, number, number, number, number, number],
    };
    // 300 dpi: 300 px = 72 pt.
    const t = ocrPageText(
      [
        {
          box: { x0: 300, y0: 300, x1: 1500, y1: 350 },
          baseline: null,
          words: [
            { text: 'Expiry', box: { x0: 300, y0: 300, x1: 600, y1: 350 }, conf: 90 },
            { text: '2027-06-30', box: { x0: 650, y0: 300, x1: 1150, y1: 350 }, conf: 90 },
          ],
        },
      ],
      300,
      frame,
      [1, 0, 0, 1, 0, 0],
    );
    expect(t.structure?.ocr).toBe(true);
    expect(Array.from(t.flags).every((f) => f & TEXT_INVISIBLE)).toBe(true);
    const l = pageLayout(t);
    expect(l.text).toBe('Expiry2027-06-30');
    expect(Array.from(l.wordFlags).every((f) => f & WORD_INVISIBLE)).toBe(true);
    expect(l.wordBox[0]).toBeCloseTo(72);
    expect(l.ocr).toBe(true);
    const d = buildDoc([l], new Interner());
    expect(d.ocrPages).toEqual([0]);
  });

  it('labels changes on OCR text, and a typical confusion as a possible OCR error', () => {
    const ocrPage = (text: string) => {
      const t = linesText([{ text, y: 200 }], 595);
      t.flags = t.flags.map((f) => f | TEXT_INVISIBLE);
      return pageLayout(t);
    };
    const intern = new Interner();
    const r = matchText(
      buildDoc([ocrPage('Grout strength 45 MPa for a 5O0 mm pad')], intern),
      buildDoc([ocrPage('Grout strength 55 MPa for a 500 mm pad')], intern),
    );
    expect(r.changes.map((c) => [c.a?.text, c.b?.text, c.ocr])).toEqual([
      ['45 MPa', '55 MPa', 'ocr'],
      ['5O0 mm', '500 mm', 'ocr-error'],
    ]);
    expect(ocrFold('U1trasonic')).toBe(ocrFold('Ultrasonic'));
  });
});

describe('header and footer bands drawn by hand', () => {
  const pageOf = (rev: string, body: string) =>
    pageLayout(
      linesText(
        [
          { text: `Data sheet DS-7 Rev ${rev}`, y: 40 },
          { text: body, y: 300 },
          { text: 'Confidential', y: 810 },
        ],
        595,
      ),
    );

  it('take out what is in them on every page, even on one page, and report it once', () => {
    const intern = new Interner();
    const bands = { top: 60, bottom: 50 };
    const a = buildDoc([pageOf('A', 'Pump rated flow is 120 m3/h.')], intern, { bands });
    const b = buildDoc([pageOf('B', 'Pump rated flow is 120 m3/h.')], intern, { bands });
    expect(a.unitText).toEqual(['Pump rated flow is 120 m3/h.']);
    expect(matchText(a, b).changes.map((c) => [c.kind, c.a?.text, c.b?.text])).toEqual([
      ['header', 'A', 'B'],
    ]);
    // Without bands, one page has no running header: the line is text.
    const plain = buildDoc([pageOf('A', 'Pump rated flow is 120 m3/h.')], intern);
    expect(plain.unitText[0]).toBe('Data sheet DS-7 Rev A');
  });
});
