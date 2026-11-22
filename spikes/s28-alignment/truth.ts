// Spike S28 (M12-03): ground truth for the vector corpus pairs.
//  - The true alignment: every generated sheet draws its content under one
//    `cm` (identity on unchanged sheets); PDFium reports it as the matrix of
//    the first page object. Truth = B's matrix after A's inverse, taken from
//    A's displayed page to B's.
//  - The true differences: line geometry and positioned characters of A,
//    moved by the true alignment, against B's. Any stretch of a line farther
//    than `eps` from every line of the other page, and any character not
//    found at its place, is a difference; differences closer than `gap` form
//    one item. This is independent of the raster detection it checks.

import { applyMat, invertMat, thenMat, type Mat } from './geom.ts';
import { SegGrid } from './grid.ts';
import { call, pageInfo, type Doc, type Glyph } from './pdfium.ts';

/** Matrix of the page's first object (the `cm` the sheet is drawn under). */
export function contentMatrix(doc: Doc, index: number): Mat {
  const em = doc.mod.pdfium as unknown as {
    wasmExports: { malloc(n: number): number; free(p: number): void };
    HEAPF32: Float32Array;
  };
  const page = call(doc.mod, 'FPDF_LoadPage', doc.ptr, index);
  try {
    const obj = call(doc.mod, 'FPDFPage_GetObject', page, 0);
    const m = em.wasmExports.malloc(24);
    try {
      if (!call(doc.mod, 'FPDFPageObj_GetMatrix', obj, m)) return [1, 0, 0, 1, 0, 0];
      const f = em.HEAPF32.subarray(m >> 2, (m >> 2) + 6);
      return [f[0] ?? 1, f[1] ?? 0, f[2] ?? 0, f[3] ?? 1, f[4] ?? 0, f[5] ?? 0];
    } finally {
      em.wasmExports.free(m);
    }
  } finally {
    call(doc.mod, 'FPDF_ClosePage', page);
  }
}

/** The true alignment, A's displayed pt → B's displayed pt. */
export function truthMat(docA: Doc, ia: number, docB: Doc, ib: number): Mat {
  const mA = contentMatrix(docA, ia);
  const mB = contentMatrix(docB, ib);
  const dA = pageInfo(docA, ia).toDisplay;
  const dB = pageInfo(docB, ib).toDisplay;
  // display A → user A → content → user B → display B
  return thenMat(thenMat(thenMat(invertMat(dA), invertMat(mA)), mB), dB);
}

export interface TruthItem {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  removed: number;
  added: number;
  /** Words of A and B inside the item. */
  textA: string;
  textB: string;
}

function moveSegs(segs: Float32Array, t: Mat): Float32Array {
  const out = new Float32Array(segs.length);
  for (let i = 0; i < segs.length; i += 2) {
    const [x, y] = applyMat(t, segs[i] ?? 0, segs[i + 1] ?? 0);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

function bounds(...sets: Float32Array[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of sets)
    for (let i = 0; i < s.length; i += 2) {
      x0 = Math.min(x0, s[i] ?? 0);
      x1 = Math.max(x1, s[i] ?? 0);
      y0 = Math.min(y0, s[i + 1] ?? 0);
      y1 = Math.max(y1, s[i + 1] ?? 0);
    }
  if (!Number.isFinite(x0)) return [0, 0, 1, 1];
  return [x0 - 1, y0 - 1, x1 + 1, y1 + 1];
}

/** Points along `segs` (every `step` pt) farther than `eps` from every segment of `other`. */
function uncovered(segs: Float32Array, other: SegGrid, eps: number, step = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i] ?? 0;
    const ay = segs[i + 1] ?? 0;
    const bx = segs[i + 2] ?? 0;
    const by = segs[i + 3] ?? 0;
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.min(4000, Math.max(1, Math.ceil(len / step)));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const y = ay + ((by - ay) * k) / n;
      if (other.nearest(x, y, eps) === Infinity) out.push(x, y);
    }
  }
  return out;
}

function moveGlyphs(gl: Glyph[], t: Mat): Glyph[] {
  const k = Math.hypot(t[0], t[1]);
  return gl.map((g) => {
    const [x, y] = applyMat(t, g.x, g.y);
    return { ch: g.ch, x, y, size: g.size * k };
  });
}

function unmatchedGlyphs(from: Glyph[], to: Glyph[]): Glyph[] {
  return from.filter((g) => {
    const tol = Math.max(0.6, g.size * 0.25);
    return !to.some(
      (h) => h.ch === g.ch && Math.abs(h.x - g.x) <= tol && Math.abs(h.y - g.y) <= tol,
    );
  });
}

export function truthDiff(
  segA: Float32Array,
  segB: Float32Array,
  glyphA: Glyph[],
  glyphB: Glyph[],
  t: Mat,
  /** B's displayed page size: geometry outside it (cropped away) is not visible. */
  page: [number, number],
  /** Whether that side's own rendering (1 = A, 2 = B) has ink within r pt of a point (B's displayed pt). */
  inked: (side: 1 | 2, x: number, y: number, r: number) => boolean = () => true,
  eps = 0.75,
  gap = 8,
): TruthItem[] {
  // Only what each side shows counts: hidden layers, white fills and text in
  // render mode 3 neither differ nor cover a difference.
  // A segment mostly inked is kept, one mostly blank is dropped, and one in
  // between is cut to its inked runs of 3 pt or more (sampled every pt): a
  // line drawn over by a white fill on one revision only shows where it is
  // not covered, while a hidden line is not "shown" where it crosses text.
  const shown = (segs: Float32Array, side: 1 | 2): Float32Array => {
    const keep: number[] = [];
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i] ?? 0;
      const ay = segs[i + 1] ?? 0;
      const bx = segs[i + 2] ?? 0;
      const by = segs[i + 3] ?? 0;
      const n = Math.min(4000, Math.max(4, Math.ceil(Math.hypot(bx - ax, by - ay))));
      const on: boolean[] = [];
      let count = 0;
      for (let k = 0; k <= n; k++) {
        const v = inked(side, ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, 0);
        on.push(v);
        if (v) count++;
      }
      const share = count / (n + 1);
      if (share >= 0.8) {
        keep.push(ax, ay, bx, by);
        continue;
      }
      if (share < 0.2) continue;
      const step = Math.hypot(bx - ax, by - ay) / n;
      let run = -1;
      for (let k = 0; k <= n + 1; k++) {
        const v = k <= n && on[k] === true;
        if (v && run < 0) run = k;
        if (!v && run >= 0) {
          const e = k - 1;
          if ((e - run) * step >= 3)
            keep.push(
              ax + ((bx - ax) * run) / n,
              ay + ((by - ay) * run) / n,
              ax + ((bx - ax) * e) / n,
              ay + ((by - ay) * e) / n,
            );
          run = -1;
        }
      }
    }
    return Float32Array.from(keep);
  };
  const segA2 = shown(moveSegs(segA, t), 1);
  segB = shown(segB, 2);
  glyphB = glyphB.filter((g) => inked(2, g.x, g.y, g.size / 2));
  const box = bounds(segA2, segB);
  const gridA = new SegGrid(segA2, 8, box);
  const gridB = new SegGrid(segB, 8, box);
  const removedPts = uncovered(segA2, gridB, eps);
  const addedPts = uncovered(segB, gridA, eps);
  const ga = moveGlyphs(glyphA, t).filter((g) => inked(1, g.x, g.y, g.size / 2));
  const remG = unmatchedGlyphs(ga, glyphB);
  const addG = unmatchedGlyphs(glyphB, ga);
  // Points: [x, y, side, r] (side 1 = removed, 2 = added; r = the radius
  // that must show ink: a line point itself, a glyph anywhere in its box,
  // since the middle of an O is paper). A glyph counts as 3 points at its
  // centre and joins every cell its box touches, so a word stays one item.
  const pts: [number, number, number, number][] = [];
  const visible = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x <= page[0] && y <= page[1];
  for (let i = 0; i < removedPts.length; i += 2)
    pts.push([removedPts[i] ?? 0, removedPts[i + 1] ?? 0, 1, 0]);
  for (let i = 0; i < addedPts.length; i += 2)
    pts.push([addedPts[i] ?? 0, addedPts[i + 1] ?? 0, 2, 0]);
  for (const g of remG) for (let k = 0; k < 3; k++) pts.push([g.x, g.y, 1, g.size / 2]);
  for (const g of addG) for (let k = 0; k < 3; k++) pts.push([g.x, g.y, 2, g.size / 2]);
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    if (p && (!visible(p[0], p[1]) || !inked(p[2] === 1 ? 1 : 2, p[0], p[1], p[3])))
      pts.splice(i, 1);
  }
  // Union-find over a grid of gap-sized cells (neighbouring cells join).
  const cells = new Map<string, number>();
  const parent: number[] = [];
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] ?? i] ?? i;
      i = parent[i] ?? i;
    }
    return i;
  };
  const cellAt = (cx: number, cy: number): number => {
    const k = `${String(cx)},${String(cy)}`;
    let c = cells.get(k);
    if (c === undefined) {
      c = parent.length;
      parent.push(c);
      cells.set(k, c);
    }
    return c;
  };
  const cellOf: number[] = [];
  for (const [x, y, , r] of pts) {
    const c = cellAt(Math.floor(x / gap), Math.floor(y / gap));
    cellOf.push(c);
    if (r > 0)
      for (let cy = Math.floor((y - r) / gap); cy <= Math.floor((y + r) / gap); cy++)
        for (let cx = Math.floor((x - r) / gap); cx <= Math.floor((x + r) / gap); cx++)
          parent[find(cellAt(cx, cy))] = find(c);
  }
  for (const [k, c] of cells) {
    const [cx, cy] = k.split(',').map(Number) as [number, number];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const o = cells.get(`${String(cx + dx)},${String(cy + dy)}`);
        if (o !== undefined) parent[find(o)] = find(c);
      }
  }
  const items = new Map<number, TruthItem>();
  pts.forEach(([x, y, side], i) => {
    const root = find(cellOf[i] ?? 0);
    let it = items.get(root);
    if (!it) {
      it = { x0: x, y0: y, x1: x, y1: y, removed: 0, added: 0, textA: '', textB: '' };
      items.set(root, it);
    }
    it.x0 = Math.min(it.x0, x);
    it.y0 = Math.min(it.y0, y);
    it.x1 = Math.max(it.x1, x);
    it.y1 = Math.max(it.y1, y);
    if (side === 1) it.removed++;
    else it.added++;
  });
  const inside = (g: Glyph, it: TruthItem): boolean =>
    g.x >= it.x0 - 0.1 && g.x <= it.x1 + 0.1 && g.y >= it.y0 - 0.1 && g.y <= it.y1 + 0.1;
  // Single points (sub-pt chord differences of flattened curves) are noise.
  const out = [...items.values()].filter(
    (it) => it.removed + it.added >= 6 || Math.hypot(it.x1 - it.x0, it.y1 - it.y0) >= 1.5,
  );
  for (const it of out) {
    it.textA = remG
      .filter((g) => inside(g, it))
      .map((g) => g.ch)
      .join('');
    it.textB = addG
      .filter((g) => inside(g, it))
      .map((g) => g.ch)
      .join('');
  }
  return out.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
}
