// M12-07 (D-66): the comparison material the Work worker reads, on real
// PDFium opened the way the Work worker opens documents (normalizeRotation):
// frames in displayed space on a turned page, signatures that see the same
// sheet at two sizes as one, positioned characters, analysis bands through a
// placement that add up to the whole raster, and comments never drawn.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import { buildPdf } from '../../e2e/fixtures/generate';
import {
  TEXT_GENERATED,
  bandRanges,
  rasterSize,
  wordsOf,
  type Affine,
} from '../../src/model/compare/material';
import { acquirePage, docPtrOf } from '../../src/workers/render/pdfium';
import {
  analysisBand,
  frameOf,
  plainFrame,
  renderInk,
  signatureOf,
  textOf,
  type LoadedFrame,
} from '../../src/workers/work/compareMaterial';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;

const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer;

async function open(id: string, bytes: Uint8Array): Promise<void> {
  // As the Work worker opens its copies (docs.ts).
  await native
    .openDocumentBuffer({ id, content: buf(bytes) }, { normalizeRotation: true })
    .toPromise();
}

function onPage<T>(id: string, index: number, fn: (page: number, frame: LoadedFrame) => T): T {
  const ref = acquirePage(native, id, index);
  try {
    return fn(ref.pagePtr, frameOf(mod, docPtrOf(native, id), index, ref.pagePtr));
  } finally {
    ref.release();
  }
}

const sig = (id: string, index = 0) =>
  onPage(id, index, (p) => signatureOf(mod, docPtrOf(native, id), index, p));

/**
 * A portrait 200 × 100 user-space page turned by /Rotate 90: a black square
 * in the user top-left corner and "AB" in Helvetica; plus a red square
 * annotation that must never appear in the analysis raster.
 */
function turnedPage(): Uint8Array {
  const content = '0 0 0 rg 0 80 20 20 re f BT /F1 12 Tf 100 40 Td (AB) Tj ET';
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate 90 /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /Annots [6 0 R] >>',
    { dict: '<< >>', stream: content },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Annot /Subtype /Square /Rect [150 0 200 50] /C [1 0 0] /IC [1 0 0] /AP << /N 7 0 R >> >>',
    {
      dict: '<< /Type /XObject /Subtype /Form /BBox [0 0 50 50] >>',
      stream: '1 0 0 rg 0 0 50 50 re f',
    },
  ]);
}

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  await open('turned', turnedPage());
  await open('a1', corpusBytes(corpusPair('overlay', '15'), 'old'));
  await open('a3', corpusBytes(corpusPair('overlay', '15'), 'new'));
  await open('pair02', corpusBytes(corpusPair('overlay', '02'), 'old'));
  await open('p04a', corpusBytes(corpusPair('overlay', '04'), 'old'));
  await open('p04b', corpusBytes(corpusPair('overlay', '04'), 'new'));
});

/** Mean ink of a rectangle of a band (pixels). */
function inkIn(
  data: Uint8Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      s += data[y * width + x] ?? 0;
      n++;
    }
  return n ? s / n : 0;
}

describe('page frame (displayed space)', () => {
  it('a /Rotate 90 page is 100 × 200 pt with the user top-left corner at the top right', () => {
    const f = onPage('turned', 0, (_p, f) => f);
    expect(f.width).toBeCloseTo(100, 3);
    expect(f.height).toBeCloseTo(200, 3);
    const ink = onPage('turned', 0, (p, f) =>
      renderInk(mod, p, { turn: f.turn, scale: 1, width: 100, top: 0, rows: 200 }),
    );
    // User (0…20, 80…100) → displayed (80…100, 0…20).
    expect(inkIn(ink, 100, 82, 2, 98, 18)).toBeGreaterThan(250);
    expect(inkIn(ink, 100, 2, 2, 18, 18)).toBe(0);
    expect(inkIn(ink, 100, 2, 182, 18, 198)).toBe(0);
  });

  it('never draws comments: the red square annotation leaves no ink', () => {
    // The annotation is at user (150…200, 0…50) → displayed (0…50, 150…200).
    const ink = onPage('turned', 0, (p, f) =>
      renderInk(mod, p, { turn: f.turn, scale: 1, width: 100, top: 0, rows: 200 }),
    );
    expect(inkIn(ink, 100, 2, 152, 48, 198)).toBe(0);
  });
});

describe('positioned text', () => {
  it('reads the characters with boxes in displayed space and their flags', () => {
    const t = onPage('turned', 0, (p, f) => textOf(mod, p, plainFrame(f)));
    const chars = [...t.codes].filter((_, i) => !((t.flags[i] ?? 0) & TEXT_GENERATED));
    expect(String.fromCodePoint(...chars)).toBe('AB');
    expect(t.boxes.length).toBe(t.codes.length * 4);
    expect(t.origins.length).toBe(t.codes.length * 2);
    // "AB" starts at user (100, 40): displayed x = 40, y = 100, the text running down.
    const [x0, y0, x1, y1] = [...t.boxes.slice(0, 4)];
    expect(x0).toBeGreaterThan(30);
    expect(x1).toBeLessThan(60);
    expect(y0).toBeGreaterThanOrEqual(99);
    expect(y1).toBeLessThan(120);
    expect(t.sizes[0]).toBeCloseTo(12, 1);
    // Running down the displayed page: a quarter turn clockwise (M12-23: PDFium's char
    // angle is clockwise; it came out as +90 before).
    expect(t.angles[0]).toBeCloseTo(-90, 3);
    expect(wordsOf(t)).toEqual(['AB']);
  });

  it('reads text on a /Rotate 90 sheet as displayed: level lines at 0°, a label reading up at 90° (pair 04)', () => {
    for (const id of ['p04a', 'p04b']) {
      const t = onPage(id, 1, (p, f) => textOf(mod, p, plainFrame(f)));
      const s = String.fromCodePoint(...t.codes);
      const angle = (word: string): number => t.angles[s.indexOf(word)] ?? NaN;
      // A is stored portrait; B landscape with /Rotate 90: both display the same.
      expect(angle('DETAIL')).toBeCloseTo(0, 3);
      expect(angle('DRAWING')).toBeCloseTo(0, 3);
      expect(angle('BEDDING')).toBeCloseTo(90, 3);
      const words = wordsOf(t);
      expect(words).toContain('DETAIL');
      expect(words).toContain('BEDDING');
    }
  });

  it('reads a drawing sheet: title block words are found', () => {
    const t = onPage('pair02', 0, (p, f) => textOf(mod, p, plainFrame(f)));
    expect(t.codes.length).toBeGreaterThan(50);
    expect(wordsOf(t).length).toBeGreaterThan(10);
  });
});

describe('signature', () => {
  it('sees the same drawing at A1 and A3 as the same sheet (pair 15)', () => {
    const a = sig('a1');
    const b = sig('a3');
    let dot = 0;
    let norm = 0;
    for (let i = 0; i < a.ink.length; i++) {
      dot += (a.ink[i] ?? 0) * (b.ink[i] ?? 0);
      norm += (a.ink[i] ?? 0) ** 2;
    }
    expect(norm).toBeCloseTo(1, 4);
    expect(dot).toBeGreaterThan(0.95);
    expect(a.frame.width / b.frame.width).toBeCloseTo(Math.SQRT2 * Math.SQRT2, 1);
    expect(a.words.length).toBeGreaterThan(5);
  });

  it('tells two different sheets apart', () => {
    const a = sig('a1');
    const b = sig('pair02');
    let dot = 0;
    for (let i = 0; i < a.ink.length; i++) dot += (a.ink[i] ?? 0) * (b.ink[i] ?? 0);
    expect(dot).toBeLessThan(0.8);
  });
});

describe('analysis bands', () => {
  it('bands add up to the whole raster, and a checkpoint runs between sub-bands', async () => {
    const f = onPage('pair02', 0, (_p, fr) => fr);
    const size = rasterSize(f.width, f.height, 72);
    const ref = acquirePage(native, 'pair02', 0);
    try {
      const whole = renderInk(mod, ref.pagePtr, {
        turn: f.turn,
        scale: 1,
        width: size.width,
        top: 0,
        rows: size.height,
      });
      let checkpoints = 0;
      const joined = new Uint8Array(size.width * size.height);
      for (const r of bandRanges(size.height, 100)) {
        const band = await analysisBand(
          mod,
          ref.pagePtr,
          f.turn,
          { dpi: 72, width: size.width, height: size.height, ...r },
          () => {
            checkpoints++;
            return Promise.resolve();
          },
          32,
        );
        expect(band.top).toBe(r.top);
        expect(band.rows).toBe(r.rows);
        joined.set(band.data, band.top * size.width);
      }
      expect(checkpoints).toBeGreaterThan(0);
      // PDFium's anti-aliasing can differ on a few pixels next to a band edge.
      let differing = 0;
      for (let i = 0; i < whole.length; i++)
        if (Math.abs((whole[i] ?? 0) - (joined[i] ?? 0)) > 1) differing++;
      expect(differing).toBeLessThan(size.width / 10);
    } finally {
      ref.release();
    }
  });

  it('draws through a placement: A1 squeezed into the A3 frame matches the A3 sheet', async () => {
    const fa = onPage('a1', 0, (_p, f) => f);
    const fb = onPage('a3', 0, (_p, f) => f);
    const k = fb.width / fa.width;
    const place: Affine = [k, 0, 0, k, 0, 0];
    const size = rasterSize(fb.width, fb.height, 50);
    const req = { dpi: 50, width: size.width, height: size.height, top: 0, rows: size.height };
    const next = (): Promise<void> => Promise.resolve();
    const a = await onPage('a1', 0, (p, f) =>
      analysisBand(mod, p, f.turn, { ...req, place }, next),
    );
    const b = await onPage('a3', 0, (p, f) => analysisBand(mod, p, f.turn, req, next));
    let both = 0;
    let either = 0;
    for (let i = 0; i < a.data.length; i++) {
      const ia = (a.data[i] ?? 0) > 96;
      const ib = (b.data[i] ?? 0) > 96;
      if (ia || ib) either++;
      if (ia && ib) both++;
    }
    expect(either).toBeGreaterThan(1000);
    expect(both / either).toBeGreaterThan(0.6);
  });

  it('refuses a raster larger than the limit', () => {
    expect(() =>
      onPage('pair02', 0, (p, f) =>
        renderInk(mod, p, { turn: f.turn, scale: 1, width: 20_000, top: 0, rows: 1 }),
      ),
    ).toThrow(/too large/);
  });
});
