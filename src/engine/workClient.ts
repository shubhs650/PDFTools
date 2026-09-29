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
  /** Owner password once unlocked: re-applied after a respawn (memory only, M2-Q7). */
  ownerPassword?: string;
}

/** Job methods: the ones that run through the worker's scheduler. */
type JobMethod =
  | 'annotations'
  | 'docState'
  | 'textStats'
  | 'verify'
  | 'digest'
  | 'pageGeometry'
  | 'textSlices'
  | 'search'
  | 'searchContext'
  | 'searchExtras'
  | 'listAttachments'
  | 'readAttachment'
  | 'listLayers'
  | 'pageViewports'
  | 'formFacts'
  | 'printOpen'
  | 'printPages'
  | 'printBand'
  | 'printClose'
  | 'printReady'
  | 'docProperties'
  | 'checkSignatures'
  | 'hitRects'
  | 'snapGeometry'
  | 'crs'
  | 'oxideWarm'
  | 'extract'
  | 'indexText';

export interface WorkClientOptions {
  wasmUrl?: string;
  respawnAboveBytes?: number;
  /** Test seam: how to start a worker. */
  spawn?: () => Worker;
}

function appendBytes(a: ArrayBuffer | undefined, b: ArrayBuffer): ArrayBuffer {
  if (!a || a.byteLength === 0) return b.slice(0);
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(new Uint8Array(a), 0);
  out.set(new Uint8Array(b), a.byteLength);
  return out.buffer;
}

export class WorkClient {
  private worker!: Worker;
  private rpc!: RpcClient<WorkApi>;
  private ready!: Promise<unknown>;
  private readonly docs = new Map<string, DocRecord>();
  /** Opens in flight: jobs on those documents wait for them (the worker needs the copy). */
  private readonly opening = new Map<string, Promise<unknown>>();
  /** Callers waiting for a document's copy to be added (whenAdded). */
  private readonly addWaiters = new Map<string, (() => void)[]>();
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
    this.docs.set(docId, { ...source, tail: undefined });
    for (const wake of this.addWaiters.get(docId) ?? []) wake();
    this.addWaiters.delete(docId);
    const opened = (async () => {
      await this.whenReady();
      return this.rpc.call(
        'open',
        {
          docId,
          original: bytes,
          ...(source.password === undefined ? {} : { password: source.password }),
        },
        { transfer: [bytes] },
      ).promise;
    })();
    this.opening.set(docId, opened);
    try {
      const { pageCount } = await opened;
      return { pageCount };
    } catch (err) {
      this.docs.delete(docId);
      throw err;
    } finally {
      this.opening.delete(docId);
    }
  }

  /** New incremental tail after a save or edit (§3.1): the worker applies it on its next job. */
  async refresh(docId: string, tail: ArrayBuffer): Promise<void> {
    const d = this.docs.get(docId);
    if (!d) return;
    d.tail = tail;
    await this.whenReady();
    await this.rpc.call('refresh', { docId, tail: tail.slice(0) }).promise;
  }

  /**
   * Resolves true once the document's copy is added here (the open pipeline
   * adds it right after the tab opens), or false after `timeoutMs`.
   */
  whenAdded(docId: string, timeoutMs: number): Promise<boolean> {
    if (this.docs.has(docId)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const list = this.addWaiters.get(docId)?.filter((w) => w !== wake) ?? [];
        if (list.length) this.addWaiters.set(docId, list);
        else this.addWaiters.delete(docId);
        resolve(false);
      }, timeoutMs);
      this.addWaiters.set(docId, [...(this.addWaiters.get(docId) ?? []), wake]);
    });
  }

  /** Whether the document has a copy here (opening it can fail without affecting the tab). */
  has(docId: string): boolean {
    return this.docs.has(docId);
  }

  /** A committed save's tail piece (M1-21): appended to the tail, applied on the next job. */
  async append(docId: string, piece: ArrayBuffer): Promise<void> {
    const d = this.docs.get(docId);
    if (!d) return;
    d.tail = appendBytes(d.tail, piece);
    await this.whenReady();
    await this.rpc.call('append', { docId, piece: piece.slice(0) }).promise;
  }

  /** The user is scrolling or zooming (M2-06): background indexing backs off. Fire and forget. */
  notifyActivity(quietMs?: number): void {
    if (this.respawning) return;
    this.rpc
      .call('activity', quietMs === undefined ? {} : { quietMs })
      .promise.catch(() => undefined);
  }

  /** Owner-password unlock of the worker's copy (§7.12); kept for respawn reloads. */
  async unlock(docId: string, ownerPassword: string): Promise<boolean> {
    const d = this.docs.get(docId);
    if (!d) return false;
    await this.whenReady();
    const { unlocked } = await this.rpc.call('unlock', { docId, ownerPassword }).promise;
    if (unlocked) d.ownerPassword = ownerPassword;
    return unlocked;
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

  /**
   * Keeps the worker from respawning between the jobs of a longer task (a
   * print job's copy lives in it). Call the returned function when done.
   */
  hold(): () => void {
    this.active++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.active--;
      this.maybeRespawn().catch((err: unknown) => {
        console.error('[work] respawn check failed', err);
      });
    };
  }

  /** Runs a scheduled job. Respawn checks happen when the worker becomes idle. */
  run<K extends JobMethod>(
    method: K,
    args: ArgsOf<WorkApi, K>,
    options: CallOptions<ProgressOf<WorkApi, K>> = {},
  ): { promise: Promise<ResultOf<WorkApi, K>>; cancel(): void } {
    const ac = new AbortController();
    // A signal aborted before the call cancels it at once (no 'abort' event comes).
    if (options.signal?.aborted) ac.abort();
    options.signal?.addEventListener('abort', () => {
      ac.abort();
    });
    let job: Job<ResultOf<WorkApi, K>, ProgressOf<WorkApi, K>> | undefined;
    this.active++;
    const promise = (async () => {
      try {
        const docId = (args as { docId?: unknown } | null)?.docId;
        if (typeof docId === 'string') await this.opening.get(docId);
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
          ...(d.ownerPassword === undefined ? {} : { ownerPassword: d.ownerPassword }),
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
