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
// Alignment (M12-10, D-60): each sheet is checked as it is first, and only a
// poor match is aligned. The Work worker reads both pages' line geometry; the
// Compare worker keeps their feature points and scores the sheet as it is.
// A vector sheet that fails gets two small coarse rasters and is aligned
// there; a scan (no line work) gets its rasters at 2 px per pt, band by band,
// for the image method. The sheet's analysis then draws A through the
// alignment found, and `onAlign` reports the status (as is, auto-aligned,
// low confidence).
//
// Pairing (M12-09, D-60): a side is one file or, for an overlay, a set of
// files; its "side pages" are the files' pages one after the other, each file
// with its page range. `pair()` reads every side page's signature and has the
// Compare worker pair them; the input window shows the result as the editable
// pairing table, and `start()` then compares the pairs it settled on, reusing
// the signatures already read.
import type {
  CompareSide,
  TextMatchProgress,
  TextOptions,
  PairingLayout,
  PairingProgress,
  SheetFacts,
} from '../../../engine/compareApi';
import type { CompareClient } from '../../../engine/compareClient';
import { AbortError, RpcError } from '../../../engine/errors';
import type { WorkClient } from '../../../engine/workClient';
import type { OcrClient } from '../../../engine/ocrClient';
import type { OcrLanguage } from '../../../model/ocr/languages';
import { OCR_DPI } from '../../../model/ocr/types';
import {
  AS_IS_AGREEMENT,
  asIs,
  coarseScale,
  imageScale,
  type SheetAlignment,
} from '../../../model/compare/align/aligner';
import {
  ANALYSIS_DPI,
  BAND_ROWS,
  IDENTITY,
  bandRanges,
  isScan,
  rasterSize,
  textBuffers,
  type Affine,
  type PageFrame,
  type PageSignature,
  type PageText,
  type RasterBand,
} from '../../../model/compare/material';
import type { PairingResult } from '../../../model/compare/pairing';
import type { TextComparison } from '../../../model/compare/text/match';
import { layerKey, type LayerStates } from '../../../workers/shared/layerCopy';
import type { Box } from '../../../model/compare/detect/textDiff';
import type { Sensitivity, SheetDiff } from '../../../model/compare/detect/entries';
import { INK_LEVEL, SCAN_INK_LEVEL } from '../../../model/compare/detect/detector';
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
  /** A's displayed space → B's frame (pt), set by hand; default: aligned automatically. */
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
  /** Align the sheets automatically (D-60; default true): an overlay aligns, a text comparison does not. */
  align?: boolean;
  /**
   * A text comparison (M12-17, D-63): each page's text is read into words in
   * reading order and the two sides are matched, first on their first pages
   * (1, 2, 4, 8, … as they arrive) and then whole. No signatures, no
   * alignment, no rasters.
   */
  text?: boolean;
  /** Detect moves in a text comparison (default true). */
  moves?: boolean;
  /** A text comparison's other switches (D-63): headers and footers, hand-drawn bands, renumbering. */
  textOptions?: Omit<TextOptions, 'moves'>;
  /**
   * OCR at compare time (M12-18, D-63, Q29): scanned pages without text are
   * read by the OCR worker for the comparison only (the files are not
   * changed). Without it such pages are "limited support" and the result
   * lists them as `scanned`, so the window can offer OCR.
   */
  ocr?: {
    languages: readonly OcrLanguage[];
    client: Pick<OcrClient, 'recognize'>;
  };
  /** A text comparison's result: on the first pages while it runs, then complete. */
  onText?: (result: TextComparison, state: TextState) => void;
  /** Text matching progress (pages read into paragraphs, then stretches compared). */
  onTextProgress?: (progress: TextMatchProgress) => void;
  onSheet?: (sheet: number, facts: SheetFacts) => void;
  /** A sheet's alignment and its status, as soon as it is known. */
  onAlign?: (sheet: number, alignment: SheetAlignment) => void;
  /** Pairing progress: signatures read, then rows of the similarity matrix. */
  onPairing?: (progress: PairingProgress & { stage: 'read' | 'match' }) => void;
  onProgress?: (progress: QueueProgress) => void;
  onError?: (key: string, error: Error) => void;
}

/** Which pages a text result covers; `complete` when it covers both documents. */
export interface TextState {
  complete: boolean;
  pages: { a: number; b: number };
  /**
   * Pages whose changes are final: S30 found that matching the first n
   * pages gives the whole comparison's changes for all but the last two
   * (moves are settled only when complete).
   */
  settled: { a: number; b: number };
}

/** Prefix sizes of the early text results: 1, 2, 4, 8, … below `n`. */
export function textCheckpoints(n: number): number[] {
  const out: number[] = [];
  for (let k = 1; k < n; k *= 2) out.push(k);
  return out;
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
  private readonly aligned = new Map<number, SheetAlignment>();
  /** Placements set by hand (M12-13), over the automatic ones. */
  private readonly manual = new Map<number, Affine>();
  /** Bumped when a sheet's placement changes: an analysis under the old one stops. */
  private readonly placeRev = new Map<number, number>();
  /** The key of each sheet's latest analysis task. */
  private readonly sheetTask = new Map<number, string>();
  /** Layer switches per document (D-59, Q24): the analysis rasters are drawn with them. */
  private readonly layers = new Map<string, LayerStates>();
  /** The layer switches each sheet's facts were gathered under. */
  private readonly factsLayers = new Map<number, string>();
  private readonly alignWatchers = new Set<(sheet: number, alignment: SheetAlignment) => void>();
  /** Sheets analysed and detected (M12-14), with their facts. */
  private readonly detected = new Map<number, SheetFacts>();
  private readonly sheetWatchers = new Set<(sheet: number, facts: SheetFacts) => void>();
  private closed = false;
  private started = false;
  private text: { result: TextComparison; state: TextState } | null = null;

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

  /** The latest text result (M12-17), or null before the first. */
  textResult(): { result: TextComparison; state: TextState } | null {
    return this.text;
  }

  /** A text comparison's tasks: every page's text, then matching on growing prefixes. */
  private textTasks(): QueueTask[] {
    const out: QueueTask[] = [];
    for (const side of ['a', 'b'] as const)
      this.pages[side].forEach((p, k) => {
        out.push({
          key: `text:${side}:${String(k)}`,
          sheet: k,
          phase: 0,
          run: (signal) => this.readText(side, p, k, signal, true),
        });
      });
    const na = this.pages.a.length;
    const nb = this.pages.b.length;
    const upTo = (n: number): string[] => {
      const keys: string[] = [];
      for (let k = 0; k < Math.min(n, na); k++) keys.push(`text:a:${String(k)}`);
      for (let k = 0; k < Math.min(n, nb); k++) keys.push(`text:b:${String(k)}`);
      return keys;
    };
    for (const n of [...textCheckpoints(Math.max(na, nb)), Math.max(na, nb)]) {
      const pages = { a: Math.min(n, na), b: Math.min(n, nb) };
      const complete = pages.a === na && pages.b === nb;
      out.push({
        key: complete ? 'match' : `match:${String(n)}`,
        sheet: null,
        phase: 1,
        after: upTo(n),
        run: (signal) => this.matchText(pages, complete, signal),
      });
    }
    return out;
  }

  private async matchText(
    pages: { a: number; b: number },
    complete: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    // An early result is worth nothing once a larger one is in.
    const have = this.text?.state.pages;
    if (have && have.a >= pages.a && have.b >= pages.b) return;
    const result = await this.opts.compare.call(
      'matchText',
      {
        cmpId: this.id,
        pages,
        ...(this.opts.moves === false ? { moves: false } : {}),
        ...this.opts.textOptions,
      },
      { signal, ...(this.opts.onTextProgress ? { onProgress: this.opts.onTextProgress } : {}) },
    ).promise;
    if (signal.aborted) return;
    const now = this.text?.state.pages;
    if (now && now.a >= pages.a && now.b >= pages.b) return;
    const state: TextState = {
      complete,
      pages,
      settled: complete ? pages : { a: Math.max(0, pages.a - 2), b: Math.max(0, pages.b - 2) },
    };
    this.text = { result, state };
    this.opts.onText?.(result, state);
  }

  private tasks(): QueueTask[] {
    if (this.opts.text) return this.textTasks();
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
    const align = this.opts.align ?? true;
    this.sheetPairs.forEach((pair, sheet) => {
      // The frames come with the signatures.
      const sigs = [`sig:a:${String(pair.a)}`, `sig:b:${String(pair.b)}`];
      const aligned = align && !pair.place;
      if (aligned)
        out.push({
          key: `align:${String(sheet)}`,
          sheet,
          phase: 1,
          after: sigs,
          run: (signal) => this.alignSheet(sheet, pair, signal),
        });
      // Detection's text layer reads both pages' positioned text (D-61).
      const texts = [`text:a:${String(pair.a)}`, `text:b:${String(pair.b)}`];
      out.push({
        key: `sheet:${String(sheet)}`,
        sheet,
        phase: 1,
        after: aligned ? [...sigs, ...texts, `align:${String(sheet)}`] : [...sigs, ...texts],
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
    layout = false,
  ): Promise<void> {
    const text: PageText = await this.opts.work.run(
      'compareText',
      { docId: from.docId, pageIndex: from.page, ...(layout ? { structure: true } : {}) },
      { signal },
    ).promise;
    const ocr = this.opts.ocr;
    if (layout && ocr && isScan(text)) {
      // A scan without text: read by OCR for this comparison only (D-63, Q29).
      const r = await this.opts.work.run(
        'compareOcrRaster',
        { docId: from.docId, pageIndex: from.page, dpi: OCR_DPI },
        { signal },
      ).promise;
      const rec = await ocr.client.recognize(
        { width: r.width, height: r.height, data: r.data, dpi: OCR_DPI },
        ocr.languages,
        { signal },
      );
      await this.opts.compare.call(
        'putOcr',
        {
          cmpId: this.id,
          side,
          page,
          lines: rec.lines,
          dpi: OCR_DPI,
          frame: r.frame,
          turn: r.turn,
        },
        { signal },
      ).promise;
      return;
    }
    await this.opts.compare.call(
      'putText',
      { cmpId: this.id, side, page, text, ...(layout ? { layout } : {}) },
      { signal, transfer: textBuffers(text) },
    ).promise;
  }

  /** A sheet's alignment in use (D-60): set by hand, else the automatic one once found. */
  alignment(sheet: number): SheetAlignment | undefined {
    const place = this.manual.get(sheet);
    return place ? this.manualAlignment(sheet, place) : this.aligned.get(sheet);
  }

  /** A sheet's automatic alignment, once found, whatever was set by hand. */
  autoAlignment(sheet: number): SheetAlignment | undefined {
    return this.aligned.get(sheet);
  }

  private manualAlignment(sheet: number, place: Affine): SheetAlignment {
    const auto = this.aligned.get(sheet);
    return { status: 'manual', method: auto?.method ?? 'vector', place, score: auto?.score ?? 0 };
  }

  /**
   * Sets a sheet's placement by hand (M12-13, D-60: points or values), or with
   * null goes back to the automatic alignment. The watchers hear the new
   * alignment (the automatic one only once it is known), the Compare worker
   * records it, and the sheet is analysed again under it.
   */
  setManual(sheet: number, place: Affine | null): void {
    if (this.closed || !this.sheetPairs[sheet]) return;
    if (place) this.manual.set(sheet, place);
    else this.manual.delete(sheet);
    const rev = (this.placeRev.get(sheet) ?? 0) + 1;
    this.placeRev.set(sheet, rev);
    const al = this.alignment(sheet);
    if (!al) return;
    this.notifyAlign(sheet, al);
    if (!this.started) return;
    void this.open()
      .then(
        () =>
          this.opts.compare.call('setAlignment', { cmpId: this.id, sheet, alignment: al }).promise,
      )
      .catch(() => undefined);
    this.reanalyse(sheet);
  }

  /** A document's layer switches (D-59, Q24): only those that differ from its defaults. */
  layersOf(docId: string): LayerStates | undefined {
    return this.layers.get(docId);
  }

  /**
   * Sets a document's layer switches (D-59, Q24; null or none: its defaults).
   * Every sheet the document is in is analysed again with them; the alignment
   * found stays (it was found with each file's default layers).
   */
  setLayers(docId: string, states: LayerStates | null): void {
    if (this.closed) return;
    const was = layerKey(this.layers.get(docId));
    if (states && layerKey(states)) this.layers.set(docId, { ...states });
    else this.layers.delete(docId);
    if (layerKey(this.layers.get(docId)) === was) return;
    this.sheetPairs.forEach((pair, sheet) => {
      if (this.pages.a[pair.a]?.docId !== docId && this.pages.b[pair.b]?.docId !== docId) return;
      // An analysis under way stops at its next band; the sheet's facts start again.
      this.placeRev.set(sheet, (this.placeRev.get(sheet) ?? 0) + 1);
      this.reanalyse(sheet);
    });
  }

  /** Layer switches of both sides of a sheet, as one key (what its facts were gathered under). */
  private sheetLayers(pair: SheetPair): string {
    const a = this.pages.a[pair.a];
    const b = this.pages.b[pair.b];
    return `${layerKey(a ? this.layers.get(a.docId) : undefined)}|${layerKey(b ? this.layers.get(b.docId) : undefined)}`;
  }

  /** Queues a sheet's analysis again (a pending one reads the new state when it starts). */
  private reanalyse(sheet: number): void {
    // A pending analysis reads the placement when it starts; one under way or over runs again.
    const key = this.sheetTask.get(sheet) ?? `sheet:${String(sheet)}`;
    const state = this.queue.state(key);
    if (state === undefined || state === 'pending' || this.queue.isCancelled) return;
    const rev = this.placeRev.get(sheet) ?? 0;
    const next = `sheet:${String(sheet)}@${String(rev)}`;
    if (this.queue.state(next) !== undefined) return;
    const pair = this.sheetPairs[sheet];
    if (!pair) return;
    this.sheetTask.set(sheet, next);
    this.releaseWork ??= this.opts.work.hold();
    this.queue.add([
      {
        key: next,
        sheet,
        phase: 1,
        after: state === 'running' ? [key] : [],
        run: (signal) => this.analyseSheet(sheet, pair, signal),
      },
    ]);
    void this.queue.whenIdle().then(() => {
      this.letWorkGo();
    });
  }

  private notifyAlign(sheet: number, al: SheetAlignment): void {
    this.opts.onAlign?.(sheet, al);
    for (const fn of this.alignWatchers) fn(sheet, al);
  }

  /**
   * Calls `fn` with each sheet's alignment as it is found (and at once with
   * those already found), for views made after the session (the result).
   */
  watchAlignment(fn: (sheet: number, alignment: SheetAlignment) => void): () => void {
    this.alignWatchers.add(fn);
    const known = new Set([...this.aligned.keys(), ...this.manual.keys()]);
    for (const sheet of known) {
      const al = this.alignment(sheet);
      if (al) fn(sheet, al);
    }
    return () => {
      this.alignWatchers.delete(fn);
    };
  }

  /**
   * Calls `fn` with each sheet as its detection ends (M12-14; again after a
   * new placement), and at once with those already done.
   */
  watchSheets(fn: (sheet: number, facts: SheetFacts) => void): () => void {
    this.sheetWatchers.add(fn);
    for (const [sheet, facts] of this.detected) fn(sheet, facts);
    return () => {
      this.sheetWatchers.delete(fn);
    };
  }

  /** Whether a sheet's detection has ended. */
  isDetected(sheet: number): boolean {
    return this.detected.has(sheet);
  }

  /** The differences of the sheets detected so far, at the settings given (D-61, Q22). */
  async differences(
    sheets: { sheet: number; zones: Box[] }[],
    settings: { sensitivity: Sensitivity; minSize: number },
  ): Promise<{ sheet: number; diff: SheetDiff }[]> {
    const want = sheets.filter((s) => this.detected.has(s.sheet));
    if (this.closed || want.length === 0) return [];
    return this.opts.compare.call('differences', { cmpId: this.id, sheets: want, ...settings })
      .promise;
  }

  /** Whether a sheet is a scan: aligned by the image method (S28: its own tolerances). */
  private isScanSheet(sheet: number): boolean {
    return this.aligned.get(sheet)?.method === 'image';
  }

  /** Checks a sheet as it is and, when it matches poorly, aligns it (D-60, S28). */
  private async alignSheet(sheet: number, pair: SheetPair, signal: AbortSignal): Promise<void> {
    const pa = this.pages.a[pair.a];
    const pb = this.pages.b[pair.b];
    if (!pa || !pb) throw new Error('sheet page missing');
    const call = this.opts.compare;
    const geo = async (side: CompareSide, from: SidePage, page: number): Promise<PageFrame> => {
      const g = await this.opts.work.run(
        'compareGeometry',
        { docId: from.docId, pageIndex: from.page },
        { signal },
      ).promise;
      await call.call(
        'putGeometry',
        { cmpId: this.id, side, page, segments: g.segments },
        { signal, transfer: [g.segments.buffer as ArrayBuffer] },
      ).promise;
      return g.frame;
    };
    const fa = await geo('a', pa, pair.a);
    const fb = await geo('b', pb, pair.b);
    const check = await call.call('alignAsIs', { cmpId: this.id, a: pair.a, b: pair.b }, { signal })
      .promise;
    let al: SheetAlignment;
    if (check.vector && check.agreement >= AS_IS_AGREEMENT) {
      al = asIs('vector', check.agreement);
      await call.call('setAlignment', { cmpId: this.id, sheet, alignment: al }, { signal }).promise;
    } else if (check.vector) {
      // Two small whole-page rasters for the coarse step (S28: 512 px canvas).
      const scale = coarseScale(fa, fb);
      const whole = async (from: SidePage, frame: PageFrame): Promise<RasterBand> => {
        const size = rasterSize(frame.width, frame.height, scale * 72);
        return this.opts.work.run(
          'compareRaster',
          {
            docId: from.docId,
            pageIndex: from.page,
            dpi: scale * 72,
            ...size,
            top: 0,
            rows: size.height,
          },
          { signal },
        ).promise;
      };
      const a = await whole(pa, fa);
      const b = await whole(pb, fb);
      al = await call.call(
        'alignVector',
        { cmpId: this.id, sheet, a: pair.a, b: pair.b, coarse: { a, b, scale } },
        { signal, transfer: [a.data.buffer as ArrayBuffer, b.data.buffer as ArrayBuffer] },
      ).promise;
    } else {
      // A scan, or next to no line work: the image method on finer rasters.
      const scale = imageScale(fa, fb);
      for (const [side, from, frame] of [
        ['a', pa, fa],
        ['b', pb, fb],
      ] as const) {
        const size = rasterSize(frame.width, frame.height, scale * 72);
        for (const range of bandRanges(size.height, this.opts.bandRows ?? BAND_ROWS)) {
          const band = await this.opts.work.run(
            'compareRaster',
            { docId: from.docId, pageIndex: from.page, dpi: scale * 72, ...size, ...range },
            { signal },
          ).promise;
          await call.call(
            'putAlignBand',
            { cmpId: this.id, sheet, side, band },
            { signal, transfer: [band.data.buffer as ArrayBuffer] },
          ).promise;
        }
      }
      al = await call.call('alignImage', { cmpId: this.id, sheet, scale }, { signal }).promise;
    }
    if (signal.aborted) return;
    this.aligned.set(sheet, al);
    const manual = this.manual.get(sheet);
    if (manual) {
      // Set by hand meanwhile: that stays in use (the worker hears it again over the automatic one).
      const mine = this.manualAlignment(sheet, manual);
      await call.call('setAlignment', { cmpId: this.id, sheet, alignment: mine }, { signal })
        .promise;
      this.notifyAlign(sheet, mine);
      return;
    }
    this.notifyAlign(sheet, al);
  }

  /** Both rasters of a sheet pair in B's frame, band by band, folded into the sheet's facts. */
  private async analyseSheet(sheet: number, pair: SheetPair, signal: AbortSignal): Promise<void> {
    const frame = this.frames.b.get(pair.b);
    if (!frame) throw new Error('B frame missing');
    const dpi = this.opts.dpi ?? ANALYSIS_DPI;
    const size = rasterSize(frame.width, frame.height, dpi);
    const place =
      this.manual.get(sheet) ?? pair.place ?? this.aligned.get(sheet)?.place ?? IDENTITY;
    const rev = this.placeRev.get(sheet) ?? 0;
    const pa = this.pages.a[pair.a];
    const pb = this.pages.b[pair.b];
    if (!pa || !pb) throw new Error('sheet page missing');
    // Facts gathered with other layer switches start again (D-59, Q24).
    const layers = this.sheetLayers(pair);
    const was = this.factsLayers.get(sheet);
    if (was !== undefined && was !== layers)
      await this.opts.compare.call('resetSheet', { cmpId: this.id, sheet }, { signal }).promise;
    this.factsLayers.set(sheet, layers);
    const la = this.layers.get(pa.docId);
    const lb = this.layers.get(pb.docId);
    const scan = this.isScanSheet(sheet);
    const inkLevel = scan ? SCAN_INK_LEVEL : INK_LEVEL;
    this.detected.delete(sheet);
    for (const range of bandRanges(size.height, this.opts.bandRows ?? BAND_ROWS)) {
      const req = { dpi, width: size.width, height: size.height, ...range };
      // Both reads are queued in the Work worker at once; it renders them one after the other.
      const ja = this.opts.work.run(
        'compareRaster',
        { docId: pa.docId, pageIndex: pa.page, ...req, place, ...(la ? { layers: la } : {}) },
        { signal },
      );
      const jb = this.opts.work.run(
        'compareRaster',
        { docId: pb.docId, pageIndex: pb.page, ...req, ...(lb ? { layers: lb } : {}) },
        { signal },
      );
      const [a, b] = await Promise.all([ja.promise, jb.promise]);
      // The placement changed meanwhile: the analysis under the new one takes over.
      if ((this.placeRev.get(sheet) ?? 0) !== rev) return;
      await this.opts.compare.call(
        'sheetBand',
        { cmpId: this.id, sheet, dpi, a, b, inkLevel },
        { signal, transfer: [a.data.buffer as ArrayBuffer, b.data.buffer as ArrayBuffer] },
      ).promise;
    }
    // Detection (M12-14, D-61): the counts are kept, and the text layer compares the words.
    await this.opts.compare.call(
      'detectSheet',
      { cmpId: this.id, sheet, a: pair.a, b: pair.b, place, scan },
      { signal },
    ).promise;
    const facts = await this.opts.compare.call('sheetFacts', { cmpId: this.id, sheet }, { signal })
      .promise;
    if (signal.aborted || (this.placeRev.get(sheet) ?? 0) !== rev) return;
    this.detected.set(sheet, facts);
    this.opts.onSheet?.(sheet, facts);
    for (const fn of this.sheetWatchers) fn(sheet, facts);
  }
}
