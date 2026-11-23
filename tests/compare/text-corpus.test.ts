// M12-17, M12-18 (D-63, D-66): the corpus acceptance suite for documents.
// The text comparison on every text pair of the corpus (01 – 17) through the
// whole pipeline — the Work worker's positioned text, figures and tables on
// real PDFium, OCR at compare time (Tesseract in this process), the Compare
// worker's handlers (layout kept instead of the characters, matching) and the
// session's early results on the first pages. Every manifest difference is
// found and every reported change is explained (spike S30's accounting).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import { CompareClient } from '../../src/engine/compareClient';
import {
  CompareSession,
  oneFile,
  textCheckpoints,
  type TextState,
} from '../../src/features/compare/engine/session';
import type { TextComparison } from '../../src/model/compare/text/match';
import type { TextOptions } from '../../src/engine/compareApi';
import { compareSpawn, fakeWork } from './support/inProcess';
import { ocrInProcess } from './support/ocrInProcess';
import { EXPECTED, account } from './support/textExpected';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
const ports: MessagePort[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

const PAIRS = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
];
const opened = new Set<string>();

async function open(pair: string): Promise<void> {
  if (opened.has(pair)) return;
  opened.add(pair);
  for (const side of ['old', 'new'] as const)
    await native
      .openDocumentBuffer(
        {
          id: `t${pair}${side}`,
          content: corpusBytes(corpusPair('text', pair), side).slice().buffer,
        },
        { normalizeRotation: true },
      )
      .toPromise();
}

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

interface Run {
  results: { result: TextComparison; state: TextState }[];
  log: string[];
  bytes: number;
}

interface Options {
  /** OCR at compare time (pair 08's scanned page). */
  ocr?: boolean;
  text?: Omit<TextOptions, 'moves'>;
}

/** A text comparison of a corpus pair through the session, every result kept. */
async function comparePair(pair: string, o: Options = {}): Promise<Run> {
  await open(pair);
  const p = corpusPair('text', pair);
  const pages = (n: number): number[] => [...Array(n).keys()];
  const log: string[] = [];
  const results: Run['results'] = [];
  const compare = new CompareClient({ spawn: compareSpawn({ spawned: 0, terminated: 0 }, ports) });
  const s = new CompareSession(
    oneFile(`t${pair}old`, pages(p.oldPages)),
    oneFile(`t${pair}new`, pages(p.newPages)),
    {
      work: fakeWork(mod, native, log),
      compare,
      text: true,
      align: false,
      onText: (result, state) => results.push({ result, state }),
      ...(o.ocr ? { ocr: { languages: ['eng'], client: ocrInProcess() } } : {}),
      ...(o.text ? { textOptions: o.text } : {}),
    },
  );
  await s.start();
  await s.whenDone();
  expect(s.progress().failed).toBe(0);
  const { bytes } = await compare.call('summary', { cmpId: s.id }).promise;
  await s.close();
  return { results, log, bytes };
}

describe('text comparison on the corpus', () => {
  it.each(PAIRS)(
    'pair %s: every manifest difference found, no false report',
    async (pair) => {
      const ocr = pair === '08';
      const { results, log } = await comparePair(pair, { ocr });
      const last = results[results.length - 1];
      expect(last?.state.complete).toBe(true);
      const acc = account(EXPECTED[pair] ?? [], last?.result.changes ?? [], ocr);
      expect(acc.missed).toEqual([]);
      expect(acc.unexplained).toEqual([]);
      // A text comparison reads text only (and scans for OCR): no signatures, geometry or rasters.
      expect(new Set(log)).toEqual(
        new Set(ocr ? ['compareText', 'compareOcrRaster'] : ['compareText']),
      );
    },
    120_000,
  );

  it('17 (500 pages): every manifest difference, the renumbering once', async () => {
    const { results } = await comparePair('17');
    const last = results[results.length - 1];
    expect(last?.state.complete).toBe(true);
    const changes = last?.result.changes ?? [];
    const acc = account(EXPECTED['17'] ?? [], changes);
    expect(acc.missed).toEqual([]);
    expect(acc.unexplained).toEqual([]);
    expect(changes.filter((c) => c.kind === 'renumbered')).toMatchObject([
      { a: { text: '96.2–96.40' }, b: { text: '96.3–96.41' } },
    ]);
  }, 300_000);

  it('08: without OCR the scanned page is limited support and offered for OCR; with it, "from OCR"', async () => {
    const plain = (await comparePair('08')).results.at(-1)?.result;
    expect(plain?.limited).toEqual({ a: [2], b: [2] });
    expect(plain?.scanned).toEqual({ a: [2], b: [2] });
    expect(account(EXPECTED['08'] ?? [], plain?.changes ?? [], false).missed).toEqual([]);
    const read = (await comparePair('08', { ocr: true })).results.at(-1)?.result;
    expect(read?.limited).toEqual({ a: [], b: [] });
    const fromOcr = read?.changes.filter((c) => c.ocr) ?? [];
    expect(fromOcr.map((c) => c.a?.text)).toEqual([
      'CAL-2026-7741-A',
      expect.stringMatching(/^2026-12-31/),
      '16.81%',
    ]);
    expect(fromOcr.every((c) => c.ocr === 'ocr' && (c.b?.rects.length ?? 0) > 0)).toBe(true);
    // Live text is not labelled.
    expect(read?.changes.find((c) => c.a?.text === 'HT-99241-A')?.ocr).toBeUndefined();
  }, 120_000);

  it('12: an OCR text layer is "from OCR"; typical confusions are "possible OCR error", not hidden', async () => {
    const r = (await comparePair('12')).results.at(-1)?.result;
    const errors = r?.changes.filter((c) => c.ocr === 'ocr-error') ?? [];
    expect(errors.map((c) => [c.a?.text, c.b?.text])).toEqual([
      ['5O0 mm', '500 mm'],
      ['U1trasonic', 'Ultrasonic'],
    ]);
    expect(r?.changes.every((c) => c.ocr)).toBe(true);
  }, 60_000);

  it('05: the renumbering is one entry; the switch shows every number', async () => {
    const on = (await comparePair('05')).results.at(-1)?.result;
    expect(on?.changes.filter((c) => c.kind === 'renumbered')).toMatchObject([
      { a: { text: '3.4–3.9' }, b: { text: '3.6–3.11' }, renumber: { shifted: 12, follow: 6 } },
    ]);
    expect(on?.changes.filter((c) => c.kind === 'reference')).toEqual([]);
    const off = (await comparePair('05', { text: { renumbering: false } })).results.at(-1)?.result;
    expect(off?.changes.some((c) => c.kind === 'renumbered')).toBe(false);
    expect(
      off?.changes.filter((c) => c.kind === 'replaced' && /^3\.\d+$/.test(c.a?.text ?? '')).length,
    ).toBeGreaterThan(5);
  }, 60_000);

  it('14: footnotes renumber like clauses; the new footnote and its mark are reported', async () => {
    const r = (await comparePair('14')).results.at(-1)?.result;
    expect(r?.changes.filter((c) => c.kind === 'renumbered')).toMatchObject([
      { a: { text: '2–3' }, b: { text: '3–4' } },
    ]);
  }, 60_000);

  it('07: rows matched as rows; a deleted and an inserted row are one change each; the repeated header is not reported', async () => {
    const r = (await comparePair('07')).results.at(-1)?.result;
    const rows = r?.changes.filter((c) => c.table && c.table.column === undefined) ?? [];
    expect(rows.map((c) => [c.kind, c.table?.row.slice(0, 4)])).toEqual([
      ['deleted', '038 '],
      ['inserted', '075A'],
    ]);
    const cells = r?.changes.filter((c) => c.table?.column !== undefined) ?? [];
    expect(cells.every((c) => !c.table?.head)).toBe(true);
    expect(new Set(cells.map((c) => c.table?.col))).toEqual(new Set(['Rate (USD)', 'Total (USD)']));
    // A cell is marked by its box, on the page where it is.
    const rate = cells.find((c) => c.a?.text === '25.50');
    expect(rate).toMatchObject({ b: { text: '38.00' }, pct: 49.02 });
    expect(rate?.b?.rects).toHaveLength(1);
  }, 60_000);

  it('02, 03, 09: a changed picture is one changed figure with how different it looks', async () => {
    for (const pair of ['02', '03', '09']) {
      const r = (await comparePair(pair)).results.at(-1)?.result;
      const figs = r?.changes.filter((c) => c.figure) ?? [];
      expect(figs).toHaveLength(1);
      expect(figs[0]?.kind).toBe('figure');
      expect(figs[0]?.figure?.diff).toBeGreaterThan(0);
      expect(figs[0]?.a?.rects).toHaveLength(1);
      expect(figs[0]?.b?.rects).toHaveLength(1);
    }
  }, 60_000);

  it('13: headers and footers once; bands drawn by hand do the same; the switch makes them text', async () => {
    const hf = (r?: TextComparison) =>
      r?.changes
        .filter((c) => c.kind === 'header' || c.kind === 'footer')
        .map((c) => [c.kind, c.a?.text, c.b?.text]);
    const auto = (await comparePair('13')).results.at(-1)?.result;
    expect(hf(auto)).toEqual([
      ['header', 'C', 'D'],
      ['footer', '6', '7'],
    ]);
    const band = { top: 70, bottom: 60 };
    const drawn = (await comparePair('13', { text: { bands: { a: band, b: band } } })).results.at(
      -1,
    )?.result;
    expect(hf(drawn)).toEqual(hf(auto));
    const off = (await comparePair('13', { text: { headersFooters: false } })).results.at(
      -1,
    )?.result;
    expect(hf(off)).toEqual([]);
    expect(off?.changes.some((c) => c.a?.text === 'C' && c.b?.text === 'D')).toBe(true);
  }, 60_000);

  it('09: the swapped sections are one move carrying the bearing pressure edit', async () => {
    const { results, bytes } = await comparePair('09');
    // Words and lines kept, not the characters (about 37 bytes each).
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(200_000);
    const changes = results[results.length - 1]?.result.changes ?? [];
    const moves = changes.filter((c) => c.kind === 'moved');
    expect(moves).toHaveLength(1);
    expect(moves[0]?.a?.text).toMatch(/^Foundation Recommendations/);
    expect(moves[0]?.inner).toMatchObject([
      { kind: 'replaced', a: { text: '180 kPa' }, b: { text: '165 kPa' }, pct: -8.33 },
    ]);
    // Marked on both pages.
    expect(moves[0]?.a?.rects.length).toBeGreaterThan(3);
    expect(moves[0]?.b?.rects.length).toBeGreaterThan(3);
  }, 60_000);

  it('04: the two clauses inserted across the reflowed columns are one change; the header once', async () => {
    const { results } = await comparePair('04');
    const r = results[results.length - 1]?.result;
    const inserted = r?.changes.filter((c) => c.kind === 'inserted') ?? [];
    expect(inserted).toHaveLength(1);
    expect(
      r?.changes.filter((c) => c.kind === 'header').map((c) => [c.a?.text, c.b?.text]),
    ).toEqual([
      ['A', 'B'],
      ['2026-09-30', '2026-11-14'],
    ]);
  }, 60_000);

  it('11: Arabic, Hindi and Japanese changes are read in their order and marked where they are', async () => {
    const { results } = await comparePair('11');
    const changes = results[results.length - 1]?.result.changes ?? [];
    const ar = changes.find((c) => c.a?.text === '12' && c.b?.text === '24');
    expect(ar?.pct).toBe(100);
    for (const c of changes)
      for (const r of [...(c.a?.rects ?? []), ...(c.b?.rects ?? [])]) {
        expect(r.x1).toBeGreaterThan(r.x0);
        expect(r.y1).toBeGreaterThan(r.y0);
      }
  }, 60_000);

  it('results come early on the first pages, then complete; early changes on settled pages stay', async () => {
    const { results } = await comparePair('03');
    // Three pages a side: results on 1 and 2 pages, then all 3.
    expect(textCheckpoints(3)).toEqual([1, 2]);
    expect(results.map((r) => [r.state.pages.a, r.state.complete])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    const key = (c: TextChange): string =>
      [c.kind, c.a?.text ?? '', c.b?.text ?? '', String(c.b?.page ?? -1)].join('|');
    const final = new Set(results[2]?.result.changes.map(key));
    for (const r of results.slice(0, 2))
      for (const c of r.result.changes)
        if ((c.b?.page ?? c.a?.page ?? 0) < r.state.settled.b) expect(final.has(key(c))).toBe(true);
    expect(results[0]?.state.settled).toEqual({ a: 0, b: 0 });
  }, 60_000);

  it('an early result does not wait for the last pages to be read (M12-23, D-66)', async () => {
    // Pair 10: 17 against 18 pages. Before M12-23 every early match waited for
    // every page of both documents, so the first result came with the last.
    await open('10');
    const p = corpusPair('text', '10');
    const pages = (n: number): number[] => [...Array(n).keys()];
    const log: string[] = [];
    const s = new CompareSession(
      oneFile('t10old', pages(p.oldPages)),
      oneFile('t10new', pages(p.newPages)),
      {
        work: fakeWork(mod, native, log),
        compare: new CompareClient({ spawn: compareSpawn({ spawned: 0, terminated: 0 }, ports) }),
        text: true,
        align: false,
        onText: (_, state) => log.push(`result:${String(state.pages.b)}`),
      },
    );
    await s.start();
    await s.whenDone();
    await s.close();
    const firstResult = log.findIndex((e) => e.startsWith('result:'));
    const lastRead = log.lastIndexOf('compareText');
    expect(firstResult).toBeGreaterThan(-1);
    expect(firstResult).toBeLessThan(lastRead);
    expect(log.at(-1)).toBe('result:18');
  }, 60_000);
});

type TextChange = TextComparison['changes'][number];
