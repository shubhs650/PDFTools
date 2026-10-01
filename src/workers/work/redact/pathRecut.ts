// Paths crossing a redacted rectangle are re-cut through PDFium's page-object
// API (M4-17, ADR-017 decision 3, ADR-001 B8 as amended): each top-level path
// object that reaches into a rectangle is replaced, at its place in the
// drawing order, by new path objects holding only its geometry outside every
// rectangle (geometry.ts) — fill and stroke colours with their alpha, stroke
// width, caps, joins and dash pattern carried over; PDFium writes the content
// stream (FPDFPage_GenerateContent). What the API cannot carry is counted, so
// the result can say so: a non-rectangular clip path (a rectangular one is
// applied geometrically), a blend mode or soft mask, marked content (optional
// content membership). Paths inside Form XObjects are not reached; the
// verification then fails for that page (no file is written).
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { rawCall } from '../../render/pdfium';
import {
  bounds,
  clipFill,
  clipStroke,
  flatten,
  grow,
  overlaps,
  strokeReach,
  type Pt,
  type Rect,
  type Subpath,
} from './geometry';

interface Heap {
  wasmExports: { malloc(n: number): number; free(p: number): void };
  getValue(ptr: number, t: 'float' | 'i32'): number;
  setValue(ptr: number, v: number, t: 'float' | 'i32'): void;
}

export interface RecutReport {
  /** Path objects that reached into a rectangle and were replaced. */
  replaced: number;
  newObjects: number;
  /** A non-rectangular clip path could not be carried over. */
  clipApproximated: number;
  /** Transparency other than plain alpha (blend mode, soft mask) could not be carried over. */
  styleApproximated: number;
  /** Marked content (e.g. optional-content layers) could not be carried over. */
  marksLost: number;
}

export const emptyRecut = (): RecutReport => ({
  replaced: 0,
  newObjects: 0,
  clipApproximated: 0,
  styleApproximated: 0,
  marksLost: 0,
});

const PATH = 2;
const SEG_LINE = 0;
const SEG_BEZIER = 1;
const SEG_MOVE = 2;
const BIG = 1e7;

/** Everything outside `r`, as rectangles for the clippers (which remove what lies inside them). */
const outside = (r: Rect): Rect[] => [
  [-BIG, -BIG, r[0], BIG],
  [r[2], -BIG, BIG, BIG],
  [r[0], -BIG, r[2], r[1]],
  [r[0], r[3], r[2], BIG],
];

export function recutPaths(
  mod: WrappedPdfiumModule,
  pagePtr: number,
  rects: readonly Rect[],
  report: RecutReport,
): void {
  if (rects.length === 0) return;
  const heap = mod.pdfium as unknown as Heap;
  const call = (name: string, ...a: number[]) => rawCall(mod, name, ...a);
  const buf = heap.wasmExports.malloc(64);
  const f = (i: number) => heap.getValue(buf + i * 4, 'float');
  const u = (i: number) => heap.getValue(buf + i * 4, 'i32') >>> 0;
  try {
    const n = call('FPDFPage_CountObjects', pagePtr);
    for (let idx = n - 1; idx >= 0; idx--) {
      const obj = call('FPDFPage_GetObject', pagePtr, idx);
      if (call('FPDFPageObj_GetType', obj) !== PATH) continue;
      if (!call('FPDFPageObj_GetBounds', obj, buf, buf + 4, buf + 8, buf + 12)) continue;
      const box: Rect = [f(0), f(1), f(2), f(3)];
      const width = call('FPDFPageObj_GetStrokeWidth', obj, buf) ? f(0) : 1;
      call('FPDFPageObj_GetMatrix', obj, buf);
      const m = [f(0), f(1), f(2), f(3), f(4), f(5)] as const;
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      call('FPDFPath_GetDrawMode', obj, buf, buf + 4);
      const fillMode = heap.getValue(buf, 'i32');
      const stroke = heap.getValue(buf + 4, 'i32') !== 0;
      const cap = call('FPDFPageObj_GetLineCap', obj);
      const join = call('FPDFPageObj_GetLineJoin', obj);
      const reach = stroke ? strokeReach(width * scale, cap, join) : 0.5;
      const grown = rects.map((r) => grow(r, reach));
      if (!grown.some((r) => overlaps(box, r))) continue;

      // The path in page space.
      const toPage = (x: number, y: number): Pt => [
        m[0] * x + m[2] * y + m[4],
        m[1] * x + m[3] * y + m[5],
      ];
      const subs: Subpath[] = [];
      const segs = call('FPDFPath_CountSegments', obj);
      let bez: Pt[] = [];
      for (let i = 0; i < segs; i++) {
        const seg = call('FPDFPath_GetPathSegment', obj, i);
        call('FPDFPathSegment_GetPoint', seg, buf, buf + 4);
        const pt = toPage(f(0), f(1));
        const type = call('FPDFPathSegment_GetType', seg);
        const cur = subs.at(-1);
        if (type === SEG_MOVE || !cur) subs.push({ start: pt, segs: [], closed: false });
        else if (type === SEG_BEZIER) {
          bez.push(pt);
          if (bez.length === 3) {
            const [c1, c2, to] = bez as [Pt, Pt, Pt];
            cur.segs.push({ kind: 'cubic', c1, c2, to });
            bez = [];
          }
        } else if (type === SEG_LINE) cur.segs.push({ kind: 'line', to: pt });
        if (call('FPDFPathSegment_GetClose', seg)) {
          const last = subs.at(-1);
          if (last) last.closed = true;
        }
      }
      // Only paths that really reach into a rectangle (the bounds are only a hint).
      const exact = bounds(subs);
      if (!grown.some((r) => overlaps(exact, r))) continue;
      const polys = fillMode !== 0 ? subs.map((s) => flatten(s)) : [];
      const edgeIn = subs.some((s) => {
        const cut = clipStroke(s, stroke ? grown : rects);
        return cut.length !== 1 || cut[0] !== s;
      });
      const covers = fillMode !== 0 && rects.some((r) => coversPoint(polys, r, fillMode));
      if (!edgeIn && !covers) continue;

      // Style.
      const color = (getter: string): [number, number, number, number] => {
        call(getter, obj, buf, buf + 4, buf + 8, buf + 12);
        return [u(0), u(1), u(2), u(3)];
      };
      const strokeColor = color('FPDFPageObj_GetStrokeColor');
      const fillColor = color('FPDFPageObj_GetFillColor');
      const dashCount = call('FPDFPageObj_GetDashCount', obj);
      let dash: number[] = [];
      let phase = 0;
      if (dashCount > 0) {
        const d = heap.wasmExports.malloc(dashCount * 4);
        try {
          if (call('FPDFPageObj_GetDashArray', obj, d, dashCount))
            dash = Array.from(
              { length: dashCount },
              (_, i) => heap.getValue(d + i * 4, 'float') * scale,
            );
        } finally {
          heap.wasmExports.free(d);
        }
        if (call('FPDFPageObj_GetDashPhase', obj, buf)) phase = f(0) * scale;
      }
      if (
        call('FPDFPageObj_HasTransparency', obj) &&
        (stroke ? strokeColor[3] : 255) === 255 &&
        (fillMode ? fillColor[3] : 255) === 255
      )
        report.styleApproximated++;
      if (call('FPDFPageObj_CountMarks', obj) > 0) report.marksLost++;
      const clipRect = readClipRect(call, heap, obj, buf);
      if (clipRect === 'other') report.clipApproximated++;
      const keep = clipRect && clipRect !== 'other' ? outside(clipRect) : [];

      const made: number[] = [];
      if (fillMode !== 0) {
        let groups = clipFill(polys, rects);
        if (keep.length) groups = groups.flatMap((g) => clipFill(g, keep));
        for (const group of groups) {
          const p = newPath(
            call,
            group.map((poly) => ({ start: poly[0] ?? [0, 0], pts: poly.slice(1), close: true })),
          );
          if (!p) continue;
          call('FPDFPageObj_SetFillColor', p, ...fillColor);
          call('FPDFPath_SetDrawMode', p, fillMode, 0);
          made.push(p);
        }
      }
      if (stroke) {
        let pieces = subs.flatMap((s) => clipStroke(s, grown));
        if (keep.length) pieces = pieces.flatMap((s) => clipStroke(s, keep));
        const p = newCurvePath(call, pieces);
        if (p) {
          call('FPDFPageObj_SetStrokeColor', p, ...strokeColor);
          call('FPDFPageObj_SetStrokeWidth', p, width * scale);
          call('FPDFPageObj_SetLineCap', p, cap);
          call('FPDFPageObj_SetLineJoin', p, join);
          if (dash.length) {
            const d = heap.wasmExports.malloc(dash.length * 4);
            try {
              dash.forEach((v, i) => {
                heap.setValue(d + i * 4, v, 'float');
              });
              call('FPDFPageObj_SetDashArray', p, d, dash.length, phase);
            } finally {
              heap.wasmExports.free(d);
            }
          }
          call('FPDFPath_SetDrawMode', p, 0, 1);
          made.push(p);
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
}

type Call = (name: string, ...a: number[]) => number;

/** Does the fill (fill mode 1 even-odd, 2 nonzero) cover the rect's centre? */
function coversPoint(polys: readonly Pt[][], r: Rect, fillMode: number): boolean {
  const cx = (r[0] + r[2]) / 2;
  const cy = (r[1] + r[3]) / 2;
  let winding = 0;
  let crossings = 0;
  for (const poly of polys)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i] ?? [0, 0];
      const [xj, yj] = poly[j] ?? [0, 0];
      if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) {
        crossings++;
        winding += yj > yi ? 1 : -1;
      }
    }
  return fillMode === 1 ? crossings % 2 === 1 : winding !== 0;
}

/** A path object from polygons (each started with a move, closed). 0 when empty. */
function newPath(call: Call, polys: { start: Pt; pts: Pt[]; close: boolean }[]): number {
  let p = 0;
  for (const poly of polys) {
    if (!p) p = call('FPDFPageObj_CreateNewPath', poly.start[0], poly.start[1]);
    else call('FPDFPath_MoveTo', p, poly.start[0], poly.start[1]);
    for (const q of poly.pts) call('FPDFPath_LineTo', p, q[0], q[1]);
    if (poly.close) call('FPDFPath_Close', p);
  }
  return p;
}

/** A path object from open subpaths with lines and cubics. 0 when empty. */
function newCurvePath(call: Call, subs: readonly Subpath[]): number {
  let p = 0;
  for (const s of subs) {
    if (!p) p = call('FPDFPageObj_CreateNewPath', s.start[0], s.start[1]);
    else call('FPDFPath_MoveTo', p, s.start[0], s.start[1]);
    for (const g of s.segs) {
      if (g.kind === 'line') call('FPDFPath_LineTo', p, g.to[0], g.to[1]);
      else call('FPDFPath_BezierTo', p, g.c1[0], g.c1[1], g.c2[0], g.c2[1], g.to[0], g.to[1]);
    }
    if (s.closed) call('FPDFPath_Close', p);
  }
  return p;
}

/** The object's clip: null (none), its rectangle when it is one axis-aligned box, else 'other'. */
function readClipRect(call: Call, heap: Heap, obj: number, buf: number): Rect | null | 'other' {
  const clip = call('FPDFPageObj_GetClipPath', obj);
  if (!clip) return null;
  const paths = call('FPDFClipPath_CountPaths', clip);
  if (paths <= 0) return null;
  if (paths > 1) return 'other';
  const n = call('FPDFClipPath_CountPathSegments', clip, 0);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const seg = call('FPDFClipPath_GetPathSegment', clip, 0, i);
    if (call('FPDFPathSegment_GetType', seg) === SEG_BEZIER) return 'other';
    call('FPDFPathSegment_GetPoint', seg, buf, buf + 4);
    pts.push([heap.getValue(buf, 'float'), heap.getValue(buf + 4, 'float')]);
  }
  const xs = [...new Set(pts.map((p) => Math.round(p[0] * 100) / 100))];
  const ys = [...new Set(pts.map((p) => Math.round(p[1] * 100) / 100))];
  if (pts.length < 4 || xs.length !== 2 || ys.length !== 2) return 'other';
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
