// M12-16 (D-59, ADR-032 route 2): the vector overlay PDF built by the Work
// worker's builder on real PDFium, opened the way the Work worker opens
// documents. Each built page is drawn back (the display mode's tile path) and
// measured against the screen overlay of the same pages (the reference, as in
// S29): the same black, the same red and green. Also: the comments are left
// out, A is drawn through its placement, a turned page, an encrypted file,
// layers with the comparison's switches, the stress sheet, Type 3 text, a
// hidden side, and cancelling.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CORPUS_PASSWORDS,
  corpusBytes,
  corpusPair,
} from '../../e2e/fixtures/comparison-corpus/index';
import { buildPdf } from '../../e2e/fixtures/generate';
import { stressSheet } from '../../e2e/fixtures/vectorStress';
import { IDENTITY, type Affine } from '../../src/model/compare/material';
import { DEFAULT_STYLE, classify, type PixelClasses } from '../../src/model/compare/overlay';
import { PdfRef, PdfStream, PdfString, isDict, nameOf } from '../../src/model/pdf/objects';
import { PdfReader } from '../../src/model/pdf/reader';
import { readLayers } from '../../src/model/ocg';
import {
  OverlayTiles,
  displayedSize,
  type OverlayTileRequest,
} from '../../src/workers/render/overlayTiles';
import {
  buildVectorOverlay,
  type VectorEnv,
  type VectorOverlayRequest,
  type VectorSheet,
} from '../../src/workers/work/vectorOverlay';

const require = createRequire(import.meta.url);
let mod: WrappedPdfiumModule;
let native: PdfiumNative;
const files = new Map<string, { bytes: Uint8Array; password?: string }>();
let outSeq = 0;

const inflate = (b: Uint8Array): Promise<Uint8Array> => Promise.resolve(inflateSync(b));

async function open(id: string, bytes: Uint8Array, password?: string): Promise<void> {
  // As the Work worker opens its copies (docs.ts).
  await native
    .openDocumentBuffer(
      { id, content: bytes.slice().buffer },
      { normalizeRotation: true, ...(password === undefined ? {} : { password }) },
    )
    .toPromise();
  files.set(id, { bytes, ...(password === undefined ? {} : { password }) });
}

async function openPair(p: string): Promise<void> {
  const pair = corpusPair('overlay', p);
  for (const side of ['old', 'new'] as const) {
    const name = side === 'old' ? pair.oldFile : pair.newFile;
    const pw = CORPUS_PASSWORDS[name]?.user;
    await open(
      `${p}${side === 'old' ? 'a' : 'b'}`,
      corpusBytes(pair, side),
      pw === '' ? undefined : pw,
    );
  }
}

function env(signal = new AbortController().signal): VectorEnv & { steps: number[] } {
  const steps: number[] = [];
  return {
    mod,
    native,
    source: (docId) =>
      Promise.resolve({
        engineId: docId,
        reader: async () => {
          const f = files.get(docId);
          if (!f) return null;
          return PdfReader.open(f.bytes, inflate, f.password ? { password: f.password } : {});
        },
      }),
    slice: {
      checkpoint: () => {
        signal.throwIfAborted();
        return Promise.resolve();
      },
      signal,
    },
    progress: (p) => {
      steps.push(p.done);
    },
    steps,
  };
}

const sheet = (p: string, page = 0, place: Affine = IDENTITY): VectorSheet => ({
  a: { docId: `${p}a`, pageIndex: page },
  b: { docId: `${p}b`, pageIndex: page },
  place,
});

const request = (sheets: VectorSheet[], extra: Partial<VectorOverlayRequest> = {}) => ({
  sheets,
  colA: DEFAULT_STYLE.colA,
  colB: DEFAULT_STYLE.colB,
  labels: { a: {}, b: {} },
  ...extra,
});

/** Builds the overlay and opens it; its id in the engine. */
async function built(req: VectorOverlayRequest): Promise<{ id: string; bytes: Uint8Array }> {
  const { bytes } = await buildVectorOverlay(env(), req);
  const id = `out${String(++outSeq)}`;
  await open(id, bytes);
  return { id, bytes };
}

const SCALE = 2;

/** A whole page as one tile (at most 2048 px a side). */
function tile(
  docId: string,
  page: number,
  extra: Partial<OverlayTileRequest> = {},
): OverlayTileRequest {
  const size = displayedSize(mod, native, docId, page);
  return {
    a: null,
    b: null,
    scale: SCALE,
    x: 0,
    y: 0,
    width: Math.min(2048, Math.ceil(size.width * SCALE)),
    height: Math.min(2048, Math.ceil(size.height * SCALE)),
    style: DEFAULT_STYLE,
    thicken: false,
    comments: { a: false, b: false, hideChecks: false },
    ...extra,
  };
}

/** The screen overlay of a sheet (the reference) and the built page, classified alike. */
function measure(
  s: VectorSheet,
  out: string,
  page = 0,
): { screen: PixelClasses; vector: PixelClasses } {
  const tiles = new OverlayTiles();
  const frameDoc = s.b?.docId ?? s.a?.docId ?? '';
  const framePage = s.b?.pageIndex ?? s.a?.pageIndex ?? 0;
  const screen = classify(
    tiles.render(
      mod,
      native,
      tile(frameDoc, framePage, {
        a: s.a && { docId: s.a.docId, pageIndex: s.a.pageIndex, place: s.place, version: 0 },
        b: s.b && { docId: s.b.docId, pageIndex: s.b.pageIndex, place: IDENTITY, version: 0 },
      }),
    ),
  );
  const vector = classify(
    tiles.render(mod, native, tile(out, page, { vector: { contentId: out, pageIndex: page } })),
  );
  return { screen, vector };
}

/** Pixel counts that agree up to anti-aliasing. */
function agrees(v: number, s: number): void {
  expect(Math.abs(v - s)).toBeLessThanOrEqual(Math.max(60, s * 0.06));
}

/**
 * The same drawing as the screen overlay: the same red and green, and the
 * same ink in both. The screen draws the anti-aliased edge of a line both
 * revisions have in neutral grey (S29 finding 7); the PDF multiplies, so a
 * few of those edge pixels are olive ("other") instead of black.
 */
function sameDrawing({ screen, vector }: { screen: PixelClasses; vector: PixelClasses }): void {
  agrees(vector.colA, screen.colA);
  agrees(vector.colB, screen.colB);
  agrees(vector.black + vector.other, screen.black + screen.other);
  expect(vector.black).toBeGreaterThanOrEqual(screen.black * 0.85);
}

async function catalogOf(bytes: Uint8Array) {
  const r = await PdfReader.open(bytes, inflate);
  const cat = await r.resolve(r.trailer.get('Root'));
  if (!isDict(cat)) throw new Error('no catalog');
  return { r, cat };
}

beforeAll(async () => {
  mod = await init({ wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')) });
  native = new PdfiumNative(mod, { fontFallback: null });
  for (const p of ['01', '07', '11', '12', '16', '19']) await openPair(p);
  await open('stressa', stressSheet('A'));
  await open('stressb', stressSheet('B'));
  await open('type3a', stressSheet('A', { type3: true }));
  await open('type3b', stressSheet('B', { type3: true }));
});

describe('the vector overlay builder', () => {
  it('draws an identical pair in black and white only', async () => {
    const s = sheet('16');
    const { id } = await built(request([s]));
    const { screen, vector } = measure(s, id);
    expect(vector.black).toBeGreaterThan(1000);
    expect(vector.colA).toBe(0);
    expect(vector.colB).toBe(0);
    sameDrawing({ screen, vector });
  });

  it('draws a changed pair as the screen overlay does: old red, new green, the same black', async () => {
    const s = sheet('01');
    const { id, bytes } = await built(request([s]));
    const { screen, vector } = measure(s, id);
    expect(vector.colA).toBeGreaterThan(200);
    expect(vector.colB).toBeGreaterThan(200);
    sameDrawing({ screen, vector });
    // One compact revision: a single cross-reference section, no attachments.
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.match(/startxref/g)?.length).toBe(1);
    const { cat } = await catalogOf(bytes);
    expect(cat.has('Names')).toBe(false);
  });

  it('draws A through its placement', async () => {
    const s = sheet('16', 0, [1, 0, 0, 1, 12, 0]);
    const { id } = await built(request([s]));
    const { screen, vector } = measure(s, id);
    expect(vector.colA).toBeGreaterThan(500);
    sameDrawing({ screen, vector });
  });

  it('leaves the comments out (Q10)', async () => {
    const s = sheet('19');
    const { id } = await built(request([s]));
    const { screen, vector } = measure(s, id);
    sameDrawing({ screen, vector });
  });

  it('makes one page per sheet, a sheet only one side has in its own colour, with progress', async () => {
    const e = env();
    const sheets: VectorSheet[] = [
      sheet('07', 0),
      sheet('07', 1),
      { a: null, b: { docId: '01b', pageIndex: 0 }, place: IDENTITY },
    ];
    const { bytes } = await buildVectorOverlay(e, request(sheets));
    expect(e.steps).toEqual([0, 1, 2, 3]);
    const id = `out${String(++outSeq)}`;
    await open(id, bytes);
    const { r } = await catalogOf(bytes);
    expect(await r.pages()).toHaveLength(3);
    const added = classify(
      new OverlayTiles().render(
        mod,
        native,
        tile(id, 2, { vector: { contentId: id, pageIndex: 2 } }),
      ),
    );
    expect(added.colB).toBeGreaterThan(2000);
    expect(added.colA + added.black).toBeLessThan(added.colB / 50);
  });

  it('leaves out a hidden side (the display mode’s show and hide)', async () => {
    const s = sheet('01');
    const { id } = await built(request([{ ...s, hide: { a: true } }]));
    const c = classify(
      new OverlayTiles().render(mod, native, tile(id, 0, { vector: { contentId: id } })),
    );
    expect(c.colA).toBe(0);
    expect(c.black).toBe(0);
    expect(c.colB).toBeGreaterThan(1000);
  });

  it('builds from an encrypted file opened with its password; the overlay is not encrypted', async () => {
    const s = sheet('12');
    const { id, bytes } = await built(request([s]));
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('/Encrypt');
    const { screen, vector } = measure(s, id);
    sameDrawing({ screen, vector });
  });

  it('tints images, masks, shadings, patterns and spot colours (the stress sheet)', async () => {
    const s: VectorSheet = {
      a: { docId: 'stressa', pageIndex: 0 },
      b: { docId: 'stressb', pageIndex: 0 },
      place: IDENTITY,
    };
    const { id } = await built(request([s]));
    const { screen, vector } = measure(s, id);
    sameDrawing({ screen, vector });
    // Nothing keeps its own colour: no orange, blue or yellow.
    expect(vector.other).toBeLessThanOrEqual(Math.max(60, screen.other * 1.2));
  });

  it('draws a page with Type 3 text through one mask, so its glyph’s own colour is tinted too', async () => {
    const s: VectorSheet = {
      a: { docId: 'type3a', pageIndex: 0 },
      b: { docId: 'type3b', pageIndex: 0 },
      place: IDENTITY,
    };
    const { id } = await built(request([s]));
    const { screen, vector } = measure(s, id);
    sameDrawing({ screen, vector });
    expect(vector.other).toBeLessThanOrEqual(Math.max(60, screen.other * 1.2));
  });

  it('draws a turned page (/Rotate 90) in its displayed frame', async () => {
    const page = (x: number) =>
      buildPdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /CropBox [10 0 400 200] /Rotate 90 /Contents 4 0 R >>',
        { dict: '<< >>', stream: `0 g 20 20 100 40 re f 4 w 0 G 200 50 m ${String(x)} 150 l S` },
      ]);
    await open('rota', page(300));
    await open('rotb', page(340));
    const s: VectorSheet = {
      a: { docId: 'rota', pageIndex: 0 },
      b: { docId: 'rotb', pageIndex: 0 },
      place: IDENTITY,
    };
    const { id } = await built(request([s]));
    expect(displayedSize(mod, native, id, 0)).toEqual(displayedSize(mod, native, 'rotb', 0));
    const { screen, vector } = measure(s, id);
    expect(vector.black).toBeGreaterThan(2000);
    sameDrawing({ screen, vector });
  });

  it('keeps each file’s layers, listed once per file, shown as the comparison’s switches say (Q24)', async () => {
    const layersB = await readLayers(files.get('11b')?.bytes ?? new Uint8Array(), inflate);
    const on = layersB.layers.find((l) => l.on);
    if (!on) throw new Error('pair 11 has a layer shown by default');
    const { bytes } = await built(
      request([sheet('11', 0), sheet('11', 1)], {
        labels: { a: { '11a': 'Old — A.pdf' }, b: { '11b': 'New — B.pdf' } },
        layers: { '11b': { [on.id]: false } },
      }),
    );
    const { r, cat } = await catalogOf(bytes);
    const ocp = await r.resolve(cat.get('OCProperties'));
    if (!isDict(ocp)) throw new Error('no /OCProperties');
    const d = await r.resolve(ocp.get('D'));
    if (!isDict(d)) throw new Error('no /D');
    const order = (await r.resolve(d.get('Order'))) as unknown[];
    const groups = order.filter(Array.isArray) as unknown[][];
    expect(groups.map((g) => (g[0] instanceof PdfString ? g[0].text() : ''))).toEqual([
      'Old — A.pdf',
      'New — B.pdf',
    ]);
    // Each source layer once, though both sheets use it.
    const nameOfRef = async (v: unknown): Promise<string> => {
      const o = await r.resolve(v as PdfRef);
      const n = isDict(o) ? o.get('Name') : undefined;
      return n instanceof PdfString ? n.text() : '';
    };
    const newNames = await Promise.all((groups[1] ?? []).slice(1).map(nameOfRef));
    expect(newNames).toHaveLength(new Set(newNames).size);
    const layersA = await readLayers(files.get('11a')?.bytes ?? new Uint8Array(), inflate);
    expect(groups[0]?.length).toBe(layersA.layers.length + 1);
    // The switched layer is off in B's group; A's own hidden layers stay off.
    const off = new Set(((await r.resolve(d.get('OFF'))) as PdfRef[]).map((x) => x.num));
    const listedB = (groups[1] ?? []).slice(1) as PdfRef[];
    const offB = await Promise.all(listedB.filter((x) => off.has(x.num)).map(nameOfRef));
    expect(offB).toContain(on.name);
    const offA = await Promise.all(
      ((groups[0] ?? []).slice(1) as PdfRef[]).filter((x) => off.has(x.num)).map(nameOfRef),
    );
    expect(offA.sort()).toEqual(
      layersA.layers
        .filter((l) => !l.on)
        .map((l) => l.name)
        .sort(),
    );
    // The page forms point to the listed copies on both pages.
    const listed = new Set(groups.flatMap((g) => g.slice(1) as PdfRef[]).map((x) => x.num));
    for (const pg of await r.pages()) {
      const res = await r.resolve(pg.dict.get('Resources'));
      const xo = isDict(res) ? await r.resolve(res.get('XObject')) : undefined;
      const form = isDict(xo) ? await r.resolve(xo.get('New')) : undefined;
      const fres =
        form instanceof PdfStream ? await r.resolve(form.dict.get('Resources')) : undefined;
      const props = isDict(fres) ? await r.resolve(fres.get('Properties')) : undefined;
      if (!isDict(props)) continue;
      for (const v of props.values()) {
        const o = await r.resolve(v);
        if (v instanceof PdfRef && isDict(o) && nameOf(o.get('Type')) === 'OCG')
          expect(listed.has(v.num)).toBe(true);
      }
    }
  });

  it('stops when cancelled', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(buildVectorOverlay(env(ctl.signal), request([sheet('01')]))).rejects.toThrow();
  });
});

// The interop pack for the owner's check in desktop viewers (plan M12-16):
// `VECTOR_PACK_DIR=<dir> npx vitest run tests/compare/vector-overlay.test.ts`.
const PACK = process.env.VECTOR_PACK_DIR;

describe.runIf(PACK !== undefined)('the interop pack', () => {
  it('writes one exported overlay per case', async () => {
    const dir = PACK ?? '';
    mkdirSync(dir, { recursive: true });
    const pages = async (docId: string): Promise<number> => {
      const f = files.get(docId);
      if (!f) return 0;
      const r = await PdfReader.open(f.bytes, inflate, f.password ? { password: f.password } : {});
      return (await r.pages()).length;
    };
    const pairSheets = async (p: string): Promise<VectorSheet[]> =>
      Array.from({ length: await pages(`${p}b`) }, (_, i) => sheet(p, i));
    const one = (a: string, b: string): VectorSheet[] => [
      { a: { docId: a, pageIndex: 0 }, b: { docId: b, pageIndex: 0 }, place: IDENTITY },
    ];
    const layersB = await readLayers(files.get('11b')?.bytes ?? new Uint8Array(), inflate);
    const switched = layersB.layers.find((l) => l.on);
    const labels = (p: string) => ({
      a: { [`${p}a`]: `Old — pair ${p}` },
      b: { [`${p}b`]: `New — pair ${p}` },
    });
    const cases: [string, VectorSheet[], Partial<VectorOverlayRequest>][] = [
      ['01-changed-drawing', await pairSheets('01'), labels('01')],
      ['07-two-sheets-colour', await pairSheets('07'), labels('07')],
      [
        '11-layers-one-switched-off',
        await pairSheets('11'),
        { ...labels('11'), layers: switched ? { '11b': { [switched.id]: false } } : {} },
      ],
      ['12-from-encrypted', await pairSheets('12'), labels('12')],
      ['16-identical', await pairSheets('16'), labels('16')],
      ['19-comments-left-out', await pairSheets('19'), labels('19')],
      ['16-a-shifted-12pt', [sheet('16', 0, [1, 0, 0, 1, 12, 0])], labels('16')],
      ['stress-images-shadings-spot', one('stressa', 'stressb'), {}],
      ['type3-text', one('type3a', 'type3b'), {}],
    ];
    for (const [name, sheets, extra] of cases) {
      const { bytes } = await buildVectorOverlay(env(), request(sheets, extra));
      writeFileSync(join(dir, `${name}.pdf`), bytes);
    }
    expect(readdirSync(dir).filter((f) => f.endsWith('.pdf'))).toHaveLength(cases.length);
  });
});
