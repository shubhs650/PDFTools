// O1 compare an area (ADR-031 D-60, D-61) through the whole pipeline on real
// PDFium: the session aligns the sheet from its two rectangles and the line
// work inside them, and detection reports only what is inside the region both
// cover. Corpus pairs 15 (the same drawing at A1 and A3: another scale) and
// 17 (S-104 on another sheet of the set; S-101 unchanged).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import { CompareClient } from '../../src/engine/compareClient';
import { CompareSession, oneFile, type SheetPair } from '../../src/features/compare/engine/session';
import { areaRegion, inRegion, type AreaBox, type AreaPair } from '../../src/model/compare/area';
import type { SheetDiff } from '../../src/model/compare/detect/entries';
import { applyAffine, type Affine } from '../../src/model/compare/material';
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
          id: `a${pair}${side}`,
          content: corpusBytes(corpusPair('overlay', pair), side).slice().buffer,
        },
        { normalizeRotation: true },
      )
      .toPromise();
}

/** One sheet of a corpus pair compared: its alignment place and its differences. */
async function compare(
  pair: string,
  sheet: SheetPair,
): Promise<{ place: Affine; status: string; diff: SheetDiff }> {
  await open(pair);
  const p = corpusPair('overlay', pair);
  const pages = (n: number): number[] => [...Array(n).keys()];
  const s = new CompareSession(
    oneFile(`a${pair}old`, pages(p.oldPages)),
    oneFile(`a${pair}new`, pages(p.newPages)),
    {
      work: fakeWork(mod, native, []),
      compare: new CompareClient({ spawn: compareSpawn({ spawned: 0, terminated: 0 }, ports) }),
      pairs: [sheet],
    },
  );
  try {
    await s.start();
    await s.whenDone();
    expect(s.progress().failed).toBe(0);
    const al = s.alignment(0);
    if (!al) throw new Error('not aligned');
    const [res] = await s.differences([{ sheet: 0, zones: [] }], {
      sensitivity: 'normal',
      minSize: 0,
    });
    if (!res) throw new Error('not detected');
    return { place: al.place, status: al.status, diff: res.diff };
  } finally {
    await s.close();
  }
}

/** The box round A's rectangle as placed, grown by `pad` and moved by `dx`, `dy`. */
function around(place: Affine, box: AreaBox, pad: number, dx: number, dy: number): AreaBox {
  const pts = [
    applyAffine(place, box[0], box[1]),
    applyAffine(place, box[2], box[3]),
    applyAffine(place, box[0], box[3]),
    applyAffine(place, box[2], box[1]),
  ];
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  return [
    Math.min(...xs) - pad + dx,
    Math.min(...ys) - pad + dy,
    Math.max(...xs) + pad + dx,
    Math.max(...ys) + pad + dy,
  ];
}

const worst = (m: Affine, truth: Affine, box: AreaBox): number =>
  Math.max(
    ...[
      [box[0], box[1]],
      [box[2], box[1]],
      [box[0], box[3]],
      [box[2], box[3]],
    ].map(([x = 0, y = 0]) => {
      const [u, v] = applyAffine(m, x, y);
      const [p, q] = applyAffine(truth, x, y);
      return Math.hypot(u - p, v - q);
    }),
  );

describe('compare an area (O1)', () => {
  it('pair 15: an area of the A1 sheet against the same area on the A3 sheet', async () => {
    // The whole sheet's alignment is the truth (M12-10 checks it against the manifest).
    const whole = await compare('15', { a: 0, b: 0 });
    // A rectangle in the middle of the A1 sheet (2384 × 1684 pt) and one drawn roughly
    // round the same part of the A3 sheet: 5 pt larger and 4 pt off.
    const a: AreaBox = [800, 500, 1500, 1100];
    const area: AreaPair = { a, b: around(whole.place, a, 5, 4, -3) };
    const r = await compare('15', { a: 0, b: 0, area });
    expect(r.status).toBe('auto');
    expect(worst(r.place, whole.place, a)).toBeLessThan(1);
    expect(r.diff.entries).toEqual([]);
  }, 120_000);

  it('pair 17: S-104 on another sheet of the set; only its change, only inside the region', async () => {
    // A's S-104 is its 4th sheet, B's the 3rd: the whole sheet first, to find the beam.
    const whole = await compare('17', { a: 3, b: 2 });
    const beam = whole.diff.entries.find((e) => `${e.old} ${e.new}`.includes('W310x39'));
    if (!beam) throw new Error('beam change not found');
    const b: AreaBox = [beam.box[0] - 60, beam.box[1] - 60, beam.box[2] + 60, beam.box[3] + 60];
    const area: AreaPair = { a: [b[0] + 6, b[1] - 4, b[2] + 10, b[3] + 2], b };
    const r = await compare('17', { a: 3, b: 2, area });
    expect(r.diff.entries.some((e) => `${e.old} → ${e.new}`.includes('W310x39 → W410x60'))).toBe(
      true,
    );
    // Nothing reported outside what both rectangles cover.
    const region = areaRegion(area, r.place);
    for (const e of r.diff.entries)
      expect(inRegion(region, (e.box[0] + e.box[2]) / 2, (e.box[1] + e.box[3]) / 2)).toBe(true);
    expect(r.diff.entries.length).toBeLessThan(whole.diff.entries.length);
  }, 120_000);

  it('pair 17: an area of an unchanged sheet reports nothing', async () => {
    // S-101 on both sides, a rectangle of each drawn a little differently.
    const area: AreaPair = { a: [300, 200, 700, 500], b: [292, 206, 706, 497] };
    const r = await compare('17', { a: 0, b: 0, area });
    expect(r.status).toBe('auto');
    expect(worst(r.place, [1, 0, 0, 1, 0, 0], area.a)).toBeLessThan(0.5);
    expect(r.diff.entries).toEqual([]);
  }, 120_000);
});
