// M12-07 (D-66): the Compare worker's store and sheet facts, its client
// (started with the first comparison, terminated with the last), and a whole
// session over real PDFium material on corpus pairs: the identical pair is
// identical sheet by sheet, a changed pair is not, Cancel stops it and Close
// gives the memory back.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import type { SheetFacts } from '../../src/engine/compareApi';
import { CompareClient } from '../../src/engine/compareClient';
import { AbortError } from '../../src/engine/errors';
import { CompareSession, oneFile, pairInOrder } from '../../src/features/compare/engine/session';
import type { PageSignature, PageText, RasterBand } from '../../src/model/compare/material';
import { SheetAccumulator } from '../../src/workers/compare/sheetFacts';
import { CompareStore } from '../../src/workers/compare/store';
import { compareSpawn, fakeWork, type FakeWorkers } from './support/inProcess';

const band = (width: number, height: number, top: number, rows: number[][]): RasterBand => ({
  width,
  height,
  top,
  rows: rows.length,
  data: Uint8Array.from(rows.flat()),
});

describe('SheetAccumulator', () => {
  it('counts ink per side and in common, with each side’s box in points', () => {
    const acc = new SheetAccumulator(4, 2, 72);
    acc.add(
      band(4, 2, 0, [
        [0, 200, 200, 0],
        [0, 0, 0, 0],
      ]),
      band(4, 2, 0, [
        [0, 200, 0, 0],
        [0, 0, 0, 255],
      ]),
    );
    const f = acc.facts();
    expect(f).toMatchObject({ inkA: 2, inkB: 2, both: 1, identical: false, rows: 2 });
    expect(f.boxA).toEqual([1, 0, 3, 1]);
    expect(f.boxB).toEqual([1, 0, 4, 2]);
  });

  it('is identical only when every row is in and every pixel equal; a resent band counts once', () => {
    const acc = new SheetAccumulator(2, 2, 144);
    const top = band(2, 2, 0, [[10, 250]]);
    acc.add(top, top);
    expect(acc.facts().identical).toBe(false); // one row of two
    acc.add(top, top);
    expect(acc.facts().rows).toBe(1);
    const bottom = band(2, 2, 1, [[0, 0]]);
    acc.add(bottom, bottom);
    const f = acc.facts();
    expect(f.identical).toBe(true);
    expect(f.inkA).toBe(1);
    expect(f.boxA).toEqual([0.5, 0, 1, 0.5]); // 144 dpi: 2 px per point
  });

  it('rejects bands that do not belong to the sheet', () => {
    const acc = new SheetAccumulator(2, 2, 72);
    const ok = band(2, 2, 0, [[0, 0]]);
    expect(() => {
      acc.add(band(3, 2, 0, [[0, 0, 0]]), ok);
    }).toThrow(/width/);
    expect(() => {
      acc.add(ok, band(2, 2, 1, [[0, 0]]));
    }).toThrow(/differ/);
    expect(() => {
      acc.add(band(2, 2, 2, [[0, 0]]), band(2, 2, 2, [[0, 0]]));
    }).toThrow(/outside/);
  });
});

describe('CompareStore', () => {
  const sig = (n: number): PageSignature => ({
    frame: { width: 10, height: 10, rotation: 0, toDisplay: [1, 0, 0, -1, 0, 10] },
    ink: new Float32Array(n),
    words: ['ab'],
  });
  const text = (n: number): PageText => ({
    frame: { width: 10, height: 10, rotation: 0, toDisplay: [1, 0, 0, -1, 0, 10] },
    codes: new Uint32Array(n),
    boxes: new Float32Array(n * 4),
    origins: new Float32Array(n * 2),
    sizes: new Float32Array(n),
    angles: new Float32Array(n),
    flags: new Uint8Array(n),
  });

  it('accounts every byte per comparison and frees them on release', () => {
    const s = new CompareStore();
    s.open('x');
    s.open('y');
    s.putSignature('x', 'a', 0, sig(1024));
    expect(s.memory().bytes).toBe(4096 + 4);
    // Replacing a page's material does not count it twice.
    s.putSignature('x', 'a', 0, sig(1024));
    expect(s.memory().bytes).toBe(4096 + 4);
    s.putText('x', 'b', 3, text(10));
    expect(s.summary('x')).toMatchObject({ signatures: { a: 1, b: 0 }, texts: { a: 0, b: 1 } });
    s.putText('y', 'a', 0, text(5));
    expect(s.memory().comparisons).toBe(2);
    const xBytes = s.summary('x').bytes;
    expect(s.release('x')).toBe(xBytes);
    expect(s.memory()).toEqual({ bytes: s.summary('y').bytes, comparisons: 1 });
    expect(s.release('x')).toBe(0);
    expect(() => s.summary('x')).toThrow(/not open/);
  });

  it('a sheet whose frame changes starts again', () => {
    const s = new CompareStore();
    s.open('x');
    s.sheetBand('x', 0, 72, band(2, 1, 0, [[255, 0]]), band(2, 1, 0, [[255, 0]]));
    expect(s.sheetFacts('x', 0).identical).toBe(true);
    s.sheetBand('x', 0, 72, band(3, 1, 0, [[0, 0, 255]]), band(3, 1, 0, [[0, 0, 0]]));
    expect(s.sheetFacts('x', 0)).toMatchObject({ width: 3, inkA: 1, inkB: 0, identical: false });
  });
});

// A Worker stand-in: the real handlers on a MessageChannel.
const ports: MessagePort[] = [];
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

const spawnOf = (w: FakeWorkers) => compareSpawn(w, ports);

describe('CompareClient', () => {
  it('starts the worker with the first comparison and terminates it with the last', async () => {
    const w: FakeWorkers = { spawned: 0, terminated: 0 };
    const c = new CompareClient({ spawn: spawnOf(w) });
    expect(c.running).toBe(false);
    await c.openComparison('one');
    await c.openComparison('two');
    expect(w.spawned).toBe(1);
    await c.call('putSignature', {
      cmpId: 'one',
      side: 'a',
      page: 0,
      signature: {
        frame: { width: 1, height: 1, rotation: 0, toDisplay: [1, 0, 0, 1, 0, 0] },
        ink: new Float32Array(8),
        words: [],
      },
    }).promise;
    expect(await c.release('one')).toBe(32);
    expect(c.running).toBe(true);
    await c.release('two');
    expect(c.running).toBe(false);
    expect(w.terminated).toBe(1);
    // The next comparison starts a fresh worker.
    await c.openComparison('three');
    expect(w.spawned).toBe(2);
    expect((await c.call('memory', null).promise).comparisons).toBe(1);
    await c.release('three');
  });

  it('a cancelled call rejects with AbortError', async () => {
    const c = new CompareClient({ spawn: spawnOf({ spawned: 0, terminated: 0 }) });
    await c.openComparison('x');
    const ac = new AbortController();
    const job = c.call('summary', { cmpId: 'x' }, { signal: ac.signal });
    ac.abort();
    await expect(job.promise).rejects.toBeInstanceOf(AbortError);
    await c.release('x');
  });
});

// The Work worker's compare jobs, run in-process on real PDFium.
const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  for (const [id, pair, side] of [
    ['p16a', '16', 'old'],
    ['p16b', '16', 'new'],
    ['p01a', '01', 'old'],
    ['p01b', '01', 'new'],
    ['p17a', '17', 'old'],
    ['p17b', '17', 'new'],
  ] as const) {
    const bytes = corpusBytes(corpusPair('overlay', pair), side);
    await native
      .openDocumentBuffer({ id, content: bytes.slice().buffer }, { normalizeRotation: true })
      .toPromise();
  }
});

const workOf = (log: string[]) => fakeWork(mod, native, log);

describe('CompareSession (real PDFium material)', () => {
  it('pairs in order by default', () => {
    expect(pairInOrder([0, 1, 2], [5, 6])).toEqual([
      { a: 0, b: 5 },
      { a: 1, b: 6 },
    ]);
  });

  it('the identical pair (16) is identical sheet by sheet; the store is released on close', async () => {
    const w: FakeWorkers = { spawned: 0, terminated: 0 };
    const compare = new CompareClient({ spawn: spawnOf(w) });
    const work = workOf([]);
    const sheets = new Map<number, SheetFacts>();
    const s = new CompareSession(oneFile('p16a', [0, 1]), oneFile('p16b', [0, 1]), {
      work,
      compare,
      dpi: 36,
      bandRows: 128,
      onSheet: (i, f) => sheets.set(i, f),
    });
    const watched: string[] = [];
    const stop = s.watchAlignment((i, al) => watched.push(`${String(i)}:${al.status}`));
    await s.start();
    expect(work.held).toBe(1);
    await s.whenDone();
    expect(watched.sort()).toEqual(['0:as-is', '1:as-is']);
    const late: number[] = [];
    s.watchAlignment((i) => late.push(i))();
    expect(late.sort()).toEqual([0, 1]);
    stop();
    // Per page a signature and text; per sheet an alignment and the analysis.
    expect(s.progress()).toMatchObject({ done: 12, failed: 0, total: 12 });
    for (const sheet of [0, 1]) {
      expect(s.alignment(sheet)).toMatchObject({ status: 'as-is', method: 'vector', score: 1 });
      const f = sheets.get(sheet);
      expect(f?.identical).toBe(true);
      expect(f?.rows).toBe(f?.height);
      expect(f?.inkA).toBeGreaterThan(1000);
    }
    expect(work.held).toBe(0);
    const summary = await compare.call('summary', { cmpId: s.id }).promise;
    expect(summary).toMatchObject({ signatures: { a: 2, b: 2 }, texts: { a: 2, b: 2 }, sheets: 2 });
    expect(summary.bytes).toBeGreaterThan(4096);
    await s.close();
    expect(compare.running).toBe(false);
    expect(w.terminated).toBe(1);
  });

  it('a changed pair (01) is not identical, and the viewed sheet comes first', async () => {
    const compare = new CompareClient({ spawn: spawnOf({ spawned: 0, terminated: 0 }) });
    const log: string[] = [];
    const work = workOf(log);
    const order: number[] = [];
    const s = new CompareSession(oneFile('p01a', [0]), oneFile('p01b', [0]), {
      work,
      compare,
      dpi: 36,
      concurrency: 1,
      onSheet: (i, f) => {
        order.push(i);
        expect(f.identical).toBe(false);
        expect(f.inkA).not.toBe(f.both);
      },
    });
    s.focus(0);
    await s.start();
    await s.whenDone();
    expect(order).toEqual([0]);
    // The viewed sheet's reads come before anything else, then its rasters.
    expect(log.slice(0, 4)).toEqual([
      'compareSignature',
      'compareText',
      'compareSignature',
      'compareText',
    ]);
    // Then its alignment (line geometry; the sheet lines up as it is), then its rasters.
    expect(log.slice(4, 6)).toEqual(['compareGeometry', 'compareGeometry']);
    expect(log.slice(6).every((m) => m === 'compareRaster')).toBe(true);
    expect(s.alignment(0)?.status).toBe('as-is');
    await s.close();
  });

  it('cancel stops the work; close releases even a cancelled comparison', async () => {
    const compare = new CompareClient({ spawn: spawnOf({ spawned: 0, terminated: 0 }) });
    const log: string[] = [];
    const work = workOf(log);
    const sheets: number[] = [];
    const s = new CompareSession(oneFile('p01a', [0]), oneFile('p01b', [0]), {
      work,
      compare,
      dpi: 72,
      bandRows: 64,
      concurrency: 1,
      onSheet: (i) => sheets.push(i),
    });
    await s.start();
    // Let the reads and a band or two through, then cancel mid-sheet.
    while (!log.includes('compareRaster')) await new Promise((r) => setTimeout(r, 1));
    s.cancel();
    await s.whenDone();
    const ran = log.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(log.length).toBe(ran);
    expect(sheets).toEqual([]);
    expect(work.held).toBe(0);
    await s.close();
    expect(compare.running).toBe(false);
  });
});

describe('CompareSession pairing (M12-09, D-60)', () => {
  it('pairs pair 17 in the Compare worker: S-103 removed, S-105 and S-106 swapped', async () => {
    const compare = new CompareClient({ spawn: spawnOf({ spawned: 0, terminated: 0 }) });
    const work = workOf([]);
    const seen: string[] = [];
    const s = new CompareSession(
      oneFile('p17a', [0, 1, 2, 3, 4, 5]),
      oneFile('p17b', [0, 1, 2, 3, 4]),
      { work, compare, onPairing: (p) => seen.push(p.stage) },
    );
    const r = await s.pair();
    expect(r.pairs).toEqual([
      [0, 0],
      [1, 1],
      [3, 2],
      [5, 3],
      [4, 4],
    ]);
    expect(r.removed).toEqual([2]);
    expect(r.sim.length).toBe(30);
    expect(seen.filter((x) => x === 'read')).toHaveLength(11);
    expect(seen.at(-1)).toBe('match');
    // The Work worker is let go between pairing and comparing.
    expect(work.held).toBe(0);
    await s.close();
    expect(compare.running).toBe(false);
  });

  it('pairs a set of files across files by name, then compares those sheets reusing the signatures', async () => {
    const compare = new CompareClient({ spawn: spawnOf({ spawned: 0, terminated: 0 }) });
    const log: string[] = [];
    const work = workOf(log);
    const sheets = new Map<number, SheetFacts>();
    const s = new CompareSession(
      {
        files: [
          { docId: 'p01a', pages: [0], name: 'M-101 Flange RevA.pdf' },
          { docId: 'p16a', pages: [0, 1], name: 'C-201 Control RevA.pdf' },
        ],
      },
      {
        files: [
          { docId: 'p16b', pages: [0, 1], name: 'C-201 Control RevB.pdf' },
          { docId: 'p01b', pages: [0], name: 'M-101 Flange RevB.pdf' },
        ],
      },
      { work, compare, dpi: 36, bandRows: 128, onSheet: (i, f) => sheets.set(i, f) },
    );
    expect(s.sidePages('a').map((p) => [p.docId, p.page, p.file])).toEqual([
      ['p01a', 0, 0],
      ['p16a', 0, 1],
      ['p16a', 1, 1],
    ]);
    const r = await s.pair();
    expect(r.pairs).toEqual([
      [1, 0],
      [2, 1],
      [0, 2],
    ]);
    const sigReads = log.filter((m) => m === 'compareSignature').length;
    expect(sigReads).toBe(6);
    await s.start(r.pairs.map(([a, b]) => ({ a, b })));
    await s.whenDone();
    // No signature read twice; the sheets are the pairs given.
    expect(log.filter((m) => m === 'compareSignature').length).toBe(sigReads);
    expect(s.pairs).toEqual([
      { a: 1, b: 0 },
      { a: 2, b: 1 },
      { a: 0, b: 2 },
    ]);
    expect(sheets.get(0)?.identical).toBe(true);
    expect(sheets.get(1)?.identical).toBe(true);
    expect(sheets.get(2)?.identical).toBe(false);
    expect(s.progress().failed).toBe(0);
    await s.close();
  });

  it('closing while pairing rejects the pairing as cancelled', async () => {
    const compare = new CompareClient({ spawn: spawnOf({ spawned: 0, terminated: 0 }) });
    const work = workOf([]);
    const s = new CompareSession(oneFile('p17a', [0, 1, 2, 3, 4, 5]), oneFile('p17b', [0, 1]), {
      work,
      compare,
      concurrency: 1,
    });
    const p = s.pair().then(
      () => null,
      (e: unknown) => e,
    );
    await s.close();
    expect(await p).toBeInstanceOf(AbortError);
    expect(work.held).toBe(0);
  });
});
