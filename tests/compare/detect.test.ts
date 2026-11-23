// M12-14 (D-61): difference detection on drawings, pure pieces (TDD): the
// banded detector's distance counts, the differences at a setting (regions,
// tolerance, minimum size, ignore zones, text-aware entries), the text layer,
// clouds from differences, stored zone sets and the list's state.
import { describe, expect, it } from 'vitest';
import {
  BINS,
  CELL_COUNTS,
  DiffDetector,
  cellPx,
  type DiffCells,
} from '../../src/model/compare/detect/detector';
import { sheetDiff, type SheetMaterial } from '../../src/model/compare/detect/entries';
import { placedWords, textChanges, type TextChange } from '../../src/model/compare/detect/textDiff';
import { cloudVertices } from '../../src/model/compare/detect/clouds';
import { zoneSetOf, zoneSetsOf } from '../../src/model/compare/detect/zoneSets';
import {
  DEFAULT_DIFF,
  addZone,
  entryId,
  sheetOrder,
  sheetState,
  shownEntries,
  stepFrom,
  toggleChecked,
  zonesOf,
  type DiffView,
} from '../../src/features/compare/diff/diffState';
import type { Sheet } from '../../src/features/compare/overlay/overlayState';
import type { PageText, RasterBand } from '../../src/model/compare/material';

/** A raster with ink (255) where `ink(x, y)` says. */
function raster(w: number, h: number, ink: (x: number, y: number) => boolean): Uint8Array {
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) d[y * w + x] = 255;
  return d;
}

function band(d: Uint8Array, w: number, h: number, top: number, rows: number): RasterBand {
  return { width: w, height: h, top, rows, data: d.slice(top * w, (top + rows) * w) };
}

/** Folds two whole rasters in, `rows` at a time. */
function detect(
  a: Uint8Array,
  b: Uint8Array,
  w: number,
  h: number,
  rows: number,
  dpi = 72,
): DiffCells {
  const det = new DiffDetector(w, h, dpi, 96);
  for (let top = 0; top < h; top += rows) {
    const n = Math.min(rows, h - top);
    det.add(band(a, w, h, top, n), band(b, w, h, top, n));
  }
  return det.cells();
}

/** Total of A's (or B's) counts at distance > tol. */
function changed(c: DiffCells, side: 'a' | 'b', tol: number): number {
  let n = 0;
  for (let i = 0; i < c.index.length; i++)
    for (let j = Math.max(0, tol - 1); j < BINS; j++)
      n += c.counts[i * CELL_COUNTS + (side === 'a' ? 0 : BINS) + j] ?? 0;
  return n;
}

const material = (cells: DiffCells, texts: TextChange[] = [], scan = false): SheetMaterial => ({
  cells,
  texts,
  scan,
  width: (cells.width * 72) / cells.dpi,
  height: (cells.height * 72) / cells.dpi,
});

describe('the banded detector', () => {
  const W = 60;
  const H = 40;
  // A vertical line at x = 20 on A; on B at 20 + shift.
  const lineAt = (x0: number) => raster(W, H, (x, y) => x === x0 && y >= 5 && y < 35);

  it('counts each mark by its distance to the other side’s ink', () => {
    for (const shift of [1, 2, 3, 4, 6]) {
      const c = detect(lineAt(20), lineAt(20 + shift), W, H, 7);
      const d = Math.min(shift, 5);
      // Unchanged at a tolerance ≥ the shift; changed (30 px a side) below it.
      for (const tol of [1, 2, 3, 4]) {
        const want = d > tol ? 30 : 0;
        expect(changed(c, 'a', tol), `shift ${String(shift)} tol ${String(tol)}`).toBe(want);
        expect(changed(c, 'b', tol)).toBe(want);
      }
      expect(c.inkA).toBe(30);
      expect(c.inkB).toBe(30);
    }
  });

  it('looks up and down across band edges: any band height gives the same cells', () => {
    // A horizontal line moved down by 2 rows, near band edges.
    const a = raster(W, H, (x, y) => y === 15 && x > 3 && x < 50);
    const b = raster(W, H, (x, y) => y === 17 && x > 3 && x < 50);
    const whole = detect(a, b, W, H, H);
    for (const rows of [1, 2, 5, 16, 17]) {
      const c = detect(a, b, W, H, rows);
      expect([...c.index]).toEqual([...whole.index]);
      expect([...c.counts]).toEqual([...whole.counts]);
    }
    expect(changed(whole, 'a', 1)).toBe(46);
    expect(changed(whole, 'a', 2)).toBe(0);
  });

  it('identical rasters give no cells; a band sent twice is not counted twice', () => {
    const a = lineAt(20);
    const det = new DiffDetector(W, H, 72, 96);
    det.add(band(a, W, H, 0, 20), band(a, W, H, 0, 20));
    det.add(band(a, W, H, 0, 20), band(a, W, H, 0, 20));
    det.add(band(a, W, H, 20, 20), band(a, W, H, 20, 20));
    const c = det.cells();
    expect(c.index.length).toBe(0);
    expect(c.ink).toBe(30);
    expect(() => {
      new DiffDetector(W, H, 72, 96).add(band(a, W, H, 10, 5), band(a, W, H, 10, 5));
    }).toThrow('bands out of order');
    expect(() => new DiffDetector(W, H, 72, 96).cells()).toThrow('sheet incomplete');
  });

  it('starts over when the sheet comes again from its top', () => {
    const det = new DiffDetector(W, H, 72, 96);
    det.add(band(lineAt(20), W, H, 0, H), band(lineAt(25), W, H, 0, H));
    det.add(band(lineAt(20), W, H, 0, H), band(lineAt(20), W, H, 0, H));
    expect(det.cells().index.length).toBe(0);
  });

  it('marks below the ink level are not ink', () => {
    const faint = new Uint8Array(W * H).fill(90);
    const c = detect(faint, new Uint8Array(W * H), W, H, 8);
    expect(c.ink).toBe(0);
  });

  it('cells are 3 pt wide at the analysis resolution', () => {
    expect(cellPx(150)).toBe(6);
    expect(cellPx(72)).toBe(3);
  });
});

describe('the differences at a setting', () => {
  // 150 dpi: 6 px cells; a 200 × 120 px sheet (96 × 57.6 pt).
  const W = 200;
  const H = 120;
  const box = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) =>
    x >= x0 && x < x1 && y >= y0 && y < y1;

  it('groups changed marks into regions: removed, added, changed', () => {
    const a = raster(W, H, (x, y) => box(10, 10, 30, 30)(x, y) || box(100, 10, 130, 20)(x, y));
    const b = raster(
      W,
      H,
      (x, y) =>
        box(150, 80, 170, 100)(x, y) || box(100, 10, 130, 20)(x, y) || box(104, 22, 126, 30)(x, y),
    );
    const d = sheetDiff(material(detect(a, b, W, H, 16, 150)), {
      sensitivity: 'normal',
      minSize: 0,
      zones: [],
    });
    const kinds = d.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(['added', 'added', 'removed']);
    const removed = d.entries.find((e) => e.kind === 'removed');
    // Box in pt (150 dpi): the cells around 10–30 px.
    expect(removed?.box[0]).toBeLessThanOrEqual(10 * 0.48);
    expect(removed?.box[2]).toBeGreaterThanOrEqual(30 * 0.48);
    expect(d.percent).toBeGreaterThan(0);
    expect(d.entries.every((e) => e.type === 'geometry' && !e.old && !e.new)).toBe(true);
  });

  it('a mark moved by 2 px is a change at High, not at Normal or Low', () => {
    const a = raster(W, H, box(50, 20, 52, 100));
    const b = raster(W, H, box(52, 20, 54, 100));
    const m = material(detect(a, b, W, H, 32, 150));
    const at = (sensitivity: 'low' | 'normal' | 'high') =>
      sheetDiff(m, { sensitivity, minSize: 0, zones: [] }).entries.length;
    expect(at('high')).toBeGreaterThan(0);
    expect(at('normal')).toBe(0);
    expect(at('low')).toBe(0);
  });

  it('a scan needs more: noise floor and tolerance', () => {
    // A 3 px shift: a change on a vector sheet at Normal, not on a scan.
    const a = raster(W, H, box(50, 20, 53, 100));
    const b = raster(W, H, box(53, 20, 56, 100));
    const cells = detect(a, b, W, H, 32, 150);
    const s = { sensitivity: 'normal' as const, minSize: 0, zones: [] };
    expect(sheetDiff(material(cells), s).entries.length).toBeGreaterThan(0);
    expect(sheetDiff(material(cells, [], true), s).entries.length).toBe(0);
    // A speck of 4 px: noise on a vector sheet too.
    const speck = raster(W, H, box(60, 60, 62, 62));
    const sp = detect(speck, new Uint8Array(W * H), W, H, 32, 150);
    expect(sheetDiff(material(sp), s).entries.length).toBe(0);
  });

  it('minimum size and ignore zones apply without new counts', () => {
    const a = raster(W, H, (x, y) => box(10, 10, 14, 14)(x, y) || box(100, 50, 180, 110)(x, y));
    const m = material(detect(a, new Uint8Array(W * H), W, H, 32, 150));
    const all = sheetDiff(m, { sensitivity: 'normal', minSize: 0, zones: [] });
    expect(all.entries).toHaveLength(2);
    // 10 pt: the 4 px (2 pt) one goes.
    expect(sheetDiff(m, { sensitivity: 'normal', minSize: 10, zones: [] }).entries).toHaveLength(1);
    // A zone over the big one (pt).
    const zoned = sheetDiff(m, { sensitivity: 'normal', minSize: 0, zones: [[40, 20, 96, 57.6]] });
    expect(zoned.entries).toHaveLength(1);
    expect(zoned.percent).toBeLessThan(all.percent);
  });

  const word = (
    text: string,
    kind: TextChange['kind'],
    x: number,
    y: number,
    w = 12,
  ): TextChange => ({
    text,
    kind,
    box: [x, y, x + w, y + 6],
    cx: x + w / 2,
    cy: y + 3,
    size: 6,
  });

  it('text-aware: a word swapped in place reads "old → new", labelled text', () => {
    const cells = detect(new Uint8Array(W * H), new Uint8Array(W * H), W, H, 32, 150);
    const d = sheetDiff(
      material(cells, [word('Ø120', 'removed', 20, 20), word('Ø128', 'added', 20, 20)]),
      { sensitivity: 'normal', minSize: 0, zones: [] },
    );
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ kind: 'changed', type: 'text', old: 'Ø120', new: 'Ø128' });
  });

  it('words on one line join; a region under the words makes it text, beside them both', () => {
    // The words' pixels at 150 dpi: x 20–44 pt → 42–92 px, y 20–26 pt → 42–54 px.
    const b = raster(W, H, (x, y) => box(42, 42, 90, 54)(x, y) || box(92, 40, 120, 70)(x, y));
    const cells = detect(new Uint8Array(W * H), b, W, H, 32, 150);
    const d = sheetDiff(
      material(cells, [word('NEW', 'added', 20, 20, 10), word('NOTE', 'added', 33, 20, 11)]),
      { sensitivity: 'normal', minSize: 0, zones: [] },
    );
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ kind: 'added', type: 'both', new: 'NEW NOTE' });
    const only = sheetDiff(
      material(detect(new Uint8Array(W * H), raster(W, H, box(42, 42, 90, 54)), W, H, 32, 150), [
        word('NEW', 'added', 20, 20, 10),
        word('NOTE', 'added', 33, 20, 11),
      ]),
      { sensitivity: 'normal', minSize: 0, zones: [] },
    );
    expect(only.entries[0]?.type).toBe('text');
  });

  it('keys stay unique and entries read top to bottom', () => {
    const a = raster(W, H, (x, y) => box(150, 10, 160, 20)(x, y) || box(10, 90, 20, 100)(x, y));
    const d = sheetDiff(material(detect(a, new Uint8Array(W * H), W, H, 32, 150)), {
      sensitivity: 'normal',
      minSize: 0,
      zones: [],
    });
    expect(d.entries.map((e) => e.box[1] < 20)).toEqual([true, false]);
    expect(new Set(d.entries.map((e) => e.key)).size).toBe(2);
  });
});

/** A page's text: one character per entry, boxes in displayed pt. */
function pageText(
  chars: { c: string; x: number; y: number; w?: number; size?: number }[],
): PageText {
  const n = chars.length;
  const t: PageText = {
    frame: { width: 500, height: 300, rotation: 0, toDisplay: [1, 0, 0, -1, 0, 300] },
    codes: new Uint32Array(n),
    boxes: new Float32Array(n * 4),
    origins: new Float32Array(n * 2),
    sizes: new Float32Array(n),
    angles: new Float32Array(n),
    flags: new Uint8Array(n),
  };
  chars.forEach((ch, i) => {
    const w = ch.w ?? 5;
    const size = ch.size ?? 8;
    t.codes[i] = ch.c.codePointAt(0) ?? 32;
    t.boxes.set([ch.x, ch.y, ch.x + w, ch.y + size], i * 4);
    t.sizes[i] = size;
  });
  return t;
}

const typed = (text: string, x: number, y: number) =>
  Array.from(text, (c, i) => ({ c, x: x + i * 5, y }));

describe('the text layer', () => {
  it('reads words with their boxes, moved by the placement', () => {
    const t = pageText([
      ...typed('PIER', 10, 20),
      { c: ' ', x: 30, y: 20 },
      ...typed('P-5', 35, 20),
    ]);
    const w = placedWords(t);
    expect(w.map((x) => x.text)).toEqual(['PIER', 'P-5']);
    expect(w[0]?.box).toEqual([10, 20, 30, 28]);
    const moved = placedWords(t, [1, 0, 0, 1, 14, 9]);
    expect(moved[0]?.box).toEqual([24, 29, 44, 37]);
  });

  it('a word not at its place on the other side is a change; one that is, is not', () => {
    const a = pageText([
      ...typed('Ø120', 100, 50),
      { c: ' ', x: 120, y: 50 },
      ...typed('BORE', 200, 50),
    ]);
    const b = pageText([
      ...typed('Ø128', 100, 50),
      { c: ' ', x: 120, y: 50 },
      ...typed('BORE', 201, 50),
    ]);
    const ch = textChanges(a, b, [1, 0, 0, 1, 0, 0]);
    expect(ch.map((c) => `${c.kind} ${c.text}`).sort()).toEqual(['added Ø128', 'removed Ø120']);
    // Through the alignment: A moved by (14, 9) lines up with B moved the same.
    const b2 = pageText([
      ...typed('Ø120', 114, 59),
      { c: ' ', x: 134, y: 59 },
      ...typed('BORE', 214, 59),
    ]);
    expect(textChanges(a, b2, [1, 0, 0, 1, 14, 9])).toEqual([]);
  });

  it('leaves invisible text (an OCR layer) out', () => {
    const a = pageText(typed('SCAN', 10, 10));
    a.flags.fill(2);
    expect(placedWords(a)).toEqual([]);
    expect(textChanges(a, undefined, [1, 0, 0, 1, 0, 0])).toEqual([]);
  });
});

describe('clouds from differences', () => {
  it('grows the box, keeps it on the page and turns it into the laid-out page', () => {
    const page = { width: 600, height: 400, rotation: 0 };
    expect(cloudVertices([10, 20, 50, 60], page)).toEqual([
      { x: 6, y: 16 },
      { x: 54, y: 16 },
      { x: 54, y: 64 },
      { x: 6, y: 64 },
    ]);
    expect(cloudVertices([1, 1, 50, 60], page)[0]).toEqual({ x: 0, y: 0 });
    // A page shown a quarter turn round: displayed 400 × 600.
    const turned = cloudVertices([10, 20, 50, 60], { width: 600, height: 400, rotation: 1 }, 0);
    expect(turned[0]).toEqual({ x: 20, y: 390 });
    expect(turned[2]).toEqual({ x: 60, y: 350 });
  });
});

describe('stored zone sets', () => {
  it('keeps valid zones only, sorted by name', () => {
    expect(zoneSetOf(null)).toBeNull();
    expect(zoneSetOf({ id: 'x', name: '  ', zones: [] })).toBeNull();
    const s = zoneSetOf({
      id: 's',
      name: ' Title block ',
      savedAt: 5,
      zones: [
        { box: [10, 10, 0, 0], all: true },
        { box: [0, 0, 5, 5], all: false, sheet: 2 },
        { box: [0, 0, 5, 5], all: false },
        { box: [0, 0, 0, 5], all: true },
        { box: ['a', 0, 1, 1], all: true },
      ],
    });
    expect(s).toEqual({
      id: 's',
      name: 'Title block',
      savedAt: 5,
      zones: [
        { box: [0, 0, 10, 10], all: true },
        { box: [0, 0, 5, 5], all: false, sheet: 2 },
      ],
    });
    expect(
      zoneSetsOf([{ id: 'b', name: 'B', zones: [] }, 3, { id: 'a', name: 'A', zones: [] }]).map(
        (x) => x.name,
      ),
    ).toEqual(['A', 'B']);
  });
});

describe('the list’s state', () => {
  const e = (key: string, kind: 'added' | 'removed' | 'changed', old = '', nw = '') => ({
    key,
    kind,
    type: old || nw ? ('text' as const) : ('geometry' as const),
    box: [0, 0, 1, 1] as [number, number, number, number],
    removed: 1,
    added: 1,
    old,
    new: nw,
  });
  const sheets: Sheet[] = [
    { a: null, b: { docId: 'b', page: 0, file: 0 }, pair: null },
    { a: { docId: 'a', page: 0, file: 0 }, b: { docId: 'b', page: 1, file: 0 }, pair: 0 },
    { a: { docId: 'a', page: 1, file: 0 }, b: { docId: 'b', page: 2, file: 0 }, pair: 1 },
    { a: { docId: 'a', page: 2, file: 0 }, b: { docId: 'b', page: 3, file: 0 }, pair: 2 },
  ];
  const v: DiffView = {
    ...DEFAULT_DIFF,
    results: {
      0: {
        entries: [e('1:1', 'added'), e('2:2', 'changed', 'Ø120', 'Ø128')],
        percent: 2,
        scan: false,
      },
      1: { entries: [], percent: 0, scan: false },
      2: { entries: [e('3:3', 'removed')], percent: 9, scan: false },
    },
  };

  it('shows the sheets in scope, filtered by kind, search and the tick', () => {
    expect(shownEntries(v, sheets, 1).map((x) => x.id)).toEqual(['0|1:1', '0|2:2', '2|3:3']);
    const sheetOnly = { ...v, filter: { ...v.filter, scope: 'sheet' as const } };
    expect(shownEntries(sheetOnly, sheets, 3).map((x) => x.id)).toEqual(['2|3:3']);
    const q = { ...v, filter: { ...v.filter, query: 'ø128' } };
    expect(shownEntries(q, sheets, 1).map((x) => x.id)).toEqual(['0|2:2']);
    const noAdded = { ...v, filter: { ...v.filter, kinds: { ...v.filter.kinds, added: false } } };
    expect(shownEntries(noAdded, sheets, 1)).toHaveLength(2);
    const ticked = toggleChecked({ ...v, filter: { ...v.filter, hideChecked: true } }, '0|1:1');
    expect(shownEntries(ticked, sheets, 1).map((x) => x.id)).toEqual(['0|2:2', '2|3:3']);
    expect(toggleChecked(ticked, '0|1:1').checked).toEqual([]);
  });

  it('steps with wrapping', () => {
    const shown = shownEntries(v, sheets, 1);
    expect(stepFrom(shown, null, 1)?.id).toBe('0|1:1');
    expect(stepFrom(shown, null, -1)?.id).toBe('2|3:3');
    expect(stepFrom(shown, '2|3:3', 1)?.id).toBe('0|1:1');
    expect(stepFrom(shown, '0|1:1', -1)?.id).toBe('2|3:3');
    expect(stepFrom([], null, 1)).toBeNull();
  });

  it('says how each sheet stands, and sorts most changed first', () => {
    const sheetAt = (i: number) => {
      const s = sheets[i];
      if (!s) throw new Error('no sheet');
      return s;
    };
    expect(sheetState(v, sheetAt(0))).toBeNull();
    expect(sheetState(v, sheetAt(1))).toEqual({ status: 'changed', count: 2, percent: 2 });
    expect(sheetState(v, sheetAt(2))).toEqual({ status: 'unchanged', percent: 0 });
    expect(sheetState({ ...v, checked: [entryId(2, '3:3')] }, sheetAt(3))).toEqual({
      status: 'done',
      count: 1,
      percent: 9,
    });
    expect(sheetState({ ...v, results: {} }, sheetAt(1))).toEqual({ status: 'pending' });
    expect(sheetOrder(v, sheets)).toEqual([0, 1, 2, 3]);
    expect(sheetOrder({ ...v, sortByChange: true }, sheets)).toEqual([3, 1, 2, 0]);
  });

  it('adds zones for this sheet or all sheets; tiny ones are not zones', () => {
    let z = addZone(DEFAULT_DIFF, 1, [50, 40, 10, 20]);
    expect(z.zones[0]).toMatchObject({ pair: 1, box: [10, 20, 50, 40] });
    z = addZone({ ...z, zoneScope: 'all' }, 1, [0, 0, 5, 5]);
    expect(z.zones[1]?.pair).toBeNull();
    expect(addZone(z, 1, [0, 0, 0.5, 9])).toBe(z);
    expect(zonesOf(z, 1)).toHaveLength(2);
    expect(zonesOf(z, 2)).toEqual([[0, 0, 5, 5]]);
  });
});
