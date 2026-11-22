// M12-17 (D-63, D-66): the text comparison on corpus pairs 01, 03, 04, 06, 09
// and 11 through the whole pipeline — the Work worker's positioned text on
// real PDFium, the Compare worker's handlers (layout kept instead of the
// characters, matching) and the session's early results on the first pages.
// Every manifest difference is found and every reported change is explained
// (spike S30's accounting); figures and table rows come with M12-18.
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
import { compareSpawn, fakeWork } from './support/inProcess';
import { EXPECTED, account } from './support/textExpected';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
const ports: MessagePort[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

const PAIRS = ['01', '03', '04', '06', '09', '11'];

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  for (const pair of PAIRS)
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
});

interface Run {
  results: { result: TextComparison; state: TextState }[];
  log: string[];
  bytes: number;
}

/** A text comparison of a corpus pair through the session, every result kept. */
async function comparePair(pair: string): Promise<Run> {
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
      const { results, log } = await comparePair(pair);
      const last = results[results.length - 1];
      expect(last?.state.complete).toBe(true);
      const acc = account(EXPECTED[pair] ?? [], last?.result.changes ?? []);
      expect(acc.missed).toEqual([]);
      expect(acc.unexplained).toEqual([]);
      // A text comparison reads text only: no signatures, geometry or rasters.
      expect(new Set(log)).toEqual(new Set(['compareText']));
    },
    60_000,
  );

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
});

type TextChange = TextComparison['changes'][number];
