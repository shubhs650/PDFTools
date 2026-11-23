// The comparison file's pure parts (M12-20, D-65, ADR-032): the data's checks
// and defaults, the text marks and where a caret for deleted text goes, and
// what reopening restores.
import { describe, expect, it } from 'vitest';
import {
  DataError,
  decodeData,
  encodeData,
  type ComparisonData,
} from '../../src/model/compare/file/format';
import {
  deletionPlace,
  rgbOf,
  textMarkSpecs,
  type MarkWords,
} from '../../src/model/compare/file/textMarks';
import type { TextComparison, TextRect } from '../../src/model/compare/text/match';
import { DEFAULT_MARK_COLOURS } from '../../src/model/compare/textView';
import { overlayRestore, textRestore, zonesFrom } from '../../src/features/compare/file/restore';
import { validRows } from '../../src/features/compare/pairingFlow';
import type { Comparison } from '../../src/features/compare/model';

const file = (name: string) => ({
  name,
  size: 10,
  sha256: '0'.repeat(64),
  pages: 2,
  range: '',
  storage: { attachment: 'TriyaCompare-A' },
});

const base = (): ComparisonData =>
  ({
    format: 'triya-comparison',
    version: 1,
    kind: 'overlay',
    created: '2026-11-23T00:00:00Z',
    modified: '2026-11-23T00:00:00Z',
    app: 'Triya PDF 1.1.0',
    documents: { A: [file('a.pdf')], B: [{ ...file('b.pdf'), storage: { attachment: 'B' } }] },
    options: {},
    ignoreZones: [],
    checked: [],
    closeOut: [],
  }) as unknown as ComparisonData;

const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

describe('the comparison data (format v1)', () => {
  it('round-trips and fills what an older writer left out', () => {
    const d = base();
    const back = decodeData(encodeData(d));
    expect(back.documents.A[0]?.name).toBe('a.pdf');
    const thin: Partial<ComparisonData> = { ...d };
    delete thin.ignoreZones;
    delete thin.checked;
    delete thin.closeOut;
    const filled = decodeData(enc(thin));
    expect(filled.ignoreZones).toEqual([]);
    expect(filled.checked).toEqual([]);
    expect(filled.closeOut).toEqual([]);
  });

  it('keeps a whole leading page count and drops anything else (M12-21 summary page)', () => {
    expect(decodeData(enc({ ...base(), leadingPages: 1 })).leadingPages).toBe(1);
    expect(decodeData(enc({ ...base(), leadingPages: -1 })).leadingPages).toBeUndefined();
    expect(decodeData(enc({ ...base(), leadingPages: 'x' })).leadingPages).toBeUndefined();
  });

  it('refuses a newer version, another format and a file without both documents', () => {
    const problem = (v: unknown): string | null => {
      try {
        decodeData(enc(v));
        return null;
      } catch (e) {
        return e instanceof DataError ? e.problem : 'other';
      }
    };
    expect(problem({ ...base(), version: 2 })).toBe('newer');
    expect(problem({ ...base(), format: 'Other' })).toBe('notComparison');
    expect(problem({ ...base(), documents: { A: [], B: [] } })).toBe('broken');
  });
});

const words: MarkWords = {
  subject: {
    inserted: 'Inserted',
    deleted: 'Deleted',
    replaced: 'Changed',
    moved: 'Moved',
    header: 'Header',
    footer: 'Footer',
    renumbered: 'Renumbered',
    reference: 'Reference',
    figure: 'Figure',
  },
  inserted: 'Inserted text',
  moved: 'Moved text',
  figure: 'Changed figure',
  was: (old) => `was: ${old}`,
  deleted: (old) => `Deleted: ${old}`,
};

const rect = (page: number, y0: number, x0 = 72): TextRect => ({
  page,
  x0,
  y0,
  x1: x0 + 100,
  y1: y0 + 12,
});

const span = (text: string, rects: TextRect[]) => ({
  page: rects[0]?.page ?? 0,
  text,
  t0: 0,
  t1: 1,
  rects,
});

describe('the text marks', () => {
  it('reads a colour as 0…1 and anything else as black', () => {
    expect(rgbOf('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(rgbOf('red')).toEqual([0, 0, 0]);
  });

  it('puts the caret through the sync point before the deleted text', () => {
    // Paragraph at A p0 y100 is at B p1 y50; the deletion is 20 pt below it on A.
    const sync = new Float32Array([0, 100, 1, 50]);
    const place = deletionPlace(sync, rect(0, 120));
    expect(place.page).toBe(1);
    expect(place.y0).toBeCloseTo(70);
    expect(place.x1 - place.x0).toBe(8);
  });

  it('without a sync point before it, uses the first one after (its line, not the offset)', () => {
    const sync = new Float32Array([2, 40, 3, 60]);
    const place = deletionPlace(sync, rect(1, 300));
    expect(place.page).toBe(3);
    expect(place.y0).toBeCloseTo(60);
  });

  it('marks each change on B’s pages, the old text in the note of a replacement', () => {
    const result = {
      changes: [
        {
          kind: 'replaced',
          a: span('1,450.00', [rect(0, 10)]),
          b: span('1,500.00', [rect(0, 10)]),
        },
        { kind: 'inserted', b: span('new clause', [rect(0, 30), rect(1, 5)]) },
        { kind: 'deleted', a: span('old ¶ clause', [rect(0, 60)]) },
      ],
      sync: new Float32Array([0, 0, 0, 0]),
      limited: { a: [], b: [] },
      scanned: { a: [], b: [] },
    } as unknown as TextComparison;
    const specs = textMarkSpecs(result, (p) => p + 4, DEFAULT_MARK_COLOURS, words);
    expect(specs.map((s) => [s.kind, s.shape, s.page])).toEqual([
      ['replaced', 'highlight', 4],
      ['inserted', 'highlight', 4],
      ['inserted', 'highlight', 5],
      ['deleted', 'caret', 4],
    ]);
    expect(specs[0]?.contents).toBe('was: 1,450.00');
    expect(specs[0]?.old).toBe('1,450.00');
    expect(specs[1]?.old).toBeUndefined();
    expect(specs[3]?.contents).toBe('Deleted: old clause');
  });
});

const overlay: Comparison = {
  id: 'cmp-1',
  type: 'overlay',
  stage: 'result',
  a: [
    { docId: 'a1', range: '' },
    { docId: 'a2', range: '' },
  ],
  b: [{ docId: 'b1', range: '' }],
};

describe('reopening restores', () => {
  it('the overlay’s view, layer switches by file, differences settings, zones and placements', () => {
    const d: ComparisonData = {
      ...base(),
      options: {
        thicken: true,
        layout: 'overlay',
        lock: false,
        vector: true,
        layers: { A: { '1': { '12': false } }, B: { '0': { '7': true } } },
        diff: { sensitivity: 'high', minSize: 2, outlines: false },
      },
      ignoreZones: [
        { sheet: 2, rect: [1, 2, 30, 40] },
        { sheet: null, rect: [0, 0, 10, 10] },
      ],
      checked: ['0|k1'],
      pairing: [
        { a: 0, b: 0 },
        { a: 1, b: null, excluded: true },
      ],
      sheets: [
        { a: [0, 0], b: [0, 0], aToB: [1, 0, 0, 1, 5, 6], status: 'manual' },
        { a: [1, 0], b: null, status: 'asIs' },
      ],
    };
    const r = overlayRestore(overlay, d);
    expect(r.view).toMatchObject({ thicken: true, layout: 'overlay', lock: false, vector: true });
    expect(r.view.layers).toEqual({ a2: { '12': false }, b1: { '7': true } });
    expect(r.diff).toMatchObject({ sensitivity: 'high', minSize: 2, outlines: false });
    expect(r.diff.zones?.map((z) => [z.pair, z.box])).toEqual([
      [1, [1, 2, 30, 40]],
      [null, [0, 0, 10, 10]],
    ]);
    expect(r.diff.checked).toEqual(['0|k1']);
    expect(r.rows).toEqual([
      { a: 0, b: 0, excluded: false },
      { a: 1, b: null, excluded: true },
    ]);
    expect([...r.manual]).toEqual([[0, [1, 0, 0, 1, 5, 6]]]);
  });

  it('the sheets whose uncertain alignment the user accepted ("Checked by you", M12-26)', () => {
    const r = overlayRestore(overlay, {
      ...base(),
      sheets: [
        { a: [0, 0], b: [0, 0], status: 'lowConfidence', checked: true },
        { a: [1, 0], b: [0, 1], status: 'lowConfidence' },
        { a: [1, 1], b: [0, 2], aToB: [1, 0, 0, 1, 2, 3], status: 'manual', checked: true },
      ],
    });
    expect([...r.checked]).toEqual([0]);
    expect([...r.manual.keys()]).toEqual([2]);
  });

  it('ignores options of the wrong type', () => {
    const r = overlayRestore(overlay, {
      ...base(),
      options: { thicken: 'yes', diff: { sensitivity: 'max' } },
    });
    expect(r.view.thicken).toBe(false);
    expect(r.diff.sensitivity).toBeUndefined();
  });

  it('a text comparison’s switches, colours and ticks', () => {
    const v = textRestore({
      ...base(),
      kind: 'text',
      options: { run: { renumbering: false }, colours: { inserted: '#00ff00' }, sync: false },
      checked: ['k'],
    });
    expect(v.options?.renumbering).toBe(false);
    expect(v.options?.headersFooters).toBe(true);
    expect(v.colours?.inserted).toBe('#00ff00');
    expect(v.sync).toBe(false);
    expect(v.checked).toEqual(['k']);
  });

  it('drops a damaged zone', () => {
    expect(
      zonesFrom([{ sheet: 1, rect: [0, 0, 1] as unknown as [number, number, number, number] }]),
    ).toEqual([]);
  });

  it('uses a saved pairing table only when it is one of these pages', () => {
    const rows = [
      { a: 0, b: 1, excluded: false },
      { a: 1, b: 0, excluded: false },
    ];
    expect(validRows(rows, { a: 2, b: 2 })).toBe(true);
    expect(validRows(rows, { a: 3, b: 2 })).toBe(false);
    expect(validRows([...rows, { a: 1, b: null, excluded: false }], { a: 2, b: 2 })).toBe(false);
  });
});
