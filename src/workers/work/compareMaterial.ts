// The comparison's material from one document (M12-07, D-66, ADR-031,
// ADR-032), read by the Work worker's PDFium: a page's frame, its signature
// (S28), its positioned characters (S30) and its analysis raster in bands,
// rendered straight through a placement (S28: A drawn into B's frame by
// PDFium, never resampled). Page content only: comments and form fields are
// not drawn (FPDF_ANNOT is not set). Pure reads: nothing is written.
//
// The app's PDFium copies are opened with `normalizeRotation` (docs.ts): PDFium
// then lays every page out unturned and the viewer applies /Rotate itself. The
// material is in the **displayed** space (S28 – S30), so the quarter turn
// PDFium left out is applied here, to frames, text and rasters alike.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import {
  IDENTITY,
  MAX_RASTER_SIDE,
  TEXT_BOLD,
  TEXT_GENERATED,
  TEXT_INVISIBLE,
  applyAffine,
  inkPicture,
  quarterTurn,
  thenAffine,
  wordsOf,
  type Affine,
  type PageFrame,
  type PageSignature,
  type PageText,
  type RasterBand,
} from '../../model/compare/material';
import { rawCall } from '../render/pdfium';

export { quarterTurn };

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
}

const heapOf = (mod: WrappedPdfiumModule): Heap => mod.pdfium as unknown as Heap;

const FPDFBitmap_BGRA = 4;
const WHITE = 0xffffffff;
const FPDF_RENDER_NO_SMOOTHTEXT = 0x1000;
const FPDF_RENDER_NO_SMOOTHIMAGE = 0x2000;
const FPDF_RENDER_NO_SMOOTHPATH = 0x4000;
/** Longest side of the raster a signature is taken from (10–40 ms a page in S28). */
const SIGNATURE_SIDE = 256;
/** Pixels one call may return (a band of a 16,000 px wide sheet, 1,024 rows). */
export const MAX_BAND_PIXELS = 16_000 * 1_024;

/** A loaded page's frame, with the turn from PDFium's layout to displayed space. */
export interface LoadedFrame extends PageFrame {
  /** PDFium's layout (pt, y down) → displayed space. */
  turn: Affine;
}

/**
 * The displayed frame of a loaded page: size, rotation and user space →
 * displayed space. `docPtr` and `pageIndex` give the page's own /Rotate,
 * which PDFium does not apply to a normalized copy.
 */
export function frameOf(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pageIndex: number,
  page: number,
): LoadedFrame {
  const heap = heapOf(mod);
  const laidW = rawCall(mod, 'FPDF_GetPageWidthF', page);
  const laidH = rawCall(mod, 'FPDF_GetPageHeightF', page);
  const applied = rawCall(mod, 'FPDFPage_GetRotation', page) & 3;
  const own = rawCall(mod, 'EPDF_GetPageRotationByIndex', docPtr, pageIndex) & 3;
  const rotation = own as 0 | 1 | 2 | 3;
  const { turn, width, height } = quarterTurn(own - applied, laidW, laidH);
  // FPDF_PageToDevice rounds to integers: ask for a 1000× device and divide.
  const K = 1000;
  const buf = heap.wasmExports.malloc(8);
  const dev = (x: number, y: number): [number, number] => {
    rawCall(
      mod,
      'FPDF_PageToDevice',
      page,
      0,
      0,
      Math.round(laidW * K),
      Math.round(laidH * K),
      0,
      x,
      y,
      buf,
      buf + 4,
    );
    const h = heapOf(mod).HEAP32;
    return [(h[buf >> 2] ?? 0) / K, (h[(buf >> 2) + 1] ?? 0) / K];
  };
  try {
    // Three points far apart fix the affine map.
    const S = 1000;
    const [ox, oy] = dev(0, 0);
    const [xx, xy] = dev(S, 0);
    const [yx, yy] = dev(0, S);
    const laid: Affine = [(xx - ox) / S, (xy - oy) / S, (yx - ox) / S, (yy - oy) / S, ox, oy];
    return { width, height, rotation, toDisplay: thenAffine(laid, turn), turn };
  } finally {
    heap.wasmExports.free(buf);
  }
}

export interface InkRequest {
  /** PDFium's layout → displayed space (`LoadedFrame.turn`). */
  turn: Affine;
  /** Pixels per point of the output frame. */
  scale: number;
  /** Raster width in pixels. */
  width: number;
  /** First row and number of rows to render. */
  top: number;
  rows: number;
  /** Displayed page (pt) → output frame (pt); default identity. */
  place?: Affine;
  /** Anti-aliasing off (thin lines stay one whole pixel). */
  aliased?: boolean;
}

/**
 * Renders rows `top` … `top + rows − 1` of a loaded page's ink raster through
 * the placement (FPDF_RenderPageBitmapWithMatrix: the matrix maps the
 * displayed page to the device). Ink = 255 − the darkest of R, G, B.
 */
export function renderInk(mod: WrappedPdfiumModule, page: number, r: InkRequest): Uint8Array {
  if (r.width < 1 || r.rows < 1 || r.width > MAX_RASTER_SIDE)
    throw new RpcError('compare-raster-size', 'The analysis raster is too large');
  if (r.width * r.rows > MAX_BAND_PIXELS)
    throw new RpcError('compare-raster-size', 'The analysis band is too large');
  const heap = heapOf(mod);
  const place = thenAffine(r.turn, r.place ?? IDENTITY);
  const out = new Uint8Array(r.width * r.rows);
  const bmp = rawCall(mod, 'FPDFBitmap_CreateEx', r.width, r.rows, FPDFBitmap_BGRA, 0, 0);
  if (!bmp) throw new RpcError('compare-memory', 'The analysis band could not be allocated');
  const mPtr = heap.wasmExports.malloc(24 + 16);
  const cPtr = mPtr + 24;
  try {
    rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, r.width, r.rows, WHITE);
    const m = place.map((v) => v * r.scale);
    m[5] = (m[5] ?? 0) - r.top;
    const f = heap.HEAPF32;
    for (let i = 0; i < 6; i++) f[(mPtr >> 2) + i] = m[i] ?? 0;
    f[cPtr >> 2] = 0;
    f[(cPtr >> 2) + 1] = 0;
    f[(cPtr >> 2) + 2] = r.width;
    f[(cPtr >> 2) + 3] = r.rows;
    const flags = r.aliased
      ? FPDF_RENDER_NO_SMOOTHPATH | FPDF_RENDER_NO_SMOOTHTEXT | FPDF_RENDER_NO_SMOOTHIMAGE
      : 0;
    rawCall(mod, 'FPDF_RenderPageBitmapWithMatrix', bmp, page, mPtr, cPtr, flags);
    const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
    const stride = rawCall(mod, 'FPDFBitmap_GetStride', bmp);
    const px = heapOf(mod).HEAPU8; // read after the render: the heap may have grown
    for (let y = 0; y < r.rows; y++) {
      let p = buf + y * stride;
      const q = y * r.width;
      for (let x = 0; x < r.width; x++, p += 4) {
        const b = px[p] ?? 255;
        const g = px[p + 1] ?? 255;
        const rr = px[p + 2] ?? 255;
        out[q + x] = 255 - (b < g ? (b < rr ? b : rr) : g < rr ? g : rr);
      }
    }
    return out;
  } finally {
    heap.wasmExports.free(mPtr);
    rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  }
}

export interface BandRequest {
  /** Pixels per point. */
  dpi: number;
  /** The raster's size in pixels (B's frame at `dpi`). */
  width: number;
  height: number;
  top: number;
  rows: number;
  /** This page's displayed space → the frame (pt). */
  place?: Affine;
  aliased?: boolean;
}

/** Only the plain fields cross the worker boundary. */
export const plainFrame = (f: LoadedFrame): PageFrame => ({
  width: f.width,
  height: f.height,
  rotation: f.rotation,
  toDisplay: f.toDisplay,
});

/**
 * Rows of a loaded page's analysis raster, in sub-bands of `subRows` with
 * `between` (the scheduler's checkpoint) called after each. The page stays
 * loaded across the checkpoints (the caller holds it from EmbedPDF's page
 * cache, so a dense sheet is parsed once for all its bands).
 */
export async function analysisBand(
  mod: WrappedPdfiumModule,
  page: number,
  turn: Affine,
  req: BandRequest,
  between: () => Promise<void>,
  subRows = 256,
): Promise<RasterBand> {
  if (req.width > MAX_RASTER_SIDE || req.height > MAX_RASTER_SIDE)
    throw new RpcError('compare-raster-size', 'The analysis raster is too large');
  const top = Math.max(0, Math.min(req.height, Math.floor(req.top)));
  const rows = Math.max(0, Math.min(req.height - top, Math.floor(req.rows)));
  if (req.width * rows > MAX_BAND_PIXELS)
    throw new RpcError('compare-raster-size', 'The analysis band is too large');
  const data = new Uint8Array(req.width * rows);
  for (let done = 0; done < rows; done += subRows) {
    const n = Math.min(subRows, rows - done);
    const part = renderInk(mod, page, {
      turn,
      scale: req.dpi / 72,
      width: req.width,
      top: top + done,
      rows: n,
      ...(req.place ? { place: req.place } : {}),
      ...(req.aliased ? { aliased: true } : {}),
    });
    data.set(part, done * req.width);
    if (done + n < rows) await between();
  }
  return { width: req.width, height: req.height, top, rows, data };
}

/**
 * A page's line segments (user space, [x1, y1, x2, y2, …]) in displayed
 * space, for alignment (M12-10): a new array, the snap cache is not touched.
 */
export function displayedSegments(segs: Float32Array, toDisplay: Affine): Float32Array {
  const out = new Float32Array(segs.length);
  for (let i = 0; i + 1 < segs.length; i += 2) {
    const [x, y] = applyAffine(toDisplay, segs[i] ?? 0, segs[i + 1] ?? 0);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

/** Room for a font's name (FPDFText_GetFontInfo; longer names are cut, the weight word comes early). */
const FONT_NAME = 40;
const BOLD_NAME = /bold|black|heavy|semibold|demi/iu;

/**
 * Whether a character's font is bold: its weight, or its name for fonts that
 * give none (the standard 14 fonts report weight 0: "Helvetica-Bold").
 * `buf` holds at least FONT_NAME bytes.
 */
function boldFont(mod: WrappedPdfiumModule, tp: number, i: number, buf: number): boolean {
  if (rawCall(mod, 'FPDFText_GetFontWeight', tp, i) >= 600) return true;
  const n = rawCall(mod, 'FPDFText_GetFontInfo', tp, i, buf, FONT_NAME, 0);
  if (n <= 1) return false;
  const bytes = heapOf(mod).HEAPU8.subarray(buf, buf + Math.min(n, FONT_NAME) - 1);
  let name = '';
  for (const c of bytes) name += String.fromCharCode(c);
  return BOLD_NAME.test(name);
}

/** Positioned characters of a loaded page in displayed space (S30's route). */
export function textOf(mod: WrappedPdfiumModule, page: number, frame: PageFrame): PageText {
  const empty = (): PageText => ({
    frame,
    codes: new Uint32Array(0),
    boxes: new Float32Array(0),
    origins: new Float32Array(0),
    sizes: new Float32Array(0),
    angles: new Float32Array(0),
    flags: new Uint8Array(0),
  });
  const tp = rawCall(mod, 'FPDFText_LoadPage', page);
  if (!tp) return empty();
  const heap = heapOf(mod);
  // Char box and origin (48 bytes), then a font name (boldFont).
  const b = heap.wasmExports.malloc(48 + FONT_NAME);
  try {
    const n = Math.max(0, rawCall(mod, 'FPDFText_CountChars', tp));
    const codes = new Uint32Array(n);
    const boxes = new Float32Array(n * 4);
    const origins = new Float32Array(n * 2);
    const sizes = new Float32Array(n);
    const angles = new Float32Array(n);
    const flags = new Uint8Array(n);
    // Render mode, size, weight and angle belong to the text object: read once per object.
    const style = new Map<number, { size: number; angle: number; bits: number }>();
    const m = frame.toDisplay;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const u = rawCall(mod, 'FPDFText_GetUnicode', tp, i);
      if (u === 0) continue;
      const generated = rawCall(mod, 'FPDFText_IsGenerated', tp, i) === 1;
      if (generated && (u === 10 || u === 13)) continue;
      let l = 0;
      let r = 0;
      let bo = 0;
      let t = 0;
      if (rawCall(mod, 'FPDFText_GetLooseCharBox', tp, i, b)) {
        // FS_RECTF: left, top, right, bottom.
        const g = heapOf(mod).HEAPF32;
        l = g[b >> 2] ?? 0;
        t = g[(b >> 2) + 1] ?? 0;
        r = g[(b >> 2) + 2] ?? 0;
        bo = g[(b >> 2) + 3] ?? 0;
      } else if (rawCall(mod, 'FPDFText_GetCharBox', tp, i, b, b + 8, b + 16, b + 24)) {
        const f = heapOf(mod).HEAPF64;
        l = f[b >> 3] ?? 0;
        r = f[(b >> 3) + 1] ?? 0;
        bo = f[(b >> 3) + 2] ?? 0;
        t = f[(b >> 3) + 3] ?? 0;
      }
      rawCall(mod, 'FPDFText_GetCharOrigin', tp, i, b + 32, b + 40);
      const f = heapOf(mod).HEAPF64;
      const [ox, oy] = applyAffine(m, f[(b + 32) >> 3] ?? 0, f[(b + 40) >> 3] ?? 0);
      const [ax, ay] = applyAffine(m, l, t);
      const [bx, by] = applyAffine(m, r, bo);
      const obj = rawCall(mod, 'FPDFText_GetTextObject', tp, i);
      let st = style.get(obj);
      if (!st) {
        // The character's direction (user space, y up) as displayed (y down, the angle counter-clockwise).
        // PDFium gives the angle clockwise (M12-23: text reading up a page came out as
        // -90°, and every line of a /Rotate 90 page as 180°, so its words fell apart
        // and the text comparison left the page out as rotated text).
        const ua = rawCall(mod, 'FPDFText_GetCharAngle', tp, i);
        const ca = Number.isFinite(ua) ? Math.cos(ua) : 1;
        const sa = Number.isFinite(ua) ? -Math.sin(ua) : 0;
        const dx = m[0] * ca + m[2] * sa;
        const dy = m[1] * ca + m[3] * sa;
        const a = (Math.atan2(-dy, dx) * 180) / Math.PI;
        st = {
          size: rawCall(mod, 'FPDFText_GetFontSize', tp, i),
          angle: Math.abs(a) < 1e-6 ? 0 : a,
          bits:
            (obj && rawCall(mod, 'FPDFTextObj_GetTextRenderMode', obj) === 3 ? TEXT_INVISIBLE : 0) |
            (boldFont(mod, tp, i, b + 48) ? TEXT_BOLD : 0),
        };
        style.set(obj, st);
      }
      codes[k] = u;
      boxes[k * 4] = Math.min(ax, bx);
      boxes[k * 4 + 1] = Math.min(ay, by);
      boxes[k * 4 + 2] = Math.max(ax, bx);
      boxes[k * 4 + 3] = Math.max(ay, by);
      origins[k * 2] = ox;
      origins[k * 2 + 1] = oy;
      sizes[k] = st.size;
      angles[k] = st.angle;
      flags[k] = st.bits | (generated ? TEXT_GENERATED : 0);
      k++;
    }
    if (k === n) return { frame, codes, boxes, origins, sizes, angles, flags };
    // Compact copies, so a transfer carries no unused tail.
    return {
      frame,
      codes: codes.slice(0, k),
      boxes: boxes.slice(0, k * 4),
      origins: origins.slice(0, k * 2),
      sizes: sizes.slice(0, k),
      angles: angles.slice(0, k),
      flags: flags.slice(0, k),
    };
  } finally {
    heap.wasmExports.free(b);
    rawCall(mod, 'FPDFText_ClosePage', tp);
  }
}

/** A loaded page's signature (S28): the ink picture of a small render plus its words. */
export function signatureOf(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pageIndex: number,
  page: number,
): PageSignature {
  const frame = frameOf(mod, docPtr, pageIndex, page);
  const scale = SIGNATURE_SIDE / Math.max(frame.width, frame.height, 1);
  const width = Math.max(1, Math.round(frame.width * scale));
  const rows = Math.max(1, Math.round(frame.height * scale));
  const ink = renderInk(mod, page, { turn: frame.turn, scale, width, top: 0, rows });
  return {
    frame: plainFrame(frame),
    ink: inkPicture(ink, width, rows),
    words: wordsOf(textOf(mod, page, plainFrame(frame))),
  };
}
