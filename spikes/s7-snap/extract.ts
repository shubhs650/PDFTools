// M0-S7: vector geometry extraction straight from PDFium (ADR-001 B14),
// shared by the Node harness and the Work worker. Walks page objects,
// recurses into form XObjects composing matrices, flattens Béziers, closes
// subpaths, and returns a flat Float32Array of segments in user space.

import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { apply, concat, flattenCubic } from './snap-core.ts';

const OBJ_PATH = 2;
const OBJ_FORM = 5;
const SEG_LINETO = 0;
const SEG_BEZIERTO = 1;
const SEG_MOVETO = 2;

type F = (...a: number[]) => number;
interface Em {
  wasmExports: Record<string, unknown> & { malloc(n: number): number; free(p: number): void };
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
}

export interface ExtractOptions {
  /** Only objects whose bounds intersect [x1, y1, x2, y2] (user space). */
  region?: [number, number, number, number];
  /** Call the raw WASM exports instead of the cwrap'd wrappers (faster). */
  raw?: boolean;
  /** Include fill-only paths (hatching, solid shapes), not just stroked ones. */
  includeFillOnly?: boolean;
  /** Stop early (budget) — number of segments. */
  maxSegments?: number;
  /** Yield to the event loop every `sliceMs` (so snap queries interleave). */
  sliceMs?: number;
  signal?: AbortSignal;
}

export interface ExtractStats {
  objects: number;
  paths: number;
  forms: number;
  skippedByRegion: number;
  segments: number;
  ms: number;
  truncated: boolean;
  slices: number;
  maxSliceMs: number;
}

export async function extractPage(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pageIndex: number,
  opts: ExtractOptions = {},
): Promise<{ segs: Float32Array; stats: ExtractStats }> {
  const em = mod.pdfium as unknown as Em;
  const wrapped = mod as unknown as Record<string, F>;
  const fn = (name: string): F => {
    const f = opts.raw ? (em.wasmExports[name] as F | undefined) : wrapped[name];
    if (!f) throw new Error(`missing ${name}`);
    return f;
  };
  const LoadPage = fn('FPDF_LoadPage');
  const ClosePage = fn('FPDF_ClosePage');
  const CountObjects = fn('FPDFPage_CountObjects');
  const GetObject = fn('FPDFPage_GetObject');
  const GetType = fn('FPDFPageObj_GetType');
  const GetMatrix = fn('FPDFPageObj_GetMatrix');
  const GetBounds = fn('FPDFPageObj_GetBounds');
  const CountSegments = fn('FPDFPath_CountSegments');
  const GetSegment = fn('FPDFPath_GetPathSegment');
  const SegPoint = fn('FPDFPathSegment_GetPoint');
  const SegType = fn('FPDFPathSegment_GetType');
  const SegClose = fn('FPDFPathSegment_GetClose');
  const DrawMode = fn('FPDFPath_GetDrawMode');
  const FormCount = fn('FPDFFormObj_CountObjects');
  const FormGet = fn('FPDFFormObj_GetObject');

  const t0 = performance.now();
  const scratch = em.wasmExports.malloc(64); // matrix (24) + point (8) + bounds (16) + modes (8)
  const mPtr = scratch;
  const pPtr = scratch + 24;
  const bPtr = scratch + 32;
  const modePtr = scratch + 48;
  const f32 = (): Float32Array => em.HEAPF32; // re-read: memory can grow
  const stats: ExtractStats = {
    objects: 0,
    paths: 0,
    forms: 0,
    skippedByRegion: 0,
    segments: 0,
    ms: 0,
    truncated: false,
    slices: 1,
    maxSliceMs: 0,
  };

  let out = new Float32Array(1 << 16);
  let len = 0;
  const push = (ax: number, ay: number, bx: number, by: number): void => {
    if (ax === bx && ay === by) return;
    if (len + 4 > out.length) {
      const next = new Float32Array(out.length * 2);
      next.set(out);
      out = next;
    }
    out[len++] = ax;
    out[len++] = ay;
    out[len++] = bx;
    out[len++] = by;
  };
  const max = opts.maxSegments ?? Infinity;
  const region = opts.region;

  const matrixOf = (obj: number): number[] => {
    if (!GetMatrix(obj, mPtr)) return [1, 0, 0, 1, 0, 0];
    const h = f32();
    const i = mPtr >> 2;
    return [h[i] ?? 1, h[i + 1] ?? 0, h[i + 2] ?? 0, h[i + 3] ?? 1, h[i + 4] ?? 0, h[i + 5] ?? 0];
  };

  const walkPath = (obj: number, m: number[]): void => {
    em.HEAP32[modePtr >> 2] = 0;
    em.HEAP32[(modePtr + 4) >> 2] = 0;
    const known = DrawMode(obj, modePtr, modePtr + 4);
    const filled = known && em.HEAP32[modePtr >> 2] !== 0;
    const stroked = !known || em.HEAP32[(modePtr + 4) >> 2] !== 0;
    if (!stroked && !(opts.includeFillOnly && filled)) return;
    // Filled subpaths are implicitly closed (ISO 32000-1 §8.5.3.3).
    const closeImplicitly = filled;
    stats.paths++;
    const n = CountSegments(obj);
    let sx = 0;
    let sy = 0; // subpath start
    let cx = 0;
    let cy = 0; // current point
    const ctrl: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const seg = GetSegment(obj, i);
      SegPoint(seg, pPtr, pPtr + 4);
      const h = f32();
      const [x, y] = apply(m, h[pPtr >> 2] ?? 0, h[(pPtr >> 2) + 1] ?? 0);
      const type = SegType(seg);
      if (type === SEG_MOVETO) {
        if (closeImplicitly && (cx !== sx || cy !== sy)) push(cx, cy, sx, sy);
        sx = cx = x;
        sy = cy = y;
        ctrl.length = 0;
      } else if (type === SEG_LINETO) {
        push(cx, cy, x, y);
        cx = x;
        cy = y;
      } else if (type === SEG_BEZIERTO) {
        ctrl.push([x, y]);
        if (ctrl.length === 3) {
          const [c1, c2, p] = ctrl as [[number, number], [number, number], [number, number]];
          let px = cx;
          let py = cy;
          for (const [qx, qy] of flattenCubic([cx, cy], c1, c2, p)) {
            push(px, py, qx, qy);
            px = qx;
            py = qy;
          }
          cx = p[0];
          cy = p[1];
          ctrl.length = 0;
        }
      }
      if (SegClose(seg) && (cx !== sx || cy !== sy)) {
        push(cx, cy, sx, sy);
        cx = sx;
        cy = sy;
      }
      if (len / 4 >= max) {
        stats.truncated = true;
        return;
      }
    }
    if (closeImplicitly && (cx !== sx || cy !== sy)) push(cx, cy, sx, sy);
  };

  const inRegion = (obj: number): boolean => {
    if (!region) return true;
    if (!GetBounds(obj, bPtr, bPtr + 4, bPtr + 8, bPtr + 12)) return true;
    const h = f32();
    const i = bPtr >> 2;
    const [l, b, r, t] = [h[i] ?? 0, h[i + 1] ?? 0, h[i + 2] ?? 0, h[i + 3] ?? 0];
    return !(r < region[0] || l > region[2] || t < region[1] || b > region[3]);
  };

  const visit = (obj: number, parent: number[] | null, depth: number): void => {
    {
      stats.objects++;
      const type = GetType(obj);
      if (type !== OBJ_PATH && type !== OBJ_FORM) return;
      // Bounds are in page space only for top-level objects.
      if (!parent && !inRegion(obj)) {
        stats.skippedByRegion++;
        return;
      }
      const own = matrixOf(obj);
      const m = parent ? concat(own, parent) : own;
      if (type === OBJ_PATH) walkPath(obj, m);
      else if (depth < 16) {
        stats.forms++;
        const n = FormCount(obj);
        for (let k = 0; k < n && !stats.truncated; k++) visit(FormGet(obj, k), m, depth + 1);
      }
    }
  };

  const page = LoadPage(docPtr, pageIndex);
  if (!page) throw new Error(`cannot load page ${String(pageIndex)}`);
  try {
    const n = CountObjects(page);
    let sliceStart = performance.now();
    for (let k = 0; k < n && !stats.truncated; k++) {
      visit(GetObject(page, k), null, 0);
      if (opts.sliceMs !== undefined && performance.now() - sliceStart >= opts.sliceMs) {
        stats.maxSliceMs = Math.max(stats.maxSliceMs, performance.now() - sliceStart);
        await new Promise((r) => setTimeout(r, 0));
        if (opts.signal?.aborted) throw new Error('aborted');
        stats.slices++;
        sliceStart = performance.now();
      }
    }
    stats.maxSliceMs = Math.max(stats.maxSliceMs, performance.now() - sliceStart);
  } finally {
    ClosePage(page);
    em.wasmExports.free(scratch);
  }
  stats.segments = len / 4;
  stats.ms = performance.now() - t0;
  return { segs: out.slice(0, len), stats };
}
