// Snap geometry (M3-18, ADR-008 decisions 1 and 3; ported from the M0-S7
// spike's extract.ts): a page's vector paths straight from PDFium's raw
// exports (B14, 2–4× faster than EmbedPDF's wrappers), whole page, fills
// included; form XObjects recursed with composed matrices, Béziers
// flattened, subpaths closed. The walk yields to the scheduler between
// slices (cancellable, rule 2); FPDF_LoadPage itself can't be sliced.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { apply, concat, flattenCubic } from '../../model/snapIndex';
import type { JobSlice } from './scheduler';

const OBJ_PATH = 2;
const OBJ_FORM = 5;
const SEG_LINETO = 0;
const SEG_BEZIERTO = 1;
const SEG_MOVETO = 2;
/** Page objects between checkpoints. */
const OBJECTS_PER_SLICE = 2000;

type F = (...a: number[]) => number;
interface Em {
  wasmExports: Record<string, unknown> & { malloc(n: number): number; free(p: number): void };
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
}

export interface GeometryStats {
  objects: number;
  paths: number;
  segments: number;
  ms: number;
}

/** The page's segments in user space: [x1, y1, x2, y2, …]. */
export async function extractGeometry(
  mod: WrappedPdfiumModule,
  docPtr: number,
  pageIndex: number,
  slice: JobSlice | null,
): Promise<{ segs: Float32Array; stats: GeometryStats }> {
  const em = mod.pdfium as unknown as Em;
  const fn = (name: string): F => {
    const f = em.wasmExports[name] as F | undefined;
    if (!f) throw new Error(`PDFium export ${name} is missing`);
    return f;
  };
  const LoadPage = fn('FPDF_LoadPage');
  const ClosePage = fn('FPDF_ClosePage');
  const CountObjects = fn('FPDFPage_CountObjects');
  const GetObject = fn('FPDFPage_GetObject');
  const GetType = fn('FPDFPageObj_GetType');
  const GetMatrix = fn('FPDFPageObj_GetMatrix');
  const CountSegments = fn('FPDFPath_CountSegments');
  const GetSegment = fn('FPDFPath_GetPathSegment');
  const SegPoint = fn('FPDFPathSegment_GetPoint');
  const SegType = fn('FPDFPathSegment_GetType');
  const SegClose = fn('FPDFPathSegment_GetClose');
  const DrawMode = fn('FPDFPath_GetDrawMode');
  const FormCount = fn('FPDFFormObj_CountObjects');
  const FormGet = fn('FPDFFormObj_GetObject');

  const t0 = performance.now();
  const scratch = em.wasmExports.malloc(64); // matrix (24) + point (8) + modes (8)
  const mPtr = scratch;
  const pPtr = scratch + 24;
  const modePtr = scratch + 48;
  const f32 = (): Float32Array => em.HEAPF32; // re-read: memory can grow
  const stats: GeometryStats = { objects: 0, paths: 0, segments: 0, ms: 0 };

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
    // Fill-only paths count too: hatching and filled outlines (ADR-008 d1).
    if (!stroked && !filled) return;
    // Filled subpaths are implicitly closed (ISO 32000-1 §8.5.3.3).
    const closeImplicitly = filled;
    stats.paths++;
    const n = CountSegments(obj);
    let sx = 0;
    let sy = 0;
    let cx = 0;
    let cy = 0;
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
    }
    if (closeImplicitly && (cx !== sx || cy !== sy)) push(cx, cy, sx, sy);
  };

  const visit = (obj: number, parent: number[] | null, depth: number): void => {
    stats.objects++;
    const type = GetType(obj);
    if (type !== OBJ_PATH && type !== OBJ_FORM) return;
    const own = matrixOf(obj);
    const m = parent ? concat(own, parent) : own;
    if (type === OBJ_PATH) walkPath(obj, m);
    else if (depth < 16) {
      const n = FormCount(obj);
      for (let k = 0; k < n; k++) visit(FormGet(obj, k), m, depth + 1);
    }
  };

  const page = LoadPage(docPtr, pageIndex);
  if (!page) {
    em.wasmExports.free(scratch);
    throw new Error(`The page ${String(pageIndex)} could not be loaded`);
  }
  try {
    const n = CountObjects(page);
    for (let k = 0; k < n; k++) {
      if (slice && k > 0 && k % OBJECTS_PER_SLICE === 0) await slice.checkpoint();
      visit(GetObject(page, k), null, 0);
    }
  } finally {
    ClosePage(page);
    em.wasmExports.free(scratch);
  }
  stats.segments = len / 4;
  stats.ms = performance.now() - t0;
  return { segs: out.slice(0, len), stats };
}
