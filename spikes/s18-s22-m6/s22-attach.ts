// S22 — Attach File comment (ADR-021 D-38 d). EmbedPDF 2.15.1 cannot create a
// /FileAttachment annotation (createPageAnnotation has no case for it). The
// PDFium build it ships exports FPDFAnnot_AddFileAttachment, FPDFAttachment_SetFile
// and FPDFAnnot_SetAP, so the Render worker can create the annotation, its
// embedded file and our paperclip appearance with direct calls (ADR-001 B14)
// instead of writing the objects with our object layer. Checks: narrow Ctrl+S
// + verification, qpdf, the file extracts byte-identical (PDFium and our
// Attachments pane code), EmbedPDF reads it back, the appearance renders,
// an encrypted document, timing for a 20 MB file.
import { performance } from 'node:perf_hooks';
import { PdfAnnotationSubtype, type PdfDocumentObject } from '@embedpdf/models';
import { qpdfEncrypt } from '../../e2e/fixtures/encrypted.ts';
import { simplePdf } from '../../e2e/fixtures/generate.ts';
import { acquirePage, withWideString } from '../../src/workers/render/pdfium.ts';
import { listAttachments, readAttachment } from '../../src/workers/work/attachments.ts';
import { annotBoxes, renderAnnotTile } from '../s12-annotate/annot-tiles.ts';
import {
  annotsOf,
  closeDoc,
  ctrlS,
  exec,
  mod,
  ms,
  native,
  openDoc,
  openPlain,
  pageOf,
  qpdfCheck,
  qpdfJson,
  rawCall,
  tracker,
} from './harness.ts';

const FPDF_ANNOT_FILEATTACHMENT = 17;
const APPEARANCE_NORMAL = 0;
const slice = { signal: new AbortController().signal, checkpoint: () => Promise.resolve() };

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
}
const heap = mod.pdfium as unknown as Heap;

/**
 * A paperclip in a 20 × 20 box, stroked in the comment colour: our own drawing
 * (rule 15), Fluent-like 1.5 pt round strokes.
 */
const PAPERCLIP =
  'q 1 0 0 RG 1.5 w 1 J 1 j ' +
  '13 5 m 13 14 l 13 16.2 11.2 18 9 18 c 6.8 18 5 16.2 5 14 c 5 6 l ' +
  '5 3.8 6.8 2 9 2 c 11.2 2 13 3.8 13 6 c 13 13 l ' +
  '13 14.1 12.1 15 11 15 c 9.9 15 9 14.1 9 13 c 9 7 l S Q';

/** Creates the annotation with direct PDFium calls; returns its /NM. */
function attach(
  doc: PdfDocumentObject,
  pageIndex: number,
  at: { x: number; y: number },
  file: { name: string; bytes: Uint8Array },
  note: string,
): string {
  const ref = acquirePage(native, doc.id, pageIndex);
  const nm = `att-${String(Math.round(at.x))}-${String(Math.round(at.y))}`;
  try {
    const a = rawCall(mod, 'FPDFPage_CreateAnnot', ref.pagePtr, FPDF_ANNOT_FILEATTACHMENT);
    if (!a) throw new Error('FPDFPage_CreateAnnot failed');
    try {
      const r = heap.wasmExports.malloc(16);
      heap.HEAPF32.set([at.x, at.y + 20, at.x + 20, at.y], r / 4); // left, top, right, bottom
      const okRect = rawCall(mod, 'FPDFAnnot_SetRect', a, r);
      heap.wasmExports.free(r);
      const att = withWideString(mod, file.name, (p) =>
        rawCall(mod, 'FPDFAnnot_AddFileAttachment', a, p),
      );
      if (!att) throw new Error('FPDFAnnot_AddFileAttachment failed');
      const buf = heap.wasmExports.malloc(Math.max(1, file.bytes.length));
      heap.HEAPU8.set(file.bytes, buf);
      const docPtr = (
        native as unknown as { cache: { getContext(id: string): { docPtr: number } } }
      ).cache.getContext(doc.id).docPtr;
      const okFile = rawCall(mod, 'FPDFAttachment_SetFile', att, docPtr, buf, file.bytes.length);
      heap.wasmExports.free(buf);
      const set = (key: string, v: string) =>
        withWideString(mod, v, (p) => rawCall(mod, 'FPDFAnnot_SetStringValue', a, key, p));
      set('Contents', note);
      set('T', 'Spike Author');
      set('NM', nm);
      // /Name /Paperclip (PdfAnnotationName.Paperclip = 9) and /C red.
      const okName = rawCall(mod, 'EPDFAnnot_SetName', a, 9);
      const okColor = rawCall(mod, 'FPDFAnnot_SetColor', a, 0, 255, 0, 0, 255);
      // FPDFAnnot_SetAP gives the stream /BBox = /Rect in page space: draw there.
      const ap = `q 1 0 0 1 ${String(at.x)} ${String(at.y)} cm ${PAPERCLIP} Q`;
      const okAp = withWideString(mod, ap, (p) =>
        rawCall(mod, 'FPDFAnnot_SetAP', a, APPEARANCE_NORMAL, p),
      );
      if (!okRect || !okFile || !okAp || !okName || !okColor)
        throw new Error(
          `rect ${String(okRect)} file ${String(okFile)} ap ${String(okAp)} name ${String(okName)} color ${String(okColor)}`,
        );
    } finally {
      rawCall(mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
  // What the Render worker's RPC would record: the page's /Annots changed.
  tracker.recordMutation('createPageAnnotation', [doc, doc.pages[pageIndex], { id: nm }]);
  return nm;
}

const pattern = (n: number) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + (i >> 8)) & 0xff;
  return b;
};

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

async function readBack(bytes: Uint8Array, password?: string) {
  const r = await openPlain(bytes, password);
  if ('error' in r) return { error: r.error };
  const doc = r.doc;
  const list = await listAttachments(mod, native, doc, slice, () => undefined);
  const files = await Promise.all(
    list.map(async (a) => ({
      name: a.name,
      description: a.description,
      size: a.size,
      bytes: new Uint8Array(await readAttachment(mod, native, doc, a.ref)),
    })),
  );
  const annots = await annotsOf(doc);
  const fa = annots.filter((a) => a.type === PdfAnnotationSubtype.FILEATTACHMENT);
  // The appearance: draw only the annotation into a tile over its rect.
  const ref = acquirePage(native, doc.id, 0);
  const boxes = annotBoxes(mod, ref.pagePtr);
  ref.release();
  const box = boxes[0];
  let inked = 0;
  if (box) {
    const tile = renderAnnotTile(
      mod,
      native,
      doc.id,
      boxes,
      842,
      box.l - 2,
      842 - box.t - 2,
      4,
      128,
    );
    for (let i = 3; i < tile.data.length; i += 4) if ((tile.data[i] ?? 0) > 0) inked++;
  }
  await native.closeDocument(doc).toPromise();
  return {
    files,
    embedpdfReads: fa.map((a) => ({
      type: 'FILEATTACHMENT',
      contents: a.contents,
      author: a.author,
    })),
    appearancePixels: inked,
  };
}

export async function run(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  // 1. A small file on page 1; narrow Ctrl+S; read back.
  {
    const src = simplePdf(2);
    const doc = await openDoc(src);
    const file = { name: 'calc-sheet.csv', bytes: new TextEncoder().encode('a,b\n1,2\n') };
    const t0 = performance.now();
    attach(doc, 0, { x: 400, y: 700 }, file, 'See the calculation');
    const createMs = ms(t0);
    const inMemory = await annotsOf(doc);
    const saved = await ctrlS(doc, src);
    await closeDoc(doc);
    const back = await readBack(saved.bytes);
    const j = qpdfJson(saved.bytes);
    const annot = Object.values(j.qpdf[1])
      .map((v) => v.value as Record<string, unknown> | undefined)
      .find((v) => v?.['/Subtype'] === '/FileAttachment');
    const fsRef = annot?.['/FS'];
    const fs =
      typeof fsRef === 'string'
        ? (j.qpdf[1][`obj:${fsRef}`]?.value as Record<string, unknown> | undefined)
        : fsRef;
    out.small = {
      createMs,
      inMemoryTypes: inMemory.map((a) => PdfAnnotationSubtype[a.type]),
      save: { mode: saved.mode, fellBack: saved.fellBack, tailBytes: saved.tailBytes },
      qpdfCheck: qpdfCheck(saved.bytes),
      annotKeys: annot ? Object.keys(annot).sort() : null,
      annotName: annot?.['/Name'],
      annotColor: annot?.['/C'],
      appearance: (() => {
        const apRef = (annot?.['/AP'] as Record<string, unknown> | undefined)?.['/N'];
        const st = typeof apRef === 'string' ? j.qpdf[1][`obj:${apRef}`]?.stream?.dict : undefined;
        return st;
      })(),
      fileSpec: fs,
      readBack:
        'files' in back
          ? {
              ...back,
              files: back.files.map((f) => ({
                name: f.name,
                description: f.description,
                size: f.size,
                identical: same(f.bytes, file.bytes),
              })),
            }
          : back,
    };
  }

  // 2. 20 MB binary: timing, size, identity.
  {
    const src = simplePdf(1);
    const doc = await openDoc(src);
    const file = { name: 'model.bin', bytes: pattern(20 * 1024 * 1024) };
    const t0 = performance.now();
    attach(doc, 0, { x: 72, y: 72 }, file, 'Large file');
    const createMs = ms(t0);
    const saved = await ctrlS(doc, src);
    await closeDoc(doc);
    const back = await readBack(saved.bytes);
    out.big20MB = {
      createMs,
      save: {
        mode: saved.mode,
        fellBack: saved.fellBack,
        tailBytes: saved.tailBytes,
        ms: saved.ms,
      },
      compressed: saved.tailBytes < file.bytes.length,
      qpdfCheck: qpdfCheck(saved.bytes),
      identical:
        'files' in back ? same(back.files[0]?.bytes ?? new Uint8Array(), file.bytes) : back,
    };
  }

  // 3. An AES-256 document opened with the owner password.
  {
    const src = qpdfEncrypt(simplePdf(1), 'u', 'o', ['256']);
    const doc = await openDoc(src, 'o');
    const file = { name: 'note.txt', bytes: new TextEncoder().encode('encrypted host') };
    attach(doc, 0, { x: 300, y: 500 }, file, 'In an encrypted file');
    const saved = await ctrlS(doc, src);
    await closeDoc(doc);
    const back = await readBack(saved.bytes, 'u');
    out.encrypted = {
      save: { mode: saved.mode, fellBack: saved.fellBack, tailBytes: saved.tailBytes },
      qpdfCheck: qpdfCheck(saved.bytes, 'u'),
      identical:
        'files' in back ? same(back.files[0]?.bytes ?? new Uint8Array(), file.bytes) : back,
      plaintextVisible: new TextDecoder('latin1')
        .decode(saved.bytes.subarray(src.length))
        .includes('encrypted host'),
    };
  }

  // 4. Undo = remove the annotation (EmbedPDF's removePageAnnotation by /NM).
  {
    const src = simplePdf(1);
    const doc = await openDoc(src);
    attach(doc, 0, { x: 300, y: 500 }, { name: 'x.txt', bytes: new Uint8Array([1, 2, 3]) }, 'x');
    const list = await annotsOf(doc);
    const a = list[0];
    let removed: unknown = 'none listed';
    if (a) removed = await native.removePageAnnotation(doc, pageOf(doc), a).toPromise();
    tracker.recordMutation('removePageAnnotation', [doc, doc.pages[0], a]);
    const saved = await ctrlS(doc, src);
    await closeDoc(doc);
    const r = await openPlain(saved.bytes);
    const left = 'doc' in r ? (await annotsOf(r.doc)).length : -1;
    if ('doc' in r) await native.closeDocument(r.doc).toPromise();
    out.undoByRemove = {
      removed,
      save: { mode: saved.mode, tailBytes: saved.tailBytes },
      annotationsLeft: left,
    };
  }

  // 5. Moving it with EmbedPDF (the select tool's drag): updatePageAnnotation.
  {
    const src = simplePdf(1);
    const doc = await openDoc(src);
    attach(doc, 0, { x: 300, y: 500 }, { name: 'm.txt', bytes: new Uint8Array([7]) }, 'move me');
    const [a] = await annotsOf(doc);
    let moved: unknown = 'none listed';
    if (a) {
      const rect = {
        origin: { x: a.rect.origin.x + 100, y: a.rect.origin.y + 50 },
        size: a.rect.size,
      };
      moved = await exec('updatePageAnnotation', doc, doc.pages[0], { ...a, rect }).catch(
        (e: unknown) => `threw: ${(e as Error).message}`,
      );
    }
    const saved = await ctrlS(doc, src);
    await closeDoc(doc);
    const back = await readBack(saved.bytes);
    const r = await openPlain(saved.bytes);
    const after = 'doc' in r ? (await annotsOf(r.doc))[0]?.rect : null;
    if ('doc' in r) await native.closeDocument(r.doc).toPromise();
    out.move = {
      moved,
      before: a?.rect,
      after,
      save: { mode: saved.mode, fellBack: saved.fellBack },
      appearancePixels: 'appearancePixels' in back ? back.appearancePixels : back,
      fileKept: 'files' in back ? back.files.length : back,
    };
  }
  return out;
}
