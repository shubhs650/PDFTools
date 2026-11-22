// M12-10 (D-60): automatic alignment, our own code on spike S28's route 1.
// Pure pieces on self-made drawings (TDD), then the whole pipeline — Work
// worker material on real PDFium, the Compare worker's handlers, the
// session — against the corpus manifest: pairs 03, 04, 06, 09 and 13 (and the
// A1/A3 pair 15).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import { CompareClient } from '../../src/engine/compareClient';
import { alignmentText } from '../../src/features/compare/alignmentText';
import { CompareSession, oneFile } from '../../src/features/compare/engine/session';
import { createFormatters } from '../../src/i18n/format';
import {
  AS_IS_AGREEMENT,
  alignImage,
  alignVector,
  alignmentValues,
  asIsCheck,
  coarseAlign,
  coarseScale,
  features,
  imageScale,
  refineVector,
  tileCorrectionBy,
  type SheetAlignment,
} from '../../src/model/compare/align/aligner';
import { fft1, phaseCorrelate } from '../../src/model/compare/align/fft';
import type { Ink } from '../../src/model/compare/align/ink';
import {
  affineToSim,
  applySim,
  degOf,
  fitSim,
  invertSim,
  ransacSim,
  rng,
  scaleOf,
  simError,
  simFrom,
  simToAffine,
  thenSim,
  type Sim,
} from '../../src/model/compare/align/similarity';
import {
  applyAffine,
  invertAffine,
  thenAffine,
  userPlacement,
  type PageFrame,
} from '../../src/model/compare/material';
import { compareSpawn, fakeWork } from './support/inProcess';

/** A self-made "drawing": a frame, rooms and some random lines, as segments. */
function drawing(seed: number, w = 600, h = 420): Float32Array {
  const r = rng(seed);
  const s: number[] = [];
  const rect = (x: number, y: number, ww: number, hh: number): void => {
    s.push(x, y, x + ww, y, x + ww, y, x + ww, y + hh, x + ww, y + hh, x, y + hh, x, y + hh, x, y);
  };
  rect(10, 10, w - 20, h - 20);
  for (let i = 0; i < 40; i++)
    rect(30 + r() * (w - 140), 30 + r() * (h - 140), 20 + r() * 80, 15 + r() * 60);
  for (let i = 0; i < 60; i++) {
    const x = 20 + r() * (w - 40);
    const y = 20 + r() * (h - 40);
    s.push(x, y, x + (r() - 0.5) * 120, y + (r() - 0.5) * 120);
  }
  return Float32Array.from(s);
}

function moveSegs(segs: Float32Array, t: Sim): Float32Array {
  const out = new Float32Array(segs.length);
  for (let i = 0; i < segs.length; i += 2) {
    const [x, y] = applySim(t, segs[i] ?? 0, segs[i + 1] ?? 0);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

/** Segments drawn 1 px wide at `scale` px per pt into a w × h raster. */
function raster(segs: Float32Array, w: number, h: number, scale: number): Ink {
  const data = new Uint8Array(w * h);
  for (let i = 0; i < segs.length; i += 4) {
    const ax = (segs[i] ?? 0) * scale;
    const ay = (segs[i + 1] ?? 0) * scale;
    const bx = (segs[i + 2] ?? 0) * scale;
    const by = (segs[i + 3] ?? 0) * scale;
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
    for (let k = 0; k <= n; k++) {
      const x = Math.round(ax + ((bx - ax) * k) / n);
      const y = Math.round(ay + ((by - ay) * k) / n);
      if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = 255;
    }
  }
  return { w, h, data };
}

describe('similarity maths', () => {
  it('fits an exact similarity, inverts it and converts to an affine map', () => {
    const t = simFrom(0.982, 1.2, 14, -9);
    const src = [0, 0, 100, 0, 0, 100, 300, 200];
    const dst = [] as number[];
    for (let i = 0; i < src.length; i += 2) dst.push(...applySim(t, src[i] ?? 0, src[i + 1] ?? 0));
    const fit = fitSim(src, dst);
    if (!fit) throw new Error('no fit');
    expect(scaleOf(fit)).toBeCloseTo(0.982, 9);
    expect(degOf(fit)).toBeCloseTo(1.2, 9);
    const back = thenSim(fit, invertSim(fit));
    expect(back.a).toBeCloseTo(1, 12);
    expect(back.tx).toBeCloseTo(0, 9);
    const m = simToAffine(t);
    expect(applyAffine(m, 30, 40)).toEqual(applySim(t, 30, 40));
    expect(affineToSim(m)).toEqual(t);
    expect(alignmentValues(m)).toMatchObject({ dx: 14, dy: -9 });
    expect(alignmentValues(m).scale).toBeCloseTo(0.982, 12);
    expect(alignmentValues(m).deg).toBeCloseTo(1.2, 12);
  });

  it('RANSAC ignores outliers, and only looks near the turn it is asked about', () => {
    const t = simFrom(1.01, 90.4, 5, 3);
    const r = rng(3);
    const src: number[] = [];
    const dst: number[] = [];
    for (let i = 0; i < 60; i++) {
      const x = r() * 500;
      const y = r() * 400;
      src.push(x, y);
      dst.push(...(i % 4 === 0 ? [r() * 500, r() * 400] : applySim(t, x, y)));
    }
    expect(ransacSim(src, dst, { threshold: 0.5, maxDeg: 45 })).toBeNull();
    const res = ransacSim(src, dst, { threshold: 0.5, maxDeg: 45, aroundDeg: 90 });
    if (!res) throw new Error('no fit');
    expect(simError(res.sim, t, 500, 400).maxPt).toBeLessThan(1e-6);
    expect(res.inliers.length).toBe(45);
  });

  it('FFT round-trips and phase correlation finds a cyclic shift', () => {
    const re = Float64Array.from({ length: 16 }, (_, i) => Math.sin(i) + i / 4);
    const im = new Float64Array(16);
    const orig = re.slice();
    fft1(re, im);
    fft1(re, im, true);
    for (let i = 0; i < 16; i++) expect(re[i]).toBeCloseTo(orig[i] ?? 0, 9);
    const n = 32;
    const a = new Float64Array(n * n);
    const b = new Float64Array(n * n);
    const r = rng(9);
    for (let i = 0; i < a.length; i++) a[i] = r();
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) b[((y + 3) % n) * n + ((x + n - 5) % n)] = a[y * n + x] ?? 0;
    const p = phaseCorrelate(a, b, n, n);
    expect(Math.round(p.dx)).toBe(-5);
    expect(Math.round(p.dy)).toBe(3);
  });
});

describe('the aligner on self-made drawings', () => {
  const segA = drawing(11);
  const truth = simFrom(0.982, 1.2, 14, -9);
  const segB = moveSegs(segA, truth);

  it('features are line ends, corners and junctions, not the inside of a straight run', () => {
    const f = features(Float32Array.from([0, 0, 10, 0, 10, 0, 20, 0, 20, 0, 20, 10]));
    expect(Array.from(f)).toEqual([0, 0, 20, 0, 20, 10]);
  });

  it('the as-is check passes an unmoved sheet and fails one moved by a point', () => {
    const f = features(segA);
    expect(asIsCheck(f, f)).toEqual({ vector: true, agreement: 1 });
    const moved = asIsCheck(f, features(moveSegs(segA, simFrom(1, 0, 1, 0))));
    expect(moved.agreement).toBeLessThan(AS_IS_AGREEMENT);
    // Next to no line work: the image method.
    expect(asIsCheck(f, features(Float32Array.from([0, 0, 10, 0]))).vector).toBe(false);
  });

  it('the coarse step gets within a few points, and finds a quarter turn when asked', () => {
    const s = 0.8;
    const c = coarseAlign(
      { a: raster(segA, 480, 336, s), b: raster(segB, 480, 336, s), scale: s },
      { n: 512 },
    );
    const e = simError(c.sim, truth, 600, 420);
    expect(Math.abs(e.deg)).toBeLessThan(0.5);
    expect(Math.abs(e.scalePct)).toBeLessThan(1);
    expect(e.maxPt).toBeLessThan(8);
    // The same sheet drawn a quarter turn round (portrait), a little skewed.
    const turn = simFrom(1, 90.7, 430, 5);
    const b = raster(moveSegs(segA, turn), 344, 480, s);
    const q = coarseAlign({ a: raster(segA, 480, 336, s), b, scale: s }, { n: 512, around: 90 });
    expect(simError(q.sim, turn, 600, 420).maxPt).toBeLessThan(8);
  });

  it('vector refinement reaches the acceptance numbers from a rough start', () => {
    const start = thenSim(truth, simFrom(1.004, 0.3, 3, -2));
    const r = refineVector(features(segA), features(segB), start, 12);
    const e = simError(r.sim, truth, 600, 420);
    expect(e.maxPt).toBeLessThan(0.05);
    expect(Math.abs(e.scalePct)).toBeLessThan(0.05);
    expect(Math.abs(e.deg)).toBeLessThan(0.05);
    expect(r.inlierShare).toBeGreaterThan(0.9);
  });

  it('aligns a moved sheet, and keeps an unmoved one as it is', () => {
    const s = coarseScale({ width: 600, height: 420 }, { width: 600, height: 420 });
    const coarse = (b: Float32Array) => ({
      a: raster(segA, Math.round(600 * s), Math.round(420 * s), s),
      b: raster(b, Math.round(600 * s), Math.round(420 * s), s),
      scale: s,
    });
    const moved = alignVector(features(segA), features(segB), coarse(segB));
    expect(moved).toMatchObject({ status: 'auto', method: 'vector' });
    const e = simError(affineToSim(moved.place), truth, 600, 420);
    expect(e.maxPt).toBeLessThan(0.05);
    const same = alignVector(features(segA), features(segA), coarse(segA));
    expect(same).toMatchObject({ status: 'as-is', place: [1, 0, 0, 1, 0, 0] });
  });

  it('finds a vector sheet drawn a quarter turn round', () => {
    const turn = simFrom(1, -89.4, 8, 595);
    const segT = moveSegs(segA, turn);
    const s = coarseScale({ width: 600, height: 420 }, { width: 420, height: 600 });
    const al = alignVector(features(segA), features(segT), {
      a: raster(segA, Math.round(600 * s), Math.round(420 * s), s),
      b: raster(segT, Math.round(420 * s), Math.round(600 * s), s),
      scale: s,
    });
    expect(al.status).toBe('auto');
    expect(simError(affineToSim(al.place), turn, 600, 420).maxPt).toBeLessThan(0.05);
  });

  it('says low confidence when nothing matches', () => {
    const other = drawing(99);
    const s = coarseScale({ width: 600, height: 420 }, { width: 600, height: 420 });
    const al = alignVector(features(segA), features(other), {
      a: raster(segA, Math.round(600 * s), Math.round(420 * s), s),
      b: raster(other, Math.round(600 * s), Math.round(420 * s), s),
      scale: s,
    });
    expect(al.status).toBe('low');
  });

  it('a tile step recovers a small shift and rotation of a raster', () => {
    const corr = simFrom(1, 0.3, 1.5, -1);
    const a = raster(segA, 600, 420, 1);
    const b = raster(moveSegs(segA, corr), 600, 420, 1);
    const fill =
      (ink: Ink) =>
      (x0: number, y0: number, out: Float64Array): void => {
        for (let y = 0; y < 64; y++)
          for (let x = 0; x < 64; x++)
            out[y * 64 + x] = (ink.data[(y0 + y) * ink.w + x0 + x] ?? 0) / 255;
      };
    const r = tileCorrectionBy(fill(a), fill(b), 600, 420, 1, 64);
    if (!r) throw new Error('no fit');
    expect(simError(r.sim, corr, 600, 420).maxPt).toBeLessThan(1.2);
  });
});

describe('the image method (scans)', () => {
  const segA = drawing(5, 400, 300);
  const thick = (ink: Ink): Ink => {
    // Scans have thick, soft lines: dilate by a pixel.
    const out = new Uint8Array(ink.data.length);
    for (let y = 0; y < ink.h; y++)
      for (let x = 0; x < ink.w; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            v = Math.max(v, ink.data[(y + dy) * ink.w + x + dx] ?? 0);
        out[y * ink.w + x] = v;
      }
    return { w: ink.w, h: ink.h, data: out };
  };
  const s = 2;
  const a = thick(raster(segA, 800, 600, s));

  it('uses an unmoved scan as it is', () => {
    expect(alignImage(a, a, s)).toMatchObject({ status: 'as-is', method: 'image' });
  });

  it('aligns a skewed, scaled scan to a fraction of a pixel', () => {
    const t = simFrom(1.012, -0.8, 6, -4);
    const b = thick(raster(moveSegs(segA, t), 800, 600, s));
    const al = alignImage(a, b, s);
    expect(al).toMatchObject({ status: 'auto', method: 'image' });
    expect(simError(affineToSim(al.place), t, 400, 300).maxPt * s).toBeLessThan(2);
  });

  it('finds a scan fed in a quarter turn round (ADR-032’s known gap)', () => {
    const t = simFrom(1, 90.5, 298, 2);
    const b = thick(raster(moveSegs(segA, t), 600, 800, s));
    const al = alignImage(a, b, s);
    expect(al.status).toBe('auto');
    expect(simError(affineToSim(al.place), t, 400, 300).maxPt * s).toBeLessThan(2);
  });

  it('a blank side is used as it is; nothing to align by', () => {
    const blank: Ink = { w: 800, h: 600, data: new Uint8Array(800 * 600) };
    expect(alignImage(a, blank, s)).toMatchObject({ status: 'as-is', score: 0 });
  });

  it('picks 2 px per pt unless the sheet is huge', () => {
    expect(imageScale({ width: 2384, height: 1684 }, { width: 1191, height: 842 })).toBe(2);
    expect(imageScale({ width: 6000, height: 4000 }, { width: 10, height: 10 })).toBe(1);
  });
});

describe('the placement in user space folds in /Rotate and the page boxes', () => {
  it('maps A’s user space to B’s through both frames', () => {
    // B: a landscape page shown with /Rotate 90 (842 × 595 laid out, displayed 595 × 842).
    const a: PageFrame = { width: 595, height: 842, rotation: 0, toDisplay: [1, 0, 0, -1, 0, 842] };
    const b: PageFrame = { width: 595, height: 842, rotation: 1, toDisplay: [0, 1, 1, 0, 0, 0] };
    const m = userPlacement(a, [1, 0, 0, 1, 0, 0], b);
    // A point drawn at A's (100, 700) shows where B shows its own (y, x) = (142, 100).
    expect(applyAffine(thenAffine(m, b.toDisplay), 100, 700)).toEqual(
      applyAffine(a.toDisplay, 100, 700),
    );
    expect(applyAffine(m, 100, 700)).toEqual([142, 100]);
    expect(thenAffine(invertAffine(m), m).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([
      1, 0, 0, 1, 0, 0,
    ]);
  });
});

// ---------------------------------------------------------------- corpus ---

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
  for (const pair of ['03', '04', '06', '09', '13', '15'])
    for (const side of ['old', 'new'] as const) {
      const bytes = corpusBytes(corpusPair('overlay', pair), side);
      await native
        .openDocumentBuffer(
          { id: `${pair}${side}`, content: bytes.slice().buffer },
          { normalizeRotation: true },
        )
        .toPromise();
    }
});

/** Every sheet's alignment of a corpus pair, paired in order, through the whole pipeline. */
async function alignPair(pair: string, pages: number): Promise<SheetAlignment[]> {
  const out: SheetAlignment[] = [];
  const all = [...Array(pages).keys()];
  const s = new CompareSession(oneFile(`${pair}old`, all), oneFile(`${pair}new`, all), {
    work: fakeWork(mod, native, []),
    compare: new CompareClient({ spawn: compareSpawn({ spawned: 0, terminated: 0 }, ports) }),
    // The analysis rasters are not what this test is about.
    dpi: 9,
    onAlign: (i, al) => {
      out[i] = al;
    },
  });
  await s.start();
  await s.whenDone();
  expect(s.progress().failed).toBe(0);
  await s.close();
  return out;
}

/** Within the plan's targets (0.5 pt over the sheet, 0.05 %, 0.05°) of the manifest's transform. */
function expectNear(al: SheetAlignment | undefined, want: Sim, w: number, h: number): void {
  if (!al) throw new Error('no alignment');
  const e = simError(affineToSim(al.place), want, w, h);
  expect(e.maxPt).toBeLessThan(0.5);
  expect(Math.abs(e.scalePct)).toBeLessThan(0.05);
  expect(Math.abs(e.deg)).toBeLessThan(0.05);
}

describe('alignment against the corpus manifest', () => {
  it('03: a registration shift and a 98.2 % plot are aligned; the aligned sheet is used as it is', async () => {
    const [p1, p2, p3] = await alignPair('03', 3);
    // A3 landscape. "+14 pt / −9 pt" in PDF space (y up) is (14, 9) as displayed (y down).
    expect(p1).toMatchObject({ status: 'auto', method: 'vector' });
    expectNear(p1, simFrom(1, 0, 14, 9), 1191, 842);
    // 98.2 % about the sheet's centre.
    expect(p2).toMatchObject({ status: 'auto', method: 'vector' });
    expectNear(p2, simFrom(0.982, 0, (1191 * 0.018) / 2, (842 * 0.018) / 2), 1191, 842);
    expect(p3).toMatchObject({ status: 'as-is', method: 'vector' });
  }, 60_000);

  it('04: the 1.2° skew is aligned; the /Rotate 90 page lines up as it is', async () => {
    const [p1, p2] = await alignPair('04', 2);
    expect(p1).toMatchObject({ status: 'auto', method: 'vector' });
    if (!p1) throw new Error('no alignment');
    // 1.2° counter-clockwise on paper is −1.2° as displayed (y down).
    expect(alignmentValues(p1.place).deg).toBeCloseTo(-1.2, 2);
    expect(Math.abs(alignmentValues(p1.place).scale - 1)).toBeLessThan(0.0005);
    expect(p2).toMatchObject({ status: 'as-is', place: [1, 0, 0, 1, 0, 0] });
  }, 60_000);

  it('06: the scanned pair (150 against 200 dpi, 0.5° skew) is aligned by the image method', async () => {
    const [p1] = await alignPair('06', 1);
    expect(p1).toMatchObject({ status: 'auto', method: 'image' });
    if (!p1) throw new Error('no alignment');
    const v = alignmentValues(p1.place);
    expect(v.deg).toBeCloseTo(0.5, 1);
    expect(Math.abs(v.scale - 1)).toBeLessThan(0.001);
    // S28 found 3.71 / −5.08 pt with no recorded truth; the scan target is 2 px at 150 dpi (0.96 pt).
    expect(Math.hypot(v.dx - 3.71, v.dy + 5.08)).toBeLessThan(0.96);
    expect(p1.score).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it('09: page boxes (MediaBox larger than the CropBox) need no alignment', async () => {
    const sheets = await alignPair('09', 2);
    for (const al of sheets) expect(al).toMatchObject({ status: 'as-is', method: 'vector' });
  }, 60_000);

  it('13: the large-format ARCH D and E sheets are used as they are', async () => {
    const sheets = await alignPair('13', 2);
    for (const al of sheets) expect(al).toMatchObject({ status: 'as-is', method: 'vector' });
  }, 60_000);

  it('15: the A1 sheet against its A3 print is scaled to 49.94 %', async () => {
    const [p1] = await alignPair('15', 1);
    expect(p1).toMatchObject({ status: 'auto', method: 'vector' });
    if (!p1) throw new Error('no alignment');
    expect(alignmentValues(p1.place).scale).toBeCloseTo(0.49941, 4);
  }, 60_000);
});

describe('what the status says', () => {
  const fmt = createFormatters('en-US');
  it('as is, auto-aligned with its values, low confidence with a hint', () => {
    const asIsText = alignmentText(
      { status: 'as-is', method: 'vector', place: [1, 0, 0, 1, 0, 0], score: 1 },
      fmt,
    );
    expect(asIsText).toEqual({ status: 'As is', values: null, hint: null });
    const auto = alignmentText(
      {
        status: 'auto',
        method: 'vector',
        place: simToAffine(simFrom(0.982, -1.2, 14, -0.001)),
        score: 0.98,
      },
      fmt,
    );
    expect(auto.status).toBe('Auto-aligned');
    expect(auto.values).toBe('Shift 14.0, 0.0 pt · scale 98.2% · rotation -1.20°');
    const low = alignmentText(
      { status: 'low', method: 'image', place: [1, 0, 0, 1, 0, 0], score: 2 },
      fmt,
    );
    expect(low.status).toBe('Low confidence');
    expect(low.hint).toMatch(/align the sheet by points/);
  });
});
