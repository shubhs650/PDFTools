// What the Compare worker holds per open comparison (M12-07, D-66): each
// side's page signatures and positioned text, and the running facts of each
// sheet pair. Every byte is accounted, and `release` drops a comparison
// whole when it closes (the plan: memory released after a comparison closes).
import type {
  CompareMemory,
  CompareSide,
  CompareSummary,
  PairingLayout,
  SheetFacts,
} from '../../engine/compareApi';
import {
  signatureBytes,
  textBytes,
  type PageSignature,
  type PageText,
  type RasterBand,
} from '../../model/compare/material';
import {
  alignImage,
  alignVector,
  asIsCheck,
  features,
  type AsIsCheck,
  type SheetAlignment,
} from '../../model/compare/align/aligner';
import type { Ink } from '../../model/compare/align/ink';
import { pairPages, type PairingResult, type PairingSide } from '../../model/compare/pairing';
import type { TextOptions } from '../../engine/compareApi';
import { buildDoc } from '../../model/compare/text/document';
import { layoutBytes, pageLayout, type PageLayout } from '../../model/compare/text/layout';
import { matchText, type TextComparison } from '../../model/compare/text/match';
import { Interner } from '../../model/compare/text/myers';
import { INK_LEVEL, SheetAccumulator } from './sheetFacts';
import { cellsBytes, DiffDetector } from '../../model/compare/detect/detector';
import {
  sheetDiff,
  type Sensitivity,
  type SheetDiff,
  type SheetMaterial,
} from '../../model/compare/detect/entries';
import { textChanges, type Box } from '../../model/compare/detect/textDiff';
import type { Affine } from '../../model/compare/material';
import { alignArea, inRegion, maskRows, type AreaPair } from '../../model/compare/area';

interface Side {
  signatures: Map<number, PageSignature>;
  texts: Map<number, PageText>;
  /** Pages of a text comparison: words in reading order (M12-17). */
  layouts: Map<number, PageLayout>;
  /** Feature points per page for alignment (M12-10): x, y, … in displayed pt. */
  features: Map<number, Float64Array>;
}

/** A page raster put band by band for the image method. */
interface AlignRaster {
  ink: Ink;
  rows: number;
}

class Comparison {
  readonly sides: Record<CompareSide, Side> = {
    a: { signatures: new Map(), texts: new Map(), layouts: new Map(), features: new Map() },
    b: { signatures: new Map(), texts: new Map(), layouts: new Map(), features: new Map() },
  };
  /** Token and paragraph keys of a text comparison, shared by both sides. */
  readonly words = new Interner();
  readonly sheets = new Map<number, SheetAccumulator>();
  /** Each sheet's difference detector while its bands come in (M12-14, D-61). */
  readonly detectors = new Map<number, DiffDetector>();
  /** Each detected sheet's counts and word changes. */
  readonly diffs = new Map<number, SheetMaterial>();
  /** Each sheet's alignment (M12-10, D-60). */
  readonly alignments = new Map<number, SheetAlignment>();
  /** Rasters of the image method, per sheet, until it has run. */
  readonly alignRasters = new Map<number, Partial<Record<CompareSide, AlignRaster>>>();
  bytes = 0;
}

/** Accumulator state per sheet: the seen-rows map (one byte per raster row). */
const sheetBytes = (s: SheetAccumulator): number => s.height + 64;

/** A sheet's detected material: its counts and its word changes. */
const materialBytes = (m: SheetMaterial): number => cellsBytes(m.cells) + m.texts.length * 96;

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

  /**
   * Keeps a page's positioned text; with `layout`, only its words in reading
   * order (a text comparison, M12-17): the characters are dropped.
   */
  putText(cmpId: string, side: CompareSide, page: number, text: PageText, layout = false): number {
    const c = this.get(cmpId);
    const s = c.sides[side];
    if (layout) {
      const old = s.layouts.get(page);
      if (old) c.bytes -= layoutBytes(old);
      const l = pageLayout(text);
      s.layouts.set(page, l);
      c.bytes += layoutBytes(l);
      return c.bytes;
    }
    const old = s.texts.get(page);
    if (old) c.bytes -= textBytes(old);
    s.texts.set(page, text);
    c.bytes += textBytes(text);
    return c.bytes;
  }

  /**
   * Compares the text of both sides (M12-17, D-63) on their first pages:
   * `pages` of each, or every page up to the first one not put yet.
   */
  matchText(
    cmpId: string,
    pages?: { a: number; b: number },
    o: TextOptions = {},
    tick?: (stage: 'read' | 'match', done: number, total: number) => void,
  ): TextComparison {
    const c = this.get(cmpId);
    const prefix = (side: CompareSide, want?: number): PageLayout[] => {
      const out: PageLayout[] = [];
      const m = c.sides[side].layouts;
      for (let p = 0; want === undefined || p < want; p++) {
        const l = m.get(p);
        if (!l) {
          if (want !== undefined) throw new Error('page text missing');
          break;
        }
        out.push(l);
      }
      return out;
    };
    const la = prefix('a', pages?.a);
    const lb = prefix('b', pages?.b);
    const total = la.length + lb.length;
    let read = 0;
    const step = (): void => {
      tick?.('read', Math.min(++read, total), total);
    };
    const hf = o.headersFooters === false ? { headersFooters: false } : {};
    const docA = buildDoc(la, c.words, {
      checkpoint: step,
      ...hf,
      ...(o.bands?.a ? { bands: o.bands.a } : {}),
    });
    const docB = buildDoc(lb, c.words, {
      checkpoint: step,
      ...hf,
      ...(o.bands?.b ? { bands: o.bands.b } : {}),
    });
    tick?.('read', total, total);
    let gaps = 0;
    return matchText(docA, docB, {
      ...(o.moves === false ? { moves: false } : {}),
      ...hf,
      ...(o.renumbering === false ? { renumbering: false } : {}),
      checkpoint: () => {
        tick?.('match', ++gaps, 0);
      },
    });
  }

  signature(cmpId: string, side: CompareSide, page: number): PageSignature | undefined {
    return this.comparisons.get(cmpId)?.sides[side].signatures.get(page);
  }

  text(cmpId: string, side: CompareSide, page: number): PageText | undefined {
    return this.comparisons.get(cmpId)?.sides[side].texts.get(page);
  }

  /** Pairs the side pages of A and B on their signatures (M12-09, D-60). */
  pairPages(
    cmpId: string,
    a: PairingLayout,
    b: PairingLayout,
    threshold?: number,
    tick?: (done: number, total: number) => void,
  ): PairingResult {
    const c = this.get(cmpId);
    const side = (s: CompareSide, l: PairingLayout): PairingSide => ({
      pages: Array.from({ length: l.count }, (_, k) => {
        const sig = c.sides[s].signatures.get(k);
        if (!sig) throw new Error('signature missing');
        return { ink: sig.ink, landscape: sig.frame.width >= sig.frame.height, words: sig.words };
      }),
      files: l.files,
      names: l.names,
    });
    return pairPages(side('a', a), side('b', b), threshold, tick);
  }

  /** Keeps a page's feature points from its line geometry (displayed pt). */
  putGeometry(cmpId: string, side: CompareSide, page: number, segments: Float32Array): number {
    const c = this.get(cmpId);
    const old = c.sides[side].features.get(page);
    if (old) c.bytes -= old.byteLength;
    const f = features(segments);
    c.sides[side].features.set(page, f);
    c.bytes += f.byteLength;
    return f.length / 2;
  }

  private featuresOf(c: Comparison, side: CompareSide, page: number): Float64Array {
    const f = c.sides[side].features.get(page);
    if (!f) throw new Error('geometry missing');
    return f;
  }

  alignAsIs(cmpId: string, a: number, b: number): AsIsCheck {
    const c = this.get(cmpId);
    return asIsCheck(this.featuresOf(c, 'a', a), this.featuresOf(c, 'b', b));
  }

  alignVector(
    cmpId: string,
    sheet: number,
    a: number,
    b: number,
    coarse: { a: RasterBand; b: RasterBand; scale: number },
    checkpoint?: () => void,
  ): SheetAlignment {
    const c = this.get(cmpId);
    const ink = (r: RasterBand): Ink => {
      if (r.top !== 0 || r.rows !== r.height) throw new Error('coarse raster incomplete');
      return { w: r.width, h: r.height, data: r.data };
    };
    const al = alignVector(
      this.featuresOf(c, 'a', a),
      this.featuresOf(c, 'b', b),
      { a: ink(coarse.a), b: ink(coarse.b), scale: coarse.scale },
      checkpoint,
    );
    c.alignments.set(sheet, al);
    return al;
  }

  /** Aligns an area comparison (O1) on the features inside its rectangles and their rasters. */
  alignArea(
    cmpId: string,
    sheet: number,
    a: number,
    b: number,
    area: AreaPair,
    rasters: { a: RasterBand; b: RasterBand; scale: number } | null,
    checkpoint?: () => void,
  ): SheetAlignment {
    const c = this.get(cmpId);
    const ink = (r: RasterBand): Ink => {
      if (r.top !== 0 || r.rows !== r.height) throw new Error('area raster incomplete');
      return { w: r.width, h: r.height, data: r.data };
    };
    const al = alignArea(
      this.featuresOf(c, 'a', a),
      this.featuresOf(c, 'b', b),
      area,
      rasters ? { a: ink(rasters.a), b: ink(rasters.b), scale: rasters.scale } : null,
      checkpoint,
    );
    c.alignments.set(sheet, al);
    return al;
  }

  putAlignBand(cmpId: string, sheet: number, side: CompareSide, band: RasterBand): number {
    const c = this.get(cmpId);
    const rasters = c.alignRasters.get(sheet) ?? {};
    c.alignRasters.set(sheet, rasters);
    let r = rasters[side];
    if (r?.ink.w !== band.width || r.ink.h !== band.height) {
      if (r) c.bytes -= r.ink.data.byteLength;
      r = {
        ink: { w: band.width, h: band.height, data: new Uint8Array(band.width * band.height) },
        rows: 0,
      };
      rasters[side] = r;
      c.bytes += r.ink.data.byteLength;
    }
    if (
      band.top < 0 ||
      band.top + band.rows > band.height ||
      band.data.length !== band.width * band.rows
    )
      throw new Error('band outside the raster');
    r.ink.data.set(band.data, band.top * band.width);
    r.rows += band.rows;
    return c.bytes;
  }

  alignImage(cmpId: string, sheet: number, scale: number, checkpoint?: () => void): SheetAlignment {
    const c = this.get(cmpId);
    const rasters = c.alignRasters.get(sheet);
    const a = rasters?.a;
    const b = rasters?.b;
    try {
      if (!a || !b || a.rows < a.ink.h || b.rows < b.ink.h) throw new Error('raster incomplete');
      const al = alignImage(a.ink, b.ink, scale, checkpoint);
      c.alignments.set(sheet, al);
      return al;
    } finally {
      this.dropAlignRasters(c, sheet);
    }
  }

  private dropAlignRasters(c: Comparison, sheet: number): void {
    const rasters = c.alignRasters.get(sheet);
    if (!rasters) return;
    for (const r of [rasters.a, rasters.b]) if (r) c.bytes -= r.ink.data.byteLength;
    c.alignRasters.delete(sheet);
  }

  /** Records a sheet's alignment; facts gathered under another placement start again (M12-13). */
  setAlignment(cmpId: string, sheet: number, alignment: SheetAlignment): void {
    const c = this.get(cmpId);
    const was = c.alignments.get(sheet);
    c.alignments.set(sheet, alignment);
    if (was?.place.join(',') === alignment.place.join(',')) return;
    const acc = c.sheets.get(sheet);
    if (acc) {
      c.bytes -= sheetBytes(acc);
      c.sheets.delete(sheet);
    }
    this.dropDiff(c, sheet);
  }

  private dropDiff(c: Comparison, sheet: number): void {
    c.detectors.delete(sheet);
    const m = c.diffs.get(sheet);
    if (m) c.bytes -= materialBytes(m);
    c.diffs.delete(sheet);
  }

  /** Forgets a sheet's facts (its analysis runs again with other layers shown). */
  resetSheet(cmpId: string, sheet: number): void {
    const c = this.get(cmpId);
    const acc = c.sheets.get(sheet);
    this.dropDiff(c, sheet);
    if (!acc) return;
    c.bytes -= sheetBytes(acc);
    c.sheets.delete(sheet);
  }

  alignment(cmpId: string, sheet: number): SheetAlignment | undefined {
    return this.comparisons.get(cmpId)?.alignments.get(sheet);
  }

  /** Folds a band pair into the sheet's facts; the bands are not kept. */
  sheetBand(
    cmpId: string,
    sheet: number,
    dpi: number,
    a: RasterBand,
    b: RasterBand,
    inkLevel?: number,
    clip?: readonly number[],
  ): number {
    const c = this.get(cmpId);
    // An area comparison (O1): only the region's ink takes part, on both sides.
    if (clip) {
      maskRows(a.data, a.width, a.top, a.rows, dpi, clip);
      maskRows(b.data, b.width, b.top, b.rows, dpi, clip);
    }
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
    // The detector: a new frame or ink level, or the sheet from its top again, starts it over.
    const level = inkLevel ?? INK_LEVEL;
    let det = c.detectors.get(sheet);
    if (
      det?.width !== b.width ||
      det.height !== b.height ||
      det.dpi !== dpi ||
      det.inkLevel !== level
    ) {
      det = new DiffDetector(b.width, b.height, dpi, level);
      c.detectors.set(sheet, det);
    }
    // A new analysis of the sheet: the differences found before go.
    const before = c.diffs.get(sheet);
    if (a.top === 0 && before) {
      c.bytes -= materialBytes(before);
      c.diffs.delete(sheet);
    }
    det.add(a, b);
    return acc.facts().rows;
  }

  /**
   * Ends a sheet's detection (M12-14): keeps the detector's counts and the
   * word changes of side pages `a` and `b` (A moved by `place`), drops the
   * detector. Returns the number of word changes.
   */
  detectSheet(
    cmpId: string,
    sheet: number,
    a: number,
    b: number,
    place: Affine,
    scan: boolean,
    clip?: readonly number[],
  ): number {
    const c = this.get(cmpId);
    const det = c.detectors.get(sheet);
    if (!det?.complete) throw new Error('sheet bands incomplete');
    const cells = det.cells();
    const ta = c.sides.a.texts.get(a);
    const tb = c.sides.b.texts.get(b);
    // The text layer is for pages with text (S28); a scan falls back to its regions.
    const all = scan ? [] : textChanges(ta, tb, place);
    // An area comparison (O1): the words in its region only.
    const texts = clip ? all.filter((w) => inRegion(clip, w.cx, w.cy)) : all;
    const k = 72 / det.dpi;
    const m: SheetMaterial = {
      cells,
      texts,
      scan,
      width: det.width * k,
      height: det.height * k,
    };
    const old = c.diffs.get(sheet);
    if (old) c.bytes -= materialBytes(old);
    c.diffs.set(sheet, m);
    c.bytes += materialBytes(m);
    c.detectors.delete(sheet);
    return texts.length;
  }

  /** The differences of the sheets detected so far, at the settings given (D-61, Q22). */
  differences(
    cmpId: string,
    sheets: { sheet: number; zones: Box[] }[],
    sensitivity: Sensitivity,
    minSize: number,
  ): { sheet: number; diff: SheetDiff }[] {
    const c = this.get(cmpId);
    const out: { sheet: number; diff: SheetDiff }[] = [];
    for (const { sheet, zones } of sheets) {
      const m = c.diffs.get(sheet);
      if (m) out.push({ sheet, diff: sheetDiff(m, { sensitivity, minSize, zones }) });
    }
    return out;
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
      texts: {
        a: c.sides.a.texts.size + c.sides.a.layouts.size,
        b: c.sides.b.texts.size + c.sides.b.layouts.size,
      },
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
