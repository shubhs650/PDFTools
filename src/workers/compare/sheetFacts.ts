// A sheet pair's running facts (M12-07, D-66): the analysis rasters of A
// (already drawn into B's frame) and B arrive band by band and are folded in
// here, then dropped, so no whole-sheet raster is ever held (S28: an ARCH E
// sheet would need 350 MB). Exact pixels; the tolerances, regions and text
// layer of detection are the DiffDetector's (M12-14).
import type { SheetFacts } from '../../engine/compareApi';
import { INK_LEVEL } from '../../model/compare/detect/detector';
import type { RasterBand } from '../../model/compare/material';

export { INK_LEVEL };

export class SheetAccumulator {
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
  private inkA = 0;
  private inkB = 0;
  private both = 0;
  private differs = false;
  private rows = 0;
  /** Which rows are in: a band sent twice is not counted twice. */
  private readonly seen: Uint8Array;
  private readonly boxA = [Infinity, Infinity, -Infinity, -Infinity];
  private readonly boxB = [Infinity, Infinity, -Infinity, -Infinity];

  constructor(width: number, height: number, dpi: number) {
    this.width = width;
    this.height = height;
    this.dpi = dpi;
    this.seen = new Uint8Array(height);
  }

  /** Folds the same rows of both rasters in. */
  add(a: RasterBand, b: RasterBand, inkLevel = INK_LEVEL): void {
    if (a.width !== this.width || b.width !== this.width)
      throw new Error('band width does not match the sheet');
    if (a.height !== this.height || b.height !== this.height)
      throw new Error('band height does not match the sheet');
    if (a.top !== b.top || a.rows !== b.rows) throw new Error('bands of A and B differ');
    if (a.top < 0 || a.top + a.rows > this.height) throw new Error('band outside the sheet');
    const w = this.width;
    for (let r = 0; r < a.rows; r++) {
      const y = a.top + r;
      if (this.seen[y]) continue;
      this.seen[y] = 1;
      this.rows++;
      const off = r * w;
      let minA = -1;
      let maxA = -1;
      let minB = -1;
      let maxB = -1;
      for (let x = 0; x < w; x++) {
        const va = a.data[off + x] ?? 0;
        const vb = b.data[off + x] ?? 0;
        if (va !== vb) this.differs = true;
        const ia = va > inkLevel;
        const ib = vb > inkLevel;
        if (ia) {
          this.inkA++;
          if (minA < 0) minA = x;
          maxA = x;
        }
        if (ib) {
          this.inkB++;
          if (minB < 0) minB = x;
          maxB = x;
        }
        if (ia && ib) this.both++;
      }
      if (minA >= 0) grow(this.boxA, minA, y, maxA + 1, y + 1);
      if (minB >= 0) grow(this.boxB, minB, y, maxB + 1, y + 1);
    }
  }

  facts(): SheetFacts {
    const k = 72 / this.dpi;
    const box = (b: number[]): [number, number, number, number] | null =>
      (b[0] ?? Infinity) === Infinity
        ? null
        : [(b[0] ?? 0) * k, (b[1] ?? 0) * k, (b[2] ?? 0) * k, (b[3] ?? 0) * k];
    return {
      width: this.width,
      height: this.height,
      dpi: this.dpi,
      inkA: this.inkA,
      inkB: this.inkB,
      both: this.both,
      boxA: box(this.boxA),
      boxB: box(this.boxB),
      identical: !this.differs && this.rows === this.height,
      rows: this.rows,
    };
  }
}

function grow(box: number[], x0: number, y0: number, x1: number, y1: number): void {
  box[0] = Math.min(box[0] ?? Infinity, x0);
  box[1] = Math.min(box[1] ?? Infinity, y0);
  box[2] = Math.max(box[2] ?? -Infinity, x1);
  box[3] = Math.max(box[3] ?? -Infinity, y1);
}
