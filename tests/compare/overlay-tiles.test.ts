// M12-11 (D-59, ADR-032 S29): the overlay's tiles on real PDFium, opened the
// way the Render worker opens documents (EmbedPDF, normalized rotation):
// identical revisions draw black and white only; a changed pair shows red
// and green; A is drawn through its placement; comments are drawn on top and
// Hide check highlights leaves out the checker's see-through marks; Thicken
// makes hairlines heavier; the grey tiles are cached and a style change only
// re-composes.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import { corpusBytes, corpusPair } from '../../e2e/fixtures/comparison-corpus/index';
import { IDENTITY, type Affine } from '../../src/model/compare/material';
import { BLUE, DEFAULT_STYLE, RED, classify } from '../../src/model/compare/overlay';
import {
  OverlayTiles,
  displayedSize,
  type OverlayTileRequest,
} from '../../src/workers/render/overlayTiles';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;

async function open(id: string, pair: string, side: 'old' | 'new'): Promise<void> {
  const bytes = corpusBytes(corpusPair('overlay', pair), side);
  await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, { normalizeRotation: true })
    .toPromise();
}

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  for (const p of ['01', '16', '19']) {
    await open(`${p}a`, p, 'old');
    await open(`${p}b`, p, 'new');
  }
});

/** The whole first page of pair `p` as one tile at `scale` px/pt. */
function whole(
  p: string,
  scale: number,
  extra: Partial<OverlayTileRequest> = {},
): OverlayTileRequest {
  const size = displayedSize(mod, native, `${p}b`, 0);
  return {
    a: { docId: `${p}a`, pageIndex: 0, place: IDENTITY, version: 0 },
    b: { docId: `${p}b`, pageIndex: 0, place: IDENTITY, version: 0 },
    scale,
    x: 0,
    y: 0,
    width: Math.min(2048, Math.ceil(size.width * scale)),
    height: Math.min(2048, Math.ceil(size.height * scale)),
    style: DEFAULT_STYLE,
    thicken: false,
    comments: { a: false, b: false, hideChecks: false },
    ...extra,
  };
}

const yellow = (rgba: Uint8ClampedArray): number => {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4)
    if ((rgba[i] ?? 0) > 200 && (rgba[i + 1] ?? 0) > 200 && (rgba[i + 2] ?? 0) < 90) n++;
  return n;
};

describe('overlay tiles', () => {
  it('draws an identical pair in black and white only', () => {
    const tiles = new OverlayTiles();
    const c = classify(tiles.render(mod, native, whole('16', 1)));
    expect(c.black).toBeGreaterThan(1000);
    expect(c.colA).toBe(0);
    expect(c.colB).toBe(0);
  });

  it('shows old ink red and new ink green on a changed pair, blue with the red/blue preset', () => {
    const tiles = new OverlayTiles();
    const c = classify(tiles.render(mod, native, whole('01', 1)));
    expect(c.colA).toBeGreaterThan(200);
    expect(c.colB).toBeGreaterThan(200);
    const style = { ...DEFAULT_STYLE, colA: RED, colB: BLUE };
    const blue = classify(tiles.render(mod, native, whole('01', 1, { style })), style);
    expect(blue.colB).toBe(c.colB);
  });

  it('draws A through its placement: shifted, the identical pair no longer agrees', () => {
    const tiles = new OverlayTiles();
    const shifted: Affine = [1, 0, 0, 1, 12, 0];
    const req = whole('16', 1);
    const c = classify(
      tiles.render(mod, native, { ...req, a: req.a && { ...req.a, place: shifted } }),
    );
    expect(c.colA).toBeGreaterThan(500);
    expect(c.colB).toBeGreaterThan(500);
  });

  it('draws comments on top, and Hide check highlights leaves out the see-through marks', () => {
    const tiles = new OverlayTiles();
    const none = yellow(tiles.render(mod, native, whole('19', 1)));
    const on = { a: true, b: true, hideChecks: false };
    const shown = yellow(tiles.render(mod, native, whole('19', 1, { comments: on })));
    const hidden = yellow(
      tiles.render(mod, native, whole('19', 1, { comments: { ...on, hideChecks: true } })),
    );
    expect(shown).toBeGreaterThan(none + 500);
    // What stays yellow is the sticky notes' icons.
    expect(hidden - none).toBeLessThan((shown - none) / 4);
    // A hidden side's comments are not drawn either.
    const hideA = { ...DEFAULT_STYLE, showA: false };
    expect(
      yellow(tiles.render(mod, native, whole('19', 1, { comments: on, style: hideA }))),
    ).toBeLessThan(shown / 4);
  });

  it('Thicken thin lines adds ink', () => {
    const tiles = new OverlayTiles();
    const ink = (thicken: boolean): number => {
      const c = classify(tiles.render(mod, native, whole('01', 1, { thicken })));
      return c.black + c.colA + c.colB;
    };
    expect(ink(true)).toBeGreaterThan(ink(false) * 1.3);
  });

  it('caches the grey tiles; a style change re-composes from them; a closed document is dropped', () => {
    const tiles = new OverlayTiles();
    tiles.render(mod, native, whole('01', 0.5));
    const cached = tiles.cachedBytes;
    expect(cached).toBeGreaterThan(0);
    tiles.render(mod, native, whole('01', 0.5, { style: { ...DEFAULT_STYLE, fade: 1 } }));
    expect(tiles.cachedBytes).toBe(cached);
    tiles.drop('01a');
    expect(tiles.cachedBytes).toBe(cached / 2);
  });

  it('refuses a tile too large to draw', () => {
    const tiles = new OverlayTiles();
    expect(() => tiles.render(mod, native, { ...whole('01', 1), width: 5000 })).toThrow(
      /too large/,
    );
  });
});
