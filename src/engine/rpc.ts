// Main-thread side of the typed, cancellable worker RPC (ARCHITECTURE §3.1,
// CLAUDE.md rules 1–2). Every call returns a Job: a promise plus cancel() and
// progress. A cancelled job rejects with AbortError exactly once, immediately;
// a result that arrives later is dropped.

import { AbortError, WorkerLostError, fromErrorData } from './errors';
import type { ApiSpec, ArgsOf, ProgressOf, Request, Response, ResultOf, RpcPort } from './protocol';

export interface Job<R, P> {
  readonly id: number;
  readonly promise: Promise<R>;
  /** Cancels the job. No-op once it has settled. */
  cancel(): void;
  /** Subscribes to progress; returns an unsubscribe function. */
  onProgress(listener: (progress: P) => void): () => void;
}

export interface CallOptions<P> {
  signal?: AbortSignal;
  /** Buffers in `args` to transfer instead of copy. */
  transfer?: Transferable[];
  onProgress?: (progress: P) => void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  progress: Set<(p: unknown) => void>;
}

export class RpcClient<Api extends ApiSpec<Api>> {
  private readonly port: RpcPort;
  private readonly name: string;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private lost = false;

  /** `name` identifies the worker in WorkerLostError messages ("render", "work"). */
  constructor(port: RpcPort, name: string) {
    this.port = port;
    this.name = name;
    port.addEventListener('message', (ev: MessageEvent) => {
      this.onMessage(ev.data as Response);
    });
    port.addEventListener('error', () => {
      this.dispose();
    });
    port.addEventListener('messageerror', () => {
      this.dispose();
    });
    port.start?.();
  }

  get isLost(): boolean {
    return this.lost;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  call<K extends keyof Api & string>(
    method: K,
    args: ArgsOf<Api, K>,
    options: CallOptions<ProgressOf<Api, K>> = {},
  ): Job<ResultOf<Api, K>, ProgressOf<Api, K>> {
    const id = this.nextId++;
    const progress = new Set<(p: unknown) => void>();
    if (options.onProgress) progress.add(options.onProgress as (p: unknown) => void);

    let settled = false;
    let rejectJob: (err: Error) => void = () => undefined;
    const promise = new Promise<ResultOf<Api, K>>((resolve, reject) => {
      rejectJob = reject;
      this.pending.set(id, {
        resolve: (v) => {
          settled = true;
          resolve(v as ResultOf<Api, K>);
        },
        reject: (e) => {
          settled = true;
          reject(e);
        },
        progress,
      });
    });

    const cancel = (): void => {
      if (settled) return;
      settled = true;
      this.pending.delete(id);
      rejectJob(new AbortError());
      if (!this.lost) this.post({ t: 'cancel', id });
    };

    const job: Job<ResultOf<Api, K>, ProgressOf<Api, K>> = {
      id,
      promise,
      cancel,
      onProgress: (listener) => {
        const l = listener as (p: unknown) => void;
        progress.add(l);
        return () => progress.delete(l);
      },
    };

    if (this.lost) {
      this.pending.delete(id);
      settled = true;
      rejectJob(new WorkerLostError(this.name));
      return job;
    }
    if (options.signal?.aborted) {
      cancel();
      return job;
    }
    options.signal?.addEventListener('abort', cancel, { once: true });
    this.post({ t: 'call', id, method, args }, options.transfer ?? []);
    return job;
  }

  /** Rejects every pending call with WorkerLostError; later calls fail fast. */
  dispose(): void {
    if (this.lost) return;
    this.lost = true;
    const err = new WorkerLostError(this.name);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private post(msg: Request, transfer: Transferable[] = []): void {
    this.port.postMessage(msg, transfer);
  }

  private onMessage(msg: Response): void {
    const p = this.pending.get(msg.id);
    if (!p) return; // cancelled or unknown: drop late messages
    switch (msg.t) {
      case 'progress':
        for (const l of p.progress) l(msg.progress);
        return;
      case 'ok':
        this.pending.delete(msg.id);
        p.resolve(msg.value);
        return;
      case 'err':
        this.pending.delete(msg.id);
        p.reject(fromErrorData(msg.error));
        return;
    }
  }
}
