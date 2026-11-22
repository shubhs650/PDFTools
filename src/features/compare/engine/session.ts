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
//
// Pairing (M12-09, D-60): a side is one file or, for an overlay, a set of
// files; its "side pages" are the files' pages one after the other, each file
// with its page range. `pair()` reads every side page's signature and has the
// Compare worker pair them; the input window shows the result as the editable
// pairing table, and `start()` then compares the pairs it settled on, reusing
// the signatures already read.
import type {
  CompareSide,
  PairingLayout,
  PairingProgress,
  SheetFacts,
} from '../../../engine/compareApi';
import type { CompareClient } from '../../../engine/compareClient';
import { AbortError, RpcError } from '../../../engine/errors';
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
import type { PairingResult } from '../../../model/compare/pairing';
import { CompareQueue, type QueueProgress, type QueueTask } from './jobQueue';

/** One file of a side. */
export interface SideFile {
  docId: string;
  /** Page indexes taking part (the input window's page range). */
  pages: number[];
  /** File name (file names help pairing a set). */
  name?: string;
}

/** A side of the comparison: one file, or a set of files for an overlay (Q38). */
export interface CompareInput {
  files: SideFile[];
}

/** A side of one file. */
export const oneFile = (docId: string, pages: number[], name?: string): CompareInput => ({
  files: [{ docId, pages, ...(name !== undefined ? { name } : {}) }],
});

/** Where a side page comes from. */
export interface SidePage {
  docId: string;
  /** Page index in the document. */
  page: number;
  /** Index of its file in the side. */
  file: number;
}

/** A side's pages: each file's pages one after the other. */
export function sidePages(input: CompareInput): SidePage[] {
  const out: SidePage[] = [];
  input.files.forEach((f, file) => {
    for (const page of f.pages) out.push({ docId: f.docId, page, file });
  });
  return out;
}

/** What the Compare worker needs to know of a side to pair it. */
export function pairingLayout(input: CompareInput): PairingLayout {
  const pages = sidePages(input);
  return {
    count: pages.length,
    files: pages.map((p) => p.file),
    names: input.files.map((f) => f.name ?? ''),
  };
}

export interface SheetPair {
  /** Side page of A and side page of B. */
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
  /** Pairing progress: signatures read, then rows of the similarity matrix. */
  onPairing?: (progress: PairingProgress & { stage: 'read' | 'match' }) => void;
  onProgress?: (progress: QueueProgress) => void;
  onError?: (key: string, error: Error) => void;
}

let seq = 0;

/** Side page n of A with side page n of B (a text comparison; the default). */
export function pairInOrder(a: number[], b: number[]): SheetPair[] {
  const n = Math.min(a.length, b.length);
  const out: SheetPair[] = [];
  for (let i = 0; i < n; i++) out.push({ a: a[i] ?? 0, b: b[i] ?? 0 });
  return out;
}

export class CompareSession {
  readonly id = `cmp-${String(++seq)}`;
  private sheetPairs: SheetPair[];
  private readonly a: CompareInput;
  private readonly b: CompareInput;
  private readonly pages: Record<CompareSide, SidePage[]>;
  private opened: Promise<void> | null = null;
  private pairing: Promise<PairingResult> | null = null;
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
    this.pages = { a: sidePages(a), b: sidePages(b) };
    const all = (side: CompareSide): number[] => [...this.pages[side].keys()];
    this.sheetPairs = opts.pairs ?? pairInOrder(all('a'), all('b'));
    this.queue = new CompareQueue({
      concurrency: opts.concurrency ?? 2,
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.onError ? { onError: opts.onError } : {}),
    });
  }

  /** The sheets compared: pairs of side pages, in sheet order. */
  get pairs(): readonly SheetPair[] {
    return this.sheetPairs;
  }

  /** The side pages of A or B (for the pairing table's labels). */
  sidePages(side: CompareSide): readonly SidePage[] {
    return this.pages[side];
  }

  /**
   * Opens the store once, and holds the Work worker while work is queued: it
   * must not respawn mid-comparison (its pages are cached there).
   */
  private open(): Promise<void> {
    this.releaseWork ??= this.opts.work.hold();
    this.opened ??= this.opts.compare.openComparison(this.id);
    return this.opened;
  }

  /**
   * Pairs the pages automatically (D-60): every side page's signature, then
   * the Compare worker's pairing. Runs once; `start` reuses the signatures.
   */
  pair(): Promise<PairingResult> {
    if (!this.pairing && this.started) return Promise.reject(new Error('pair before start'));
    this.pairing ??= this.runPairing();
    return this.pairing;
  }

  private async runPairing(): Promise<PairingResult> {
    await this.open();
    if (this.closed) throw new AbortError();
    const total = this.pages.a.length + this.pages.b.length;
    let read = 0;
    const sigTasks = this.signatureTasks(() => {
      read++;
      this.opts.onPairing?.({ stage: 'read', done: read, total });
    }).filter((t) => this.queue.state(t.key) === undefined);
    const out: { result: PairingResult | null } = { result: null };
    this.queue.add([
      ...sigTasks,
      {
        key: 'pair',
        sheet: null,
        phase: 0,
        after: sigTasks.map((t) => t.key),
        run: async (signal) => {
          const job = this.opts.compare.call(
            'pairPages',
            { cmpId: this.id, a: pairingLayout(this.a), b: pairingLayout(this.b) },
            {
              signal,
              onProgress: (p) => {
                this.opts.onPairing?.({ stage: 'match', ...p });
              },
            },
          );
          out.result = await job.promise;
        },
      },
    ]);
    await this.queue.whenIdle();
    if (!this.started) this.letWorkGo();
    if (!out.result) {
      if (this.queue.isCancelled) throw new AbortError();
      throw new RpcError('compare-pairing', 'Pairing failed');
    }
    return out.result;
  }

  /**
   * Opens the comparison's store and queues every task, comparing `pairs`
   * (the pairing table's result) when given.
   */
  async start(pairs?: SheetPair[]): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (pairs) this.sheetPairs = pairs;
    // A pairing still running finishes first: its signature tasks are shared.
    if (this.pairing) await this.pairing.catch(() => undefined);
    if (this.closed || this.queue.isCancelled) return;
    await this.open();
    this.queue.add(this.tasks().filter((t) => this.queue.state(t.key) === undefined));
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

  /** The sheet a side page serves (what the user views is a sheet), or the page itself. */
  private sheetOf(side: CompareSide, page: number): number {
    const i = this.sheetPairs.findIndex((p) => p[side] === page);
    return i >= 0 ? i : this.sheetPairs.length + page;
  }

  private signatureTasks(onRead?: () => void): QueueTask[] {
    const out: QueueTask[] = [];
    for (const side of ['a', 'b'] as const)
      this.pages[side].forEach((p, k) => {
        out.push({
          key: `sig:${side}:${String(k)}`,
          sheet: this.started ? this.sheetOf(side, k) : null,
          phase: 0,
          run: async (signal) => {
            await this.readSignature(side, p, k, signal);
            onRead?.();
          },
        });
      });
    return out;
  }

  private tasks(): QueueTask[] {
    const out: QueueTask[] = [];
    const sigs = new Map(this.signatureTasks().map((t) => [t.key, t]));
    for (const side of ['a', 'b'] as const)
      this.pages[side].forEach((p, k) => {
        const sig = sigs.get(`sig:${side}:${String(k)}`);
        if (sig) out.push(sig);
        out.push({
          key: `text:${side}:${String(k)}`,
          sheet: this.sheetOf(side, k),
          phase: 0,
          run: (signal) => this.readText(side, p, k, signal),
        });
      });
    this.sheetPairs.forEach((pair, sheet) => {
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
    from: SidePage,
    page: number,
    signal: AbortSignal,
  ): Promise<void> {
    const signature: PageSignature = await this.opts.work.run(
      'compareSignature',
      { docId: from.docId, pageIndex: from.page },
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
    from: SidePage,
    page: number,
    signal: AbortSignal,
  ): Promise<void> {
    const text: PageText = await this.opts.work.run(
      'compareText',
      { docId: from.docId, pageIndex: from.page },
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
    const pa = this.pages.a[pair.a];
    const pb = this.pages.b[pair.b];
    if (!pa || !pb) throw new Error('sheet page missing');
    for (const range of bandRanges(size.height, this.opts.bandRows ?? BAND_ROWS)) {
      const req = { dpi, width: size.width, height: size.height, ...range };
      // Both reads are queued in the Work worker at once; it renders them one after the other.
      const ja = this.opts.work.run(
        'compareRaster',
        { docId: pa.docId, pageIndex: pa.page, ...req, place },
        { signal },
      );
      const jb = this.opts.work.run(
        'compareRaster',
        { docId: pb.docId, pageIndex: pb.page, ...req },
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
