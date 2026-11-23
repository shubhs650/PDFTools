// M12-13 (D-60): a placement set by hand in the comparison's session — it
// is the alignment in use over the automatic one (also when it comes first),
// the Compare worker records it, the sheet is analysed again under it, and
// going back to automatic restores the automatic alignment. Real PDFium on
// corpus pair 04.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import { CompareClient } from '../../src/engine/compareClient';
import { CompareSession, oneFile } from '../../src/features/compare/engine/session';
import type { SheetAlignment } from '../../src/model/compare/align/aligner';
import type { Affine } from '../../src/model/compare/material';
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
  for (const side of ['old', 'new'] as const) {
    const bytes = corpusBytes(corpusPair('overlay', '04'), side);
    await native
      .openDocumentBuffer(
        { id: `04${side}`, content: bytes.slice().buffer },
        { normalizeRotation: true },
      )
      .toPromise();
  }
});

function session(heard: [number, SheetAlignment][], sheets: number[]) {
  const all = [0, 1];
  const compare = new CompareClient({ spawn: compareSpawn({ spawned: 0, terminated: 0 }, ports) });
  const s = new CompareSession(oneFile('04old', all), oneFile('04new', all), {
    work: fakeWork(mod, native, []),
    compare,
    dpi: 9,
    onAlign: (i, al) => heard.push([i, al]),
    onSheet: (i) => sheets.push(i),
  });
  return { s };
}

const SHIFT: Affine = [1, 0, 0, 1, 12, -4];

describe('a placement set by hand', () => {
  it('takes over from the automatic alignment, is recorded and analysed again, and can be undone', async () => {
    const heard: [number, SheetAlignment][] = [];
    const sheets: number[] = [];
    const { s } = session(heard, sheets);
    await s.start();
    await s.whenDone();
    const auto = s.alignment(0);
    expect(auto?.status).toBe('auto');
    expect(sheets.filter((i) => i === 0)).toHaveLength(1);

    s.setManual(0, SHIFT);
    expect(s.alignment(0)).toMatchObject({ status: 'manual', place: SHIFT, method: 'vector' });
    expect(s.autoAlignment(0)).toEqual(auto);
    expect(heard.at(-1)).toEqual([0, s.alignment(0)]);
    await s.whenDone();
    // Analysed once more, under the new placement.
    expect(sheets.filter((i) => i === 0)).toHaveLength(2);
    expect(s.progress().failed).toBe(0);

    s.setManual(0, null);
    expect(s.alignment(0)).toEqual(auto);
    expect(heard.at(-1)).toEqual([0, auto]);
    await s.whenDone();
    expect(sheets.filter((i) => i === 0)).toHaveLength(3);
    await s.close();
  }, 60_000);

  it('set before the automatic alignment arrives, stays in use', async () => {
    const heard: [number, SheetAlignment][] = [];
    const { s } = session(heard, []);
    s.setManual(1, SHIFT);
    await s.start();
    await s.whenDone();
    expect(s.alignment(1)).toMatchObject({ status: 'manual', place: SHIFT });
    expect(s.autoAlignment(1)?.status).toBe('as-is');
    expect(heard.filter(([i]) => i === 1).at(-1)?.[1].status).toBe('manual');
    const watched: SheetAlignment[] = [];
    const off = s.watchAlignment((i, al) => {
      if (i === 1) watched.push(al);
    });
    expect(watched).toEqual([s.alignment(1)]);
    off();
    await s.close();
  }, 60_000);
});
