// Spike S28 (M12-03): PDFium in Node for the harness. In the app this is the
// Work worker's job (D-66): analysis rasters, line geometry and positioned
// text. Everything is returned in the displayed page's space: pt, origin top
// left, y down, /Rotate and the CropBox applied, like the viewer.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { extractGeometry } from '../../src/workers/work/geometry.ts';
import { applyMat, invertMat, type Mat } from './geom.ts';
import type { Ink } from './image.ts';

type F = (...a: (number | string)[]) => number;
interface Em {
  wasmExports: { malloc(n: number): number; free(p: number): void; memory?: WebAssembly.Memory };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  HEAPF64: Float64Array;
  stringToUTF8(s: string, ptr: number, max: number): void;
}

let modP: Promise<WrappedPdfiumModule> | null = null;

export function pdfium(): Promise<WrappedPdfiumModule> {
  modP ??= (async () => {
    const root = join(import.meta.dirname, '..', '..');
    const mod = await init({
      wasmBinary: readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm')),
    });
    new PdfiumNative(mod, { fontFallback: null }); // initialises the library
    return mod;
  })();
  return modP;
}

const em = (mod: WrappedPdfiumModule): Em => mod.pdfium as unknown as Em;
export const call = (mod: WrappedPdfiumModule, n: string, ...a: (number | string)[]): number => {
  const f = (mod as unknown as Record<string, F | undefined>)[n];
  if (!f) throw new Error(`missing ${n}`);
  return f(...a);
};

/** WASM heap size in bytes (PDFium's memory). */
export function heapBytes(mod: WrappedPdfiumModule): number {
  return em(mod).wasmExports.memory?.buffer.byteLength ?? em(mod).HEAPU8.length;
}

export interface Doc {
  mod: WrappedPdfiumModule;
  ptr: number;
  pages: number;
  close(): void;
}

export function openDoc(mod: WrappedPdfiumModule, bytes: Uint8Array, password = ''): Doc {
  const e = em(mod);
  const buf = e.wasmExports.malloc(bytes.length);
  e.HEAPU8.set(bytes, buf);
  const ptr = call(mod, 'FPDF_LoadMemDocument', buf, bytes.length, password);
  if (!ptr) {
    e.wasmExports.free(buf);
    throw new Error(`load failed (${String(call(mod, 'FPDF_GetLastError'))})`);
  }
  return {
    mod,
    ptr,
    pages: call(mod, 'FPDF_GetPageCount', ptr),
    close: () => {
      call(mod, 'FPDF_CloseDocument', ptr);
      e.wasmExports.free(buf);
    },
  };
}

export interface PageInfo {
  /** Displayed size in pt (after /Rotate). */
  w: number;
  h: number;
  rotation: number;
  /** User space → displayed page (pt, y down). */
  toDisplay: Mat;
}

function withPage<T>(doc: Doc, index: number, fn: (page: number) => T): T {
  const page = call(doc.mod, 'FPDF_LoadPage', doc.ptr, index);
  if (!page) throw new Error(`page ${String(index)} not loaded`);
  try {
    return fn(page);
  } finally {
    call(doc.mod, 'FPDF_ClosePage', page);
  }
}

export function pageInfo(doc: Doc, index: number): PageInfo {
  return withPage(doc, index, (page) => {
    const { mod } = doc;
    const e = em(mod);
    const w = call(mod, 'FPDF_GetPageWidthF', page);
    const h = call(mod, 'FPDF_GetPageHeightF', page);
    const rotation = call(mod, 'FPDFPage_GetRotation', page);
    // FPDF_PageToDevice returns integers: ask for a 1000× device and divide.
    const K = 1000;
    const buf = e.wasmExports.malloc(8);
    const dev = (x: number, y: number): [number, number] => {
      call(
        mod,
        'FPDF_PageToDevice',
        page,
        0,
        0,
        Math.round(w * K),
        Math.round(h * K),
        0,
        x,
        y,
        buf,
        buf + 4,
      );
      return [(e.HEAP32[buf >> 2] ?? 0) / K, (e.HEAP32[(buf >> 2) + 1] ?? 0) / K];
    };
    // Three points far apart fix the affine map.
    const S = 1000;
    const [ox, oy] = dev(0, 0);
    const [xx, xy] = dev(S, 0);
    const [yx, yy] = dev(0, S);
    e.wasmExports.free(buf);
    const toDisplay: Mat = [(xx - ox) / S, (xy - oy) / S, (yx - ox) / S, (yy - oy) / S, ox, oy];
    return { w, h, rotation, toDisplay };
  });
}

const FPDF_RENDER_NO_SMOOTHTEXT = 0x1000;
const FPDF_RENDER_NO_SMOOTHIMAGE = 0x2000;
const FPDF_RENDER_NO_SMOOTHPATH = 0x4000;
const FPDFBitmap_BGRA = 4;

export interface RenderOptions {
  /** Pixels per pt of the output frame. */
  scale: number;
  /** Output frame size in pixels. */
  width: number;
  height: number;
  /** Displayed page (pt) → output frame (pt) before scaling; default identity. */
  place?: Mat;
  /** Anti-aliasing off (binary-looking ink, thin lines kept 1 px). */
  aliased?: boolean;
  /** Rows per band (memory bound). */
  band?: number;
}

/**
 * Renders a page (content only: no annotations, no form fields) as an ink
 * raster, through an optional placement, in bands so the bitmap stays small.
 * Ink = 255 − the darkest of R, G, B: coloured lines count as ink, light
 * fills do not.
 */
export function renderInk(doc: Doc, index: number, o: RenderOptions): Ink {
  const { mod } = doc;
  const e = em(mod);
  const band = Math.max(1, Math.min(o.band ?? 512, o.height));
  const out = new Uint8Array(o.width * o.height);
  const flags = o.aliased
    ? FPDF_RENDER_NO_SMOOTHPATH | FPDF_RENDER_NO_SMOOTHTEXT | FPDF_RENDER_NO_SMOOTHIMAGE
    : 0;
  const place = o.place ?? [1, 0, 0, 1, 0, 0];
  withPage(doc, index, (page) => {
    const bmp = call(mod, 'FPDFBitmap_CreateEx', o.width, band, FPDFBitmap_BGRA, 0, 0);
    if (!bmp) throw new Error('bitmap');
    const mPtr = e.wasmExports.malloc(24 + 16);
    const cPtr = mPtr + 24;
    try {
      for (let top = 0; top < o.height; top += band) {
        const rows = Math.min(band, o.height - top);
        call(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, o.width, band, 0xffffffff);
        const m = [
          place[0] * o.scale,
          place[1] * o.scale,
          place[2] * o.scale,
          place[3] * o.scale,
          place[4] * o.scale,
          place[5] * o.scale - top,
        ];
        const f = e.HEAPF32;
        for (let i = 0; i < 6; i++) f[(mPtr >> 2) + i] = m[i] ?? 0;
        f[cPtr >> 2] = 0;
        f[(cPtr >> 2) + 1] = 0;
        f[(cPtr >> 2) + 2] = o.width;
        f[(cPtr >> 2) + 3] = rows;
        call(mod, 'FPDF_RenderPageBitmapWithMatrix', bmp, page, mPtr, cPtr, flags);
        const buf = call(mod, 'FPDFBitmap_GetBuffer', bmp);
        const stride = call(mod, 'FPDFBitmap_GetStride', bmp);
        const heap = em(mod).HEAPU8; // re-read: the heap may have grown
        for (let y = 0; y < rows; y++) {
          let p = buf + y * stride;
          const q = (top + y) * o.width;
          for (let x = 0; x < o.width; x++, p += 4) {
            const b = heap[p] ?? 255;
            const g = heap[p + 1] ?? 255;
            const r = heap[p + 2] ?? 255;
            out[q + x] = 255 - Math.min(r, g, b);
          }
        }
      }
    } finally {
      e.wasmExports.free(mPtr);
      call(mod, 'FPDFBitmap_Destroy', bmp);
    }
  });
  return { w: o.width, h: o.height, data: out };
}

/** The page's line segments (vector content, curves flattened) in displayed space. */
export async function segments(doc: Doc, index: number): Promise<Float32Array> {
  const info = pageInfo(doc, index);
  const { segs } = await extractGeometry(doc.mod, doc.ptr, index, null);
  const m = info.toDisplay;
  for (let i = 0; i < segs.length; i += 2) {
    const [x, y] = applyMat(m, segs[i] ?? 0, segs[i + 1] ?? 0);
    segs[i] = x;
    segs[i + 1] = y;
  }
  return segs;
}

export interface Glyph {
  ch: string;
  /** Centre in displayed space. */
  x: number;
  y: number;
  size: number;
}

/** Positioned characters (PDFium text) in displayed space. */
export function glyphs(doc: Doc, index: number): Glyph[] {
  const info = pageInfo(doc, index);
  return withPage(doc, index, (page) => {
    const { mod } = doc;
    const e = em(mod);
    const tp = call(mod, 'FPDFText_LoadPage', page);
    const out: Glyph[] = [];
    if (!tp) return out;
    const b = e.wasmExports.malloc(32);
    try {
      const n = call(mod, 'FPDFText_CountChars', tp);
      for (let i = 0; i < n; i++) {
        const u = call(mod, 'FPDFText_GetUnicode', tp, i);
        if (u <= 32) continue;
        if (!call(mod, 'FPDFText_GetCharBox', tp, i, b, b + 8, b + 16, b + 24)) continue;
        const f = e.HEAPF64;
        const l = f[b >> 3] ?? 0;
        const r = f[(b >> 3) + 1] ?? 0;
        const bo = f[(b >> 3) + 2] ?? 0;
        const t = f[(b >> 3) + 3] ?? 0;
        const [x, y] = applyMat(info.toDisplay, (l + r) / 2, (bo + t) / 2);
        out.push({ ch: String.fromCodePoint(u), x, y, size: Math.max(Math.abs(t - bo), 0.1) });
      }
    } finally {
      e.wasmExports.free(b);
      call(mod, 'FPDFText_ClosePage', tp);
    }
    return out;
  });
}

export const displayToUser = (info: PageInfo): Mat => invertMat(info.toDisplay);
