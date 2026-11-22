// Main-thread client for the Compare worker (M12-07, D-66, ARCHITECTURE
// §3.1). The worker starts with the first comparison and is terminated when
// the last one is released: its JS heap is the comparison's material, and a
// fresh worker is the only sure way to give it back. Calls are the typed,
// cancellable jobs of the shared RPC (rule 2).
import type { CompareApi } from './compareApi';
import type { ArgsOf, ProgressOf } from './protocol';
import { RpcClient, type CallOptions, type Job } from './rpc';
import type { ResultOf } from './protocol';

export interface CompareClientOptions {
  /** Test seam: how to start a worker. */
  spawn?: () => Worker;
}

type Method = Exclude<keyof CompareApi, 'open' | 'release'>;

export class CompareClient {
  private worker: Worker | null = null;
  private rpc: RpcClient<CompareApi> | null = null;
  private readonly open = new Set<string>();
  private readonly spawnWorker: () => Worker;
  /** Workers started so far (observable for tests: a release terminates). */
  starts = 0;

  constructor(opts: CompareClientOptions = {}) {
    this.spawnWorker =
      opts.spawn ??
      (() =>
        new Worker(new URL('../workers/compare.worker.ts', import.meta.url), {
          type: 'module',
          name: 'compare',
        }));
  }

  /** Comparisons open now. */
  get openCount(): number {
    return this.open.size;
  }

  /** Whether a worker is running. */
  get running(): boolean {
    return this.worker !== null;
  }

  private ensure(): RpcClient<CompareApi> {
    if (!this.rpc || this.rpc.isLost) {
      this.worker?.terminate();
      this.worker = this.spawnWorker();
      this.rpc = new RpcClient<CompareApi>(this.worker, 'compare');
      this.starts++;
      // A worker that died loses every comparison's material: open ones start again.
      for (const id of this.open)
        this.rpc.call('open', { cmpId: id }).promise.catch(() => undefined);
    }
    return this.rpc;
  }

  /** Starts a comparison's store (and the worker if needed). */
  async openComparison(cmpId: string): Promise<void> {
    this.open.add(cmpId);
    await this.ensure().call('open', { cmpId }).promise;
  }

  call<K extends Method>(
    method: K,
    args: ArgsOf<CompareApi, K>,
    options: CallOptions<ProgressOf<CompareApi, K>> = {},
  ): Job<ResultOf<CompareApi, K>, ProgressOf<CompareApi, K>> {
    return this.ensure().call(method, args, options);
  }

  /**
   * Drops a comparison's material. With no comparison left the worker is
   * terminated (its memory goes back); the next comparison starts a new one.
   */
  async release(cmpId: string): Promise<number> {
    if (!this.open.delete(cmpId)) return 0;
    if (!this.rpc || this.rpc.isLost) return 0;
    let freed = 0;
    try {
      freed = (await this.rpc.call('release', { cmpId }).promise).freedBytes;
    } finally {
      if (this.open.size === 0) this.terminate();
    }
    return freed;
  }

  terminate(): void {
    this.rpc?.dispose();
    this.worker?.terminate();
    this.rpc = null;
    this.worker = null;
  }
}
