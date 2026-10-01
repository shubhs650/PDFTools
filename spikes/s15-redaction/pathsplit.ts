// M4-02 spike (ADR-017): PDFium's redaction removes path objects that lie
// inside a rectangle but leaves paths that cross it. This prototype replaces
// each crossing path (top-level only) with new path objects holding only the
// geometry outside the rectangle, through PDFium's page-object API (no content
// stream is parsed or written by us; FPDFPage_GenerateContent writes it, B8):
//   - strokes: every edge clipped against the rectangle grown by half the
//     stroke width (Liang–Barsky); Béziers flattened first (prototype only);
//   - fills: each closed subpath clipped to the rectangle's complement, as four
//     convex regions (left, right, below, above), Sutherland–Hodgman.
// The new objects take the original's place in the drawing order.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { rawCall } from '../../src/workers/render/pdfium.ts';
import type { Rect } from './verify.ts';

type P = [number, number];
interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'float' | 'i32'): number;
}

export interface SplitReport {
  examined: number;
  replaced: number;
  newObjects: number;
  clipPathsLost: number;
  insideForms: number;
}

/** Parts of p→q outside rectangle r (as parameter ranges of the segment). */
function outsideParts(p: P, q: P, r: Rect): [number, number][] {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  for (const [pk, qk] of [
    [-dx, p[0] - r[0]],
    [dx, r[2] - p[0]],
    [-dy, p[1] - r[1]],
    [dy, r[3] - p[1]],
  ] as const) {
    if (pk === 0) {
      if (qk < 0) return [[0, 1]];
    } else {
      const t = qk / pk;
      if (pk < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  if (t0 >= t1) return [[0, 1]];
  const parts: [number, number][] = [];
  if (t0 > 1e-9) parts.push([0, t0]);
  if (t1 < 1 - 1e-9) parts.push([t1, 1]);
  return parts;
}

const lerp = (p: P, q: P, t: number): P => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** Polylines of `line` with everything inside any of `rects` cut out. */
export function clipPolyline(line: P[], rects: Rect[]): P[][] {
  let pieces: P[][] = [line];
  for (const r of rects) {
    const next: P[][] = [];
    for (const pl of pieces) {
      let cur: P[] = [];
      const finish = () => {
        if (cur.length > 1) next.push(cur);
        cur = [];
      };
      for (let i = 1; i < pl.length; i++) {
        const p = pl[i - 1] ?? [0, 0];
        const q = pl[i] ?? [0, 0];
        const parts = outsideParts(p, q, r);
        if (parts.length === 0) finish();
        for (const [a, b] of parts) {
          if (a > 0 || cur.length === 0) {
            finish();
            cur = [lerp(p, q, a)];
          }
          cur.push(lerp(p, q, b));
          if (b < 1) finish();
        }
      }
      finish();
    }
    pieces = next;
  }
  return pieces;
}

/** Sutherland–Hodgman against one half-plane a·x + b·y + c ≥ 0. */
function clipHalf(poly: P[], a: number, b: number, c: number): P[] {
  const out: P[] = [];
  const f = (p: P) => a * p[0] + b * p[1] + c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] ?? [0, 0];
    const q = poly[(i + 1) % poly.length] ?? [0, 0];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) out.push(lerp(p, q, fp / (fp - fq)));
  }
  return out;
}

/** A polygon minus a rectangle, as up to four polygons (left, right, below, above). */
export function clipPolygon(poly: P[], r: Rect): P[][] {
  const [x0, y0, x1, y1] = r;
  const regions = [
    (p: P[]) => clipHalf(p, -1, 0, x0), // x ≤ x0
    (p: P[]) => clipHalf(p, 1, 0, -x1), // x ≥ x1
    (p: P[]) => clipHalf(clipHalf(clipHalf(p, 1, 0, -x0), -1, 0, x1), 0, -1, y0), // below
    (p: P[]) => clipHalf(clipHalf(clipHalf(p, 1, 0, -x0), -1, 0, x1), 0, 1, -y1), // above
  ];
  return regions.map((g) => g(poly)).filter((x) => x.length >= 3);
}

export function splitCrossingPaths(
  mod: WrappedPdfiumModule,
  pagePtr: number,
  rects: Rect[],
): SplitReport {
  const heap = mod.pdfium as unknown as Heap;
  const call = (name: string, ...a: number[]) => rawCall(mod, name, ...a);
  const report: SplitReport = {
    examined: 0,
    replaced: 0,
    newObjects: 0,
    clipPathsLost: 0,
    insideForms: 0,
  };
  const buf = heap.wasmExports.malloc(64);
  const f = (i: number) => heap.getValue(buf + i * 4, 'float');
  const u = (i: number) => heap.getValue(buf + i * 4, 'i32') >>> 0;
  try {
    const n = call('FPDFPage_CountObjects', pagePtr);
    for (let idx = n - 1; idx >= 0; idx--) {
      const obj = call('FPDFPage_GetObject', pagePtr, idx);
      const type = call('FPDFPageObj_GetType', obj);
      if (type === 5) {
        report.insideForms += 1; // forms: prototype does not descend
        continue;
      }
      if (type !== 2) continue;
      if (!call('FPDFPageObj_GetBounds', obj, buf, buf + 4, buf + 8, buf + 12)) continue;
      const b: Rect = [f(0), f(1), f(2), f(3)];
      const width = call('FPDFPageObj_GetStrokeWidth', obj, buf) ? f(0) : 1;
      call('FPDFPageObj_GetMatrix', obj, buf);
      const m = [f(0), f(1), f(2), f(3), f(4), f(5)] as const;
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      const half = (width * scale) / 2 + 0.5;
      const grown = rects.map((r): Rect => [r[0] - half, r[1] - half, r[2] + half, r[3] + half]);
      if (!grown.some((r) => b[0] < r[2] && b[2] > r[0] && b[1] < r[3] && b[3] > r[1])) continue;
      report.examined++;
      call('FPDFPath_GetDrawMode', obj, buf, buf + 4);
      const fillMode = heap.getValue(buf, 'i32');
      const stroke = heap.getValue(buf + 4, 'i32') !== 0;
      // Subpaths in page space; Béziers flattened (prototype).
      const subs: { pts: P[]; closed: boolean }[] = [];
      const toPage = (x: number, y: number): P => [
        m[0] * x + m[2] * y + m[4],
        m[1] * x + m[3] * y + m[5],
      ];
      const segs = call('FPDFPath_CountSegments', obj);
      let bez: P[] = [];
      for (let i = 0; i < segs; i++) {
        const seg = call('FPDFPath_GetPathSegment', obj, i);
        call('FPDFPathSegment_GetPoint', seg, buf, buf + 4);
        const pt = toPage(f(0), f(1));
        const st = call('FPDFPathSegment_GetType', seg);
        const cur = subs.at(-1);
        if (st === 2 || !cur) subs.push({ pts: [pt], closed: false });
        else if (st === 1) {
          bez.push(pt);
          if (bez.length === 3) {
            const p0 = cur.pts.at(-1) ?? pt;
            const [c1, c2, p3] = bez as [P, P, P];
            for (let k = 1; k <= 16; k++) {
              const t = k / 16;
              const s = 1 - t;
              cur.pts.push([
                s * s * s * p0[0] +
                  3 * s * s * t * c1[0] +
                  3 * s * t * t * c2[0] +
                  t * t * t * p3[0],
                s * s * s * p0[1] +
                  3 * s * s * t * c1[1] +
                  3 * s * t * t * c2[1] +
                  t * t * t * p3[1],
              ]);
            }
            bez = [];
          }
        } else cur.pts.push(pt);
        if (call('FPDFPathSegment_GetClose', seg) && subs.at(-1))
          (subs.at(-1) as { closed: boolean }).closed = true;
      }
      // Style
      const color = (getter: string): [number, number, number, number] => {
        call(getter, obj, buf, buf + 4, buf + 8, buf + 12);
        return [u(0), u(1), u(2), u(3)];
      };
      const strokeColor = color('FPDFPageObj_GetStrokeColor');
      const fillColor = color('FPDFPageObj_GetFillColor');
      const cap = call('FPDFPageObj_GetLineCap', obj);
      const join = call('FPDFPageObj_GetLineJoin', obj);
      call('FPDFPageObj_GetClipPath', obj);
      const clip = call('FPDFPageObj_GetClipPath', obj);
      if (clip && call('FPDFClipPath_CountPaths', clip) > 0) report.clipPathsLost++;

      const made: number[] = [];
      const newPath = (pts: P[], close: boolean) => {
        const first = pts[0];
        if (!first) return 0;
        const p = call('FPDFPageObj_CreateNewPath', first[0], first[1]);
        for (const q of pts.slice(1)) call('FPDFPath_LineTo', p, q[0], q[1]);
        if (close) call('FPDFPath_Close', p);
        return p;
      };
      if (fillMode !== 0) {
        for (const sp of subs) {
          if (sp.pts.length < 3) continue;
          let polys: P[][] = [sp.pts];
          for (const r of rects) polys = polys.flatMap((poly) => clipPolygon(poly, r));
          for (const poly of polys) {
            const p = newPath(poly, true);
            if (!p) continue;
            call('FPDFPageObj_SetFillColor', p, ...fillColor);
            call('FPDFPath_SetDrawMode', p, fillMode, 0);
            made.push(p);
          }
        }
      }
      if (stroke) {
        for (const sp of subs) {
          const line = sp.closed && sp.pts[0] ? [...sp.pts, sp.pts[0]] : sp.pts;
          for (const piece of clipPolyline(line, grown)) {
            const p = newPath(piece, false);
            if (!p) continue;
            call('FPDFPageObj_SetStrokeColor', p, ...strokeColor);
            call('FPDFPageObj_SetStrokeWidth', p, width * scale);
            call('FPDFPageObj_SetLineCap', p, cap);
            call('FPDFPageObj_SetLineJoin', p, join);
            call('FPDFPath_SetDrawMode', p, 0, 1);
            made.push(p);
          }
        }
      }
      call('FPDFPage_RemoveObject', pagePtr, obj);
      call('FPDFPageObj_Destroy', obj);
      made.forEach((p, k) => call('FPDFPage_InsertObjectAtIndex', pagePtr, p, idx + k));
      report.replaced++;
      report.newObjects += made.length;
    }
  } finally {
    heap.wasmExports.free(buf);
  }
  return report;
}
