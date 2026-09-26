// Print rasters in the Work worker (D-25, §7.13, M2-15, ADR-013 decision 5):
// raw FPDF_RenderPageBitmap with FPDF_PRINTING (EmbedPDF renders ignore the
// Print flag), one band of rows at a time so an A0 sheet at 300 DPI never
// needs a whole-page bitmap. Pixels are RGBA, transferred to the caller,
// which has them encoded in the encoder worker.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { RpcError } from '../../engine/errors';
import type { Markups, Region } from '../../features/print/options';
import { rawCall } from '../render/pdfium';

const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10; // RGBA, as ImageData wants
const FPDF_PRINTING = 0x800;
const FPDFBitmap_BGRA = 4;
const WHITE = 0xffffffff;
/** Pixels whose channels differ by less than this count as unchanged (markups only). */
const SAME = 8;

export interface BandRequest {
  pageIndex: number;
  /** Pixels per point. */
  scale: number;
  /** The printed part of the page in points (null: the whole page). */
  region: Region | null;
  /** First row of the band within the printed part, and its height in rows. */
  top: number;
  rows: number;
  markups: Markups;
}

export interface Band {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

interface Heap {
  HEAPU8: Uint8Array;
}

/** The page's displayed size in points (its /Rotate applied), and its rotation. */
export function pageBox(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pageIndex: number,
): { width: number; height: number; rotation: number } {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtr, pageIndex);
  if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
  try {
    return {
      width: rawCall(mod, 'FPDF_GetPageWidthF', page),
      height: rawCall(mod, 'FPDF_GetPageHeightF', page),
      rotation: rawCall(mod, 'FPDFPage_GetRotation', page),
    };
  } finally {
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

/** One render of the band into a fresh white bitmap; returns its RGBA copy. */
function renderOnce(
  mod: WrappedPdfiumModule,
  page: number,
  form: number,
  geometry: { x: number; y: number; w: number; h: number; width: number; rows: number },
  flags: number,
  withForms: boolean,
): Uint8ClampedArray<ArrayBuffer> {
  const { x, y, w, h, width, rows } = geometry;
  const bmp = rawCall(mod, 'FPDFBitmap_CreateEx', width, rows, FPDFBitmap_BGRA, 0, 0);
  if (!bmp) throw new RpcError('print-memory', 'The page is too large to print');
  try {
    rawCall(mod, 'FPDFBitmap_FillRect', bmp, 0, 0, width, rows, WHITE);
    rawCall(mod, 'FPDF_RenderPageBitmap', bmp, page, x, y, w, h, 0, flags);
    // Form fields are printed with the document even without markups (as Acrobat's "Document").
    if (withForms && form) rawCall(mod, 'FPDF_FFLDraw', form, bmp, page, x, y, w, h, 0, flags);
    const buf = rawCall(mod, 'FPDFBitmap_GetBuffer', bmp);
    // HEAPU8 is read after the render (the heap may have grown); slice copies out.
    const heap = (mod.pdfium as unknown as Heap).HEAPU8;
    return new Uint8ClampedArray(heap.slice(buf, buf + width * rows * 4).buffer);
  } finally {
    rawCall(mod, 'FPDFBitmap_Destroy', bmp);
  }
}

/**
 * Renders one band. Markups on: the page with its printable annotations
 * (widgets included). Off: the page and its form fields only. Only: what
 * annotations add (pixels that differ from the "off" render), on white.
 */
export function renderBand(mod: WrappedPdfiumModule, docPtr: number, req: BandRequest): Band {
  const page = rawCall(mod, 'FPDF_LoadPage', docPtr, req.pageIndex);
  if (!page) throw new RpcError('page-not-loaded', 'The page could not be loaded');
  const needForms = req.markups !== 'on';
  const info = needForms ? rawCall(mod, 'PDFiumExt_OpenFormFillInfo') : 0;
  const form = info ? rawCall(mod, 'PDFiumExt_InitFormFillEnvironment', docPtr, info) : 0;
  if (form) rawCall(mod, 'FORM_OnAfterLoadPage', page, form);
  try {
    const full = {
      width: rawCall(mod, 'FPDF_GetPageWidthF', page),
      height: rawCall(mod, 'FPDF_GetPageHeightF', page),
    };
    const region = req.region ?? { x: 0, y: 0, ...full };
    const width = Math.max(1, Math.round(region.width * req.scale));
    const geometry = {
      // The whole page at this scale, placed so the band's first row is row 0.
      x: -Math.round(region.x * req.scale),
      y: -Math.round(region.y * req.scale) - req.top,
      w: Math.round(full.width * req.scale),
      h: Math.round(full.height * req.scale),
      width,
      rows: req.rows,
    };
    const annots = FPDF_PRINTING | FPDF_REVERSE_BYTE_ORDER | FPDF_ANNOT;
    const plain = FPDF_PRINTING | FPDF_REVERSE_BYTE_ORDER;
    let data: Uint8ClampedArray<ArrayBuffer>;
    if (req.markups === 'on') data = renderOnce(mod, page, form, geometry, annots, false);
    else if (req.markups === 'off') data = renderOnce(mod, page, form, geometry, plain, true);
    else {
      const withMarkups = renderOnce(mod, page, form, geometry, annots, false);
      const without = renderOnce(mod, page, form, geometry, plain, true);
      data = markupsOnly(withMarkups, without);
    }
    return { data, width, height: req.rows };
  } finally {
    if (form) {
      rawCall(mod, 'FORM_OnBeforeClosePage', page, form);
      rawCall(mod, 'PDFiumExt_ExitFormFillEnvironment', form);
    }
    if (info) rawCall(mod, 'PDFiumExt_CloseFormFillInfo', info);
    rawCall(mod, 'FPDF_ClosePage', page);
  }
}

/** Keeps the pixels annotations changed; everything else becomes white. In place on `on`. */
export function markupsOnly(
  on: Uint8ClampedArray<ArrayBuffer>,
  off: Uint8ClampedArray,
): Uint8ClampedArray<ArrayBuffer> {
  for (let i = 0; i < on.length; i += 4) {
    const same =
      Math.abs((on[i] ?? 0) - (off[i] ?? 0)) < SAME &&
      Math.abs((on[i + 1] ?? 0) - (off[i + 1] ?? 0)) < SAME &&
      Math.abs((on[i + 2] ?? 0) - (off[i + 2] ?? 0)) < SAME;
    if (same) {
      on[i] = 255;
      on[i + 1] = 255;
      on[i + 2] = 255;
    }
    on[i + 3] = 255;
  }
  return on;
}
