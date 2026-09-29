// M4-19 spike, Node part (ADR-018): comment transfer between documents on real
// PDFium (the WASM the workers load), our reader/serializer and narrow Ctrl+S.
//   1. Object copy (copy.ts) of every M3 tool's comment + other-viewer-style
//      markups, into Rev B targets of several geometries and encryptions;
//      qpdf on every output; reopen; import verified against the source's
//      digest; per-annotation pixel comparison; the next Ctrl+S folded into
//      ONE narrow revision and verified with ADR-005's check.
//   2. Re-create through EmbedPDF (getPageAnnotations → createPageAnnotation):
//      what is lost.
//   3. Duplicates, paste, permissions, a signed target.
//   4. Timings: 1,000 comments into the 2,000-page stand-in and the A0 sheet,
//      both routes; reopen on its own.
// Self-made fixtures only (rule 13). Writes spikes/s16-comment-transfer/out/s16-node.json.
//
//   node --import ./spikes/shared/ts-ext.ts spikes/s16-comment-transfer/run-node.ts
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { deflateSync } from 'node:zlib';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationReplyType,
  PdfAnnotationState,
  PdfAnnotationStateModel,
  PdfAnnotationSubtype,
  type PdfAnnotationObject,
  type PdfDocumentObject,
} from '@embedpdf/models';
import { init } from '@embedpdf/pdfium';
import {
  a0Sheet,
  contractPdf,
  markedContractPdf,
  markedSheetPdf,
} from '../../e2e/fixtures/generate.ts';
import { OWNER_PW, qpdfEncrypt, USER_PW } from '../../e2e/fixtures/encrypted.ts';
import { makeSigner, signedPdf } from '../../e2e/fixtures/signed.ts';
import { allows } from '../../src/model/permissions.ts';
import {
  D,
  isDict,
  N,
  PdfStream,
  S,
  type PdfDict,
  type PdfValue,
} from '../../src/model/pdf/objects.ts';
import { PdfReader } from '../../src/model/pdf/reader.ts';
import { concatBytes, latin1 } from '../../src/workers/render/save/bytes.ts';
import { digestDocument, type AnnotDigest } from '../../src/workers/render/save/digest.ts';
import { acquirePage, rawCall } from '../../src/workers/render/pdfium.ts';
import { SaveTracker } from '../../src/workers/render/save/tracker.ts';
import { checkSignatures } from '../../src/workers/work/signatures.ts';
import { compareDigests } from '../../src/workers/work/verifySave.ts';
import { everyToolAnnotation } from '../s1-save/annotations.ts';
import { annotBoxes, renderAnnotTile } from '../s12-annotate/annot-tiles.ts';
import {
  importComments,
  mapNoRotateRect,
  mapRect,
  mergeTails,
  type ImportOptions,
  type Mat,
} from './copy.ts';
import { A4, foreignAnnotations, revDoc, type PageGeom } from './fixtures.ts';

const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
const tracker = new SaveTracker(mod, native);
const heap = mod.pdfium as unknown as {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  UTF16ToString(ptr: number): string;
};
let seq = 0;
const ms = (t: number) => Math.round((performance.now() - t) * 10) / 10;
const out: Record<string, unknown> = {};

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
const pageOf = (doc: PdfDocumentObject, i: number) => {
  const p = doc.pages[i];
  if (!p) throw new Error(`no page ${String(i)}`);
  return p;
};

function qpdfCheck(bytes: Uint8Array, password?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 's16-'));
  const f = join(dir, 'f.pdf');
  writeFileSync(f, bytes);
  const r = spawnSync('qpdf', ['--check', ...(password ? [`--password=${password}`] : []), f]);
  const text = (r.stdout.toString() + r.stderr.toString()).trim();
  return r.status === 0
    ? 'ok'
    : `exit ${String(r.status)}: ${text.split('\n').slice(-3).join(' | ')}`;
}
const qpdf = (bytes: Uint8Array, args: string[]): Uint8Array => {
  const dir = mkdtempSync(join(tmpdir(), 's16q-'));
  writeFileSync(join(dir, 'in.pdf'), bytes);
  const r = spawnSync('qpdf', [...args, join(dir, 'in.pdf'), join(dir, 'out.pdf')]);
  if (r.status !== 0 && r.status !== 3) throw new Error(r.stderr.toString());
  return new Uint8Array(readFileSync(join(dir, 'out.pdf')));
};
const revisions = (bytes: Uint8Array, from: number) =>
  [...latin1(bytes.subarray(from)).matchAll(/startxref/g)].length;

function wide(fn: (buf: number, len: number) => number): string {
  const len = fn(0, 0);
  if (len <= 2) return '';
  const p = heap.wasmExports.malloc(len + 2);
  try {
    fn(p, len + 2);
    return heap.UTF16ToString(p);
  } finally {
    heap.wasmExports.free(p);
  }
}

/** Each annotation with an /NM on a page, drawn alone (annotation tile, ADR-014) in display space. */
function annotImages(doc: PdfDocumentObject, page: number, size = 1000): Map<string, Uint8Array> {
  const ref = acquirePage(native, doc.id, page);
  const boxes = annotBoxes(mod, ref.pagePtr);
  const names = new Map<number, string>();
  for (const b of boxes) {
    const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, b.index);
    names.set(
      b.index,
      wide((buf, len) => rawCall(mod, 'FPDFAnnot_GetStringValue', a, 'NM', buf, len)),
    );
    rawCall(mod, 'FPDFPage_CloseAnnot', a);
  }
  ref.release();
  const outMap = new Map<string, Uint8Array>();
  for (const b of boxes) {
    const nm = names.get(b.index);
    if (!nm) continue;
    const { data } = renderAnnotTile(mod, native, doc.id, [b], size, 0, 0, 1, size, page);
    outMap.set(nm, data);
  }
  return outMap;
}

/** Share of drawn pixels (either side) that differ by more than 24 in any channel. */
function pixelDiff(a: Uint8Array, b: Uint8Array): { drawn: number; differ: number; pct: number } {
  let drawn = 0;
  let differ = 0;
  for (let i = 0; i < a.length; i += 4) {
    if ((a[i + 3] ?? 0) === 0 && (b[i + 3] ?? 0) === 0) continue;
    drawn++;
    for (let k = 0; k < 4; k++)
      if (Math.abs((a[i + k] ?? 0) - (b[i + k] ?? 0)) > 24) {
        differ++;
        break;
      }
  }
  return { drawn, differ, pct: drawn ? Math.round((differ / drawn) * 10000) / 100 : 0 };
}

function comparePixels(
  src: PdfDocumentObject,
  tgt: PdfDocumentObject,
  pairs: [number, number][],
): {
  compared: number;
  identical: number;
  blank: number;
  minDrawn: number;
  worst: { nm: string; pct: number }[];
  missing: string[];
} {
  let compared = 0;
  let blank = 0;
  let minDrawn = Infinity;
  let identical = 0;
  const worst: { nm: string; pct: number }[] = [];
  const missing: string[] = [];
  for (const [sp, tp] of pairs) {
    const a = annotImages(src, sp);
    const b = annotImages(tgt, tp);
    for (const [nm, img] of a) {
      const other = b.get(nm);
      if (!other) {
        missing.push(nm);
        continue;
      }
      compared++;
      const d = pixelDiff(img, other);
      if (d.drawn === 0) blank++;
      minDrawn = Math.min(minDrawn, d.drawn);
      if (d.differ === 0) identical++;
      else worst.push({ nm, pct: d.pct });
    }
  }
  worst.sort((x, y) => y.pct - x.pct);
  return { compared, identical, blank, minDrawn, worst: worst.slice(0, 8), missing };
}

function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = (table[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const o = new Uint8Array(12 + data.length);
    const dv = new DataView(o.buffer);
    dv.setUint32(0, data.length);
    o.set(
      Uint8Array.from(type, (c) => c.charCodeAt(0)),
      4,
    );
    o.set(data, 8);
    dv.setUint32(8 + data.length, crc(o.subarray(4, 8 + data.length)));
    return o;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++)
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
  return concatBytes([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** The whole page with its annotations as PDFium displays it (page /Rotate applied), for review. */
function renderPng(doc: PdfDocumentObject, page: number, file: string): void {
  const ref = acquirePage(native, doc.id, page);
  const h2 = mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    HEAPU8: Uint8Array;
  };
  const w = Math.round(rawCall(mod, 'FPDF_GetPageWidthF', ref.pagePtr));
  const h = Math.round(rawCall(mod, 'FPDF_GetPageHeightF', ref.pagePtr));
  const px = h2.wasmExports.malloc(w * h * 4);
  const bmp = rawCall(mod, 'FPDFBitmap_CreateEx', w, h, 4, px, w * 4);
  rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  rawCall(mod, 'FPDF_RenderPageBitmap', bmp, ref.pagePtr, 0, 0, w, h, 0, 0x01 | 0x10);
  const data = h2.HEAPU8.slice(px, px + w * h * 4);
  rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  h2.wasmExports.free(px);
  ref.release();
  mkdirSync('spikes/s16-comment-transfer/out', { recursive: true });
  writeFileSync(`spikes/s16-comment-transfer/out/${file}.png`, encodePng(w, h, data));
}

/** The import check: the target's annotations = before + the source's copies, placed. */
function verifyImport(
  srcDigest: Map<number, AnnotDigest[]>,
  before: Map<number, AnnotDigest[]>,
  after: Map<number, AnnotDigest[]>,
  copied: Set<number>,
  noRotate: Set<number>,
  offset: number,
  matrices: Map<number, Mat>,
): { ok: boolean; expected: number; got: number; mismatches: string[] } {
  const key = (a: AnnotDigest) => `${String(a.subtype)}|${a.nm}|${a.contents}`;
  const mismatches: string[] = [];
  let expected = 0;
  let got = 0;
  const pages = new Set([...before.keys(), ...after.keys()]);
  for (const tp of pages) {
    const want = [...(before.get(tp) ?? [])].map((a) => ({ ...a }));
    const m = matrices.get(tp - offset);
    for (const a of srcDigest.get(tp - offset) ?? []) {
      if (!copied.has(a.obj)) continue;
      const r = m
        ? ((noRotate.has(a.obj) ? mapNoRotateRect(a.rect, m) : mapRect(a.rect, m)) as number[])
        : a.rect;
      want.push({ ...a, rect: r.map((v) => Math.round(v * 10) / 10) as AnnotDigest['rect'] });
    }
    const have = [...(after.get(tp) ?? [])];
    expected += want.length;
    got += have.length;
    for (const w of want) {
      const i = have.findIndex(
        (h) => key(h) === key(w) && h.rect.every((v, k) => Math.abs(v - (w.rect[k] ?? 0)) <= 0.3),
      );
      if (i < 0) mismatches.push(`p${String(tp)} ${key(w)} [${w.rect.join(' ')}]`);
      else have.splice(i, 1);
    }
    for (const h of have) mismatches.push(`p${String(tp)} extra ${key(h)}`);
  }
  return { ok: mismatches.length === 0, expected, got, mismatches: mismatches.slice(0, 6) };
}

const digestMap = (doc: PdfDocumentObject, pages: number[] | 'all') =>
  new Map(digestDocument(mod, native, doc.id, pages).pages.map((p) => [p.page, p.annots]));

// ---- Rev A --------------------------------------------------------------------

async function buildRevA(): Promise<Uint8Array> {
  const f = foreignAnnotations(10, 8);
  const base = revDoc('Rev A', 3, () => A4, f.objs, f.annots);
  const doc = await open(base);
  const errors: string[] = [];
  const add = async (page: number, a: PdfAnnotationObject, ctx?: unknown) => {
    try {
      await native.createPageAnnotation(doc, pageOf(doc, page), a, ctx as never).toPromise();
      tracker.recordMutation('createPageAnnotation', [doc, pageOf(doc, page), a]);
    } catch (e) {
      errors.push(`${a.id}: ${JSON.stringify(e)}`);
    }
  };
  for (const t of everyToolAnnotation(0)) {
    if (t.tool === 'link') continue;
    const ctx = t.stampPng
      ? { data: pngBytes(64, 32).slice().buffer, mimeType: 'image/png' }
      : undefined;
    await add(0, t.annotation, ctx);
  }
  const rect = { origin: { x: 100, y: 100 }, size: { width: 120, height: 60 } };
  await add(1, {
    id: 'a-parent',
    pageIndex: 1,
    type: PdfAnnotationSubtype.SQUARE,
    rect,
    author: 'Reviewer A',
    contents: 'Check this dimension',
    flags: ['print'],
    color: 'transparent',
    strokeColor: '#E44234',
    opacity: 1,
    strokeWidth: 2,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
  });
  await add(1, {
    id: 'a-reply',
    pageIndex: 1,
    type: PdfAnnotationSubtype.TEXT,
    rect: { origin: { x: 100, y: 100 }, size: { width: 20, height: 20 } },
    author: 'Vendor B',
    contents: 'Corrected in rev B',
    inReplyToId: 'a-parent',
    replyType: PdfAnnotationReplyType.Reply,
    flags: ['print', 'noView'],
  });
  await add(1, {
    id: 'a-state',
    pageIndex: 1,
    type: PdfAnnotationSubtype.TEXT,
    rect: { origin: { x: 100, y: 100 }, size: { width: 20, height: 20 } },
    author: 'Reviewer A',
    contents: 'Accepted set by Reviewer A',
    inReplyToId: 'a-parent',
    replyType: PdfAnnotationReplyType.Reply,
    stateModel: PdfAnnotationStateModel.Review,
    state: PdfAnnotationState.Accepted,
    flags: ['print', 'noView', 'hidden'],
  });
  // A measurement made the M3-16 way: EmbedPDF line + our /Measure and /IT patch.
  await add(1, {
    id: 'a-measure',
    pageIndex: 1,
    type: PdfAnnotationSubtype.LINE,
    rect: { origin: { x: 96, y: 296 }, size: { width: 208, height: 8 } },
    linePoints: { start: { x: 100, y: 300 }, end: { x: 300, y: 300 } },
    author: 'Reviewer A',
    contents: '2.00 m',
    strokeColor: '#E44234',
    color: 'transparent',
    opacity: 1,
    strokeWidth: 1,
    flags: ['print'],
  } as PdfAnnotationObject);
  tracker.stagePatch(
    doc.id,
    { page: 1, annot: 'a-measure' },
    new Map<string, PdfValue>([
      ['IT', N('LineDimension')],
      [
        'Measure',
        D({
          Type: N('Measure'),
          Subtype: N('RL'),
          R: S('1 in = 1 m'),
          X: [D({ Type: N('NumberFormat'), U: S('m'), C: 0.0138889, D: 100 })],
          D: [D({ Type: N('NumberFormat'), U: S('m'), C: 1, D: 100 })],
          A: [D({ Type: N('NumberFormat'), U: S('sq m'), C: 1, D: 100 })],
        }),
      ],
    ]),
  );
  const r = tracker.saveIncremental(doc.id);
  await close(doc);
  out.revA = { tools: everyToolAnnotation(0).length - 1, createErrors: errors, saveMode: r.mode };
  return concatBytes([base, r.tail]);
}

function pngBytes(w: number, h: number): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = (table[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const o = new Uint8Array(12 + data.length);
    const dv = new DataView(o.buffer);
    dv.setUint32(0, data.length);
    o.set(
      Uint8Array.from(type, (c) => c.charCodeAt(0)),
      4,
    );
    o.set(data, 8);
    dv.setUint32(8 + data.length, crc(o.subarray(4, 8 + data.length)));
    return o;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set([200, 30, 30, 255], y * (1 + w * 4) + 1 + x * 4);
  return concatBytes([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array()),
  ]);
}

// ---- 1. Object copy matrix -------------------------------------------------------

interface Case {
  name: string;
  target: Uint8Array;
  targetPw?: string;
  source: Uint8Array;
  sourcePw?: string;
  opts?: ImportOptions;
  /** Source page → target page pairs for the pixel check (same visual size only). */
  pixels?: boolean;
}

async function objectCopy(c: Case): Promise<Record<string, unknown>> {
  const res: Record<string, unknown> = {};
  // Permissions (rule 9): source needs copy, target annotate.
  const sdoc = await open(c.source, c.sourcePw);
  const tdoc0 = await open(c.target, c.targetPw);
  res.sourceCopy = allows(tracker.security(sdoc.id), 'copy');
  res.targetAnnotate = allows(tracker.security(tdoc0.id), 'annotate');
  if (!res.sourceCopy || !res.targetAnnotate) {
    await close(sdoc);
    await close(tdoc0);
    return { ...res, refused: true };
  }
  const before = digestMap(tdoc0, 'all');
  await close(tdoc0);
  const src = await PdfReader.open(c.source, undefined, c.sourcePw ? { password: c.sourcePw } : {});
  const tgt = await PdfReader.open(c.target, undefined, c.targetPw ? { password: c.targetPw } : {});
  const t0 = performance.now();
  const { tail: t1, report } = await importComments(src, tgt, c.target, c.opts);
  res.importMs = ms(t0);
  res.report = {
    ...report,
    map: undefined,
    placed: undefined,
    copiedSrc: undefined,
    noRotate: report.noRotate.size,
    ms: Object.fromEntries(Object.entries(report.ms).map(([k, v]) => [k, Math.round(v * 10) / 10])),
  };
  res.t1Bytes = t1.length;
  const withImport = concatBytes([c.target, t1]);
  res.qpdfImport = qpdfCheck(withImport, c.targetPw);
  // Reopen (the Render worker's route).
  const t1r = performance.now();
  const tdoc = await open(withImport, c.targetPw);
  res.reopenMs = ms(t1r);
  const after = digestMap(tdoc, 'all');
  const offset = c.opts?.offset ?? 0;
  const matrices = new Map<number, Mat>();
  for (const [, p] of report.placed) matrices.set(p.page - offset, p.m);
  const srcDigest = digestMap(sdoc, 'all');
  res.verifyImport = verifyImport(
    srcDigest,
    before,
    after,
    report.copiedSrc,
    report.noRotate,
    offset,
    matrices,
  );
  if (c.pixels) {
    const pairs: [number, number][] = [
      ...new Set([...report.placed.values()].map((p) => p.page)),
    ].map((tp) => [tp - offset, tp]);
    res.pixels = comparePixels(sdoc, tdoc, pairs);
  }
  const slug = c.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  if (/rotated|crop|letter|same geometry/.test(c.name))
    for (const p of [0, 2]) {
      renderPng(tdoc, p + offset, `${slug}-p${String(p + 1)}`);
      if (c.name.includes('same geometry')) renderPng(sdoc, p, `source-p${String(p + 1)}`);
    }
  // The next Ctrl+S after one more edit: PDFium's narrow tail against original + t1,
  // folded with t1 into ONE revision on the file as it is on disk.
  const page0 = pageOf(tdoc, 0);
  const edit: PdfAnnotationObject = {
    id: `after-${String(seq)}`,
    pageIndex: 0,
    type: PdfAnnotationSubtype.SQUARE,
    rect: { origin: { x: 40, y: 40 }, size: { width: 60, height: 30 } },
    author: 'Owner',
    contents: 'Added after the import',
    flags: ['print'],
    color: 'transparent',
    strokeColor: '#0000FF',
    opacity: 1,
    strokeWidth: 1,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
  };
  await native.createPageAnnotation(tdoc, page0, edit).toPromise();
  tracker.recordMutation('createPageAnnotation', [tdoc, page0, edit]);
  const t2s = performance.now();
  const r2 = tracker.saveIncremental(tdoc.id);
  const merged = mergeTails(c.target, t1, r2.tail);
  res.saveMs = ms(t2s);
  const saved = concatBytes([c.target, merged]);
  res.save = {
    mode: r2.mode,
    t2Bytes: r2.tail.length,
    mergedBytes: merged.length,
    revisionsAdded: revisions(saved, c.target.length),
    qpdf: qpdfCheck(saved, c.targetPw),
  };
  const back = await open(saved, c.targetPw);
  // ADR-005's check for the edit (tracker's expected digest) …
  res.verifySave = r2.expected
    ? compareDigests(
        r2.expected,
        digestDocument(
          mod,
          native,
          back.id,
          r2.expected.pages.map((p) => p.page),
        ),
      )
    : null;
  // … and the whole document equal to what the Render worker had after the import + edit.
  const live = digestDocument(mod, native, tdoc.id, 'all');
  res.verifyAll = compareDigests(live, digestDocument(mod, native, back.id, 'all'));
  await close(back);
  await close(tdoc);
  await close(sdoc);
  return res;
}

const revA = await buildRevA();
const same = revDoc('Rev B', 3);
const f3 = (g: PageGeom) => revDoc('Rev B', 3, () => g);
const targets: Case[] = [
  { name: 'same geometry (xref table)', target: same, source: revA, pixels: true },
  {
    name: 'object streams + xref stream',
    target: qpdf(same, ['--object-streams=generate']),
    source: revA,
    pixels: true,
  },
  {
    name: 'rotated 90 (landscape media)',
    target: f3({ media: [0, 0, 842, 595], rotate: 90 }),
    source: revA,
    pixels: true,
  },
  {
    name: 'crop box offset',
    target: f3({ media: [0, 0, 700, 950], crop: [50, 60, 645, 902] }),
    source: revA,
    pixels: true,
  },
  {
    name: 'letter size (top-left anchored)',
    target: f3({ media: [0, 0, 612, 792] }),
    source: revA,
  },
  { name: 'shorter target (2 pages)', target: revDoc('Rev B', 2), source: revA },
  {
    name: 'offset +1 (a cover sheet added)',
    target: revDoc('Rev B', 4),
    source: revA,
    opts: { offset: 1 },
    pixels: true,
  },
  {
    name: 'target AES-256 (owner pw)',
    target: qpdfEncrypt(same, USER_PW, OWNER_PW, ['256']),
    targetPw: OWNER_PW,
    source: revA,
    pixels: true,
  },
  {
    name: 'target RC4-128 (owner pw)',
    target: qpdfEncrypt(same, USER_PW, OWNER_PW, ['128', '--use-aes=n']),
    targetPw: OWNER_PW,
    source: revA,
    pixels: true,
  },
  {
    name: 'source AES-256 (user pw)',
    target: same,
    source: qpdfEncrypt(revA, USER_PW, OWNER_PW, ['256']),
    sourcePw: USER_PW,
    pixels: true,
  },
  {
    name: 'source and target AES-128',
    target: qpdfEncrypt(same, USER_PW, OWNER_PW, ['128', '--use-aes=y']),
    targetPw: USER_PW,
    source: qpdfEncrypt(revA, USER_PW, OWNER_PW, ['128', '--use-aes=y']),
    sourcePw: USER_PW,
    pixels: true,
  },
  {
    name: 'source denies copy',
    target: same,
    source: qpdfEncrypt(revA, USER_PW, OWNER_PW, ['256', '--extract=n']),
    sourcePw: USER_PW,
  },
  {
    name: 'target denies annotate',
    target: qpdfEncrypt(same, USER_PW, OWNER_PW, ['256', '--annotate=n', '--modify=none']),
    targetPw: USER_PW,
    source: revA,
  },
  {
    name: 'filter: author Acme Reviewer, no replies',
    target: same,
    source: revA,
    opts: { authors: ['Acme Reviewer'], withReplies: false },
  },
  {
    name: 'filter: page 3 only, Square/Polygon',
    target: same,
    source: revA,
    opts: { pages: [2], types: ['Square', 'Polygon'] },
  },
];
out.objectCopy = {};
for (const c of targets) {
  (out.objectCopy as Record<string, unknown>)[c.name] = await objectCopy(c);
  console.log('done', c.name);
}

// ---- 2. Duplicates, paste, signed target ------------------------------------------

{
  const src = await PdfReader.open(revA);
  const tgt0 = await PdfReader.open(same);
  const first = await importComments(src, tgt0, same);
  const once = concatBytes([same, first.tail]);
  const again = await importComments(src, await PdfReader.open(once), once);
  // Paste into the same document: new /NM for each copy.
  const paste = await importComments(src, await PdfReader.open(revA), revA, {
    newNames: true,
    pages: [1],
  });
  const pasted = concatBytes([revA, paste.tail]);
  const pdoc = await open(pasted);
  const names =
    digestMap(pdoc, [1])
      .get(1)
      ?.map((a) => a.nm) ?? [];
  await close(pdoc);
  out.duplicates = {
    firstAdded: first.report.added,
    secondAdded: again.report.added,
    secondSkippedDuplicates: again.report.skipped.duplicate,
    secondTailBytes: again.tail.length,
  };
  out.paste = {
    added: paste.report.added,
    qpdf: qpdfCheck(pasted),
    annotationsOnPage: names.length,
    uniqueNames: new Set(names.filter(Boolean)).size,
    withName: names.filter(Boolean).length,
  };
}
{
  const signed = await signedPdf(await makeSigner('Spike Signer'));
  const src = await PdfReader.open(revA);
  const { tail, report } = await importComments(src, await PdfReader.open(signed), signed, {
    pages: [0],
  });
  const withImport = concatBytes([signed, tail]);
  const slice = { checkpoint: () => Promise.resolve() } as never;
  const sigs = await checkSignatures(withImport, slice, () => undefined);
  out.signedTarget = {
    added: report.added,
    qpdf: qpdfCheck(withImport),
    signatures: sigs.map((s) => ({
      integrity: s.integrity,
      revision: s.revision,
      revisions: s.revisions,
      changedAfter: s.changedAfter,
    })),
  };
}

// ---- 3. Re-create through EmbedPDF ---------------------------------------------------

async function recreate(source: Uint8Array, target: Uint8Array, pages: number[]) {
  const sdoc = await open(source);
  const tdoc = await open(target);
  const errors: Record<string, string> = {};
  let created = 0;
  let read = 0;
  const skippedTypes: Record<string, number> = {};
  const t0 = performance.now();
  let readMs = 0;
  for (const p of pages) {
    const tr = performance.now();
    const list = (await native
      .getPageAnnotations(sdoc, pageOf(sdoc, p))
      .toPromise()) as PdfAnnotationObject[];
    readMs += performance.now() - tr;
    for (const a of list) {
      read++;
      if (
        a.type === PdfAnnotationSubtype.POPUP ||
        a.type === PdfAnnotationSubtype.WIDGET ||
        a.type === PdfAnnotationSubtype.LINK
      ) {
        skippedTypes[String(a.type)] = (skippedTypes[String(a.type)] ?? 0) + 1;
        continue;
      }
      const copy = { ...a, pageIndex: p } as PdfAnnotationObject;
      try {
        await native.createPageAnnotation(tdoc, pageOf(tdoc, p), copy).toPromise();
        tracker.recordMutation('createPageAnnotation', [tdoc, pageOf(tdoc, p), copy]);
        created++;
      } catch (e) {
        errors[`${a.id} (type ${String(a.type)})`] = JSON.stringify(e).slice(0, 120);
      }
    }
  }
  const createMs = ms(t0);
  const t1 = performance.now();
  const r = tracker.saveIncremental(tdoc.id);
  const saveMs = ms(t1);
  const saved = concatBytes([target, r.tail]);
  await close(tdoc);
  return {
    sdoc,
    saved,
    errors,
    created,
    read,
    skippedTypes,
    readMs: Math.round(readMs),
    createMs,
    saveMs,
    mode: r.mode,
    tailBytes: r.tail.length,
    expected: r.expected,
  };
}

async function keysByName(bytes: Uint8Array, pages: number[]): Promise<Map<string, PdfDict>> {
  const r = await PdfReader.open(bytes);
  const ps = await r.pages();
  const m = new Map<string, PdfDict>();
  for (const i of pages) {
    const annots = await r.resolve(ps[i]?.dict.get('Annots'));
    for (const a of Array.isArray(annots) ? annots : []) {
      const d = await r.resolve(a);
      if (!isDict(d)) continue;
      const nm = d.get('NM');
      if (nm && 'text' in (nm as object)) m.set((nm as { text(): string }).text(), d);
    }
  }
  return m;
}

{
  const pages = [0, 1, 2];
  const r = await recreate(revA, same, pages);
  const tdoc = await open(r.saved);
  const pixels = comparePixels(
    r.sdoc,
    tdoc,
    pages.map((p) => [p, p]),
  );
  const verify = r.expected
    ? compareDigests(
        r.expected,
        digestDocument(
          mod,
          native,
          tdoc.id,
          r.expected.pages.map((p) => p.page),
        ),
      )
    : null;
  await close(tdoc);
  await close(r.sdoc);
  const srcKeys = await keysByName(revA, pages);
  const tgtKeys = await keysByName(r.saved, pages);
  const lost: Record<string, string[]> = {};
  const missing: string[] = [];
  const ignore = new Set(['P', 'Popup', 'Parent', 'Type']);
  for (const [nm, d] of srcKeys) {
    const t = tgtKeys.get(nm);
    if (!t) {
      missing.push(`${nm} (/${String((d.get('Subtype') as { name?: string } | undefined)?.name)})`);
      continue;
    }
    const gone = [...d.keys()].filter((k) => !ignore.has(k) && !t.has(k));
    if (gone.length) lost[nm] = gone;
  }
  out.recreate = {
    read: r.read,
    created: r.created,
    skippedTypes: r.skippedTypes,
    errors: r.errors,
    saveMode: r.mode,
    tailBytes: r.tailBytes,
    qpdf: qpdfCheck(r.saved),
    verify,
    missingInTarget: missing,
    keysLost: lost,
    pixels,
  };
}

// ---- 4. Timings: 1,000 comments --------------------------------------------------------

async function timeObjectCopy(source: Uint8Array, target: Uint8Array, pages: number[]) {
  const t0 = performance.now();
  const src = await PdfReader.open(source);
  const tgt = await PdfReader.open(target);
  const openMs = ms(t0);
  const { tail, report } = await importComments(src, tgt, target, { pages });
  const importMs = ms(t0);
  const withImport = concatBytes([target, tail]);
  const t1 = performance.now();
  const doc = await native
    .openDocumentBuffer({ id: `t${String(++seq)}`, content: withImport.slice().buffer })
    .toPromise();
  const openPdfiumMs = ms(t1);
  let loaded = 0;
  for (let i = 0; i < doc.pages.length; i += 500) {
    const r = await native.getAnnotationsBatch(doc, doc.pages.slice(i, i + 500)).toPromise();
    loaded += Object.values(r).reduce((a, x) => a + x.length, 0);
  }
  const reopenMs = ms(t1);
  await native.closeDocument(doc).toPromise();
  // Undo = reopen the target without the import.
  const t2 = performance.now();
  const undoDoc = await native
    .openDocumentBuffer({ id: `u${String(++seq)}`, content: target.slice().buffer })
    .toPromise();
  for (let i = 0; i < undoDoc.pages.length; i += 500)
    await native.getAnnotationsBatch(undoDoc, undoDoc.pages.slice(i, i + 500)).toPromise();
  const undoMs = ms(t2);
  await native.closeDocument(undoDoc).toPromise();
  const t3 = performance.now();
  const merged = mergeTails(target, tail, new Uint8Array(0));
  const mergeMs = ms(t3);
  return {
    added: report.added,
    objects: report.objects,
    tailBytes: tail.length,
    readersOpenMs: openMs,
    importMs,
    importPartsMs: Object.fromEntries(
      Object.entries(report.ms).map(([k, v]) => [k, Math.round(v)]),
    ),
    reopenPdfiumOpenMs: openPdfiumMs,
    reopenWithAnnotationLoadMs: reopenMs,
    annotationsLoaded: loaded,
    undoByReopenMs: undoMs,
    mergeMs,
    mergedEqualsTail: merged.length === tail.length,
    qpdf: qpdfCheck(withImport),
  };
}

{
  const contractSrc = markedContractPdf(200, 5);
  const contractTgt = contractPdf(2000);
  const pages = Array.from({ length: 200 }, (_, i) => i);
  const sheetSrc = markedSheetPdf(200_000, 1000);
  const sheetTgt = a0Sheet(200_000);
  out.timings = {
    objectCopy: {
      contract2000: await timeObjectCopy(contractSrc, contractTgt, pages),
      a0Sheet: await timeObjectCopy(sheetSrc, sheetTgt, [0]),
    },
  };
  console.log('object copy timed');
  const rc = await recreate(contractSrc, contractTgt, pages);
  await close(rc.sdoc);
  const ra = await recreate(sheetSrc, sheetTgt, [0]);
  await close(ra.sdoc);
  const pick = (r: typeof rc) => ({
    created: r.created,
    errors: Object.keys(r.errors).length,
    readMs: r.readMs,
    createMs: r.createMs,
    saveMs: r.saveMs,
    tailBytes: r.tailBytes,
    mode: r.mode,
  });
  (out.timings as Record<string, unknown>).recreate = { contract2000: pick(rc), a0Sheet: pick(ra) };
}

mkdirSync('spikes/s16-comment-transfer/out', { recursive: true });
writeFileSync(
  'spikes/s16-comment-transfer/out/s16-node.json',
  JSON.stringify(
    out,
    (_, v: unknown): unknown =>
      v instanceof Map
        ? Object.fromEntries(v)
        : v instanceof Set
          ? [...v]
          : v instanceof PdfStream
            ? '<stream>'
            : v,
    2,
  ),
);
console.log(JSON.stringify(out, null, 1).slice(0, 200));
