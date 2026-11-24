// Spike S32 (M13-03, D-69): Thin Lines, three routes, on the PDFium WASM and
// the EmbedPDF engine the app ships, with the app's own save code.
//
//   node --expose-gc --import ./spikes/shared/ts-ext.ts spikes/s32-thin-lines/run-node.ts [width|saves|perf|all]
//
// Routes (plan §3):
//   a  "toggle": set stroke widths to 0 around each tile render on the app's
//      own document (Render worker) and put them back right after;
//   b  "copy": a second, view-only load of the document (original bytes plus
//      the tail) in the Render worker, its pages kept thin;
//   c  "work": thin tiles from the Work worker (its own PDFium; measured as a
//      second module instance, plus what the Work worker's queue means).
// Writes test-results/s32-node.json.
/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style -- WASM exports and test pages known to exist (spike code) */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject, PdfPageObject, Rect } from '@embedpdf/models';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { a0Sheet } from '../../e2e/fixtures/generate.ts';
import { planFlatten } from '../../src/features/annotate/flatten/flattenModel.ts';
import { applyPageOp } from '../../src/workers/render/pages.ts';
import { acquirePage, docPtrOf, purgePageCache } from '../../src/workers/render/pdfium.ts';
import { SaveTracker } from '../../src/workers/render/save/tracker.ts';
import { encodePng } from '../../src/workers/work/png.ts';
import { currentSection, openBufferCopy, openSharedCopy, type SharedCopy } from './copy.ts';
import { bigFilePdf, cadSheetPdf, PROBE, probePdf } from './fixtures.ts';
import { differingPixels, inkAcrossH, inkAcrossV, renderWindow } from './pixels.ts';
import { call, collectStrokes, restore, thin, type StrokeList } from './thin.ts';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS = join(ROOT, 'Synthetic PDF Corpus/engineering_pdf_overlay_test_corpus/');
const OUT = join(ROOT, 'test-results/s32-node.json');
const require = createRequire(import.meta.url);
const wasmBinary = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));

async function engine(): Promise<{ mod: WrappedPdfiumModule; native: PdfiumNative }> {
  const mod = await init({ wasmBinary });
  const native = new PdfiumNative(mod, { fontFallback: null });
  return { mod, native };
}

const memBytes = (mod: WrappedPdfiumModule): number =>
  (mod.pdfium.wasmExports as unknown as { memory: WebAssembly.Memory }).memory.buffer.byteLength;

let seq = 0;
async function open(
  native: PdfiumNative,
  bytes: Uint8Array,
  tracker?: SaveTracker,
): Promise<PdfDocumentObject> {
  const id = `d${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, { normalizeRotation: true })
    .toPromise();
  if (tracker) {
    tracker.opened(id, bytes);
    await tracker.securityReady(id);
  }
  return doc;
}

const corpus = (pair: string, file: string): Uint8Array =>
  new Uint8Array(readFileSync(join(CORPUS, pair, file)));

const FIXTURES: { name: string; bytes: () => Uint8Array }[] = [
  {
    name: 'pair 08 P&ID hairlines (RevB)',
    bytes: () => corpus('pair_08_pid_microtext_hairline', '08_pid_microtext_hairline_RevB_NEW.pdf'),
  },
  {
    name: 'pair 14 dense A1 plot plan (RevB)',
    bytes: () => corpus('pair_14_dense_a1_plot_plan', '14_dense_a1_plot_plan_RevB_NEW.pdf'),
  },
  {
    name: 'pair 16 identical control (RevA)',
    bytes: () => corpus('pair_16_identical_control', '16_identical_control_RevA_OLD.pdf'),
  },
  { name: 'A0 sheet, 200k segments in paths of 50 (e2e a0Sheet)', bytes: () => a0Sheet(200_000) },
  {
    name: 'A0 CAD sheet, 100k one-line paths + 2,000 blocks (self-made)',
    bytes: () => cadSheetPdf(100_000, 2_000),
  },
];

// ------------------------------------------------------------------ tiles

const TILE = 256;

/** The 256 px tiles a 1920 × 1080 window shows around the page centre at `scale`. */
function viewportTiles(page: PdfPageObject, scale: number): Rect[] {
  const vw = 1920 / scale;
  const vh = 1080 / scale;
  const pw = page.size.width;
  const ph = page.size.height;
  const x0 = Math.max(0, (pw - vw) / 2);
  const y0 = Math.max(0, (ph - vh) / 2);
  const x1 = Math.min(pw, x0 + vw);
  const y1 = Math.min(ph, y0 + vh);
  const t = TILE / scale;
  const out: Rect[] = [];
  for (let ty = Math.floor(y0 / t); ty * t < y1; ty++)
    for (let tx = Math.floor(x0 / t); tx * t < x1; tx++) {
      const ox = tx * t;
      const oy = ty * t;
      out.push({
        origin: { x: ox, y: oy },
        size: { width: Math.min(t, pw - ox), height: Math.min(t, ph - oy) },
      });
    }
  return out;
}

async function renderTile(
  native: PdfiumNative,
  doc: PdfDocumentObject,
  page: PdfPageObject,
  rect: Rect,
  scale: number,
) {
  return native.renderPageRect(doc, page, rect, { scaleFactor: scale, dpr: 1 }).toPromise();
}

/** Route a: walk, thin, render, put back — all in one Render-worker message. */
async function renderTileThinA(
  mod: WrappedPdfiumModule,
  native: PdfiumNative,
  doc: PdfDocumentObject,
  page: PdfPageObject,
  rect: Rect,
  scale: number,
  cached?: Map<number, StrokeList>,
): Promise<{ walkMs: number; toggleMs: number }> {
  const ref = acquirePage(native, doc.id, page.index);
  let walkMs = 0;
  let toggleMs = 0;
  try {
    let t = performance.now();
    let list = cached?.get(ref.pagePtr);
    if (!list) {
      list = collectStrokes(mod, ref.pagePtr);
      cached?.set(ref.pagePtr, list);
    }
    walkMs = performance.now() - t;
    t = performance.now();
    thin(mod, list);
    toggleMs = performance.now() - t;
    try {
      await renderTile(native, doc, page, rect, scale);
    } finally {
      t = performance.now();
      restore(mod, list);
      toggleMs += performance.now() - t;
    }
  } finally {
    ref.release();
  }
  return { walkMs, toggleMs };
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    mean: +(sum / Math.max(1, s.length)).toFixed(2),
    p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2),
    max: +(s[s.length - 1] ?? 0).toFixed(2),
    total: +sum.toFixed(1),
  };
};

// ------------------------------------------------------------------ width

async function widthCheck() {
  const { mod, native } = await engine();
  const doc = await open(native, probePdf());
  const ref = acquirePage(native, doc.id, 0);
  const page = ref.pagePtr;
  const list = collectStrokes(mod, page);
  const rows: Record<string, unknown>[] = [];
  for (const scale of [0.25, 1, 4, 16]) {
    const row: Record<string, unknown> = { scale };
    for (const [k, pt] of Object.entries(PROBE)) {
      const measure = k === 'vertical' ? inkAcrossV : inkAcrossH;
      const before = renderWindow(mod, page, 842, pt.x, pt.y, scale, { annots: true });
      thin(mod, list);
      const on = renderWindow(mod, page, 842, pt.x, pt.y, scale, { annots: true });
      restore(mod, list);
      const after = renderWindow(mod, page, 842, pt.x, pt.y, scale, { annots: true });
      row[k] = {
        normal: +measure(before).toFixed(2),
        thin: +measure(on).toFixed(2),
        changedPx: differingPixels(before, on),
        afterRestoreChangedPx: differingPixels(before, after),
      };
    }
    rows.push(row);
  }
  // The whole page at 2 px/pt: back to the same pixels after the restore.
  const whole = (opts: { annots: boolean }) =>
    renderWindow(mod, page, 842, 297.5, 421, 2, { wPt: 595, hPt: 842, ...opts });
  const a = whole({ annots: true });
  thin(mod, list);
  const b = whole({ annots: true });
  restore(mod, list);
  const c = whole({ annots: true });
  ref.release();
  return {
    strokes: list.objects.length,
    forms: list.forms,
    widthsInFile: [...list.widths],
    rows,
    wholePage: {
      changedPxThin: differingPixels(a, b),
      changedPxAfterRestore: differingPixels(a, c),
    },
  };
}

// ------------------------------------------------------------------ saves

const hex = (b: Uint8Array) => {
  let h = 0x811c9dc5;
  for (const x of b) h = Math.imul(h ^ x, 0x01000193) >>> 0;
  return `${String(b.length)}:${h.toString(16)}`;
};

/**
 * Route b's view-only copy (copy.ts): the opened bytes plus PDFium's
 * incremental section for the current state, opened as a second document;
 * each loaded page of it is made thin once and kept thin. It is never edited
 * by the app and never saved. Reopened when page content changes.
 */
class ThinCopy {
  doc: PdfDocumentObject | null = null;
  private shared: SharedCopy | null = null;
  private lists = new Map<number, StrokeList>();
  refreshes = 0;
  refreshMs: number[] = [];
  private readonly mod: WrappedPdfiumModule;
  private readonly native: PdfiumNative;
  private readonly original: PdfDocumentObject;
  private readonly opened: Uint8Array;
  private readonly kind: 'buffer' | 'shared';
  constructor(
    mod: WrappedPdfiumModule,
    native: PdfiumNative,
    original: PdfDocumentObject,
    opened: Uint8Array,
    kind: 'buffer' | 'shared',
  ) {
    this.mod = mod;
    this.native = native;
    this.original = original;
    this.opened = opened;
    this.kind = kind;
  }

  async close(): Promise<void> {
    if (this.shared) await this.shared.close();
    else if (this.doc) await this.native.closeDocument(this.doc).toPromise();
    this.shared = null;
    this.doc = null;
    this.lists.clear();
  }

  async refresh(): Promise<void> {
    const t = performance.now();
    await this.close();
    const id = `${this.original.id}-thin${String(++this.refreshes)}`;
    const section = currentSection(
      this.mod,
      this.native,
      this.original.id,
      this.opened.length,
      this.opened,
    );
    if (this.kind === 'shared') {
      this.shared = openSharedCopy(
        this.mod,
        this.native,
        this.original,
        id,
        this.opened.length,
        section,
      );
      this.doc = this.shared.doc;
    } else {
      this.doc = await openBufferCopy(this.native, id, this.opened, section);
    }
    this.refreshMs.push(performance.now() - t);
  }

  /** The copy's page, thin (walked once per page load: EmbedPDF reloads a page after 5 s idle). */
  private thinPage(index: number): void {
    if (!this.doc) throw new Error('copy not open');
    const ref = acquirePage(this.native, this.doc.id, index);
    try {
      if (!this.lists.has(ref.pagePtr)) {
        const l = collectStrokes(this.mod, ref.pagePtr);
        thin(this.mod, l);
        this.lists.set(ref.pagePtr, l);
      }
    } finally {
      ref.release();
    }
  }

  async tile(index: number, rect: Rect, scale: number) {
    if (!this.doc) await this.refresh();
    this.thinPage(index);
    const doc = this.doc as PdfDocumentObject;
    return renderTile(this.native, doc, doc.pages[index] as PdfPageObject, rect, scale);
  }

  /** The copy with its widths put back draws exactly what the original draws. */
  async inSync(orig: PdfDocumentObject, index: number, rect: Rect, scale: number): Promise<number> {
    if (!this.doc) await this.refresh();
    this.thinPage(index);
    const doc = this.doc as PdfDocumentObject;
    const ref = acquirePage(this.native, doc.id, index);
    const list = this.lists.get(ref.pagePtr) as StrokeList;
    restore(this.mod, list);
    try {
      const a = await renderTile(this.native, doc, doc.pages[index] as PdfPageObject, rect, scale);
      const b = await renderTile(
        this.native,
        orig,
        orig.pages[index] as PdfPageObject,
        rect,
        scale,
      );
      let diff = 0;
      for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
      return diff;
    } finally {
      thin(this.mod, list);
      ref.release();
    }
  }
}

type SaveMode = 'plain' | 'a' | 'aPurge' | 'b' | 'bBuffer';

/**
 * The same edits on copies of a file, viewed with plain tiles or one of the
 * thin routes in between, then every save path the Render worker has: Ctrl+S
 * (narrow tail), Ctrl+S keep-all, the recovery / Work-worker snapshot, Save
 * Optimized (full rewrite), and Flatten Comments followed by Ctrl+S and Save
 * Optimized. A second plain run shows the saves are deterministic at all.
 * Route "aPurge" is route a plus dropping the page from EmbedPDF's cache after
 * every thin tile (so no changed flag survives into an edit).
 */
async function savesCheck(name: string, bytes: Uint8Array) {
  const { mod, native } = await engine();
  const tracker = new SaveTracker(mod, native);
  const run = async (mode: SaveMode) => {
    const doc = await open(native, bytes, tracker);
    const page = doc.pages[0];
    if (!page) throw new Error('no page');
    const copy =
      mode === 'b' || mode === 'bBuffer'
        ? new ThinCopy(mod, native, doc, bytes, mode === 'b' ? 'shared' : 'buffer')
        : null;
    const scale = Math.min(1920 / page.size.width, 1080 / page.size.height) * 2;
    const rects = viewportTiles(page, scale).slice(0, 12);
    let outOfSyncPx = 0;
    const view = async () => {
      for (const rect of rects) {
        if (mode === 'a' || mode === 'aPurge') {
          await renderTileThinA(mod, native, doc, page, rect, scale);
          if (mode === 'aPurge') purgePageCache(native, doc.id);
        } else if (copy) {
          await copy.tile(0, rect, scale);
          outOfSyncPx += await copy.inSync(doc, 0, rect, scale);
        } else await renderTile(native, doc, page, rect, scale);
      }
    };
    await view();
    // An edit: a square comment, as the Comment tools make it. Tiles have no
    // comments (annotation tiles draw them), so route b needs no refresh here.
    const square = {
      id: 's32-square',
      type: PdfAnnotationSubtype.SQUARE,
      pageIndex: 0,
      rect: { origin: { x: 100, y: 100 }, size: { width: 80, height: 40 } },
      strokeColor: '#E44234',
      color: 'transparent',
      strokeWidth: 3,
      opacity: 1,
      flags: ['print'],
      author: 'S32',
      created: new Date(Date.UTC(2026, 10, 24)),
      modified: new Date(Date.UTC(2026, 10, 24)),
    };
    const args = [doc, page, square] as const;
    tracker.checkAllowed('createPageAnnotation', doc.id, [...args]);
    await native.createPageAnnotation(doc, page, square as never).toPromise();
    tracker.recordMutation('createPageAnnotation', [...args]);
    await view();
    const out: Record<string, string> = {};
    out.ctrlS = hex((await tracker.save(doc.id)).tail);
    out.ctrlSKeepAll = hex((await tracker.save(doc.id, { keepAll: true })).tail);
    out.snapshot = hex((await tracker.snapshot(doc.id)).tail);
    out.saveOptimized = hex(tracker.saveRewrite(doc.id));
    // Flatten Comments on page 1 (a page operation; it purges the page cache first).
    const batch = await native.getAnnotationsBatch(doc, doc.pages).toPromise();
    const list = Object.values(batch).flat();
    const plan = planFlatten(
      list.map((a) => ({ ...a, stateModel: (a as { stateModel?: string }).stateModel })),
      { scope: { kind: 'pages', pages: [0] }, keepReplies: false },
    );
    const noop = { signal: new AbortController().signal, progress: () => undefined };
    if (plan.pages.length > 0)
      await applyPageOp(mod, native, doc.id, { kind: 'flatten', pages: plan.pages }, noop);
    // Page content changed: route b reopens its copy.
    if (copy) await copy.refresh();
    await view();
    out.flattenThenCtrlS = hex((await tracker.save(doc.id)).tail);
    out.flattenThenSaveOptimized = hex(tracker.saveRewrite(doc.id));
    await copy?.close();
    return { out, outOfSyncPx, refreshes: copy?.refreshes ?? 0 };
  };
  const plain = (await run('plain')).out;
  const plain2 = (await run('plain')).out;
  const same = (o: Record<string, string>) => Object.keys(plain).every((k) => plain[k] === o[k]);
  const a = (await run('a')).out;
  const aPurge = (await run('aPurge')).out;
  const b = await run('b');
  const bBuffer = await run('bBuffer');
  return {
    name,
    deterministic: same(plain2),
    routeA_sameBytes: same(a),
    routeAPurge_sameBytes: same(aPurge),
    routeB_sameBytes: same(b.out),
    routeB_copyOutOfSyncPx: b.outOfSyncPx,
    routeBBuffer_sameBytes: same(bBuffer.out),
    routeBBuffer_copyOutOfSyncPx: bBuffer.outOfSyncPx,
    routeB_refreshes: b.refreshes,
    plain,
    routeA: a,
  };
}

/**
 * The hazard behind route a: PDFium marks every object whose width was set as
 * changed, and putting the width back does not clear that. If anything calls
 * FPDFPage_GenerateContent on the SAME loaded page afterwards (without a
 * fresh load, which flatten does), PDFium rewrites those content streams.
 */
async function dirtyHazard() {
  const { mod, native } = await engine();
  const tracker = new SaveTracker(mod, native);
  const one = async (toggle: boolean) => {
    const doc = await open(native, probePdf(), tracker);
    const ref = acquirePage(native, doc.id, 0);
    try {
      if (toggle) {
        const list = collectStrokes(mod, ref.pagePtr);
        thin(mod, list);
        restore(mod, list);
      }
      call(mod, 'FPDFPage_GenerateContent', ref.pagePtr);
    } finally {
      ref.release();
    }
    const bytes = tracker.saveRewrite(doc.id);
    // A fresh load of the page after a purge: no change flags left.
    purgePageCache(native, doc.id);
    const ref2 = acquirePage(native, doc.id, 0);
    call(mod, 'FPDFPage_GenerateContent', ref2.pagePtr);
    ref2.release();
    return { bytes: hex(bytes), afterReload: hex(tracker.saveRewrite(doc.id)) };
  };
  const plain = await one(false);
  const toggled = await one(true);
  return {
    generateContentOnSamePage: {
      plain: plain.bytes,
      toggled: toggled.bytes,
      same: plain.bytes === toggled.bytes,
    },
    afterFreshLoad: { plain: plain.afterReload, toggled: toggled.afterReload },
  };
}

/** Route b on an encrypted file (pair 12 Rev B, AES-256, open password): the copy opens with it. */
async function encryptedCheck() {
  const { mod, native } = await engine();
  const bytes = corpus('pair_12_encrypted_bridge_pier', '12_encrypted_bridge_pier_RevB_NEW.pdf');
  const id = `d${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer(
      { id, content: bytes.slice().buffer },
      { normalizeRotation: true, password: 'test1234' },
    )
    .toPromise();
  const page = doc.pages[0] as PdfPageObject;
  const section = currentSection(mod, native, doc.id, bytes.length, bytes);
  const copy = openSharedCopy(mod, native, doc, `${id}-thin`, bytes.length, section, 'test1234');
  const ref = acquirePage(native, copy.doc.id, 0);
  const list = collectStrokes(mod, ref.pagePtr);
  ref.release();
  const fit = Math.min(1920 / page.size.width, 1080 / page.size.height);
  let diff = 0;
  for (const rect of viewportTiles(page, fit)) {
    const a = await renderTile(native, doc, page, rect, fit);
    const b = await renderTile(native, copy.doc, copy.doc.pages[0] as PdfPageObject, rect, fit);
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
  }
  await copy.close();
  return { pages: doc.pageCount, strokedPaths: list.objects.length, copyOutOfSyncBytes: diff };
}

// ------------------------------------------------------------------ perf

async function perfOne(name: string, bytes: Uint8Array) {
  const { mod, native } = await engine();
  const tracker = new SaveTracker(mod, native);
  const doc = await open(native, bytes, tracker);
  const page = doc.pages[0];
  if (!page) throw new Error('no page');
  const docPtr = docPtrOf(native, doc.id);

  // Page parse (a fresh FPDF_LoadPage), and one walk.
  let t = performance.now();
  const raw = call(mod, 'FPDF_LoadPage', docPtr, 0);
  const loadMs = performance.now() - t;
  t = performance.now();
  const list = collectStrokes(mod, raw);
  const walkMs = performance.now() - t;
  t = performance.now();
  thin(mod, list);
  restore(mod, list);
  const toggleMs = performance.now() - t;
  call(mod, 'FPDF_ClosePage', raw);

  const fit = Math.min(1920 / page.size.width, 1080 / page.size.height);
  const zooms = [
    { label: 'fit', scale: fit },
    { label: '100%', scale: 1 },
    { label: '400%', scale: 4 },
  ];
  const byZoom: Record<string, unknown>[] = [];
  // Warm the page cache once (the first tile parses the page).
  await renderTile(native, doc, page, viewportTiles(page, fit)[0] as Rect, fit);

  // Route b: the view-only copy on the original's bytes (copy.ts "shared"), kept thin.
  const copy = new ThinCopy(mod, native, doc, bytes, 'shared');
  t = performance.now();
  await copy.refresh();
  const copyOpenMs = performance.now() - t;
  t = performance.now();
  await copy.tile(0, viewportTiles(page, fit)[0] as Rect, fit);
  const copyFirstTileMs = performance.now() - t;

  for (const z of zooms) {
    const tiles = viewportTiles(page, z.scale);
    const base: number[] = [];
    const aWalk: number[] = [];
    const aCached: number[] = [];
    const aToggle: number[] = [];
    const aPurge: number[] = [];
    const b: number[] = [];
    const cache = new Map<number, StrokeList>();
    for (const rect of tiles) {
      t = performance.now();
      await renderTile(native, doc, page, rect, z.scale);
      base.push(performance.now() - t);
      t = performance.now();
      await renderTileThinA(mod, native, doc, page, rect, z.scale);
      aWalk.push(performance.now() - t);
      t = performance.now();
      const r = await renderTileThinA(mod, native, doc, page, rect, z.scale, cache);
      aCached.push(performance.now() - t);
      aToggle.push(r.toggleMs);
      if (aPurge.length < 8) {
        // Route a made save-safe by dropping the page after each thin tile: the next parses it again.
        t = performance.now();
        await renderTileThinA(mod, native, doc, page, rect, z.scale);
        purgePageCache(native, doc.id);
        await renderTile(native, doc, page, rect, z.scale);
        aPurge.push(performance.now() - t - (base[base.length - 1] ?? 0));
        cache.clear();
      }
      t = performance.now();
      await copy.tile(0, rect, z.scale);
      b.push(performance.now() - t);
    }
    byZoom.push({
      zoom: z.label,
      scale: +z.scale.toFixed(3),
      tiles: tiles.length,
      baseline: stats(base),
      routeA_walkEachTile: stats(aWalk),
      routeA_cachedWalk: stats(aCached),
      routeA_toggleOnly: stats(aToggle),
      routeA_purgeAfterEachTile_first8: stats(aPurge),
      routeB_copy: stats(b),
    });
  }

  // Route c: a second PDFium instance (the Work worker's), cold.
  t = performance.now();
  const work = await engine();
  const workInitMs = performance.now() - t;
  const workMem0 = memBytes(work.mod);
  t = performance.now();
  const wdoc = await open(work.native, bytes);
  const wref = acquirePage(work.native, wdoc.id, 0);
  const wl = collectStrokes(work.mod, wref.pagePtr);
  thin(work.mod, wl);
  wref.release();
  const workFirstPageMs = performance.now() - t;
  await copy.close();
  // What a thin tile from the Work worker would wait for: its jobs yield at page
  // boundaries, and some draw a whole page in one call (OCR raster, Compare).
  t = performance.now();
  const whole = await native
    .renderPageRect(
      doc,
      page,
      { origin: { x: 0, y: 0 }, size: page.size },
      { scaleFactor: 150 / 72, dpr: 1 },
    )
    .toPromise();
  const wholePage150DpiMs = performance.now() - t;
  const wholePageMpx = (whole.width * whole.height) / 1e6;
  const wtimes: number[] = [];
  for (const rect of viewportTiles(page, fit)) {
    t = performance.now();
    await renderTile(work.native, wdoc, wdoc.pages[0] as PdfPageObject, rect, fit);
    wtimes.push(performance.now() - t);
  }
  return {
    name,
    page: { w: Math.round(page.size.width), h: Math.round(page.size.height) },
    fileKB: Math.round(bytes.length / 1024),
    objectsVisited: list.visited,
    strokedPaths: list.objects.length,
    formPlacements: list.forms,
    pageLoadMs: +loadMs.toFixed(1),
    walkMs: +walkMs.toFixed(1),
    thinAndRestoreMs: +toggleMs.toFixed(1),
    routeB: {
      openCopyMs: +copyOpenMs.toFixed(1),
      firstTileMs: +copyFirstTileMs.toFixed(1),
    },
    routeC: {
      engineInitMs: +workInitMs.toFixed(0),
      openPageThinMs: +workFirstPageMs.toFixed(1),
      heapForDocMB: +((memBytes(work.mod) - workMem0) / 2 ** 20).toFixed(1),
      fitTiles: stats(wtimes),
      workUnit_wholePage150DpiMs: +wholePage150DpiMs.toFixed(0),
      workUnit_megapixels: +wholePageMpx.toFixed(1),
    },
    byZoom,
  };
}

// ------------------------------------------------------------------ memory

/**
 * WASM heap size (what the worker really holds) with the document open and
 * one tile drawn, then with route b's copy (both ways of opening it) and one
 * thin tile drawn, each in a fresh engine; route c as a second engine.
 */
async function memoryOne(name: string, bytes: Uint8Array) {
  const MB = (n: number) => +(n / 2 ** 20).toFixed(1);
  const variant = async (kind: 'none' | 'buffer' | 'shared' | 'sharedNoChange') => {
    const { mod, native } = await engine();
    const doc = await open(native, bytes);
    const page = doc.pages[0] as PdfPageObject;
    const fit = Math.min(1920 / page.size.width, 1080 / page.size.height);
    const rect = viewportTiles(page, fit)[0] as Rect;
    await renderTile(native, doc, page, rect, fit);
    const before = memBytes(mod);
    let refreshMs = 0;
    if (kind === 'sharedNoChange') {
      // Page content unchanged since opening (comments do not count): no section, no save.
      const t = performance.now();
      const c = openSharedCopy(mod, native, doc, `${doc.id}-thin`, bytes.length, new Uint8Array(0));
      refreshMs = performance.now() - t;
      const ref = acquirePage(native, c.doc.id, 0);
      thin(mod, collectStrokes(mod, ref.pagePtr));
      ref.release();
      await renderTile(native, c.doc, c.doc.pages[0] as PdfPageObject, rect, fit);
    } else if (kind !== 'none') {
      const copy = new ThinCopy(mod, native, doc, bytes, kind);
      await copy.refresh();
      refreshMs = copy.refreshMs[0] ?? 0;
      await copy.tile(0, rect, fit);
    }
    return { before: MB(before), after: MB(memBytes(mod)), refreshMs: +refreshMs.toFixed(1) };
  };
  const gc = () => (globalThis as { gc?: () => void }).gc?.();
  // Timing first, in a fresh engine (the later variants keep several engines alive).
  const shared = await variant('shared');
  gc();
  const sharedNoChange = await variant('sharedNoChange');
  gc();
  const none = await variant('none');
  gc();
  const buffer = await variant('buffer');
  gc();
  const work = await engine();
  const empty = memBytes(work.mod);
  const wdoc = await open(work.native, bytes);
  const wpage = wdoc.pages[0] as PdfPageObject;
  const ref = acquirePage(work.native, wdoc.id, 0);
  thin(work.mod, collectStrokes(work.mod, ref.pagePtr));
  ref.release();
  const fit = Math.min(1920 / wpage.size.width, 1080 / wpage.size.height);
  await renderTile(work.native, wdoc, wpage, viewportTiles(wpage, fit)[0] as Rect, fit);
  return {
    name,
    fileMB: MB(bytes.length),
    heapMB_documentOnly: none.after,
    heapMB_routeB_bufferCopy: buffer.after,
    heapMB_routeB_sharedCopy: shared.after,
    heapMB_routeB_sharedCopyNoContentChange: sharedNoChange.after,
    routeB_openCopyMs: {
      buffer: buffer.refreshMs,
      shared: shared.refreshMs,
      sharedNoContentChange: +sharedNoChange.refreshMs.toFixed(1),
    },
    heapMB_routeC_secondEngine: { emptyEngine: MB(empty), withDocument: MB(memBytes(work.mod)) },
  };
}

// ------------------------------------------------------------------ pictures

/**
 * Side-by-side pictures for the owner (out/, not committed): the same window
 * of a page drawn as it is and with Thin Lines (route b), 2 device px per CSS px.
 */
async function pictures() {
  const dir = join(HERE, 'out/');
  mkdirSync(dir, { recursive: true });
  const { mod, native } = await engine();
  const shots: { file: string; bytes: Uint8Array; rect: Rect; scale: number }[] = [
    {
      file: '01-probe-page',
      bytes: probePdf(),
      rect: { origin: { x: 20, y: 60 }, size: { width: 560, height: 440 } },
      scale: 1.5,
    },
    {
      file: '02-pair14-dense-a1-400pct',
      bytes: corpus('pair_14_dense_a1_plot_plan', '14_dense_a1_plot_plan_RevB_NEW.pdf'),
      rect: { origin: { x: 1000, y: 700 }, size: { width: 160, height: 100 } },
      scale: 4,
    },
    {
      file: '03-pair08-pid-200pct',
      bytes: corpus('pair_08_pid_microtext_hairline', '08_pid_microtext_hairline_RevB_NEW.pdf'),
      rect: { origin: { x: 200, y: 250 }, size: { width: 320, height: 200 } },
      scale: 2,
    },
  ];
  const written: string[] = [];
  for (const shot of shots) {
    const doc = await open(native, shot.bytes);
    const copy = new ThinCopy(mod, native, doc, shot.bytes, 'shared');
    await copy.refresh();
    const dpr = 2;
    const a = await native
      .renderPageRect(doc, doc.pages[0] as PdfPageObject, shot.rect, {
        scaleFactor: shot.scale,
        dpr,
      })
      .toPromise();
    const b = await copy.tile(0, shot.rect, shot.scale * dpr);
    // Side by side with an 8 px grey gap.
    const gap = 8;
    const w = a.width * 2 + gap;
    const h = a.height;
    const out = new Uint8Array(w * h * 4).fill(160);
    for (let y = 0; y < h; y++) {
      out.set(a.data.subarray(y * a.width * 4, (y + 1) * a.width * 4), y * w * 4);
      out.set(b.data.subarray(y * b.width * 4, (y + 1) * b.width * 4), (y * w + a.width + gap) * 4);
    }
    const file = join(dir, `${shot.file}-normal-vs-thin.png`);
    writeFileSync(file, await encodePng(out, w, h));
    written.push(file);
    await copy.close();
  }
  return written;
}

// ------------------------------------------------------------------ main

const what = process.argv[2] ?? 'all';
const results: Record<string, unknown> = {};
if (what === 'width' || what === 'all') {
  results.width = await widthCheck();
  console.log(JSON.stringify(results.width, null, 1));
}
if (what === 'saves' || what === 'all') {
  const saves = [];
  saves.push(await savesCheck('probe page (self-made)', probePdf()));
  for (const f of FIXTURES.slice(0, 3)) saves.push(await savesCheck(f.name, f.bytes()));
  results.saves = saves;
  results.dirtyHazard = await dirtyHazard();
  results.encrypted = await encryptedCheck();
  console.log('encrypted', JSON.stringify(results.encrypted));
  for (const s of saves) console.log(JSON.stringify({ ...s, plain: undefined, routeA: undefined }));
  console.log(JSON.stringify(results.dirtyHazard, null, 1));
}
if (what === 'perf' || what === 'all') {
  const perf = [];
  for (const f of FIXTURES) {
    const r = await perfOne(f.name, f.bytes());
    perf.push(r);
    console.log(JSON.stringify(r, null, 1));
  }
  results.perf = perf;
}
if (what === 'memory' || what === 'all') {
  const memory = [];
  memory.push(await memoryOne(FIXTURES[1]?.name ?? '', FIXTURES[1]?.bytes() ?? new Uint8Array()));
  memory.push(await memoryOne(FIXTURES[4]?.name ?? '', FIXTURES[4]?.bytes() ?? new Uint8Array()));
  memory.push(await memoryOne('120 MB file (probe page + one 120 MB image)', bigFilePdf(120)));
  results.memory = memory;
  for (const m of memory) console.log(JSON.stringify(m));
}
if (what === 'pictures') console.log((await pictures()).join('\n'));
else {
  mkdirSync(join(ROOT, 'test-results'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`wrote ${OUT}`);
}
