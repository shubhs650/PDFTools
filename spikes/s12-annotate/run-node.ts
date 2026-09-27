// M3-01 spike, Node part (ADR-014): what EmbedPDF 2.15.1's annotation calls
// cost on the one-call-at-a-time Render queue, and whether every tool, reply,
// review state and /NM round-trips through our narrow Ctrl+S. Real PDFium (the
// WASM the workers load), our SaveTracker and digest, self-made fixtures.
// Writes spikes/s12-annotate/out/s12-node.json.
//
//   node --import ./spikes/shared/ts-ext.ts spikes/s12-annotate/run-node.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
  type PdfSquareAnnoObject,
  type PdfTextAnnoObject,
} from '@embedpdf/models';
import { init } from '@embedpdf/pdfium';
import {
  buildPdf,
  contractPdf,
  markedContractPdf,
  markedSheetPdf,
  simplePdf,
} from '../../e2e/fixtures/generate.ts';
import { isDict, nameOf, PdfRef, PdfString, type PdfValue } from '../../src/model/pdf/objects.ts';
import { PdfReader } from '../../src/model/pdf/reader.ts';
import { concatBytes } from '../../src/workers/render/save/bytes.ts';
import { digestDocument } from '../../src/workers/render/save/digest.ts';
import { acquirePage, rawCall } from '../../src/workers/render/pdfium.ts';
import { SaveTracker } from '../../src/workers/render/save/tracker.ts';
import { compareDigests } from '../../src/workers/work/verifySave.ts';
import { everyToolAnnotation } from '../s1-save/annotations.ts';
import { annotBoxes, renderAnnotTile } from './annot-tiles.ts';

const require = createRequire(import.meta.url);
const mod = await init({
  wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
});
const native = new PdfiumNative(mod, { fontFallback: null });
const tracker = new SaveTracker(mod, native);
let seq = 0;

async function open(bytes: Uint8Array, track = false): Promise<PdfDocumentObject> {
  const id = `d${String(++seq)}`;
  const doc = await native.openDocumentBuffer({ id, content: bytes.slice().buffer }).toPromise();
  if (track) tracker.opened(id, bytes);
  return doc;
}
async function close(doc: PdfDocumentObject): Promise<void> {
  if (tracker.has(doc.id)) tracker.closed(doc.id);
  await native.closeDocument(doc).toPromise();
}
const ms = (t: number) => Math.round((performance.now() - t) * 100) / 100;
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const stats = (xs: number[]) => ({
  n: xs.length,
  p50: pct(xs, 50),
  p95: pct(xs, 95),
  max: pct(xs, 100),
  total: Math.round(xs.reduce((a, b) => a + b, 0)),
});
const pageOf = (doc: PdfDocumentObject, i: number) => {
  const p = doc.pages[i];
  if (!p) throw new Error(`no page ${String(i)}`);
  return p;
};

/** A tiny RGBA PNG (the image stamp's input). */
function png(w: number, h: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = (crcTable[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(
      Uint8Array.from(type, (c) => c.charCodeAt(0)),
      4,
    );
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
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

const out: Record<string, unknown> = {};

// ---- 1. Every tool through the narrow Ctrl+S, verified -------------------------
{
  const o = simplePdf(1);
  const doc = await open(o, true);
  const page = pageOf(doc, 0);
  const perTool: Record<string, unknown> = {};
  for (const t of everyToolAnnotation(0)) {
    const t0 = performance.now();
    const ctx = t.stampPng
      ? { data: png(64, 32).slice().buffer, mimeType: 'image/png' }
      : undefined;
    try {
      tracker.checkAllowed('createPageAnnotation', doc.id);
      await native.createPageAnnotation(doc, page, t.annotation, ctx as never).toPromise();
      tracker.recordMutation('createPageAnnotation', [doc, page, t.annotation]);
      perTool[t.tool] = { createMs: ms(t0) };
    } catch (e) {
      perTool[t.tool] = { error: JSON.stringify(e) };
    }
  }
  const r = tracker.saveIncremental(doc.id);
  const saved = concatBytes([o, r.tail]);
  // Appearance modes per annotation, read back raw from the saved file.
  const back = await open(saved);
  const ref = acquirePage(native, back.id, 0);
  const n = rawCall(mod, 'FPDFPage_GetAnnotCount', ref.pagePtr);
  const withAp: string[] = [];
  const withoutAp: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = rawCall(mod, 'FPDFPage_GetAnnot', ref.pagePtr, i);
    const sub = rawCall(mod, 'FPDFAnnot_GetSubtype', a);
    const modes = rawCall(mod, 'EPDFAnnot_GetAvailableAppearanceModes', a);
    (modes ? withAp : withoutAp).push(String(sub));
    rawCall(mod, 'FPDFPage_CloseAnnot', a);
  }
  ref.release();
  const actual = digestDocument(mod, native, back.id, [0]);
  const verify = r.expected ? compareDigests(r.expected, actual) : null;
  await close(back);
  await close(doc);
  out.tools = {
    count: Object.keys(perTool).length,
    failed: Object.entries(perTool).filter(([, v]) => 'error' in (v as object)),
    createMs: stats(
      Object.values(perTool).flatMap(
        (v) => ((v as { createMs?: number }).createMs ?? []) as number,
      ),
    ),
    saveMode: r.mode,
    tailBytes: r.tail.length,
    annotationsInSaved: n,
    withAppearance: withAp.length,
    withoutAppearanceSubtypes: withoutAp,
    verify,
  };
}

// ---- 2. Loading every annotation: what the plugin does at open ------------------
{
  const load = async (bytes: Uint8Array) => {
    const doc = await open(bytes);
    // getAllAnnotations = getAnnotationsBatch per 500 pages, LOW priority, one
    // uninterruptible executor call each (engines pdf-engine getAllAnnotations).
    const chunks: number[] = [];
    let count = 0;
    for (let i = 0; i < doc.pages.length; i += 500) {
      const t0 = performance.now();
      const r = await native.getAnnotationsBatch(doc, doc.pages.slice(i, i + 500)).toPromise();
      chunks.push(ms(t0));
      count += Object.values(r).reduce((a, x) => a + x.length, 0);
    }
    // Per page, once warm (what a visible-pages-only load would cost).
    const perPage: number[] = [];
    for (let i = 0; i < Math.min(doc.pages.length, 200); i++) {
      const t0 = performance.now();
      await native.getPageAnnotations(doc, pageOf(doc, i)).toPromise();
      perPage.push(ms(t0));
    }
    await close(doc);
    return {
      pages: doc.pages.length,
      annotations: count,
      chunkMs: stats(chunks),
      perPageWarmMs: stats(perPage),
    };
  };
  out.loadAll = {
    contract2000: await load(contractPdf(2000)),
    markedContract2000x5: await load(markedContractPdf(2000, 5)),
    markedSheet200kx1000: await load(markedSheetPdf(200_000, 1000)),
  };
}

// ---- 3. Appearance bitmaps (stock AnnotationLayer) vs annotations in tiles ------
{
  const sheet = await open(markedSheetPdf(200_000, 1000));
  const page = pageOf(sheet, 0);
  await native.getPageAnnotations(sheet, page).toPromise(); // parse once
  const appearances: Record<string, unknown> = {};
  for (const scale of [0.05, 0.25, 1]) {
    const t0 = performance.now();
    const map = await native
      .renderPageAnnotationsRaw(sheet, page, { scaleFactor: scale })
      .toPromise();
    let pixels = 0;
    for (const a of Object.values(map)) {
      const img = a.normal?.data;
      if (img) pixels += img.width * img.height;
    }
    appearances[`scale${String(scale)}`] = {
      ms: ms(t0),
      images: Object.keys(map).length,
      megapixels: Math.round(pixels / 1e4) / 100,
    };
  }
  // Tiles (256 px) with and without annotations, at fit-ish and 800 %.
  const tile = async (scale: number, withAnnotations: boolean) => {
    const xs: number[] = [];
    for (let i = 0; i < 24; i++) {
      const w = 256 / scale;
      const x = ((i * 977) % Math.max(1, page.size.width - w)) | 0;
      const y = ((i * 613) % Math.max(1, page.size.height - w)) | 0;
      const t0 = performance.now();
      await native
        .renderPageRect(
          sheet,
          page,
          { origin: { x, y }, size: { width: w, height: w } },
          {
            scaleFactor: scale,
            withAnnotations,
          },
        )
        .toPromise();
      xs.push(ms(t0));
    }
    return stats(xs);
  };
  // Annotation-only tiles: the markups intersecting a tile, each drawn with
  // EPDF_RenderAnnotBitmap through the tile's matrix (annot-tiles.ts).
  const ref = acquirePage(native, sheet.id, 0);
  const t0 = performance.now();
  const boxes = annotBoxes(mod, ref.pagePtr);
  const boxesMs = ms(t0);
  ref.release();
  const annotTile = (scale: number) => {
    const xs: number[] = [];
    let drawn = 0;
    for (let i = 0; i < 24; i++) {
      const w = 256 / scale;
      const x = ((i * 977) % Math.max(1, page.size.width - w)) | 0;
      const y = ((i * 613) % Math.max(1, page.size.height - w)) | 0;
      const t1 = performance.now();
      drawn += renderAnnotTile(mod, native, sheet.id, boxes, page.size.height, x, y, scale).drawn;
      xs.push(ms(t1));
    }
    return { ...stats(xs), annotationsDrawn: drawn };
  };
  const tiles = {
    scale0_25: {
      without: await tile(0.25, false),
      with: await tile(0.25, true),
      annotationTile: annotTile(0.25),
    },
    scale8: {
      without: await tile(8, false),
      with: await tile(8, true),
      annotationTile: annotTile(8),
    },
    annotationBoxesMs: boxesMs,
  };
  await close(sheet);
  // A markup the size of the sheet (a cloud around a whole area): the stock
  // layer renders one bitmap of the annotation's rect at the current zoom.
  const big = { width: 3000, height: 2000 };
  out.appearance = {
    markedSheet: appearances,
    tiles,
    fullSheetMarkupBitmapMegapixels: Object.fromEntries(
      [1, 4, 8, 64].map((z) => [
        `zoom${String(z * 100)}`,
        Math.round((big.width * z * big.height * z) / 1e6),
      ]),
    ),
  };
}

// ---- 4. Replies and review state round-trip ----------------------------------
{
  const o = simplePdf(1);
  const doc = await open(o, true);
  const page = pageOf(doc, 0);
  const parent: PdfSquareAnnoObject = {
    id: 'm3-01-parent',
    pageIndex: 0,
    type: PdfAnnotationSubtype.SQUARE,
    rect: { origin: { x: 100, y: 100 }, size: { width: 120, height: 60 } },
    author: 'Reviewer A',
    contents: 'Check this dimension',
    flags: ['print'],
    color: 'transparent',
    strokeColor: '#E44234',
    opacity: 1,
    strokeWidth: 2,
    strokeStyle: PdfAnnotationBorderStyle.SOLID,
  };
  const reply: PdfTextAnnoObject = {
    id: 'm3-01-reply',
    pageIndex: 0,
    type: PdfAnnotationSubtype.TEXT,
    rect: { origin: { x: 100, y: 100 }, size: { width: 20, height: 20 } },
    author: 'Vendor B',
    contents: 'Corrected in rev B',
    inReplyToId: 'm3-01-parent',
    replyType: PdfAnnotationReplyType.Reply,
    flags: ['print', 'noView'],
  };
  const state: PdfTextAnnoObject = {
    id: 'm3-01-state',
    pageIndex: 0,
    type: PdfAnnotationSubtype.TEXT,
    rect: { origin: { x: 100, y: 100 }, size: { width: 20, height: 20 } },
    author: 'Reviewer A',
    contents: 'Accepted set by Reviewer A',
    inReplyToId: 'm3-01-parent',
    replyType: PdfAnnotationReplyType.Reply,
    stateModel: PdfAnnotationStateModel.Review,
    state: PdfAnnotationState.Accepted,
    flags: ['print', 'noView', 'hidden'],
  };
  const errors: string[] = [];
  for (const a of [parent, reply, state] as PdfAnnotationObject[]) {
    try {
      await native.createPageAnnotation(doc, page, a).toPromise();
      tracker.recordMutation('createPageAnnotation', [doc, page, a]);
    } catch (e) {
      errors.push(`${a.id}: ${JSON.stringify(e)}`);
    }
  }
  const r = tracker.saveIncremental(doc.id);
  const saved = concatBytes([o, r.tail]);
  await close(doc);
  const back = await open(saved);
  const read = (await native
    .getPageAnnotations(back, pageOf(back, 0))
    .toPromise()) as PdfAnnotationObject[];
  await close(back);
  const byId = Object.fromEntries(read.map((a) => [a.id, a]));
  const rd = await PdfReader.open(saved);
  const [pg] = await rd.pages();
  const raw: Record<
    string,
    { IRT: string; RT: string; StateModel: string; State: string; Popup: string }
  > = {};
  const nums = new Map<number, string>();
  for (const ref of ((await rd.resolve(pg?.dict.get('Annots'))) as PdfValue[] | undefined) ?? []) {
    const a = await rd.resolve(ref);
    if (!isDict(a) || !(ref instanceof PdfRef)) continue;
    const nm = (a.get('NM') as PdfString | undefined)?.text() ?? '';
    nums.set(ref.num, nm);
    const irt = a.get('IRT');
    raw[nm] = {
      IRT: irt instanceof PdfRef ? `obj ${String(irt.num)}` : '-',
      RT: nameOf(a.get('RT')) ?? '-',
      StateModel: (a.get('StateModel') as PdfString | undefined)?.text() ?? '-',
      State: (a.get('State') as PdfString | undefined)?.text() ?? '-',
      Popup: a.has('Popup') ? 'yes' : 'no',
    };
  }
  for (const v of Object.values(raw))
    if (v.IRT.startsWith('obj ')) v.IRT = `→ ${nums.get(Number(v.IRT.slice(4))) ?? '?'}`;
  out.replies = {
    errors,
    mode: r.mode,
    read: Object.fromEntries(
      Object.entries(byId).map(([k, a]) => [
        k,
        {
          inReplyToId: (a as { inReplyToId?: string }).inReplyToId,
          replyType: (a as { replyType?: number }).replyType,
          state: (a as { state?: string }).state,
          stateModel: (a as { stateModel?: string }).stateModel,
        },
      ]),
    ),
    raw,
  };
}

// ---- 5. Viewer-made replies and states (Acrobat's form) are read ---------------
{
  const bytes = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R 5 0 R 6 0 R] >>',
    '<< /Type /Annot /Subtype /Square /Rect [100 600 220 660] /NM (acro-parent) /T (Acrobat user) /Contents (Parent) /C [1 0 0] >>',
    '<< /Type /Annot /Subtype /Text /Rect [100 600 120 620] /NM (acro-reply) /T (Other) /Contents (A reply) /IRT 4 0 R /F 28 >>',
    '<< /Type /Annot /Subtype /Text /Rect [100 600 120 620] /NM (acro-state) /T (Acrobat user) /Contents (Rejected set by Acrobat user) /IRT 4 0 R /StateModel (Review) /State (Rejected) /F 30 >>',
  ]);
  const doc = await open(bytes);
  const read = (await native
    .getPageAnnotations(doc, pageOf(doc, 0))
    .toPromise()) as PdfAnnotationObject[];
  await close(doc);
  out.viewerReplies = read.map((a) => ({
    id: a.id,
    type: a.type,
    inReplyToId: (a as { inReplyToId?: string }).inReplyToId,
    state: (a as { state?: string }).state,
    stateModel: (a as { stateModel?: string }).stateModel,
  }));
}

// ---- 6. /NM of an annotation that has none (ADR-005 consequence) -------------------
{
  const o = buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R] >>',
    '<< /Type /Annot /Subtype /Square /Rect [100 600 220 660] /T (Old viewer) /Contents (No NM) /C [1 0 0] >>',
  ]);
  const doc = await open(o, true);
  const page = pageOf(doc, 0);
  const [a] = (await native.getPageAnnotations(doc, page).toPromise()) as PdfAnnotationObject[];
  const assigned = a?.id ?? '';
  const noEdit = tracker.saveIncremental(doc.id);
  // Persist it: an update without changes marks the annotation dirty.
  const t0 = performance.now();
  if (a) {
    await native.updatePageAnnotation(doc, page, a).toPromise();
    tracker.recordMutation('updatePageAnnotation', [doc, page, a]);
  }
  const persisted = tracker.saveIncremental(doc.id);
  const saved = concatBytes([o, persisted.tail]);
  const rd = await PdfReader.open(saved);
  const annot = await rd.get(4);
  out.nm = {
    assignedInMemory: assigned.length > 0,
    tailWithoutEdit: noEdit.tail.length,
    tailAfterNoOpUpdate: persisted.tail.length,
    updateMs: ms(t0),
    persistedMatches:
      isDict(annot) && (annot.get('NM') as PdfString | undefined)?.text() === assigned,
    keptObjects: persisted.kept,
  };
  await close(doc);
}

// ---- 7. PDFium exports the spike used (B14) ---------------------------------------
out.directExports = [
  'EPDF_RenderAnnotBitmap',
  'FPDFAnnot_GetRect',
  'FPDFBitmap_CreateEx',
  'FPDFBitmap_FillRect',
  'FPDFBitmap_Destroy',
  'FPDFPage_GetAnnotCount',
  'FPDFPage_GetAnnot',
  'FPDFAnnot_GetSubtype',
  'EPDFAnnot_GetAvailableAppearanceModes',
  'FPDFPage_CloseAnnot',
];

mkdirSync('spikes/s12-annotate/out', { recursive: true });
writeFileSync('spikes/s12-annotate/out/s12-node.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
