// M4-01 spike, Node part (ADR-016): page operations (rotate, delete, insert
// blank, move, import, extract) on real PDFium (the WASM the workers load),
// saved with our narrow Ctrl+S, checked with qpdf and by reopening; what the
// operations leave dangling; EmbedPDF's page cache after an operation; undo by
// reopening original + tail; timings on the 2,000-page stand-in and the A0
// sheet. Self-made fixtures only (rule 13). Writes spikes/s14-pages/out/s14-node.json.
//
//   node --import ./spikes/shared/ts-ext.ts spikes/s14-pages/run-node.ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationSubtype,
  type PdfBookmarkObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init } from '@embedpdf/pdfium';
import {
  a0Sheet,
  buildPdf,
  contractPdf,
  fullFormPdf,
  outlinedPdf,
  simplePdf,
  type PdfObject,
} from '../../e2e/fixtures/generate.ts';
import { OWNER_PW, qpdfEncrypt, USER_PW } from '../../e2e/fixtures/encrypted.ts';
import { makeSigner, signedPdf } from '../../e2e/fixtures/signed.ts';
import { isDict, nameOf, PdfRef, type PdfValue } from '../../src/model/pdf/objects.ts';
import { PdfReader } from '../../src/model/pdf/reader.ts';
import { concatBytes } from '../../src/workers/render/save/bytes.ts';
import { narrowTail } from '../../src/workers/render/save/narrowTail.ts';
import { acquirePage, docPtrOf, rawCall } from '../../src/workers/render/pdfium.ts';
import { SaveTracker } from '../../src/workers/render/save/tracker.ts';
import { FPDF_INCREMENTAL, saveWithFlags } from '../../src/workers/render/save/writer.ts';
import { saveBaseOf } from '../../src/workers/render/save/xref.ts';
import { checkSignatures } from '../../src/workers/work/signatures.ts';
import { digestDocument } from '../../src/workers/render/save/digest.ts';
import { compareDigests } from '../../src/workers/work/verifySave.ts';
import { changedObjects } from './semdiff.ts';

const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
const tracker = new SaveTracker(mod, native);
const heap = mod.pdfium as unknown as {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  setValue(ptr: number, v: number, t: 'i32'): void;
  getValue(ptr: number, t: 'float'): number;
  UTF16ToString(ptr: number): string;
};
let seq = 0;
const ms = (t: number) => Math.round((performance.now() - t) * 100) / 100;
const out: Record<string, unknown> = {};

// ---- helpers ------------------------------------------------------------------

async function open(bytes: Uint8Array, password?: string): Promise<PdfDocumentObject> {
  const id = `d${String(++seq)}`;
  const doc = await native
    .openDocumentBuffer(
      { id, content: bytes.slice().buffer },
      password === undefined ? {} : { password },
    )
    .toPromise();
  tracker.opened(id, bytes, password);
  await tracker.securityReady(id);
  return doc;
}
async function close(doc: PdfDocumentObject): Promise<void> {
  if (tracker.has(doc.id)) tracker.closed(doc.id);
  await native.closeDocument(doc).toPromise();
}
const dptr = (doc: PdfDocumentObject) => docPtrOf(native, doc.id);
const pageCount = (doc: PdfDocumentObject) => rawCall(mod, 'FPDF_GetPageCount', dptr(doc));

/** Closes every cached FPDF_PAGE of the document (EmbedPDF's cache is keyed by index). */
function purgePageCache(doc: PdfDocumentObject): void {
  const ctx = (
    native as unknown as {
      cache: { getContext(id: string): { pageCache: { forceReleaseAll(): void } } };
    }
  ).cache.getContext(doc.id);
  ctx.pageCache.forceReleaseAll();
}

function withInts<T>(xs: readonly number[], fn: (ptr: number) => T): T {
  const ptr = heap.wasmExports.malloc(Math.max(4, xs.length * 4));
  try {
    xs.forEach((x, i) => {
      heap.setValue(ptr + i * 4, x, 'i32');
    });
    return fn(ptr);
  } finally {
    heap.wasmExports.free(ptr);
  }
}

/** Text of a freshly loaded page (bypasses EmbedPDF's cache). */
function pageText(docPtr: number, index: number, max = 40): string {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtr, index);
  if (!page) return '<no page>';
  try {
    const tp = rawCall(mod, 'FPDFText_LoadPage', page);
    try {
      const n = Math.min(max, rawCall(mod, 'FPDFText_CountChars', tp));
      if (n <= 0) return '';
      const buf = heap.wasmExports.malloc((n + 1) * 2);
      try {
        rawCall(mod, 'FPDFText_GetText', tp, 0, n, buf);
        return heap.UTF16ToString(buf).trim();
      } finally {
        heap.wasmExports.free(buf);
      }
    } finally {
      rawCall(mod, 'FPDFText_ClosePage', tp);
    }
  } finally {
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

interface PageId {
  obj: number;
  text: string;
  rot: number;
  w: number;
  h: number;
  annots: number;
}
function identity(docPtr: number, index: number): PageId {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtr, index);
  try {
    return {
      obj: rawCall(mod, 'EPDFDoc_GetPageObjectNumberByIndex', docPtr, index),
      text: pageText(docPtr, index, 24),
      rot: rawCall(mod, 'FPDFPage_GetRotation', page),
      w: Math.round(rawCall(mod, 'FPDF_GetPageWidthF', page)),
      h: Math.round(rawCall(mod, 'FPDF_GetPageHeightF', page)),
      annots: rawCall(mod, 'FPDFPage_GetAnnotCount', page),
    };
  } finally {
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}
const identities = (docPtr: number, sample?: number[]) => {
  const n = rawCall(mod, 'FPDF_GetPageCount', docPtr);
  const idx = sample ?? Array.from({ length: n }, (_, i) => i);
  return idx.filter((i) => i < n).map((i) => identity(docPtr, i));
};

// ---- operations (direct PDFium exports, B14) ------------------------------------

const ops = {
  rotate(doc: PdfDocumentObject, index: number, quarter: number): void {
    const ref = acquirePage(native, doc.id, index);
    try {
      const now = rawCall(mod, 'FPDFPage_GetRotation', ref.pagePtr);
      rawCall(mod, 'FPDFPage_SetRotation', ref.pagePtr, (now + quarter + 4) % 4);
    } finally {
      ref.release();
    }
  },
  delete(doc: PdfDocumentObject, index: number): void {
    rawCall(mod, 'FPDFPage_Delete', dptr(doc), index);
  },
  insertBlank(doc: PdfDocumentObject, index: number, w: number, h: number): number {
    const page = rawCall(mod, 'FPDFPage_New', dptr(doc), index, w, h);
    const ok = page !== 0;
    if (ok) rawCall(mod, 'FPDF_ClosePage', page);
    return ok ? 1 : 0;
  },
  move(doc: PdfDocumentObject, indices: number[], dest: number): boolean {
    return withInts(
      indices,
      (p) => rawCall(mod, 'FPDF_MovePages', dptr(doc), p, indices.length, dest) === 1,
    );
  },
  import(dest: PdfDocumentObject, src: PdfDocumentObject, indices: number[], at: number): boolean {
    return withInts(
      indices,
      (p) =>
        rawCall(mod, 'FPDF_ImportPagesByIndex', dptr(dest), dptr(src), p, indices.length, at) === 1,
    );
  },
};

// ---- saving -------------------------------------------------------------------

function qpdfCheck(bytes: Uint8Array, password?: string): { ok: boolean; msg: string } {
  const dir = mkdtempSync(join(tmpdir(), 's14-'));
  const f = join(dir, 'f.pdf');
  writeFileSync(f, bytes);
  const args = ['--check', ...(password ? [`--password=${password}`] : []), f];
  const r = spawnSync('qpdf', args);
  const text = (r.stdout.toString() + r.stderr.toString()).trim();
  // 0 = ok, 3 = warnings; report warnings verbatim.
  return {
    ok: r.status === 0,
    msg: r.status === 0 ? 'ok' : text.split('\n').slice(-3).join(' | '),
  };
}

interface SaveOutcome {
  mode: string;
  tailBytes: number;
  saveMs: number;
  diff?: { changed: number; unchanged: number; fresh: number; diffMs: number };
  qpdf: { ok: boolean; msg: string };
  reopenMs: number;
  identical: boolean;
  /** Today's ADR-005 check (all pages, as for an untracked change). */
  verify: string;
  firstMismatch?: { page: number; want: PageId | undefined; got: PageId | undefined };
}

/**
 * Saves the document two ways — keep-all (what the tracker does today for an
 * untracked change) and semantic-narrow (dirty = objects that really changed)
 * — and checks each: qpdf, then reopen and compare every sampled page's
 * identity (text, rotation, size, annotation count) with the live document.
 */
async function saveBoth(
  doc: PdfDocumentObject,
  original: Uint8Array,
  password: string | undefined,
  sample?: number[],
  negativeControl = false,
): Promise<Record<string, SaveOutcome>> {
  purgePageCache(doc);
  const want = identities(dptr(doc), sample);
  const wantCount = pageCount(doc);
  const reader = await PdfReader.open(original, undefined, password ? { password } : {});
  const result: Record<string, SaveOutcome> = {};
  // Page operations are untracked: the expected digest covers every page.
  tracker.recordMutation('deletePage', [doc]);
  const expected = digestDocument(mod, native, doc.id, 'all');
  const check = async (mode: string, tail: Uint8Array, saveMs: number, extra = {}) => {
    const saved = concatBytes([original, tail]);
    const qpdf = qpdfCheck(saved, password);
    const t0 = performance.now();
    const back = await open(saved, password);
    const reopenMs = ms(t0);
    const gotCount = pageCount(back);
    const got = identities(dptr(back), sample);
    const v = compareDigests(expected, digestDocument(mod, native, back.id, 'all'));
    await close(back);
    let firstMismatch: SaveOutcome['firstMismatch'];
    const idx = sample ?? want.map((_, i) => i);
    for (let i = 0; i < Math.max(want.length, got.length); i++) {
      if (JSON.stringify(want[i]) !== JSON.stringify(got[i])) {
        firstMismatch = { page: idx[i] ?? i, want: want[i], got: got[i] };
        break;
      }
    }
    result[mode] = {
      mode,
      tailBytes: tail.length,
      saveMs,
      ...extra,
      qpdf,
      reopenMs,
      identical: gotCount === wantCount && !firstMismatch,
      verify: v.ok ? 'ok' : `${v.reason}${v.page === undefined ? '' : ` p${String(v.page)}`}`,
      ...(firstMismatch ? { firstMismatch } : {}),
    };
  };
  {
    const t0 = performance.now();
    const r = tracker.saveIncremental(doc.id, { keepAll: true });
    await check('keep-all', r.tail, ms(t0));
  }
  {
    const t0 = performance.now();
    const full = saveWithFlags(mod, dptr(doc), FPDF_INCREMENTAL);
    const d = await changedObjects(reader, full, original.length);
    const r = narrowTail(saveBaseOf(original), full, original.length, d.changed);
    await check('semantic-narrow', r.tail, ms(t0), {
      diff: { changed: d.changed.length, unchanged: d.unchanged, fresh: d.fresh, diffMs: d.ms },
    });
    if (negativeControl) {
      // Drop the page tree nodes from the dirty set: a wrong narrow tail.
      const trees = new Set<number>();
      for (const n of d.changed) {
        const v = await reader.get(n);
        if (isDict(v) && nameOf(v.get('Type')) === 'Pages') trees.add(n);
      }
      const bad = narrowTail(
        saveBaseOf(original),
        full,
        original.length,
        d.changed.filter((n) => !trees.has(n)),
      );
      await check('negative-control (page tree dropped)', bad.tail, 0);
    }
  }
  return result;
}

// ---- fixtures -------------------------------------------------------------------

/** 30 pages in a balanced tree: root → 3 /Pages nodes × 10 pages, one inherited /Rotate. */
function nestedTreePdf(): Uint8Array {
  const objs: PdfObject[] = [];
  const pageNum = (i: number) => 6 + i * 2;
  const font = 6 + 60;
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 30 >>');
  for (let n = 0; n < 3; n++) {
    const kids = Array.from({ length: 10 }, (_, k) => `${String(pageNum(n * 10 + k))} 0 R`);
    const rot = n === 2 ? ' /Rotate 90' : '';
    objs.push(`<< /Type /Pages /Parent 2 0 R /Kids [${kids.join(' ')}] /Count 10${rot} >>`);
  }
  for (let i = 0; i < 30; i++) {
    objs.push(
      `<< /Type /Page /Parent ${String(3 + Math.floor(i / 10))} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(pageNum(i) + 1)} 0 R >>`,
      { dict: '<< >>', stream: `BT /F1 36 Tf 72 740 Td (Page ${String(i + 1)}) Tj ET` },
    );
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return buildPdf(objs);
}

/** 3 pages; page 2 has a /VP, a Square annotation and a text widget in /AcroForm. */
function richSourcePdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [10 0 R] /DA (/Helv 12 Tf 0 g) >> /PageLabels << /Nums [0 << /S /r >>] >> >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 12 0 R >> >> /Contents 4 0 R >>',
    { dict: '<< >>', stream: 'BT /F1 36 Tf 72 740 Td (Source 1) Tj ET' },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 12 0 R >> >> /Contents 6 0 R /Annots [9 0 R 10 0 R] /VP [<< /Type /Viewport /BBox [0 0 595 842] /Name (Detail A) /Measure << /Type /Measure /Subtype /RL /R (1 in = 5 ft) /X [<< /U (ft) /C 0.069444 >>] /D [<< /U (ft) /C 1 >>] /A [<< /U (sq ft) /C 1 >>] >> >>] >>',
    { dict: '<< >>', stream: 'BT /F1 36 Tf 72 740 Td (Source 2) Tj ET' },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Rotate 90 /Resources << /Font << /F1 12 0 R >> >> /Contents 8 0 R >>',
    { dict: '<< >>', stream: 'BT /F1 36 Tf 72 500 Td (Source 3) Tj ET' },
    '<< /Type /Annot /Subtype /Square /Rect [100 100 300 300] /C [1 0 0] /T (Reviewer) /Contents (A square) /NM (sq-1) /P 5 0 R >>',
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (Alice) /Rect [60 600 300 624] /F 4 /P 5 0 R /DA (/Helv 12 Tf 0 g) >>',
    '<< >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

// ---- 1. APIs -------------------------------------------------------------------

out.apis = {
  embedpdfEngine: ['deletePage', 'importPages', 'extractPages', 'createDocument', 'mergePages'].map(
    (m) => ({
      m,
      present: typeof (native as unknown as Record<string, unknown>)[m] === 'function',
    }),
  ),
  pdfiumExports: [
    'FPDFPage_SetRotation',
    'FPDFPage_Delete',
    'FPDFPage_New',
    'FPDF_MovePages',
    'FPDF_ImportPagesByIndex',
    'FPDF_CreateNewDocument',
    'EPDFDoc_GetPageObjectNumberByIndex',
  ].map((e) => ({
    e,
    present: typeof (mod as unknown as Record<string, unknown>)[e] === 'function',
  })),
};

// ---- 2. Each operation × each original form, both save modes -------------------

const qpdf = (bytes: Uint8Array, args: string[]): Uint8Array => {
  const dir = mkdtempSync(join(tmpdir(), 's14q-'));
  writeFileSync(join(dir, 'in.pdf'), bytes);
  const r = spawnSync('qpdf', [...args, join(dir, 'in.pdf'), join(dir, 'out.pdf')]);
  if (r.status !== 0 && r.status !== 3) throw new Error(r.stderr.toString());
  return new Uint8Array(readFileSync(join(dir, 'out.pdf')));
};
const base10 = simplePdf(10);
const originals: { name: string; bytes: Uint8Array; password?: string }[] = [
  { name: 'xref-table', bytes: base10 },
  { name: 'object-streams', bytes: qpdf(base10, ['--object-streams=generate']) },
  { name: 'nested-tree', bytes: nestedTreePdf() },
  {
    name: 'aes-256 (owner pw)',
    bytes: qpdfEncrypt(base10, USER_PW, OWNER_PW, ['256']),
    password: OWNER_PW,
  },
  {
    name: 'rc4-128 (owner pw)',
    bytes: qpdfEncrypt(base10, USER_PW, OWNER_PW, ['128', '--use-aes=n']),
    password: OWNER_PW,
  },
];

interface Op {
  name: string;
  run(doc: PdfDocumentObject): Promise<void> | void;
}
const opList: Op[] = [
  {
    name: 'rotate p2 +90, p5 -90',
    run: (d) => {
      ops.rotate(d, 1, 1);
      ops.rotate(d, 4, 3);
    },
  },
  {
    name: 'delete p3',
    run: (d) => {
      ops.delete(d, 2);
    },
  },
  {
    name: 'delete p1,p2 (first)',
    run: (d) => {
      ops.delete(d, 1);
      ops.delete(d, 0);
    },
  },
  {
    name: 'insert blank at 0 and end',
    run: (d) => (ops.insertBlank(d, 0, 595, 842), ops.insertBlank(d, pageCount(d), 842, 595)),
  },
  { name: 'move p9,p10 to front', run: (d) => void ops.move(d, [8, 9], 0) },
  { name: 'move p1 to end', run: (d) => void ops.move(d, [0], pageCount(d) - 1) },
  {
    name: 'import 3 pages (rich source) at 2',
    run: async (d) => {
      const src = await open(richSourcePdf());
      ops.import(d, src, [0, 1, 2], 2);
      await close(src);
    },
  },
  {
    name: 'mixed: markup + rotate + delete + insert',
    run: async (d) => {
      const page = d.pages[3];
      if (!page) throw new Error('no page');
      await native
        .createPageAnnotation(d, page, {
          id: 'spike-sq',
          type: PdfAnnotationSubtype.SQUARE,
          pageIndex: 3,
          rect: { origin: { x: 100, y: 100 }, size: { width: 100, height: 60 } },
          color: '#FF0000',
          strokeColor: '#FF0000',
          strokeWidth: 2,
          opacity: 1,
          author: 'Spike',
          contents: 'kept after page ops',
        } as never)
        .toPromise();
      ops.rotate(d, 3, 1);
      ops.delete(d, 0);
      ops.insertBlank(d, 5, 595, 842);
    },
  },
];

const matrix: Record<string, unknown>[] = [];
for (const o of originals) {
  for (const op of opList) {
    const doc = await open(o.bytes, o.password);
    let error: string | undefined;
    try {
      await op.run(doc);
    } catch (e) {
      error = String(e);
    }
    const neg = o.name === 'xref-table' && op.name.startsWith('move');
    const saves = error ? {} : await saveBoth(doc, o.bytes, o.password, undefined, neg);
    await close(doc);
    matrix.push({ original: o.name, op: op.name, ...(error ? { error } : {}), saves });
  }
}
out.matrix = matrix;

// ---- 3. EmbedPDF's page cache after an operation -------------------------------
{
  const doc = await open(simplePdf(6));
  const before = acquirePage(native, doc.id, 3);
  const cachedPtr = before.pagePtr;
  before.release();
  ops.delete(doc, 0);
  const after = acquirePage(native, doc.id, 3);
  const staleSamePtr = after.pagePtr === cachedPtr;
  const cachedText = (() => {
    const tp = rawCall(mod, 'FPDFText_LoadPage', after.pagePtr);
    const buf = heap.wasmExports.malloc(64);
    rawCall(mod, 'FPDFText_GetText', tp, 0, 6, buf);
    const s = heap.UTF16ToString(buf);
    heap.wasmExports.free(buf);
    rawCall(mod, 'FPDFText_ClosePage', tp);
    return s;
  })();
  after.release();
  const fresh = pageText(dptr(doc), 3, 6);
  purgePageCache(doc);
  const purged = acquirePage(native, doc.id, 3);
  const purgedPtrDiffers = purged.pagePtr !== cachedPtr;
  purged.release();
  // A page held open while it is deleted: does closing it later crash?
  const held = acquirePage(native, doc.id, 1);
  ops.delete(doc, 1);
  let closeAfterDelete = 'ok';
  try {
    purgePageCache(doc);
  } catch (e) {
    closeAfterDelete = String(e);
  }
  held.release();
  await close(doc);
  out.pageCache = {
    keyedByIndex: true,
    staleSamePtr,
    cachedTextAtIndex3: cachedText,
    freshTextAtIndex3: fresh,
    purgedPtrDiffers,
    closeAfterDelete,
  };
}

// ---- 4. What an operation leaves dangling --------------------------------------
{
  const refsTo = async (bytes: Uint8Array) => {
    const r = await PdfReader.open(bytes);
    const pages = new Set((await r.pages()).map((p) => p.num));
    const root = await r.resolve(r.trailer.get('Root'));
    const dangling: string[] = [];
    const destPage = (v: PdfValue | undefined) =>
      Array.isArray(v) && v[0] instanceof PdfRef ? v[0].num : undefined;
    // outline items
    if (isDict(root)) {
      const outlines = await r.resolve(root.get('Outlines'));
      let item = isDict(outlines) ? await r.resolve(outlines.get('First')) : undefined;
      let guard = 0;
      while (isDict(item) && guard++ < 500) {
        const dest = await r.resolve(item.get('Dest'));
        const n = destPage(dest);
        if (n !== undefined && !pages.has(n)) dangling.push(`outline→${String(n)}`);
        item = await r.resolve(item.get('Next'));
      }
      const dests = await r.resolve(root.get('Dests'));
      if (isDict(dests))
        for (const [k, v] of dests) {
          const n = destPage(await r.resolve(v));
          if (n !== undefined && !pages.has(n)) dangling.push(`dests.${k}→${String(n)}`);
        }
      const acro = await r.resolve(root.get('AcroForm'));
      const fields = isDict(acro) ? await r.resolve(acro.get('Fields')) : undefined;
      for (const f of Array.isArray(fields) ? fields : []) {
        const fd = await r.resolve(f);
        const p = isDict(fd) ? fd.get('P') : undefined;
        if (p instanceof PdfRef && !pages.has(p.num))
          dangling.push(`field ${f instanceof PdfRef ? String(f.num) : '?'} /P→${String(p.num)}`);
      }
    }
    // link annotations on remaining pages
    for (const { dict } of await r.pages()) {
      const annots = await r.resolve(dict.get('Annots'));
      for (const a of Array.isArray(annots) ? annots : []) {
        const ad = await r.resolve(a);
        if (!isDict(ad) || nameOf(ad.get('Subtype')) !== 'Link') continue;
        const n = destPage(await r.resolve(ad.get('Dest')));
        const action = await r.resolve(ad.get('A'));
        const m = isDict(action) ? destPage(await r.resolve(action.get('D'))) : undefined;
        for (const x of [n, m])
          if (x !== undefined && !pages.has(x)) dangling.push(`link→${String(x)}`);
      }
    }
    return { pages: pages.size, dangling };
  };
  const outlined = outlinedPdf();
  const beforeOut = await refsTo(outlined);
  // Delete pages 3 and 30 (the named dest "chap3", an outline item and a link target).
  const doc = await open(outlined);
  ops.delete(doc, 29);
  ops.delete(doc, 2);
  purgePageCache(doc);
  const tail = tracker.saveIncremental(doc.id, { keepAll: true }).tail;
  const savedOut = concatBytes([outlined, tail]);
  // What PDFium/EmbedPDF report for the bookmarks now.
  const back = await open(savedOut);
  const bookmarks = await (
    native as unknown as {
      getBookmarks(d: PdfDocumentObject): {
        toPromise(): Promise<{ bookmarks: PdfBookmarkObject[] }>;
      };
    }
  )
    .getBookmarks(back)
    .toPromise();
  const bmTargets = bookmarks.bookmarks.slice(0, 6).map((b) => ({
    title: b.title,
    target: JSON.stringify(b.target).slice(0, 120),
  }));
  await close(back);
  await close(doc);

  const form = fullFormPdf();
  const fdoc = await open(form);
  ops.insertBlank(fdoc, 0, 595, 842);
  ops.delete(fdoc, 1); // the form page
  purgePageCache(fdoc);
  const savedForm = concatBytes([form, tracker.saveIncremental(fdoc.id, { keepAll: true }).tail]);
  await close(fdoc);
  const fback = await open(savedForm);
  const formType = rawCall(mod, 'FPDF_GetFormType', dptr(fback));
  await close(fback);

  out.dangling = {
    outlined: { before: beforeOut, after: await refsTo(savedOut), bookmarks: bmTargets },
    formPageDeleted: { after: await refsTo(savedForm), formTypeAfter: formType },
  };
}

// ---- 5. What importing carries over --------------------------------------------
{
  const src = await open(richSourcePdf());
  const dest = await open(simplePdf(2));
  ops.import(dest, src, [0, 1, 2], 1);
  purgePageCache(dest);
  const destBytes = simplePdf(2);
  const saved = concatBytes([destBytes, tracker.saveIncremental(dest.id, { keepAll: true }).tail]);
  await close(dest);
  await close(src);
  const r = await PdfReader.open(saved);
  const pages = await r.pages();
  const root = await r.resolve(r.trailer.get('Root'));
  const imported = pages[2]?.dict; // "Source 2"
  const annots = imported ? await r.resolve(imported.get('Annots')) : undefined;
  const kinds: string[] = [];
  for (const a of Array.isArray(annots) ? annots : []) {
    const d = await r.resolve(a);
    if (isDict(d)) kinds.push(nameOf(d.get('Subtype')) ?? '?');
  }
  const acro = isDict(root) ? await r.resolve(root.get('AcroForm')) : undefined;
  const third = pages[3]?.dict;
  out.importCarries = {
    pages: pages.length,
    annotSubtypesOnImportedPage2: kinds,
    vpKept: imported?.has('VP') ?? false,
    rotateKept: third?.get('Rotate') ?? null,
    destHasAcroForm: isDict(acro),
    destPageLabels: isDict(root) && root.has('PageLabels'),
    destOutlines: isDict(root) && root.has('Outlines'),
    qpdf: qpdfCheck(saved),
  };
  // extractPages (engine) into a new document
  const srcForExtract = await open(richSourcePdf());
  const t0 = performance.now();
  const buf = (await native.extractPages(srcForExtract, [1, 2]).toPromise()) as ArrayBuffer;
  const extracted = new Uint8Array(buf);
  await close(srcForExtract);
  const er = await PdfReader.open(extracted);
  const eroot = await er.resolve(er.trailer.get('Root'));
  out.extractPages = {
    ms: ms(t0),
    bytes: extracted.length,
    pages: (await er.pages()).length,
    hasAcroForm: isDict(eroot) && eroot.has('AcroForm'),
    qpdf: qpdfCheck(extracted),
  };
}

// ---- 6. Signed original --------------------------------------------------------
{
  const signed = await signedPdf(await makeSigner('Spike Signer'));
  const doc = await open(signed);
  ops.insertBlank(doc, 1, 595, 842);
  ops.rotate(doc, 0, 1);
  const saves = await saveBoth(doc, signed, undefined);
  purgePageCache(doc);
  const keepAllTail = tracker.saveIncremental(doc.id, { keepAll: true }).tail;
  const full = saveWithFlags(mod, dptr(doc), FPDF_INCREMENTAL);
  const d = await changedObjects(await PdfReader.open(signed), full, signed.length);
  const narrow = narrowTail(saveBaseOf(signed), full, signed.length, d.changed).tail;
  await close(doc);
  const slice = { checkpoint: () => Promise.resolve() } as never;
  const sigsOf = async (tail: Uint8Array) =>
    (await checkSignatures(concatBytes([signed, tail]), slice, () => undefined)).map((s) => ({
      integrity: s.integrity,
      revision: s.revision,
      revisions: s.revisions,
      changedAfter: s.changedAfter,
    }));
  out.signed = {
    saves,
    signaturesKeepAll: await sigsOf(keepAllTail),
    signaturesSemanticNarrow: await sigsOf(narrow),
  };
}

// ---- 7. Timings: 2,000-page contract and A0 sheet; undo by reopen -------------
{
  const contract = contractPdf(2000);
  const doc = await open(contract);
  const t: Record<string, number> = {};
  let t0 = performance.now();
  for (let i = 1999; i >= 1000; i--) ops.delete(doc, i);
  t.delete1000 = ms(t0);
  t0 = performance.now();
  for (let i = 0; i < 100; i++) ops.insertBlank(doc, i * 5, 595, 842);
  t.insertBlank100 = ms(t0);
  t0 = performance.now();
  ops.move(
    doc,
    Array.from({ length: 500 }, (_, i) => i * 2),
    0,
  );
  t.move500 = ms(t0);
  t0 = performance.now();
  for (let i = 0; i < pageCount(doc); i++) ops.rotate(doc, i, 1);
  t.rotateAll1100 = ms(t0);
  purgePageCache(doc);
  const sample = [0, 1, 2, 3, 10, 99, 500, 501, 999, 1099];
  const saves = await saveBoth(doc, contract, undefined, sample);
  // Undo = close, reopen original + the tail taken before the operation.
  t0 = performance.now();
  const before = contractPdf(2000); // pre-operation state: the original (empty tail)
  const reopened = await open(before);
  t.undoReopen2000 = ms(t0);
  await close(reopened);
  // Tail snapshot cost (what undo must take before each operation).
  t0 = performance.now();
  tracker.snapshotTail(doc.id);
  t.snapshotTailAfterOps = ms(t0);
  await close(doc);

  const a0 = a0Sheet(200_000, 3);
  const adoc = await open(a0);
  t0 = performance.now();
  ops.rotate(adoc, 0, 1);
  ops.delete(adoc, 2);
  t.a0RotateDelete = ms(t0);
  const a0saves = await saveBoth(adoc, a0, undefined);
  await close(adoc);
  t0 = performance.now();
  const a0re = await open(a0);
  t.a0UndoReopen = ms(t0);
  await close(a0re);

  const mem = (mod.pdfium.wasmExports as unknown as { memory: WebAssembly.Memory }).memory;
  out.timings = {
    ...t,
    contractSaves: saves,
    a0Saves: a0saves,
    wasmMemoryMB: Math.round(mem.buffer.byteLength / 1048576),
  };
}

mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/s14-node.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
