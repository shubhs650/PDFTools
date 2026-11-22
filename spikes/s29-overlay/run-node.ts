// Spike S29 (M12-04, D-59) — the Node half: everything that is PDFium, the
// pixel work and the vector overlay builder, on the same PDFium WASM the app
// ships. The browser half (compositor against worker, frames, memory) is
// s29.spec.ts.
//
//   node spikes/s29-overlay/make-fixtures.ts
//   node --import ./spikes/shared/ts-ext.ts spikes/s29-overlay/run-node.ts
//
// Optional second and third engines for the vector overlay check (outside the
// repository, never bundled; see RESULTS.md):
//   PDFJS_DIR=/tmp/pdfjs   pdf.js (Firefox's engine), run in Chromium
//   pdftoppm on PATH       Poppler (the engine of several Linux viewers)
// Writes out/pack/ (the owner's sample pack) and test-results/s29-node.json.
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { encodePng } from '../../src/workers/work/png.ts';
import {
  DEFAULT_STYLE,
  classify,
  compose,
  crop,
  styleTables,
  thicken,
  type PixelClasses,
} from './composite.ts';
import {
  annotCount,
  call,
  openDoc,
  pageSize,
  renderPage,
  withPage,
  type Matrix,
  type OpenDoc,
} from './pdfiumKit.ts';
import { tileMatrix } from './sheet.ts';
import { buildVectorOverlay, type Route, type SheetSpec, type Source } from './vectorOverlay.ts';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS = join(ROOT, 'Synthetic PDF Corpus/engineering_pdf_overlay_test_corpus/');
const PACK = join(HERE, 'out/pack/');
const RESULTS = join(ROOT, 'test-results/s29-node.json');
const PDFJS_DIR = process.env.PDFJS_DIR;

const require = createRequire(import.meta.url);
const wasmBinary = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
const mod: WrappedPdfiumModule = await init({ wasmBinary });
call(mod, 'PDFiumExt_Init');

const results: Record<string, unknown> = {};
const note = (k: string, v: unknown) => {
  results[k] = v;
  console.log(k, JSON.stringify(v));
};
const now = () => performance.now();
const r1 = (n: number) => Math.round(n * 10) / 10;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

interface Pair {
  id: string;
  dir: string;
  files: [string, string];
  passwords: [string, string];
  aToB?: (A: OpenDoc, B: OpenDoc, page: number) => Matrix;
}

function corpusPair(id: string, passwords: [string, string] = ['', '']): Pair {
  const dir = readdirSync(CORPUS).find((d) => d.startsWith(`pair_${id}_`));
  if (!dir) throw new Error(`pair ${id} missing`);
  const files = readdirSync(join(CORPUS, dir))
    .filter((f) => f.endsWith('.pdf'))
    .sort() as [string, string];
  return { id, dir: join(CORPUS, dir), files, passwords };
}

const PAIRS: Pair[] = [
  corpusPair('01'),
  corpusPair('07'),
  corpusPair('08'),
  corpusPair('11'),
  // Rev A: owner password only (opens with ''); Rev B: user password.
  corpusPair('12', ['', 'test1234']),
  corpusPair('14'),
  corpusPair('16'),
  // The same drawing at A1 and A3 (manifest: scale 0.49941, offset 0 / 0.5 pt).
  {
    ...corpusPair('15'),
    aToB: (A, B, page) => {
      const k = 0.49941;
      const ha = pageSize(mod, A.doc, page).h;
      const hb = pageSize(mod, B.doc, page).h;
      return [k, 0, 0, k, 0, hb - k * ha - 0.5];
    },
  },
  {
    id: 'stress',
    dir: join(HERE, 'out'),
    files: ['stress_A.pdf', 'stress_B.pdf'],
    passwords: ['', ''],
  },
];

interface Opened {
  pair: Pair;
  A: OpenDoc;
  B: OpenDoc;
  bytes: [Uint8Array, Uint8Array];
  pages: number;
}

function openPair(p: Pair): Opened {
  const bytes: [Uint8Array, Uint8Array] = [
    readFileSync(join(p.dir, p.files[0])),
    readFileSync(join(p.dir, p.files[1])),
  ];
  const A = openDoc(mod, bytes[0], p.passwords[0]);
  const B = openDoc(mod, bytes[1], p.passwords[1]);
  const pages = Math.min(
    call(mod, 'FPDF_GetPageCount', A.doc),
    call(mod, 'FPDF_GetPageCount', B.doc),
  );
  return { pair: p, A, B, bytes, pages };
}

/** The on-screen route for one sheet region: grey A through aToB, grey B, composed. */
function screenOverlay(
  o: Opened,
  page: number,
  z: number,
  tx: number,
  ty: number,
  w: number,
  h: number,
) {
  const aToB = o.pair.aToB?.(o.A, o.B, page);
  const ga = withPage(mod, o.A.doc, page, (pg) =>
    renderPage(mod, pg, tileMatrix(z, tx, ty, aToB), w, h, true),
  );
  const gb = withPage(mod, o.B.doc, page, (pg) =>
    renderPage(mod, pg, tileMatrix(z, tx, ty), w, h, true),
  );
  return { ga, gb };
}

// ---------------------------------------------------------------------------
// 1. Rendering without comments, through a matrix, by direct PDFium calls.
// ---------------------------------------------------------------------------
{
  // Pair 19 has review comments: none of them may reach the overlay.
  const p19 = openPair(corpusPair('19'));
  // Rev A carries the checker's comments (clouds, callout, notes, highlights).
  const commented = p19.A;
  const s = pageSize(mod, commented.doc, 0);
  const z = 0.5;
  const w = Math.round(s.w * z);
  const h = Math.round(s.h * z);
  const annots = withPage(mod, commented.doc, 0, (pg) => annotCount(mod, pg));
  const plain = withPage(mod, commented.doc, 0, (pg) =>
    renderPage(mod, pg, [z, 0, 0, z, 0, 0], w, h, false),
  );
  // With FPDF_ANNOT the comments appear: the difference shows they were left out.
  const withAnnots = withPage(mod, commented.doc, 0, (pg) => {
    const heap = mod.pdfium as unknown as {
      wasmExports: { malloc(n: number): number; free(p: number): void };
      HEAPU8: Uint8Array;
      HEAPF32: Float32Array;
    };
    const px = heap.wasmExports.malloc(w * h * 4);
    const mp = heap.wasmExports.malloc(24);
    const cp = heap.wasmExports.malloc(16);
    const bmp = call(mod, 'FPDFBitmap_CreateEx', w, h, 4, px, w * 4);
    call(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
    heap.HEAPF32.set([z, 0, 0, z, 0, 0], mp >> 2);
    heap.HEAPF32.set([0, 0, w, h], cp >> 2);
    call(mod, 'FPDF_RenderPageBitmapWithMatrix', bmp, pg, mp, cp, 0x10 | 0x01);
    const out = heap.HEAPU8.slice(px, px + w * h * 4);
    call(mod, 'FPDFBitmap_Destroy', bmp);
    heap.wasmExports.free(px);
    heap.wasmExports.free(mp);
    heap.wasmExports.free(cp);
    return out;
  });
  let differ = 0;
  for (let i = 0; i < plain.length; i += 4)
    if (plain[i] !== withAnnots[i] || plain[i + 1] !== withAnnots[i + 1]) differ++;
  note('withoutComments', { pair: '19', annotations: annots, pixelsOnlyWithAnnotFlag: differ });

  // Through a matrix: pair 15 (A1 drawn into its A3 copy's frame) must overlay
  // with almost no colour; drawn as is (identity), it cannot.
  const p15 = openPair(PAIRS.find((p) => p.id === '15') ?? corpusPair('15'));
  const sb = pageSize(mod, p15.B.doc, 0);
  const zz = 2;
  const W = Math.round(sb.w * zz);
  const Hh = Math.round(sb.h * zz);
  const { ga, gb } = screenOverlay(p15, 0, zz, 0, 0, W, Hh);
  const aligned = classify(compose(ga, gb, W, Hh, styleTables(DEFAULT_STYLE, 'neutral')));
  const raw = classify(
    compose(
      withPage(mod, p15.A.doc, 0, (pg) => renderPage(mod, pg, [zz, 0, 0, zz, 0, 0], W, Hh, true)),
      gb,
      W,
      Hh,
      styleTables(DEFAULT_STYLE, 'neutral'),
    ),
  );
  const inkShare = (c: PixelClasses) =>
    r1((100 * (c.colA + c.colB)) / Math.max(1, c.colA + c.colB + c.black + c.other));
  note('throughMatrix', {
    pair: '15',
    aligned,
    unaligned: raw,
    colouredInkPctAligned: inkShare(aligned),
    colouredInkPctUnaligned: inkShare(raw),
  });
  writeFileSync(
    join(HERE, 'out/p15-aligned.png'),
    await encodePng(
      compose(ga, gb, W, Hh, styleTables(DEFAULT_STYLE, 'neutral')) as unknown as Uint8Array,
      W,
      Hh,
    ),
  );
  for (const o of [p19, p15]) {
    o.A.close();
    o.B.close();
  }
}

// ---------------------------------------------------------------------------
// 2. Tile costs on screen: grey renders, composition, Thicken, Fade, at zooms
//    from fit to 6400 %, on the flange (pair 01) and the dense A1 sheet (14).
// ---------------------------------------------------------------------------
{
  const TILE = 512;
  const out: Record<string, unknown> = {};
  for (const id of ['01', '14']) {
    const o = openPair(PAIRS.find((p) => p.id === id) ?? corpusPair(id));
    const s = pageSize(mod, o.B.doc, 0);
    const rows: unknown[] = [];
    for (const zoom of [0.25, 1, 4, 16, 64]) {
      const z = zoom * (96 / 72); // CSS px per pt at that zoom, DPR 1
      const times = {
        greyA: [] as number[],
        greyB: [] as number[],
        compose: [] as number[],
        neutral: [] as number[],
        thicken: [] as number[],
        tables: [] as number[],
        normalView: [] as number[],
      };
      // Tiles at five spots across the sheet (the dense middle, corners).
      const spots = [
        [0.5, 0.5],
        [0.25, 0.3],
        [0.75, 0.7],
        [0.1, 0.9],
        [0.9, 0.1],
      ];
      for (const [fx, fy] of spots) {
        const tx = Math.max(0, Math.min(s.w * z - TILE, (fx ?? 0.5) * s.w * z - TILE / 2));
        const ty = Math.max(0, Math.min(s.h * z - TILE, (fy ?? 0.5) * s.h * z - TILE / 2));
        const w = Math.min(TILE, Math.round(s.w * z));
        const h = Math.min(TILE, Math.round(s.h * z));
        let t = now();
        const ga = withPage(mod, o.A.doc, 0, (pg) =>
          renderPage(mod, pg, tileMatrix(z, tx, ty), w, h, true),
        );
        times.greyA.push(now() - t);
        t = now();
        const gb = withPage(mod, o.B.doc, 0, (pg) =>
          renderPage(mod, pg, tileMatrix(z, tx, ty), w, h, true),
        );
        times.greyB.push(now() - t);
        t = now();
        withPage(mod, o.B.doc, 0, (pg) => renderPage(mod, pg, tileMatrix(z, tx, ty), w, h, false));
        times.normalView.push(now() - t);
        t = now();
        const tabs = styleTables(DEFAULT_STYLE, 'neutral');
        times.tables.push(now() - t);
        t = now();
        compose(ga, gb, w, h);
        times.compose.push(now() - t);
        t = now();
        compose(ga, gb, w, h, tabs);
        times.neutral.push(now() - t);
        // Thicken: the tile is rendered one pixel larger on each side, then cut.
        t = now();
        const m = 1;
        const ga2 = withPage(mod, o.A.doc, 0, (pg) =>
          renderPage(mod, pg, tileMatrix(z, tx - m, ty - m), w + 2 * m, h + 2 * m, true),
        );
        const gb2 = withPage(mod, o.B.doc, 0, (pg) =>
          renderPage(mod, pg, tileMatrix(z, tx - m, ty - m), w + 2 * m, h + 2 * m, true),
        );
        compose(
          crop(thicken(ga2, w + 2 * m, h + 2 * m), w + 2 * m, m, w, h),
          crop(thicken(gb2, w + 2 * m, h + 2 * m), w + 2 * m, m, w, h),
          w,
          h,
          tabs,
        );
        times.thicken.push(now() - t);
      }
      rows.push({
        zoom: `${String(zoom * 100)} %`,
        medianMs: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, r1(median(v))])),
        maxMs: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, r1(Math.max(...v))])),
      });
    }
    out[id] = rows;
    o.A.close();
    o.B.close();
  }
  note('tileCosts512', out);
}

// ---------------------------------------------------------------------------
// 3. Exact black on overlap and Thicken thin lines, measured on real sheets.
// ---------------------------------------------------------------------------
{
  const o = openPair(PAIRS.find((p) => p.id === '16') ?? corpusPair('16'));
  const s = pageSize(mod, o.B.doc, 0);
  const z = 2;
  const w = Math.round(s.w * z);
  const h = Math.round(s.h * z);
  const { ga, gb } = screenOverlay(o, 0, z, 0, 0, w, h);
  const multiply = classify(compose(ga, gb, w, h));
  const neutral = classify(compose(ga, gb, w, h, styleTables(DEFAULT_STYLE, 'neutral')));
  // Full-ink pixels (grey 0 on both): must be exactly 0,0,0.
  const rgba = compose(ga, gb, w, h);
  let full = 0;
  let exact = 0;
  for (let i = 0; i < ga.length; i++)
    if (ga[i] === 0 && gb[i] === 0) {
      full++;
      if (rgba[i * 4] === 0 && rgba[i * 4 + 1] === 0 && rgba[i * 4 + 2] === 0) exact++;
    }
  // Anti-aliased edges of unchanged lines: olive with plain Multiply, grey with neutral.
  note('identicalControl', {
    pair: '16',
    fullInkPixels: full,
    exactBlack: exact,
    multiply,
    neutral,
  });
  writeFileSync(
    join(HERE, 'out/p16-multiply.png'),
    await encodePng(rgba as unknown as Uint8Array, w, h),
  );
  o.A.close();
  o.B.close();

  // Thicken on the dense sheet at 100 %, where its lines are 1-2 px: line width in pixels.
  const d = openPair(PAIRS.find((p) => p.id === '14') ?? corpusPair('14'));
  const zz = 96 / 72;
  const sd = pageSize(mod, d.B.doc, 0);
  const T = 512;
  const m = 1;
  // Darkest-run widths of thin features along one row.
  const runs = (img: Uint8Array, W: number, y: number) => {
    const out: number[] = [];
    let run = 0;
    for (let x = 0; x < W; x++) {
      if ((img[y * W + x] ?? 255) < 200) run++;
      else if (run) {
        out.push(run);
        run = 0;
      }
    }
    return out;
  };
  // The first tile (scanning the sheet) with a row crossing two or more hairlines.
  let g: Uint8Array = new Uint8Array(0);
  let row = -1;
  let spot = [0, 0];
  scan: for (let fy = 0.15; fy < 0.9; fy += 0.07)
    for (let fx = 0.15; fx < 0.9; fx += 0.07) {
      const tx = sd.w * zz * fx;
      const ty = sd.h * zz * fy;
      g = withPage(mod, d.B.doc, 0, (pg) =>
        renderPage(mod, pg, tileMatrix(zz, tx - m, ty - m), T + 2 * m, T + 2 * m, true),
      );
      for (let y = m; y < T; y += 8)
        if (runs(g, T + 2 * m, y).filter((r) => r <= 2).length >= 2) {
          row = y;
          spot = [Math.round(fx * 100) / 100, Math.round(fy * 100) / 100];
          break scan;
        }
    }
  const thick = thicken(g, T + 2 * m, T + 2 * m);
  const before = row >= 0 ? runs(g, T + 2 * m, row) : [];
  const after = row >= 0 ? runs(thick, T + 2 * m, row) : [];
  note('thickenAt100', {
    pair: '14',
    spot,
    row,
    inkRunsBefore: before.slice(0, 12),
    inkRunsAfter: after.slice(0, 12),
  });
  writeFileSync(
    join(HERE, 'out/p14-100-thin.png'),
    await encodePng(
      compose(g, null, T + 2 * m, T + 2 * m) as unknown as Uint8Array,
      T + 2 * m,
      T + 2 * m,
    ),
  );
  writeFileSync(
    join(HERE, 'out/p14-100-thick.png'),
    await encodePng(
      compose(thick, null, T + 2 * m, T + 2 * m) as unknown as Uint8Array,
      T + 2 * m,
      T + 2 * m,
    ),
  );
  d.A.close();
  d.B.close();
}

// ---------------------------------------------------------------------------
// 4. The vector overlay builder, routes 1 and 2: the sample pack, sizes, build
//    times, and a pixel check against the on-screen overlay in PDFium.
// ---------------------------------------------------------------------------
rmSync(PACK, { recursive: true, force: true });
mkdirSync(PACK, { recursive: true });
interface PackFile {
  pair: string;
  route: Route;
  file: string;
  pages: number;
  bytes: number;
  sourceBytes: number;
  buildMs: number;
  stats: unknown;
}
const pack: PackFile[] = [];
const ROUTES: Route[] = ['wrap', 'recolour'];
const CHECK_Z = 1.5; // 108 dpi
const checks: Record<string, unknown>[] = [];
/** Reference: the on-screen route, plain Multiply (what the vector file can show). */
const references = new Map<string, { w: number; h: number; rgba: Uint8ClampedArray }>();

function diff(
  ref: Uint8ClampedArray | Uint8Array,
  got: Uint8Array,
  w: number,
  h: number,
  gw: number,
  gh: number,
) {
  const W = Math.min(w, gw);
  const Hh = Math.min(h, gh);
  let sum = 0;
  let big = 0;
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * w + x) * 4;
      const j = (y * gw + x) * 4;
      let worst = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs((ref[i + c] ?? 0) - (got[j + c] ?? 0));
        sum += d;
        if (d > worst) worst = d;
      }
      if (worst > 96) big++;
    }
  return {
    meanAbs: Math.round((sum / (W * Hh * 3)) * 1000) / 1000,
    pctOver96: Math.round((100000 * big) / (W * Hh)) / 1000,
  };
}

/** Colour classes of the reference that the engine's render lost or added (per mille of ink). */
function colourAgreement(ref: PixelClasses, got: PixelClasses) {
  const ink = Math.max(1, ref.black + ref.colA + ref.colB + ref.other);
  return {
    redRef: ref.colA,
    red: got.colA,
    greenRef: ref.colB,
    green: got.colB,
    blackRef: ref.black,
    black: got.black,
    colourDeltaPermille: Math.round(
      (1000 * (Math.abs(ref.colA - got.colA) + Math.abs(ref.colB - got.colB))) / ink,
    ),
  };
}

const deepZoom: Record<string, unknown>[] = [];
for (const p of PAIRS) {
  const o = openPair(p);
  const srcA: Source = {
    doc: o.A.doc,
    bytes: o.bytes[0],
    password: p.passwords[0],
    label: p.files[0],
  };
  const srcB: Source = {
    doc: o.B.doc,
    bytes: o.bytes[1],
    password: p.passwords[1],
    label: p.files[1],
  };
  const sheets: SheetSpec[] = Array.from({ length: o.pages }, (_, i) => ({
    a: { source: srcA, index: i },
    b: { source: srcB, index: i },
    aToB: p.aToB?.(o.A, o.B, i),
  }));
  for (let i = 0; i < Math.min(o.pages, 3); i++) {
    const s = pageSize(mod, o.B.doc, i);
    const w = Math.round(s.w * CHECK_Z);
    const h = Math.round(s.h * CHECK_Z);
    const { ga, gb } = screenOverlay(o, i, CHECK_Z, 0, 0, w, h);
    references.set(`${p.id}:${String(i)}`, { w, h, rgba: compose(ga, gb, w, h) });
  }
  for (const route of ROUTES) {
    const t0 = now();
    const { bytes, stats } = await buildVectorOverlay(mod, sheets, {
      route,
      colA: [255, 0, 0],
      colB: [0, 255, 0],
    });
    const buildMs = now() - t0;
    const file = `overlay_${p.id}_${route === 'wrap' ? 'route1-wrap' : 'route2-recolour'}.pdf`;
    writeFileSync(join(PACK, file), bytes);
    pack.push({
      pair: p.id,
      route,
      file,
      pages: o.pages,
      bytes: bytes.length,
      sourceBytes: o.bytes[0].length + o.bytes[1].length,
      buildMs: r1(buildMs),
      stats,
    });
    const V = openDoc(mod, bytes);
    for (let i = 0; i < Math.min(o.pages, 3); i++) {
      const ref = references.get(`${p.id}:${String(i)}`);
      if (!ref) continue;
      const got = withPage(mod, V.doc, i, (pg) =>
        renderPage(mod, pg, [CHECK_Z, 0, 0, CHECK_Z, 0, 0], ref.w, ref.h, false),
      );
      checks.push({
        engine: 'pdfium',
        pair: p.id,
        route,
        page: i + 1,
        ...diff(ref.rgba, got, ref.w, ref.h, ref.w, ref.h),
        ...colourAgreement(classify(ref.rgba), classify(got)),
      });
      if (i === 0)
        writeFileSync(
          join(HERE, `out/render-pdfium-${p.id}-${route}.png`),
          await encodePng(got, ref.w, ref.h),
        );
    }
    // Drawing speed at 6400 %: a 512 px tile in the middle of sheet 1.
    if (['01', '14', 'stress'].includes(p.id)) {
      const z = 64 * (96 / 72);
      const s = pageSize(mod, o.B.doc, 0);
      const spots = [
        [0.5, 0.5],
        [0.3, 0.4],
        [0.7, 0.6],
      ];
      const tVec: number[] = [];
      const tScreen: number[] = [];
      const tNormal: number[] = [];
      for (const [fx, fy] of spots) {
        const tx = (fx ?? 0.5) * s.w * z;
        const ty = (fy ?? 0.5) * s.h * z;
        let t = now();
        withPage(mod, V.doc, 0, (pg) =>
          renderPage(mod, pg, tileMatrix(z, tx, ty), 512, 512, false),
        );
        tVec.push(now() - t);
        t = now();
        const { ga, gb } = screenOverlay(o, 0, z, tx, ty, 512, 512);
        compose(ga, gb, 512, 512);
        tScreen.push(now() - t);
        t = now();
        withPage(mod, o.B.doc, 0, (pg) =>
          renderPage(mod, pg, tileMatrix(z, tx, ty), 512, 512, false),
        );
        tNormal.push(now() - t);
      }
      deepZoom.push({
        engine: 'pdfium',
        pair: p.id,
        route,
        tileMs6400: {
          vectorOverlay: r1(median(tVec)),
          screenRoute: r1(median(tScreen)),
          normalViewB: r1(median(tNormal)),
        },
      });
    }
    V.close();
  }
  o.A.close();
  o.B.close();
}
note('pack', pack);

// ---------------------------------------------------------------------------
// 5. Other engines: Poppler (pdftoppm) and pdf.js in Chromium, when present.
// ---------------------------------------------------------------------------
function readPpm(buf: Buffer): { w: number; h: number; rgba: Uint8Array } {
  // P6 <w> <h> 255\n<rgb>
  let pos = 0;
  const fields: string[] = [];
  while (fields.length < 4) {
    while (buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09) pos++;
    let s = '';
    while (pos < buf.length && ![0x20, 0x0a, 0x0d, 0x09].includes(buf[pos] ?? 0))
      s += String.fromCharCode(buf[pos++] ?? 0);
    fields.push(s);
  }
  pos++;
  const w = Number(fields[1]);
  const h = Number(fields[2]);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = buf[pos + i * 3] ?? 0;
    rgba[i * 4 + 1] = buf[pos + i * 3 + 1] ?? 0;
    rgba[i * 4 + 2] = buf[pos + i * 3 + 2] ?? 0;
    rgba[i * 4 + 3] = 255;
  }
  return { w, h, rgba };
}

let poppler = false;
try {
  execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
  poppler = true;
} catch {
  /* not installed */
}
if (poppler) {
  const tmp = join(tmpdir(), 's29-poppler');
  mkdirSync(tmp, { recursive: true });
  for (const f of pack) {
    for (let i = 0; i < Math.min(f.pages, 3); i++) {
      const ref = references.get(`${f.pair}:${String(i)}`);
      if (!ref) continue;
      const base = join(tmp, 'p');
      execFileSync('pdftoppm', [
        '-r',
        String(CHECK_Z * 72),
        '-f',
        String(i + 1),
        '-l',
        String(i + 1),
        '-singlefile',
        join(PACK, f.file),
        base,
      ]);
      const img = readPpm(readFileSync(`${base}.ppm`));
      checks.push({
        engine: 'poppler',
        pair: f.pair,
        route: f.route,
        page: i + 1,
        ...diff(ref.rgba, img.rgba, ref.w, ref.h, img.w, img.h),
        ...colourAgreement(classify(ref.rgba), classify(img.rgba)),
      });
    }
    if (['01', '14', 'stress'].includes(f.pair)) {
      // 6400 %: a 512 px window in the middle, whole process (start-up included).
      const dpi = 64 * 96;
      const ref = references.get(`${f.pair}:0`);
      if (!ref) continue;
      const W = (ref.w / CHECK_Z) * 64 * (96 / 72);
      const H = (ref.h / CHECK_Z) * 64 * (96 / 72);
      const zoomTile = (file: string) => {
        const t0 = now();
        execFileSync('pdftoppm', [
          '-r',
          String(dpi),
          '-f',
          '1',
          '-l',
          '1',
          '-x',
          String(Math.round(W / 2)),
          '-y',
          String(Math.round(H / 2)),
          '-W',
          '512',
          '-H',
          '512',
          '-singlefile',
          file,
          join(tmp, 'z'),
        ]);
        return r1(now() - t0);
      };
      const src = PAIRS.find((p) => p.id === f.pair);
      const normal = src ? zoomTile(join(src.dir, src.files[1])) : undefined;
      deepZoom.push({
        engine: 'poppler',
        pair: f.pair,
        route: f.route,
        tileMs6400: { vectorOverlay: zoomTile(join(PACK, f.file)), normalViewB: normal },
      });
    }
  }
}

if (PDFJS_DIR && existsSync(join(PDFJS_DIR, 'node_modules/pdfjs-dist/build/pdf.mjs'))) {
  const srv = spawn('python3', ['-m', 'http.server', '4291', '--bind', '127.0.0.1'], {
    cwd: PDFJS_DIR,
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 800));
  writeFileSync(
    join(PDFJS_DIR, 's29.html'),
    `<!doctype html><canvas id="c"></canvas><script type="module">
import * as pdfjs from './node_modules/pdfjs-dist/build/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = './node_modules/pdfjs-dist/build/pdf.worker.mjs';
window.renderPdf = async (url, pageNo, scale, region) => {
  const doc = await pdfjs.getDocument({ url, standardFontDataUrl: './node_modules/pdfjs-dist/standard_fonts/' }).promise;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale });
  const c = document.getElementById('c');
  let w = Math.round(vp.width), h = Math.round(vp.height), transform;
  if (region) { w = region[2]; h = region[3]; transform = [1, 0, 0, 1, -region[0], -region[1]]; }
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const t0 = performance.now();
  await page.render({ canvasContext: ctx, viewport: vp, transform, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
  const ms = performance.now() - t0;
  const d = ctx.getImageData(0, 0, w, h).data;
  let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  await doc.destroy();
  return { w, h, ms, rgba: btoa(s) };
};
window.ready = true;
</script>`,
  );
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
      : {},
  );
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4291/s29.html');
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
  const pjsVersion = (
    JSON.parse(readFileSync(join(PDFJS_DIR, 'node_modules/pdfjs-dist/package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  for (const f of pack) {
    copyFileSync(join(PACK, f.file), join(PDFJS_DIR, f.file));
    for (let i = 0; i < Math.min(f.pages, 3); i++) {
      const ref = references.get(`${f.pair}:${String(i)}`);
      if (!ref) continue;
      const r = await page.evaluate(
        ([u, n, sc]) =>
          (
            window as unknown as {
              renderPdf: (
                u: string,
                n: number,
                s: number,
              ) => Promise<{ w: number; h: number; ms: number; rgba: string }>;
            }
          ).renderPdf(u, n, sc),
        [`./${f.file}`, i + 1, CHECK_Z] as [string, number, number],
      );
      const rgba = Uint8Array.from(Buffer.from(r.rgba, 'base64'));
      checks.push({
        engine: `pdf.js ${pjsVersion}`,
        pair: f.pair,
        route: f.route,
        page: i + 1,
        ...diff(ref.rgba, rgba, ref.w, ref.h, r.w, r.h),
        ...colourAgreement(classify(ref.rgba), classify(rgba)),
      });
      if (i === 0)
        writeFileSync(
          join(HERE, `out/render-pdfjs-${f.pair}-${f.route}.png`),
          await encodePng(rgba, r.w, r.h),
        );
    }
    if (['01', '14', 'stress'].includes(f.pair)) {
      const ref = references.get(`${f.pair}:0`);
      if (!ref) continue;
      const sc = 64 * (96 / 72);
      const W = (ref.w / CHECK_Z) * sc;
      const H = (ref.h / CHECK_Z) * sc;
      const zoomTile = async (u: string) =>
        (
          await page.evaluate(
            ([u, s, reg]) =>
              (
                window as unknown as {
                  renderPdf: (
                    u: string,
                    n: number,
                    s: number,
                    r: number[],
                  ) => Promise<{ ms: number }>;
                }
              ).renderPdf(u, 1, s, reg),
            [u, sc, [Math.round(W / 2), Math.round(H / 2), 512, 512]] as [string, number, number[]],
          )
        ).ms;
      const src = PAIRS.find((p) => p.id === f.pair);
      let normal: number | undefined;
      if (src) {
        copyFileSync(join(src.dir, src.files[1]), join(PDFJS_DIR, `src-${f.pair}.pdf`));
        normal = r1(await zoomTile(`./src-${f.pair}.pdf`));
      }
      deepZoom.push({
        engine: `pdf.js ${pjsVersion}`,
        pair: f.pair,
        route: f.route,
        tileMs6400: { vectorOverlay: r1(await zoomTile(`./${f.file}`)), normalViewB: normal },
      });
    }
  }
  await browser.close();
  srv.kill();
}
note('engineChecks', checks);
note('deepZoom', deepZoom);

mkdirSync(join(ROOT, 'test-results'), { recursive: true });
writeFileSync(RESULTS, JSON.stringify(results, null, 2));
console.log('results →', RESULTS, '· pack →', PACK);
