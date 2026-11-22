// One running comparison's work (M12-07, D-66, ARCHITECTURE §3.1): the main
// thread only routes. The Work worker reads each page's signature and
// positioned text and renders the analysis rasters band by band; each result
// is transferred (never copied) to the Compare worker, which keeps the
// material and folds the band pairs into each sheet's facts. Tasks run
// through the CompareQueue: the viewed sheet first, progress, Cancel.
// Closing the comparison cancels its work and releases its memory.
//
// M12-07 builds the pipeline; pairing (M12-09) supplies `pairs`, alignment
// (M12-10) the placement of A, detection (M12-14) the work on the bands.
import type { CompareSide, SheetFacts } from '../../../engine/compareApi';
import type { CompareClient } from '../../../engine/compareClient';
import type { WorkClient } from '../../../engine/workClient';
import {
  ANALYSIS_DPI,
  BAND_ROWS,
  IDENTITY,
  bandRanges,
  rasterSize,
  textBuffers,
  type Affine,
  type PageFrame,
  type PageSignature,
  type PageText,
} from '../../../model/compare/material';
import { CompareQueue, type QueueProgress, type QueueTask } from './jobQueue';

export interface CompareInput {
  docId: string;
  /** Page indexes taking part (the input window's page range). */
  pages: number[];
}

export interface SheetPair {
  /** Page of A and page of B (index in the document). */
  a: number;
  b: number;
  /** A's displayed space → B's frame (pt); default: as is. */
  place?: Affine;
}

export interface SessionOptions {
  work: Pick<WorkClient, 'run' | 'hold'>;
  compare: CompareClient;
  /** Sheet pairs; default: the pages of A and B paired in order. */
  pairs?: SheetPair[];
  /** Analysis resolution (S28: 150 dpi). */
  dpi?: number;
  bandRows?: number;
  /** Tasks in flight (default 2). */
  concurrency?: number;
  onSheet?: (sheet: number, facts: SheetFacts) => void;
  onProgress?: (progress: QueueProgress) => void;
  onError?: (key: string, error: Error) => void;
}

let seq = 0;

/** The default pairing until M12-09: page n of A with page n of B. */
export function pairInOrder(a: number[], b: number[]): SheetPair[] {
  const n = Math.min(a.length, b.length);
  const out: SheetPair[] = [];
  for (let i = 0; i < n; i++) out.push({ a: a[i] ?? 0, b: b[i] ?? 0 });
  return out;
}

export class CompareSession {
  readonly id = `cmp-${String(++seq)}`;
  readonly pairs: SheetPair[];
  private readonly a: CompareInput;
  private readonly b: CompareInput;
  private readonly opts: SessionOptions;
  private readonly queue: CompareQueue;
  private readonly frames: Record<CompareSide, Map<number, PageFrame>> = {
    a: new Map(),
    b: new Map(),
  };
  private releaseWork: (() => void) | null = null;
  private closed = false;
  private started = false;

  constructor(a: CompareInput, b: CompareInput, opts: SessionOptions) {
    this.a = a;
    this.b = b;
    this.opts = opts;
    this.pairs = opts.pairs ?? pairInOrder(a.pages, b.pages);
    this.queue = new CompareQueue({
      concurrency: opts.concurrency ?? 2,
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.onError ? { onError: opts.onError } : {}),
    });
  }

  /** Opens the comparison's store and queues every task. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // Keeps the Work worker from respawning mid-comparison (its pages are cached there).
    this.releaseWork = this.opts.work.hold();
    await this.opts.compare.openComparison(this.id);
    if (this.closed) return;
    this.queue.add(this.tasks());
    void this.queue.whenIdle().then(() => {
      this.letWorkGo();
    });
  }

  /** The sheet the user is looking at goes first. */
  focus(sheet: number | null): void {
    this.queue.focus(sheet);
  }

  progress(): QueueProgress {
    return this.queue.progress();
  }

  /** Resolves when every task has finished, failed or been cancelled. */
  whenDone(): Promise<void> {
    return this.queue.whenIdle();
  }

  /** Stops the work; what is done stays. */
  cancel(): void {
    this.queue.cancel();
  }

  /** Cancels, then releases everything the comparison holds. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queue.cancel();
    await this.queue.whenIdle();
    this.letWorkGo();
    await this.opts.compare.release(this.id);
  }

  private letWorkGo(): void {
    const release = this.releaseWork;
    this.releaseWork = null;
    release?.();
  }

  /** The sheet a page serves (what the user views is a sheet), or the page itself. */
  private sheetOf(side: CompareSide, page: number): number {
    const i = this.pairs.findIndex((p) => p[side] === page);
    return i >= 0 ? i : this.pairs.length + page;
  }

  private tasks(): QueueTask[] {
    const out: QueueTask[] = [];
    for (const side of ['a', 'b'] as const) {
      const input = side === 'a' ? this.a : this.b;
      for (const page of input.pages) {
        const sheet = this.sheetOf(side, page);
        out.push({
          key: `sig:${side}:${String(page)}`,
          sheet,
          phase: 0,
          run: (signal) => this.readSignature(side, input.docId, page, signal),
        });
        out.push({
          key: `text:${side}:${String(page)}`,
          sheet,
          phase: 0,
          run: (signal) => this.readText(side, input.docId, page, signal),
        });
      }
    }
    this.pairs.forEach((pair, sheet) => {
      out.push({
        key: `sheet:${String(sheet)}`,
        sheet,
        phase: 1,
        // The frames come with the signatures.
        after: [`sig:a:${String(pair.a)}`, `sig:b:${String(pair.b)}`],
        run: (signal) => this.analyseSheet(sheet, pair, signal),
      });
    });
    return out;
  }

  private async readSignature(
    side: CompareSide,
    docId: string,
    page: number,
    signal: AbortSignal,
  ): Promise<void> {
    const signature: PageSignature = await this.opts.work.run(
      'compareSignature',
      { docId, pageIndex: page },
      { signal },
    ).promise;
    this.frames[side].set(page, signature.frame);
    await this.opts.compare.call(
      'putSignature',
      { cmpId: this.id, side, page, signature },
      { signal, transfer: [signature.ink.buffer as ArrayBuffer] },
    ).promise;
  }

  private async readText(
    side: CompareSide,
    docId: string,
    page: number,
    signal: AbortSignal,
  ): Promise<void> {
    const text: PageText = await this.opts.work.run(
      'compareText',
      { docId, pageIndex: page },
      { signal },
    ).promise;
    await this.opts.compare.call(
      'putText',
      { cmpId: this.id, side, page, text },
      { signal, transfer: textBuffers(text) },
    ).promise;
  }

  /** Both rasters of a sheet pair in B's frame, band by band, folded into the sheet's facts. */
  private async analyseSheet(sheet: number, pair: SheetPair, signal: AbortSignal): Promise<void> {
    const frame = this.frames.b.get(pair.b);
    if (!frame) throw new Error('B frame missing');
    const dpi = this.opts.dpi ?? ANALYSIS_DPI;
    const size = rasterSize(frame.width, frame.height, dpi);
    const place = pair.place ?? IDENTITY;
    for (const range of bandRanges(size.height, this.opts.bandRows ?? BAND_ROWS)) {
      const req = { dpi, width: size.width, height: size.height, ...range };
      // Both reads are queued in the Work worker at once; it renders them one after the other.
      const ja = this.opts.work.run(
        'compareRaster',
        { docId: this.a.docId, pageIndex: pair.a, ...req, place },
        { signal },
      );
      const jb = this.opts.work.run(
        'compareRaster',
        { docId: this.b.docId, pageIndex: pair.b, ...req },
        { signal },
      );
      const [a, b] = await Promise.all([ja.promise, jb.promise]);
      await this.opts.compare.call(
        'sheetBand',
        { cmpId: this.id, sheet, dpi, a, b },
        { signal, transfer: [a.data.buffer as ArrayBuffer, b.data.buffer as ArrayBuffer] },
      ).promise;
    }
    const facts = await this.opts.compare.call('sheetFacts', { cmpId: this.id, sheet }, { signal })
      .promise;
    if (!signal.aborted) this.opts.onSheet?.(sheet, facts);
  }
}
