// Main-thread client for the Work worker (ARCHITECTURE §3.1, ADR-004 decisions 1
// and 4, ADR-001 B11). It owns the worker's lifecycle: after a job, when the
// worker is idle and its WASM memory is above the threshold (or a document was
// evicted), it terminates the worker, starts a fresh one and reloads every open
// document as original + tail. Callers keep their jobs; nothing is visible to
// the user.
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import type { CallOptions, Job } from './rpc';
import { RpcClient } from './rpc';
import { WorkerLostError } from './errors';
import type { ArgsOf, ProgressOf, ResultOf } from './protocol';
import type { WorkApi } from './workApi';
import { WORK_RESPAWN_BYTES, shouldRespawnWork } from './workerLifecycle';

export interface WorkDocSource {
  /**
   * Re-reads the original bytes after a respawn (from the file handle, OPFS or
   * memory). The first copy is transferred to the worker, so the main thread
   * does not keep one (§3.1: only the Render worker holds another copy).
   */
  reload: () => Promise<ArrayBuffer>;
  password?: string;
}

interface DocRecord extends WorkDocSource {
  tail: ArrayBuffer | undefined;
}

/** Job methods: the ones that run through the worker's scheduler. */
type JobMethod = 'docState' | 'textStats';

export interface WorkClientOptions {
  wasmUrl?: string;
  respawnAboveBytes?: number;
  /** Test seam: how to start a worker. */
  spawn?: () => Worker;
}

export class WorkClient {
  private worker!: Worker;
  private rpc!: RpcClient<WorkApi>;
  private ready!: Promise<unknown>;
  private readonly docs = new Map<string, DocRecord>();
  private readonly wasmUrl: string;
  private readonly threshold: number;
  private readonly spawnWorker: () => Worker;
  private active = 0;
  private evicted = false;
  private respawning: Promise<void> | null = null;
  private checking: Promise<void> | null = null;
  /** Number of respawns so far (observable for tests and diagnostics). */
  respawns = 0;
  /** WASM bytes seen by the last respawn check (before any respawn it caused). */
  lastCheckedBytes = 0;

  constructor(opts: WorkClientOptions = {}) {
    this.wasmUrl = opts.wasmUrl ?? new URL(pdfiumWasmUrl, location.origin).href;
    this.threshold = opts.respawnAboveBytes ?? WORK_RESPAWN_BYTES;
    this.spawnWorker =
      opts.spawn ??
      (() =>
        new Worker(new URL('../workers/work.worker.ts', import.meta.url), {
          type: 'module',
          name: 'work',
        }));
    this.start();
  }

  private start(): void {
    this.worker = this.spawnWorker();
    this.rpc = new RpcClient<WorkApi>(this.worker, 'work');
    this.ready = this.rpc.call('init', { wasmUrl: this.wasmUrl }).promise;
  }

  /** Opens a document; `bytes` is transferred to the worker. */
  async open(
    docId: string,
    bytes: ArrayBuffer,
    source: WorkDocSource,
  ): Promise<{ pageCount: number }> {
    await this.whenReady();
    this.docs.set(docId, { ...source, tail: undefined });
    const { pageCount } = await this.rpc.call(
      'open',
      {
        docId,
        original: bytes,
        ...(source.password === undefined ? {} : { password: source.password }),
      },
      { transfer: [bytes] },
    ).promise;
    return { pageCount };
  }

  /** New incremental tail after a save or edit (§3.1): the worker applies it on its next job. */
  async refresh(docId: string, tail: ArrayBuffer): Promise<void> {
    const d = this.docs.get(docId);
    if (!d) return;
    d.tail = tail;
    await this.whenReady();
    await this.rpc.call('refresh', { docId, tail: tail.slice(0) }).promise;
  }

  async close(docId: string): Promise<void> {
    if (!this.docs.delete(docId)) return;
    await this.whenReady();
    await this.rpc.call('close', { docId }).promise;
  }

  /** Evicts an idle document under memory pressure: closes it and respawns when idle (ADR-004 d4). */
  async evict(docId: string): Promise<void> {
    await this.close(docId);
    this.evicted = true;
    await this.maybeRespawn();
  }

  memory(): Promise<{ wasmBytes: number; peakWasmBytes: number }> {
    return this.whenReady().then(() => this.rpc.call('memory', null).promise);
  }

  /** Runs a scheduled job. Respawn checks happen when the worker becomes idle. */
  run<K extends JobMethod>(
    method: K,
    args: ArgsOf<WorkApi, K>,
    options: CallOptions<ProgressOf<WorkApi, K>> = {},
  ): { promise: Promise<ResultOf<WorkApi, K>>; cancel(): void } {
    const ac = new AbortController();
    options.signal?.addEventListener('abort', () => {
      ac.abort();
    });
    let job: Job<ResultOf<WorkApi, K>, ProgressOf<WorkApi, K>> | undefined;
    this.active++;
    const promise = (async () => {
      try {
        await this.whenReady();
        job = this.rpc.call(method, args, { ...options, signal: ac.signal });
        return await job.promise;
      } finally {
        this.active--;
        this.maybeRespawn().catch((err: unknown) => {
          console.error('[work] respawn check failed', err);
        });
      }
    })();
    return {
      promise,
      cancel: () => {
        ac.abort();
      },
    };
  }

  /** Waits for init and for any respawn in progress. */
  private async whenReady(): Promise<void> {
    if (this.respawning) await this.respawning;
    await this.ready;
  }

  /**
   * Checks memory and respawns if the policy says so. Single-flight: concurrent
   * callers share one check, so two jobs finishing together cannot race a
   * respawn against each other's in-flight calls.
   */
  private maybeRespawn(): Promise<void> {
    if (this.checking) {
      // An eviction during a check still needs its own decision afterwards.
      return this.checking.then(() => (this.evicted ? this.maybeRespawn() : undefined));
    }
    this.checking = this.check().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async check(): Promise<void> {
    try {
      if (this.respawning) {
        await this.respawning;
        return;
      }
      if (this.active > 0) return;
      const { wasmBytes } = await this.rpc.call('memory', null).promise;
      this.lastCheckedBytes = wasmBytes;
      const input = {
        wasmBytes,
        pendingJobs: this.active,
        evicted: this.evicted,
        thresholdBytes: this.threshold,
      };
      if (!shouldRespawnWork(input)) return;
      this.respawning = this.respawn().finally(() => {
        this.respawning = null;
      });
      await this.respawning;
    } catch (err) {
      // A worker that died on its own is replaced by the next respawn; anything else is a bug.
      if (!(err instanceof WorkerLostError)) throw err;
    }
  }

  private async respawn(): Promise<void> {
    this.rpc.dispose();
    this.worker.terminate();
    this.evicted = false;
    this.start();
    this.respawns++;
    await this.ready;
    for (const [docId, d] of this.docs) {
      const original = await d.reload();
      await this.rpc.call(
        'open',
        {
          docId,
          original,
          ...(d.tail ? { tail: d.tail.slice(0) } : {}),
          ...(d.password === undefined ? {} : { password: d.password }),
        },
        { transfer: [original] },
      ).promise;
    }
  }

  terminate(): void {
    this.rpc.dispose();
    this.worker.terminate();
  }
}
