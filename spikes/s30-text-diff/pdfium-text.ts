// Spike S30 (M12-05): positioned characters from PDFium (FPDFText), the input
// of route 1 (our own reading order). In the app this is the Work worker's job
// (D-66). Everything is in the displayed page's space: pt, origin top left,
// y down, /Rotate and the CropBox applied, like the viewer (S28's pageInfo).

import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { applyMat } from '../s28-alignment/geom.ts';
import { call, pageInfo, type Doc } from '../s28-alignment/pdfium.ts';

export interface Char {
  /** The character (one code point; PDFium's own unicode). */
  ch: string;
  /** Loose box (font ascent to descent), displayed space. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Baseline origin, displayed space. */
  ox: number;
  oy: number;
  size: number;
  bold: boolean;
  /** Text render mode 3 (invisible: an OCR layer over a scan). */
  invisible: boolean;
  /** A space or line break PDFium added (not in the content). */
  generated: boolean;
  /** Text direction angle in degrees (0 = horizontal, left to right). */
  angle: number;
}

export interface Figure {
  /** Displayed space. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** FNV-1a hash of the decoded pixels (exact sameness). */
  hash: string;
  /** 16 × 16 grey thumbnail, 0–255 (how different two pictures are). */
  thumb: Uint8Array;
}

export interface PageText {
  w: number;
  h: number;
  chars: Char[];
  /** Share of the page covered by images (1 = a scan). */
  imageCover: number;
  /** Images, in content order. */
  figures: Figure[];
  /** Path objects (rulings, drawings): a table needs rulings or numbers. */
  paths: number;
}

/** Hash and thumbnail of an image object's pixels (FPDFImageObj_GetBitmap). */
function imagePixels(mod: WrappedPdfiumModule, obj: number): { hash: string; thumb: Uint8Array } {
  const bmp = call(mod, 'FPDFImageObj_GetBitmap', obj);
  const thumb = new Uint8Array(256);
  if (!bmp) return { hash: 'none', thumb };
  try {
    const w = call(mod, 'FPDFBitmap_GetWidth', bmp);
    const h = call(mod, 'FPDFBitmap_GetHeight', bmp);
    const stride = call(mod, 'FPDFBitmap_GetStride', bmp);
    const fmt = call(mod, 'FPDFBitmap_GetFormat', bmp);
    const bpp = fmt === 1 ? 1 : fmt === 2 ? 3 : 4;
    const buf = call(mod, 'FPDFBitmap_GetBuffer', bmp);
    const heap = (mod.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
    let hsh = 0x811c9dc5;
    const sum = new Float64Array(256);
    const cnt = new Float64Array(256);
    for (let y = 0; y < h; y++) {
      const row = buf + y * stride;
      const ty = Math.min(15, Math.floor((y * 16) / h));
      for (let x = 0; x < w; x++) {
        const p = row + x * bpp;
        let g = 0;
        for (let k = 0; k < Math.min(bpp, 3); k++) {
          const v = heap[p + k] ?? 0;
          g += v;
          hsh = Math.imul(hsh ^ v, 0x01000193);
        }
        const i = ty * 16 + Math.min(15, Math.floor((x * 16) / w));
        sum[i] = (sum[i] ?? 0) + g / Math.min(bpp, 3);
        cnt[i] = (cnt[i] ?? 0) + 1;
      }
    }
    for (let i = 0; i < 256; i++)
      thumb[i] = (cnt[i] ?? 0) ? Math.round((sum[i] ?? 0) / (cnt[i] ?? 1)) : 255;
    return { hash: `${String(w)}x${String(h)}:${(hsh >>> 0).toString(16)}`, thumb };
  } finally {
    call(mod, 'FPDFBitmap_Destroy', bmp);
  }
}

interface Em {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPF64: Float64Array;
  HEAPF32: Float32Array;
}
const em = (mod: WrappedPdfiumModule): Em => mod.pdfium as unknown as Em;

const FPDF_PAGEOBJ_PATH = 2;
const FPDF_PAGEOBJ_IMAGE = 3;

export function pageText(doc: Doc, index: number): PageText {
  const info = pageInfo(doc, index);
  const { mod } = doc;
  const e = em(mod);
  const page = call(mod, 'FPDF_LoadPage', doc.ptr, index);
  if (!page) throw new Error(`page ${String(index)} not loaded`);
  const chars: Char[] = [];
  const figures: Figure[] = [];
  let imageArea = 0;
  let paths = 0;
  const b = e.wasmExports.malloc(64);
  try {
    // Images: the share of the page they cover (a scanned page is one image).
    const nObj = call(mod, 'FPDFPage_CountObjects', page);
    for (let i = 0; i < nObj; i++) {
      const obj = call(mod, 'FPDFPage_GetObject', page, i);
      const type = call(mod, 'FPDFPageObj_GetType', obj);
      if (type === FPDF_PAGEOBJ_PATH) paths++;
      if (type !== FPDF_PAGEOBJ_IMAGE) continue;
      if (!call(mod, 'FPDFPageObj_GetBounds', obj, b, b + 4, b + 8, b + 12)) continue;
      const f = e.HEAPF32;
      const l = f[b >> 2] ?? 0;
      const bo = f[(b >> 2) + 1] ?? 0;
      const r = f[(b >> 2) + 2] ?? 0;
      const t = f[(b >> 2) + 3] ?? 0;
      imageArea += Math.max(0, r - l) * Math.max(0, t - bo);
      const [ax, ay] = applyMat(info.toDisplay, l, t);
      const [bx, by] = applyMat(info.toDisplay, r, bo);
      figures.push({
        x0: Math.min(ax, bx),
        y0: Math.min(ay, by),
        x1: Math.max(ax, bx),
        y1: Math.max(ay, by),
        ...imagePixels(mod, obj),
      });
    }
    const tp = call(mod, 'FPDFText_LoadPage', page);
    if (tp) {
      try {
        const n = call(mod, 'FPDFText_CountChars', tp);
        const style = new Map<
          number,
          { invisible: boolean; size: number; bold: boolean; angle: number }
        >();
        for (let i = 0; i < n; i++) {
          const u = call(mod, 'FPDFText_GetUnicode', tp, i);
          if (u === 0) continue;
          const generated = call(mod, 'FPDFText_IsGenerated', tp, i) === 1;
          const ch = String.fromCodePoint(u);
          if (generated && (ch === '\r' || ch === '\n')) continue;
          const f = e.HEAPF64;
          let l = 0;
          let r = 0;
          let bo = 0;
          let t = 0;
          if (call(mod, 'FPDFText_GetLooseCharBox', tp, i, b)) {
            // FS_RECTF: left, top, right, bottom (floats).
            const g = e.HEAPF32;
            l = g[b >> 2] ?? 0;
            t = g[(b >> 2) + 1] ?? 0;
            r = g[(b >> 2) + 2] ?? 0;
            bo = g[(b >> 2) + 3] ?? 0;
          } else if (call(mod, 'FPDFText_GetCharBox', tp, i, b, b + 8, b + 16, b + 24)) {
            l = f[b >> 3] ?? 0;
            r = f[(b >> 3) + 1] ?? 0;
            bo = f[(b >> 3) + 2] ?? 0;
            t = f[(b >> 3) + 3] ?? 0;
          }
          call(mod, 'FPDFText_GetCharOrigin', tp, i, b + 32, b + 40);
          const ox0 = e.HEAPF64[(b + 32) >> 3] ?? 0;
          const oy0 = e.HEAPF64[(b + 40) >> 3] ?? 0;
          const m = info.toDisplay;
          const [ax, ay] = applyMat(m, l, t);
          const [bx, by] = applyMat(m, r, bo);
          const [ox, oy] = applyMat(m, ox0, oy0);
          // Render mode, size, weight and angle are the text object's: read once per object.
          const obj = call(mod, 'FPDFText_GetTextObject', tp, i);
          let st = style.get(obj);
          if (!st) {
            const a = (call(mod, 'FPDFText_GetCharAngle', tp, i) * 180) / Math.PI;
            st = {
              invisible: obj ? call(mod, 'FPDFTextObj_GetTextRenderMode', obj) === 3 : false,
              size: call(mod, 'FPDFText_GetFontSize', tp, i),
              bold: call(mod, 'FPDFText_GetFontWeight', tp, i) >= 600,
              angle: Number.isFinite(a) ? a : 0,
            };
            style.set(obj, st);
          }
          const { invisible, angle } = st;
          chars.push({
            ch,
            x0: Math.min(ax, bx),
            y0: Math.min(ay, by),
            x1: Math.max(ax, bx),
            y1: Math.max(ay, by),
            ox,
            oy,
            size: st.size,
            bold: st.bold,
            invisible,
            generated,
            angle,
          });
        }
      } finally {
        call(mod, 'FPDFText_ClosePage', tp);
      }
    }
  } finally {
    e.wasmExports.free(b);
    call(mod, 'FPDF_ClosePage', page);
  }
  return {
    w: info.w,
    h: info.h,
    chars,
    imageCover: imageArea / (info.w * info.h),
    figures,
    paths,
  };
}
