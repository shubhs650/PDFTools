// M12-14 (D-61): the corpus acceptance suite for drawings starts here. The
// differences on the overlay corpus through the whole pipeline: Work worker
// material on real PDFium, the Compare worker's handlers (alignment, banded
// detection, the text layer, entries) and the session. Every expectation is
// the manifest's: identical pairs report nothing, the control sheets are
// unchanged, the changes named are found, text-aware where there is text, and
// a title-block-only change stays inside the title block.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import { CompareClient } from '../../src/engine/compareClient';
import { CompareSession, oneFile, type SheetPair } from '../../src/features/compare/engine/session';
import type { DiffEntry, SheetDiff, Sensitivity } from '../../src/model/compare/detect/entries';
import { compareSpawn, fakeWork } from './support/inProcess';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
const ports: MessagePort[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
});

const opened = new Set<string>();
async function open(pair: string): Promise<void> {
  if (opened.has(pair)) return;
  opened.add(pair);
  for (const side of ['old', 'new'] as const)
    await native
      .openDocumentBuffer(
        {
          id: `d${pair}${side}`,
          content: corpusBytes(corpusPair('overlay', pair), side).slice().buffer,
        },
        { normalizeRotation: true },
      )
      .toPromise();
}

/** The differences of a corpus pair, sheet by sheet, at a sensitivity. */
async function differences(
  pair: string,
  o: { pairs?: SheetPair[]; sensitivity?: Sensitivity } = {},
): Promise<SheetDiff[]> {
  await open(pair);
  const p = corpusPair('overlay', pair);
  const pages = (n: number): number[] => [...Array(n).keys()];
  const s = new CompareSession(
    oneFile(`d${pair}old`, pages(p.oldPages)),
    oneFile(`d${pair}new`, pages(p.newPages)),
    {
      work: fakeWork(mod, native, []),
      compare: new CompareClient({ spawn: compareSpawn({ spawned: 0, terminated: 0 }, ports) }),
      ...(o.pairs ? { pairs: o.pairs } : {}),
    },
  );
  try {
    await s.start();
    await s.whenDone();
    expect(s.progress().failed).toBe(0);
    const sheets = (o.pairs ?? pages(Math.min(p.oldPages, p.newPages))).map((_, sheet) => sheet);
    for (const sheet of sheets) expect(s.isDetected(sheet)).toBe(true);
    const res = await s.differences(
      sheets.map((sheet) => ({ sheet, zones: [] })),
      { sensitivity: o.sensitivity ?? 'normal', minSize: 0 },
    );
    return res.sort((x, y) => x.sheet - y.sheet).map((r) => r.diff);
  } finally {
    await s.close();
  }
}

const words = (e: DiffEntry): string => `${e.old} → ${e.new}`;
const has = (d: SheetDiff, re: RegExp): boolean => d.entries.some((e) => re.test(words(e)));

describe('differences on the overlay corpus (M12-14)', () => {
  it('pair 16: an identical pair reports nothing, at every sensitivity', async () => {
    for (const sensitivity of ['normal', 'high'] as const) {
      const d = await differences('16', { sensitivity });
      expect(d).toHaveLength(2);
      for (const sheet of d) {
        expect(sheet.entries).toEqual([]);
        expect(sheet.percent).toBe(0);
      }
    }
  }, 120_000);

  it('pair 15: the same drawing plotted at A1 and at A3 reports nothing', async () => {
    const [d] = await differences('15');
    expect(d?.entries).toEqual([]);
  }, 120_000);

  it('pair 01: every manifest change, text-aware', async () => {
    const [d] = await differences('01');
    if (!d) throw new Error('no sheet');
    expect(d.scan).toBe(false);
    expect(d.entries.length).toBeGreaterThan(20);
    expect(d.percent).toBeGreaterThan(0);
    // Bolt circle Ø120 → Ø128, bore tolerance H7 → H6, the keyway added.
    expect(has(d, /Ø120\.0 → Ø128\.0/)).toBe(true);
    expect(has(d, /H7 .*→ H6/)).toBe(true);
    expect(d.entries.some((e) => e.kind === 'added' && e.new.includes('KEYWAY'))).toBe(true);
    // Six holes become eight: geometry, not text.
    expect(d.entries.filter((e) => e.type === 'geometry').length).toBeGreaterThan(5);
    for (const e of d.entries) {
      expect(e.box[2]).toBeGreaterThan(e.box[0]);
      expect(e.box[3]).toBeGreaterThan(e.box[1]);
    }
  }, 120_000);

  it('pair 10: the identical control sheet is unchanged; the others changed', async () => {
    const d = await differences('10');
    expect(d).toHaveLength(4);
    expect(d[1]?.entries).toEqual([]);
    expect(d[1]?.percent).toBe(0);
    for (const i of [0, 2, 3]) expect(d[i]?.entries.length).toBeGreaterThan(0);
    // P4: EF-03 added.
    expect(d[3] && has(d[3], /EF-03/)).toBe(true);
  }, 180_000);

  it('pair 18: a title-block-only change stays in the title block', async () => {
    const [d] = await differences('18');
    if (!d) throw new Error('no sheet');
    expect(d.entries.length).toBeGreaterThan(0);
    // A1 landscape (2384 × 1684 pt); the title block is zones H10 – G12.
    for (const e of d.entries) {
      expect(e.box[0]).toBeGreaterThan(2384 * 0.75);
      expect(e.box[1]).toBeGreaterThan(1684 * 0.8);
    }
    expect(has(d, /2026-09-20 → 2026-10-15/)).toBe(true);
    expect(has(d, /APPROVAL → CONSTRUCTION/)).toBe(true);
  }, 120_000);

  it('pair 17: in the manifest pairing, only S-104 changed', async () => {
    const pairs: SheetPair[] = [
      { a: 0, b: 0 },
      { a: 1, b: 1 },
      { a: 3, b: 2 },
      { a: 4, b: 4 },
      { a: 5, b: 3 },
    ];
    const d = await differences('17', { pairs });
    for (const i of [0, 1, 3, 4]) expect(d[i]?.entries).toEqual([]);
    const s104 = d[2];
    if (!s104) throw new Error('no S-104');
    expect(has(s104, /W310x39 → W410x60/)).toBe(true);
  }, 180_000);

  it('pair 06: a scan is compared by its ink alone', async () => {
    const [d] = await differences('06');
    if (!d) throw new Error('no sheet');
    expect(d.scan).toBe(true);
    expect(d.entries.length).toBeGreaterThan(0);
    for (const e of d.entries) expect(e.type).toBe('geometry');
  }, 120_000);
});
