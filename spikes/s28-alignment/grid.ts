// Spike S28 (M12-03): uniform grids for nearest-point and near-segment queries.

/** Points [x, y, …] in a uniform grid. */
export class PointGrid {
  readonly cell: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly start: Uint32Array;
  private readonly items: Uint32Array;
  readonly pts: Float64Array;

  constructor(pts: Float64Array, cell: number) {
    this.pts = pts;
    const n = pts.length / 2;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pts[2 * i] ?? 0;
      const y = pts[2 * i + 1] ?? 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0;
    this.cell = cell;
    this.x0 = x0;
    this.y0 = y0;
    this.cols = Math.max(1, Math.floor((x1 - x0) / cell) + 1);
    this.rows = Math.max(1, Math.floor((y1 - y0) / cell) + 1);
    const counts = new Uint32Array(this.cols * this.rows + 1);
    const cellOf = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(pts[2 * i] ?? 0, pts[2 * i + 1] ?? 0);
      cellOf[i] = c;
      counts[c + 1] = (counts[c + 1] ?? 0) + 1;
    }
    for (let c = 0; c < this.cols * this.rows; c++)
      counts[c + 1] = (counts[c + 1] ?? 0) + (counts[c] ?? 0);
    this.start = counts;
    this.items = new Uint32Array(n);
    const fill = counts.slice(0, -1);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i] ?? 0;
      const at = fill[c] ?? 0;
      fill[c] = at + 1;
      this.items[at] = i;
    }
  }

  private cellIndex(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
    return cy * this.cols + cx;
  }

  /** Up to `k` nearest points within `r` of (x, y), nearest first: [index, distance²]. */
  near(x: number, y: number, r: number, k: number): [number, number][] {
    const out: [number, number][] = [];
    const r2 = r * r;
    const cx0 = Math.floor((x - r - this.x0) / this.cell);
    const cx1 = Math.floor((x + r - this.x0) / this.cell);
    const cy0 = Math.floor((y - r - this.y0) / this.cell);
    const cy1 = Math.floor((y + r - this.y0) / this.cell);
    for (let cy = Math.max(0, cy0); cy <= Math.min(this.rows - 1, cy1); cy++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(this.cols - 1, cx1); cx++) {
        const c = cy * this.cols + cx;
        for (let k2 = this.start[c] ?? 0; k2 < (this.start[c + 1] ?? 0); k2++) {
          const i = this.items[k2] ?? 0;
          const dx = (this.pts[2 * i] ?? 0) - x;
          const dy = (this.pts[2 * i + 1] ?? 0) - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) out.push([i, d2]);
        }
      }
    }
    out.sort((p, q) => p[1] - q[1]);
    return out.length > k ? out.slice(0, k) : out;
  }
}

/** Segments [x1, y1, x2, y2, …] indexed by bounding box, for "is any segment within r". */
export class SegGrid {
  private readonly cell: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly start: Uint32Array;
  private readonly items: Uint32Array;
  readonly segs: Float32Array | Float64Array;

  constructor(
    segs: Float32Array | Float64Array,
    cell: number,
    bounds: [number, number, number, number],
  ) {
    this.segs = segs;
    this.cell = cell;
    this.x0 = bounds[0];
    this.y0 = bounds[1];
    this.cols = Math.max(1, Math.ceil((bounds[2] - bounds[0]) / cell));
    this.rows = Math.max(1, Math.ceil((bounds[3] - bounds[1]) / cell));
    const n = segs.length / 4;
    const lists: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    for (let i = 0; i < n; i++) {
      const ax = segs[4 * i] ?? 0;
      const ay = segs[4 * i + 1] ?? 0;
      const bx = segs[4 * i + 2] ?? 0;
      const by = segs[4 * i + 3] ?? 0;
      const c0 = this.clampX(Math.min(ax, bx));
      const c1 = this.clampX(Math.max(ax, bx));
      const r0 = this.clampY(Math.min(ay, by));
      const r1 = this.clampY(Math.max(ay, by));
      if ((c1 - c0 + 1) * (r1 - r0 + 1) > 64) {
        // Long segment: walk it instead of its whole bounding box.
        const len = Math.hypot(bx - ax, by - ay);
        const steps = Math.ceil(len / (cell / 2)) + 1;
        let last = -1;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const c = this.clampY(ay + (by - ay) * t) * this.cols + this.clampX(ax + (bx - ax) * t);
          if (c !== last) {
            const l = lists[c];
            if (l && l[l.length - 1] !== i) l.push(i);
            last = c;
          }
        }
        continue;
      }
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) lists[r * this.cols + c]?.push(i);
    }
    this.start = new Uint32Array(lists.length + 1);
    let total = 0;
    for (let c = 0; c < lists.length; c++) {
      this.start[c] = total;
      total += lists[c]?.length ?? 0;
    }
    this.start[lists.length] = total;
    this.items = new Uint32Array(total);
    let k = 0;
    for (const l of lists) for (const i of l) this.items[k++] = i;
  }

  private clampX(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
  }
  private clampY(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
  }

  /** Distance from (x, y) to the nearest segment, if within r (else Infinity). */
  nearest(x: number, y: number, r: number): number {
    let best = Infinity;
    // One cell more each way: the walk that lists a long segment can miss a
    // cell whose corner it only clips.
    const c0 = this.clampX(x - r - this.cell);
    const c1 = this.clampX(x + r + this.cell);
    const r0 = this.clampY(y - r - this.cell);
    const r1 = this.clampY(y + r + this.cell);
    const s = this.segs;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const c = row * this.cols + col;
        for (let k = this.start[c] ?? 0; k < (this.start[c + 1] ?? 0); k++) {
          const i = this.items[k] ?? 0;
          const ax = s[4 * i] ?? 0;
          const ay = s[4 * i + 1] ?? 0;
          const dx = (s[4 * i + 2] ?? 0) - ax;
          const dy = (s[4 * i + 3] ?? 0) - ay;
          const l2 = dx * dx + dy * dy;
          let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
          if (d < best) best = d;
        }
      }
    }
    return best <= r ? best : Infinity;
  }
}
