// A uniform grid of points for nearest-point queries (M12-10, D-60; spike
// S28): feature matching and the "as is" agreement.
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
