// Main-thread client for the OCR worker (ADR-020 decision 6, ADR-004 memory
// policy): started on first use, one page at a time, terminated by `stop()`
// when the job ends or when a page is cancelled mid-recognition (the only way
// to interrupt Tesseract's synchronous Recognize). A later call starts a fresh
// worker. Nothing here touches pixels (rule 1): rasters are transferred.
import dataUrlDefault from './ocrDataUrl';
import { AbortError } from './errors';
import type { OcrApi, OcrRaster } from './ocrApi';
import { RpcClient } from './rpc';

export interface OcrClientOptions {
  dataUrl?: string;
  /** Test seam: how to start a worker. */
  spawn?: () => Worker;
}

export interface RecognizeOptions {
  signal?: AbortSignal;
  onProgress?: (p: { percent: number }) => void;
}

export class OcrClient {
  private worker: Worker | null = null;
  private rpc: RpcClient<OcrApi> | null = null;
  private ready: Promise<unknown> | null = null;
  private readonly dataUrl: string;
  private readonly spawnWorker: () => Worker;
  /** Workers started so far (observable for tests). */
  starts = 0;

  constructor(opts: OcrClientOptions = {}) {
    this.dataUrl = opts.dataUrl ?? dataUrlDefault();
    this.spawnWorker =
      opts.spawn ??
      (() =>
        new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), {
          type: 'module',
          name: 'ocr',
        }));
  }

  get running(): boolean {
    return this.worker !== null;
  }

  private start(): RpcClient<OcrApi> {
    this.worker = this.spawnWorker();
    this.rpc = new RpcClient<OcrApi>(this.worker, 'ocr');
    this.ready = this.rpc.call('init', { dataUrl: this.dataUrl }).promise;
    this.starts++;
    return this.rpc;
  }

  /** Recognizes one page; `raster.data` is transferred. Rejects with AbortError on cancel. */
  async recognize(
    raster: OcrRaster,
    opts: RecognizeOptions = {},
  ): Promise<{ lines: OcrLine[]; conf: number; ms: number }> {
    if (opts.signal?.aborted) throw new AbortError();
    const rpc = this.rpc ?? this.start();
    await this.ready;
    if (opts.signal?.aborted) throw new AbortError();
    const job = rpc.call('recognize', raster, {
      transfer: [raster.data],
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
    const onAbort = () => {
      // Recognize cannot be interrupted: the job rejects at once, then the worker goes.
      job.cancel();
      this.stop();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await job.promise;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Terminates the worker (its memory goes with it); the next call starts a new one. */
  stop(): void {
    this.rpc?.dispose();
    this.worker?.terminate();
    this.worker = null;
    this.rpc = null;
    this.ready = null;
  }
}

type OcrLine = import('../model/ocr/types').OcrLine;
