// Spike S28 (M12-03): difference detection on an aligned pair (D-61) and the
// "as is" match score (D-60). B is rendered in its own displayed frame; A is
// rendered by PDFium straight through the alignment into that frame (no
// resampling of a raster). A mark of one revision is unchanged when the other
// has ink within `tol` pixels; what is left is grouped into regions.

import { invertMat, type Mat } from './geom.ts';
import { dilate, mask, type Ink } from './image.ts';
import { pageInfo, renderInk, type Doc, type Glyph } from './pdfium.ts';
import { words } from './pairing.ts';

export interface DetectOptions {
  dpi: number;
  /** Ink level (0–255) that counts as a mark. */
  threshold: number;
  /** Tolerance in pixels (Chebyshev). */
  tol: number;
  /** Marks closer than this (pt) form one region. */
  gapPt: number;
  /** Smallest region kept, in changed pixels. */
  minPx: number;
  aliased: boolean;
}

export const DEFAULT_DETECT: DetectOptions = {
  dpi: 150,
  threshold: 96,
  tol: 1,
  gapPt: 6,
  minPx: 6,
  aliased: true,
};

export interface Region {
  /** Bounding box in B's displayed page (pt). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  removed: number;
  added: number;
  kind: 'added' | 'removed' | 'changed';
}

export interface Detection {
  regions: Region[];
  /** Changed pixels over all ink pixels, percent. */
  changedPct: number;
  renderMs: number;
  detectMs: number;
  /** Largest set of typed arrays alive at once (bytes), PDFium's band bitmap not included. */
  peakBytes: number;
  pixels: number;
}

/** Renders the pair in B's frame: A through `t` (A displayed pt → B displayed pt). */
export function renderPair(
  docA: Doc,
  ia: number,
  docB: Doc,
  ib: number,
  t: Mat,
  dpi: number,
  aliased: boolean,
): { a: Ink; b: Ink } {
  const info = pageInfo(docB, ib);
  const scale = dpi / 72;
  const width = Math.ceil(info.w * scale);
  const height = Math.ceil(info.h * scale);
  const b = renderInk(docB, ib, { scale, width, height, aliased });
  const a = renderInk(docA, ia, { scale, width, height, aliased, place: t });
  return { a, b };
}

export function detect(
  docA: Doc,
  ia: number,
  docB: Doc,
  ib: number,
  t: Mat,
  o: DetectOptions = DEFAULT_DETECT,
): Detection {
  const t0 = performance.now();
  const { a, b } = renderPair(docA, ia, docB, ib, t, o.dpi, o.aliased);
  const renderMs = performance.now() - t0;
  const t1 = performance.now();
  const { w, h } = b;
  const px = w * h;
  let live = 2 * px;
  let peak = live;
  const ma = mask(a, o.threshold);
  const mb = mask(b, o.threshold);
  live += 2 * px; // the ink rasters are dropped from here on
  peak = Math.max(peak, live);
  live -= 2 * px;
  // 1 = removed (A only), 2 = added (B only).
  const diff = new Uint8Array(px);
  live += px;
  {
    const db = dilate(mb, w, h, o.tol);
    peak = Math.max(peak, live + 2 * px);
    for (let i = 0; i < px; i++) if (ma[i] && !db[i]) diff[i] = 1;
  }
  {
    const da = dilate(ma, w, h, o.tol);
    for (let i = 0; i < px; i++) if (mb[i] && !da[i]) diff[i] = (diff[i] ?? 0) | 2;
  }
  let inkPx = 0;
  for (let i = 0; i < px; i++) inkPx += (ma[i] ?? 0) | (mb[i] ?? 0);
  // Group on a grid of cells half the gap wide; neighbouring cells join.
  const scale = o.dpi / 72;
  const cellPx = Math.max(1, Math.round((o.gapPt / 2) * scale));
  const cw = Math.ceil(w / cellPx);
  const ch = Math.ceil(h / cellPx);
  const rem = new Uint32Array(cw * ch);
  const add = new Uint32Array(cw * ch);
  let changed = 0;
  for (let y = 0; y < h; y++) {
    const cy = Math.floor(y / cellPx) * cw;
    for (let x = 0; x < w; x++) {
      const d = diff[y * w + x] ?? 0;
      if (!d) continue;
      changed++;
      const c = cy + Math.floor(x / cellPx);
      if (d & 1) rem[c] = (rem[c] ?? 0) + 1;
      if (d & 2) add[c] = (add[c] ?? 0) + 1;
    }
  }
  const label = new Int32Array(cw * ch).fill(-1);
  const regions: Region[] = [];
  const stack: number[] = [];
  for (let s = 0; s < cw * ch; s++) {
    if (label[s] !== -1 || (rem[s] ?? 0) + (add[s] ?? 0) === 0) continue;
    const id = regions.length;
    const r: Region = {
      x0: Infinity,
      y0: Infinity,
      x1: -Infinity,
      y1: -Infinity,
      removed: 0,
      added: 0,
      kind: 'changed',
    };
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop() ?? 0;
      const cx = c % cw;
      const cy = (c - cx) / cw;
      r.removed += rem[c] ?? 0;
      r.added += add[c] ?? 0;
      r.x0 = Math.min(r.x0, cx);
      r.y0 = Math.min(r.y0, cy);
      r.x1 = Math.max(r.x1, cx + 1);
      r.y1 = Math.max(r.y1, cy + 1);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx;
          const yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
          const q = yy * cw + xx;
          if (label[q] === -1 && (rem[q] ?? 0) + (add[q] ?? 0) > 0) {
            label[q] = id;
            stack.push(q);
          }
        }
    }
    regions.push(r);
  }
  const kept: Region[] = [];
  for (const r of regions) {
    const total = r.removed + r.added;
    if (total < o.minPx) continue;
    const share = r.removed / total;
    r.kind = share > 0.85 ? 'removed' : share < 0.15 ? 'added' : 'changed';
    const k = cellPx / scale;
    r.x0 *= k;
    r.y0 *= k;
    r.x1 *= k;
    r.y1 *= k;
    kept.push(r);
  }
  return {
    regions: kept,
    changedPct: inkPx ? (100 * changed) / inkPx : 0,
    renderMs,
    detectMs: performance.now() - t1,
    peakBytes: peak + 4 * px,
    pixels: px,
  };
}

/**
 * The "as is" score: the share of ink of either page that has ink of the
 * other within `tol` px, at a low resolution. 1 = the pages coincide.
 */
export function matchScore(a: Ink, b: Ink, threshold = 64, tol = 1): number {
  const ma = mask(a, threshold);
  const mb = mask(b, threshold);
  const da = dilate(ma, a.w, a.h, tol);
  const db = dilate(mb, b.w, b.h, tol);
  let hit = 0;
  let all = 0;
  for (let i = 0; i < ma.length; i++) {
    if (ma[i]) {
      all++;
      if (db[i]) hit++;
    }
    if (mb[i]) {
      all++;
      if (da[i]) hit++;
    }
  }
  return all ? hit / all : 1;
}

export interface TextChange {
  kind: 'added' | 'removed';
  text: string;
  /** Centre and box in B's displayed page (pt). */
  x: number;
  y: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Placed {
  text: string;
  x: number;
  y: number;
  size: number;
  box: [number, number, number, number];
}

/** Positioned words of A (moved by `t`) against B's: words not found at their place. */
export function textChanges(ga: Glyph[], gb: Glyph[], t: Mat): TextChange[] {
  const placed = (gl: Glyph[], m: Mat | null): Placed[] => {
    const out: Placed[] = [];
    let cur: Glyph[] = [];
    const flush = (): void => {
      if (!cur.length) return;
      const text = words(cur).join('');
      let size = 0;
      const pts: [number, number][] = [];
      for (const g of cur) {
        size = Math.max(size, g.size);
        pts.push(m ? [m[0] * g.x + m[2] * g.y + m[4], m[1] * g.x + m[3] * g.y + m[5]] : [g.x, g.y]);
      }
      const k = m ? Math.hypot(m[0], m[1]) : 1;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const box: [number, number, number, number] = [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ];
      out.push({
        text,
        x: xs.reduce((p, v) => p + v, 0) / xs.length,
        y: ys.reduce((p, v) => p + v, 0) / ys.length,
        size: size * k,
        box,
      });
      cur = [];
    };
    let last: Glyph | null = null;
    for (const g of gl) {
      const near =
        last !== null &&
        Math.abs(g.y - last.y) < Math.max(g.size, last.size) * 0.5 &&
        g.x - last.x > -0.1 &&
        g.x - last.x < Math.max(g.size, last.size) * 1.2;
      if (!near) flush();
      cur.push(g);
      last = g;
    }
    flush();
    return out;
  };
  const wa = placed(ga, t);
  const wb = placed(gb, null);
  const out: TextChange[] = [];
  const unmatched = (from: Placed[], to: Placed[], kind: TextChange['kind']): void => {
    for (const w of from) {
      const tol = Math.max(2, w.size * 0.5);
      if (!to.some((v) => v.text === w.text && Math.hypot(v.x - w.x, v.y - w.y) <= tol))
        out.push({
          kind,
          text: w.text,
          x: w.x,
          y: w.y,
          x0: w.box[0],
          y0: w.box[1],
          x1: w.box[2],
          y1: w.box[3],
        });
    }
  };
  unmatched(wb, wa, 'added');
  unmatched(wa, wb, 'removed');
  return out;
}

export { invertMat };
