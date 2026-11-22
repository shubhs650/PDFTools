// What the Compare worker holds per open comparison (M12-07, D-66): each
// side's page signatures and positioned text, and the running facts of each
// sheet pair. Every byte is accounted, and `release` drops a comparison
// whole when it closes (the plan: memory released after a comparison closes).
import type {
  CompareMemory,
  CompareSide,
  CompareSummary,
  SheetFacts,
} from '../../engine/compareApi';
import {
  signatureBytes,
  textBytes,
  type PageSignature,
  type PageText,
  type RasterBand,
} from '../../model/compare/material';
import { SheetAccumulator } from './sheetFacts';

interface Side {
  signatures: Map<number, PageSignature>;
  texts: Map<number, PageText>;
}

class Comparison {
  readonly sides: Record<CompareSide, Side> = {
    a: { signatures: new Map(), texts: new Map() },
    b: { signatures: new Map(), texts: new Map() },
  };
  readonly sheets = new Map<number, SheetAccumulator>();
  bytes = 0;
}

/** Accumulator state per sheet: the seen-rows map (one byte per raster row). */
const sheetBytes = (s: SheetAccumulator): number => s.height + 64;

export class CompareStore {
  private readonly comparisons = new Map<string, Comparison>();

  open(cmpId: string): void {
    if (!this.comparisons.has(cmpId)) this.comparisons.set(cmpId, new Comparison());
  }

  private get(cmpId: string): Comparison {
    const c = this.comparisons.get(cmpId);
    if (!c) throw new Error('comparison not open');
    return c;
  }

  putSignature(cmpId: string, side: CompareSide, page: number, sig: PageSignature): number {
    const c = this.get(cmpId);
    const old = c.sides[side].signatures.get(page);
    if (old) c.bytes -= signatureBytes(old);
    c.sides[side].signatures.set(page, sig);
    c.bytes += signatureBytes(sig);
    return c.bytes;
  }

  putText(cmpId: string, side: CompareSide, page: number, text: PageText): number {
    const c = this.get(cmpId);
    const old = c.sides[side].texts.get(page);
    if (old) c.bytes -= textBytes(old);
    c.sides[side].texts.set(page, text);
    c.bytes += textBytes(text);
    return c.bytes;
  }

  signature(cmpId: string, side: CompareSide, page: number): PageSignature | undefined {
    return this.comparisons.get(cmpId)?.sides[side].signatures.get(page);
  }

  text(cmpId: string, side: CompareSide, page: number): PageText | undefined {
    return this.comparisons.get(cmpId)?.sides[side].texts.get(page);
  }

  /** Folds a band pair into the sheet's facts; the bands are not kept. */
  sheetBand(
    cmpId: string,
    sheet: number,
    dpi: number,
    a: RasterBand,
    b: RasterBand,
    inkLevel?: number,
  ): number {
    const c = this.get(cmpId);
    const old = c.sheets.get(sheet);
    let acc = old;
    const sameFrame = old?.width === b.width && old.height === b.height && old.dpi === dpi;
    if (!acc || !sameFrame) {
      // A new frame (another alignment, another resolution) starts the sheet again.
      if (old) c.bytes -= sheetBytes(old);
      acc = new SheetAccumulator(b.width, b.height, dpi);
      c.sheets.set(sheet, acc);
      c.bytes += sheetBytes(acc);
    }
    acc.add(a, b, inkLevel);
    return acc.facts().rows;
  }

  sheetFacts(cmpId: string, sheet: number): SheetFacts {
    const acc = this.get(cmpId).sheets.get(sheet);
    if (!acc) throw new Error('no bands for this sheet');
    return acc.facts();
  }

  summary(cmpId: string): CompareSummary {
    const c = this.get(cmpId);
    return {
      signatures: { a: c.sides.a.signatures.size, b: c.sides.b.signatures.size },
      texts: { a: c.sides.a.texts.size, b: c.sides.b.texts.size },
      sheets: c.sheets.size,
      bytes: c.bytes,
    };
  }

  release(cmpId: string): number {
    const c = this.comparisons.get(cmpId);
    if (!c) return 0;
    this.comparisons.delete(cmpId);
    return c.bytes;
  }

  memory(): CompareMemory {
    let bytes = 0;
    for (const c of this.comparisons.values()) bytes += c.bytes;
    return { bytes, comparisons: this.comparisons.size };
  }
}
