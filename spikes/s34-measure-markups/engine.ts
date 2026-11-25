// Spike S34 (M14-01, D-74): the app's own engine in Node. PDFium WASM and
// EmbedPDF's PdfiumNative as the Render worker runs them, the app's SaveTracker
// for Ctrl+S (incremental, staged object keys), the comment-font FaceStore with
// the fonts that ship with the app (vendor/fonts/files), and the readbacks the
// app installs (fonts, leader lines).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { PdfDocumentObject } from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { FaceStore } from '../../src/workers/render/commentFonts/faces.ts';
import { installFontReadback } from '../../src/workers/render/freeTextFonts.ts';
import { installLeaderReadback } from '../../src/workers/render/leaderReadback.ts';
import { acquirePage, docPtrOf, rawCall, withWideString } from '../../src/workers/render/pdfium.ts';
import { concatBytes } from '../../src/workers/render/save/bytes.ts';
import { SaveTracker } from '../../src/workers/render/save/tracker.ts';

const require = createRequire(import.meta.url);
const VENDOR = fileURLToPath(new URL('../../vendor/fonts/files/', import.meta.url));

export interface Engine {
  mod: WrappedPdfiumModule;
  native: PdfiumNative;
  tracker: SaveTracker;
  faces: FaceStore;
  /** Font files loaded so far (only fonts that ship with the app). */
  fontFiles: string[];
}

let shared: Promise<Engine> | null = null;

export function engine(): Promise<Engine> {
  shared ??= (async () => {
    const mod = await init({
      wasmBinary: readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
    });
    const native = new PdfiumNative(mod, { fontFallback: null });
    installFontReadback(native);
    installLeaderReadback(mod, native);
    const tracker = new SaveTracker(mod, native);
    const fontFiles: string[] = [];
    const faces = new FaceStore({
      harfbuzz: () => import('harfbuzzjs'),
      subsetWasm: () =>
        Promise.resolve(readFileSync(require.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'))),
      fontFile: (file) => {
        fontFiles.push(file);
        return Promise.resolve(new Uint8Array(readFileSync(join(VENDOR, file))));
      },
    });
    return { mod, native, tracker, faces, fontFiles };
  })();
  return shared;
}

let seq = 0;

/** Opens bytes as the Render worker does (tracked for Ctrl+S). */
export async function open(e: Engine, bytes: Uint8Array): Promise<PdfDocumentObject> {
  const id = `s34-${String(++seq)}`;
  const doc = await e.native
    .openDocumentBuffer({ id, content: bytes.slice().buffer }, {})
    .toPromise();
  e.tracker.opened(id, bytes);
  await e.tracker.securityReady(id);
  return doc;
}

/** Ctrl+S: the opened bytes plus the narrow incremental tail; committed. */
export async function save(e: Engine, doc: PdfDocumentObject, opened: Uint8Array) {
  const s = await e.tracker.save(doc.id);
  e.tracker.commit(doc.id, s.tail.length);
  return { bytes: concatBytes([opened, s.tail]), tail: s.tail.length, mode: s.mode };
}

/** Runs `fn` with the annotation named `id` (/NM) on page `pageIndex`. */
export function withAnnot<T>(
  e: Engine,
  docId: string,
  pageIndex: number,
  id: string,
  fn: (annot: number, pagePtr: number) => T,
): T | null {
  const ref = acquirePage(e.native, docId, pageIndex);
  try {
    const a = withWideString(e.mod, id, (p) =>
      rawCall(e.mod, 'EPDFPage_GetAnnotByName', ref.pagePtr, p),
    );
    if (!a) return null;
    try {
      return fn(a, ref.pagePtr);
    } finally {
      rawCall(e.mod, 'FPDFPage_CloseAnnot', a);
    }
  } finally {
    ref.release();
  }
}

/** A page rendered by PDFium (comments drawn), as RGBA rows, `scale` pixels per point. */
export function renderPage(
  e: Engine,
  docId: string,
  pageIndex: number,
  scale: number,
): { width: number; height: number; rgba: Uint8Array } {
  const page = rawCall(e.mod, 'FPDF_LoadPage', docPtrOf(e.native, docId), pageIndex);
  const w = Math.round(rawCall(e.mod, 'FPDF_GetPageWidthF', page) * scale);
  const h = Math.round(rawCall(e.mod, 'FPDF_GetPageHeightF', page) * scale);
  const bmp = rawCall(e.mod, 'FPDFBitmap_Create', w, h, 0);
  rawCall(e.mod, 'FPDFBitmap_FillRect', bmp, 0, 0, w, h, 0xffffffff);
  rawCall(e.mod, 'FPDF_RenderPageBitmap', bmp, page, 0, 0, w, h, 0, 1);
  const buf = rawCall(e.mod, 'FPDFBitmap_GetBuffer', bmp);
  const stride = rawCall(e.mod, 'FPDFBitmap_GetStride', bmp);
  const heap = (e.mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const at = buf + y * stride + x * 4;
      const o = (y * w + x) * 4;
      rgba[o] = heap[at + 2] ?? 0;
      rgba[o + 1] = heap[at + 1] ?? 0;
      rgba[o + 2] = heap[at] ?? 0;
      rgba[o + 3] = 255;
    }
  rawCall(e.mod, 'FPDFBitmap_Destroy', bmp);
  rawCall(e.mod, 'FPDF_ClosePage', page);
  return { width: w, height: h, rgba };
}
