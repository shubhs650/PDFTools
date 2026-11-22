// M12-09 (D-60): page pairing. The similarity and the assignment on made-up
// signatures (order kept, inserted, removed and reordered sheets, a title
// block that weighs nothing, file names for sets), the editable pairing
// table, and the whole pairing on real PDFium signatures of corpus pairs 02,
// 05, 10 and 17 (the removed and reordered set), as S28 measured.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import { SIGNATURE_GRID } from '../../src/model/compare/material';
import {
  PAIR_THRESHOLD,
  assignPairs,
  candidates,
  comparedPairs,
  isEdited,
  orderByNames,
  pairPages,
  pairingRows,
  rowsPairing,
  scoreOf,
  setExcluded,
  setPartner,
  sheetNameKey,
  similarityMatrix,
  unpair,
  type PairingSide,
  type PairingSignature,
} from '../../src/model/compare/pairing';
import { acquirePage, docPtrOf } from '../../src/workers/render/pdfium';
import { signatureOf } from '../../src/workers/work/compareMaterial';

const N = SIGNATURE_GRID * SIGNATURE_GRID;

/** A unit-length ink picture with ink in cells `cells` (zero mean like the real one). */
function picture(cells: number[]): Float32Array {
  const g = new Float32Array(N);
  for (const c of cells) g[c] = 1;
  let mean = 0;
  for (const v of g) mean += v;
  mean /= N;
  let norm = 0;
  for (let i = 0; i < N; i++) {
    g[i] = (g[i] ?? 0) - mean;
    norm += (g[i] ?? 0) ** 2;
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < N; i++) g[i] = (g[i] ?? 0) / norm;
  return g;
}

/** Sheet `k`: its own ink picture and words, plus a title block on every sheet. */
const sheet = (k: number, words: string[] = [`detail${String(k)}`, `note${String(k)}`]) =>
  ({
    ink: picture([k * 37, k * 37 + 1, k * 37 + 2, (k * 91) % N, (k * 53 + 7) % N]),
    landscape: true,
    words: [...words, 'ACME', 'Engineering', 'Drawn', 'Checked'],
  }) satisfies PairingSignature;

const side = (pages: PairingSignature[], extra: Partial<PairingSide> = {}): PairingSide => ({
  pages,
  ...extra,
});

describe('similarity', () => {
  it('a page is most like itself; the title block on every sheet does not make sheets alike', () => {
    const a = side([sheet(1), sheet(2), sheet(3)]);
    const b = side([sheet(1), sheet(2), sheet(3)]);
    const sim = similarityMatrix(a, b);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (i === j) expect(sim[i * 3 + j]).toBeCloseTo(1, 4);
        else expect(sim[i * 3 + j]).toBeLessThan(0.2);
  });

  it('a portrait page against a landscape one scores lower; a page without words counts ink only', () => {
    const p = { ...sheet(1), landscape: false };
    const sim = similarityMatrix(side([sheet(1)]), side([p]));
    // Half of (ink 1 − 0.2) plus half of the words (1).
    expect(sim[0]).toBeCloseTo(0.9, 4);
    const scan = { ...sheet(1), words: [] };
    expect(similarityMatrix(side([scan]), side([scan]))[0]).toBeCloseTo(1, 4);
  });
});

describe('assignment', () => {
  const run = (a: PairingSignature[], b: PairingSignature[]) => {
    const r = pairPages(side(a), side(b));
    return { pairs: r.pairs, removed: r.removed, added: r.added };
  };

  it('keeps order; finds an inserted sheet and a removed one', () => {
    expect(run([sheet(1), sheet(2), sheet(3)], [sheet(1), sheet(9), sheet(2), sheet(3)])).toEqual({
      pairs: [
        [0, 0],
        [1, 2],
        [2, 3],
      ],
      removed: [],
      added: [1],
    });
    expect(run([sheet(1), sheet(2), sheet(3)], [sheet(1), sheet(3)])).toEqual({
      pairs: [
        [0, 0],
        [2, 1],
      ],
      removed: [1],
      added: [],
    });
  });

  it('finds reordered sheets after the order-keeping pass', () => {
    expect(
      run(
        [sheet(1), sheet(2), sheet(3), sheet(4), sheet(5), sheet(6)],
        [sheet(1), sheet(2), sheet(4), sheet(6), sheet(5)],
      ),
    ).toEqual({
      pairs: [
        [0, 0],
        [1, 1],
        [3, 2],
        [5, 3],
        [4, 4],
      ],
      removed: [2],
      added: [],
    });
  });

  it('pairs nothing below the threshold', () => {
    const sim = Float32Array.from([PAIR_THRESHOLD - 0.01, 0.9, 0.1, 0.2]);
    expect(assignPairs(sim, 2, 2)).toEqual({ pairs: [[0, 1]], removed: [1], added: [0] });
  });

  it('a page that matches two sheets goes to the one in order (the set order decides)', () => {
    // Two B sheets look the same as A's second sheet; order keeps the right one.
    const twin = sheet(2);
    expect(run([sheet(1), twin, sheet(3)], [sheet(1), twin, twin, sheet(3)]).pairs).toEqual([
      [0, 0],
      [1, 1],
      [2, 3],
    ]);
  });
});

describe('file names for sets', () => {
  it('reduces a file name to its sheet, revision marks dropped', () => {
    expect(sheetNameKey('S-101_RevB.pdf')).toBe('s 101');
    expect(sheetNameKey('S-101 Rev C.pdf')).toBe('s 101');
    expect(sheetNameKey('S-101 B.pdf')).toBe('s 101');
    expect(sheetNameKey('s101-r02.PDF')).toBe('s101');
    expect(sheetNameKey('02_arch_floorplan_RevA_OLD.pdf')).toBe(
      sheetNameKey('02_arch_floorplan_RevB_NEW.pdf'),
    );
    expect(sheetNameKey('M-201 v3 IFC 20261122.pdf')).toBe('m 201');
    expect(sheetNameKey('Sheet A.pdf')).not.toBe(sheetNameKey('Sheet B.pdf'));
    expect(sheetNameKey('A-101.pdf')).not.toBe(sheetNameKey('A-102.pdf'));
  });

  it('pairs scans that look alike by their file names, whatever order the files were picked in', () => {
    // Ink only and every sheet the same picture: only the names can tell.
    const blank = { ...sheet(1), words: [] };
    const a = side([blank, blank, blank], {
      files: [0, 1, 2],
      names: ['S-101 RevA.pdf', 'S-102 RevA.pdf', 'S-103 RevA.pdf'],
    });
    const b = side([blank, blank, blank], {
      files: [0, 1, 2],
      names: ['S-103 RevB.pdf', 'S-101 RevB.pdf', 'S-102 RevB.pdf'],
    });
    expect(orderByNames(a, b)).toEqual([2, 0, 1]);
    expect(pairPages(a, b).pairs).toEqual([
      [2, 0],
      [0, 1],
      [1, 2],
    ]);
  });

  it('a file without a namesake keeps its place after the file before it', () => {
    const p = sheet(1);
    const a = side([p, p, p, p], {
      files: [0, 1, 1, 2],
      names: ['X-2.pdf', 'Unmatched.pdf', 'X-1.pdf'],
    });
    const b = side([p, p], { files: [0, 1], names: ['X-1.pdf', 'X-2.pdf'] });
    // X-1 (rank 0), X-2 (rank 1), then Unmatched after X-2.
    expect(orderByNames(a, b)).toEqual([3, 0, 1, 2]);
  });

  it('names play no part unless both sides are sets', () => {
    const blank = { ...sheet(1), words: [] };
    const a = side([blank, blank], { files: [0, 0], names: ['S-102.pdf'] });
    const b = side([blank, blank], { files: [0, 1], names: ['S-102.pdf', 'S-101.pdf'] });
    expect(orderByNames(a, b)).toEqual([0, 1]);
    const sim = similarityMatrix(a, b);
    expect(sim[0]).toBeCloseTo(sim[1] ?? 0, 6);
  });
});

describe('pairing table', () => {
  const auto = {
    pairs: [
      [0, 0],
      [1, 1],
      [3, 2],
      [5, 3],
      [4, 4],
    ] as [number, number][],
    removed: [2],
    added: [],
  };

  it('lists sheets in B order with a removed page after the sheet of the page before it', () => {
    expect(pairingRows(auto)).toEqual([
      { a: 0, b: 0, excluded: false },
      { a: 1, b: 1, excluded: false },
      { a: 2, b: null, excluded: false },
      { a: 3, b: 2, excluded: false },
      { a: 5, b: 3, excluded: false },
      { a: 4, b: 4, excluded: false },
    ]);
    expect(
      pairingRows({ pairs: [[1, 0]], removed: [0], added: [1] }).map((r) => [r.a, r.b]),
    ).toEqual([
      [0, null],
      [1, 0],
      [null, 1],
    ]);
  });

  it('changing a partner moves the page and leaves the old partner on its own', () => {
    const rows = pairingRows(auto);
    // Sheet 4 (A5–B3) gets A4 instead: A4 leaves sheet 5, A5 becomes removed.
    const next = setPartner(rows, 4, 'a', 4);
    expect(next.map((r) => [r.a, r.b])).toEqual([
      [0, 0],
      [1, 1],
      [2, null],
      [3, 2],
      [4, 3],
      [5, null],
      [null, 4],
    ]);
    expect(isEdited(next, auto)).toBe(true);
    // A removed page paired with an added one: both one-sided sheets merge into one.
    const merged = setPartner(next, 6, 'a', 5);
    expect(merged.map((r) => [r.a, r.b])).toEqual([
      [0, 0],
      [1, 1],
      [2, null],
      [3, 2],
      [4, 3],
      [5, 4],
    ]);
    expect(rowsPairing(merged).removed).toEqual([2]);
  });

  it('unpair marks the A page removed and the B page added; none clears a side', () => {
    const rows = pairingRows(auto);
    const split = unpair(rows, 0);
    expect(split.slice(0, 2).map((r) => [r.a, r.b])).toEqual([
      [null, 0],
      [0, null],
    ]);
    const none = setPartner(rows, 1, 'b', null);
    expect(none.slice(1, 3).map((r) => [r.a, r.b])).toEqual([
      [1, null],
      [null, 1],
    ]);
    expect(isEdited(pairingRows(auto), auto)).toBe(false);
  });

  it('an excluded sheet is not compared; the compared sheets keep table order', () => {
    const rows = setExcluded(pairingRows(auto), 1, true);
    expect(comparedPairs(rows)).toEqual([
      { a: 0, b: 0 },
      { a: 3, b: 2 },
      { a: 5, b: 3 },
      { a: 4, b: 4 },
    ]);
    expect(isEdited(rows, auto)).toBe(true);
  });

  it('candidates are the other side’s pages by similarity, keeping the current partner', () => {
    const r = pairPages(side([sheet(1), sheet(2), sheet(3)]), side([sheet(3), sheet(1)]));
    expect(candidates(r, 'a', 0, 1)).toEqual([1]);
    expect(candidates(r, 'a', 0, 1, 0)).toEqual([1, 0]);
    expect(candidates(r, 'b', 0, 2)[0]).toBe(2);
    expect(scoreOf(r, 2, 0)).toBeCloseTo(1, 4);
    expect(scoreOf(r, null, 0)).toBeNull();
  });
});

// ------------------------------------------------ real PDFium signatures ---

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

async function signatures(id: string, side: 'old' | 'new'): Promise<PairingSignature[]> {
  const docId = `${id}${side}`;
  const bytes = corpusBytes(corpusPair('overlay', id), side);
  const doc = await native
    .openDocumentBuffer({ id: docId, content: bytes.slice().buffer }, { normalizeRotation: true })
    .toPromise();
  const out: PairingSignature[] = [];
  for (let i = 0; i < doc.pageCount; i++) {
    const ref = acquirePage(native, docId, i);
    try {
      const ptr = docPtrOf(native, docId);
      const s = signatureOf(mod, ptr, i, ref.pagePtr);
      out.push({ ink: s.ink, landscape: s.frame.width >= s.frame.height, words: s.words });
    } finally {
      ref.release();
    }
  }
  return out;
}

describe('corpus pairs on real signatures (S28)', () => {
  const inOrder = (n: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [i, i] as [number, number]);

  it.each([
    ['02', { pairs: inOrder(2), removed: [], added: [] }],
    [
      '05',
      {
        pairs: [
          [0, 0],
          [1, 2],
          [2, 3],
        ],
        removed: [],
        added: [1],
      },
    ],
    ['10', { pairs: inOrder(4), removed: [], added: [] }],
    [
      '17',
      {
        pairs: [
          [0, 0],
          [1, 1],
          [3, 2],
          [5, 3],
          [4, 4],
        ],
        removed: [2],
        added: [],
      },
    ],
  ])('pair %s pairs as the manifest says', async (id, expected) => {
    const a = await signatures(id, 'old');
    const b = await signatures(id, 'new');
    const r = pairPages(side(a), side(b));
    expect({ pairs: r.pairs, removed: r.removed, added: r.added }).toEqual(expected);
    // Every true pair clears the threshold with room to spare.
    for (const [i, j] of expected.pairs as [number, number][])
      expect(scoreOf(r, i, j)).toBeGreaterThan(0.45);
  });

  it('pair 17 as a set of one-sheet files picked in another order pairs the same sheets', async () => {
    const a = await signatures('17', 'old');
    const b = await signatures('17', 'new');
    const namesA = ['S-101', 'S-102', 'S-103', 'S-104', 'S-105', 'S-106'].map(
      (n) => `${n} RevA.pdf`,
    );
    // B in the order the files happened to be picked: S-106, S-101, S-105, S-102, S-104.
    const pickB = [3, 0, 4, 1, 2];
    const namesB = ['S-101', 'S-102', 'S-104', 'S-106', 'S-105'].map((n) => `${n}_RevB.pdf`);
    const r = pairPages(
      side(a, { files: [0, 1, 2, 3, 4, 5], names: namesA }),
      side(
        pickB.map((k) => b[k]).filter((x): x is PairingSignature => x !== undefined),
        { files: [0, 1, 2, 3, 4], names: pickB.map((k) => namesB[k] ?? '') },
      ),
    );
    // Back to sheet names: every sheet with its namesake, S-103 removed.
    const named = r.pairs.map(([i, j]) => [
      sheetNameKey(namesA[i] ?? ''),
      sheetNameKey(namesB[pickB[j] ?? 0] ?? ''),
    ]);
    for (const [x, y] of named) expect(x).toBe(y);
    expect(named).toHaveLength(5);
    expect(r.removed.map((i) => namesA[i])).toEqual(['S-103 RevA.pdf']);
    expect(r.added).toEqual([]);
  });
});

describe('every other overlay pair of the corpus', () => {
  // Pairs with the same sheets on both sides pair in order (S28: 19 of 19).
  const others = [
    '01',
    '03',
    '04',
    '06',
    '07',
    '08',
    '09',
    '11',
    '13',
    '14',
    '15',
    '16',
    '18',
    '19',
  ];
  it.each(others)('pair %s pairs in order', async (id) => {
    const a = await signatures(id, 'old');
    const b = await signatures(id, 'new');
    const r = pairPages(side(a), side(b));
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual([]);
    expect(r.pairs).toEqual(a.map((_, i) => [i, i]));
  });
});
