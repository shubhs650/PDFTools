// Minimal typed, cancellable RPC over postMessage — the shape /src/engine will
// grow into (ARCHITECTURE §3.1: every call cancellable, progress for > 300 ms).

export type Handlers = Record<string, (args: never, ctx: CallContext) => unknown>;

export interface CallContext {
  signal: AbortSignal;
  progress(p: unknown): void;
  transfer(t: Transferable[]): void;
}

type Req = { id: number; method: string; args: unknown } | { id: number; cancel: true };
type Res =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string; aborted?: boolean }
  | { id: number; progress: unknown };

export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

/** Worker side. */
export function serve(handlers: Handlers): void {
  const live = new Map<number, AbortController>();
  self.addEventListener('message', (ev: MessageEvent<Req>) => {
    const msg = ev.data;
    if ('cancel' in msg) {
      live.get(msg.id)?.abort();
      return;
    }
    const ac = new AbortController();
    live.set(msg.id, ac);
    let transfer: Transferable[] = [];
    const ctx: CallContext = {
      signal: ac.signal,
      progress: (p) => {
        (self as unknown as Worker).postMessage({ id: msg.id, progress: p } satisfies Res);
      },
      transfer: (t) => (transfer = t),
    };
    const fn = handlers[msg.method];
    Promise.resolve()
      .then(() => {
        if (!fn) throw new Error(`unknown method ${msg.method}`);
        return fn(msg.args as never, ctx);
      })
      .then(
        (value) => {
          (self as unknown as Worker).postMessage({ id: msg.id, ok: true, value } satisfies Res, {
            transfer,
          });
        },
        (err: unknown) => {
          (self as unknown as Worker).postMessage({
            id: msg.id,
            ok: false,
            error: String(err),
            aborted: err instanceof AbortedError,
          } satisfies Res);
        },
      )
      .finally(() => live.delete(msg.id));
  });
}

/** Main-thread side. */
export class RpcClient<H extends Handlers> {
  private next = 1;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: unknown) => void;
      onProgress?: (p: unknown) => void;
    }
  >();

  constructor(private readonly worker: Worker) {
    worker.addEventListener('message', (ev: MessageEvent<Res>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if ('progress' in msg) {
        p.onProgress?.(msg.progress);
        return;
      }
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(msg.aborted ? new AbortedError() : new Error(msg.error));
    });
  }

  call<M extends keyof H & string>(
    method: M,
    args: Parameters<H[M]>[0],
    opts: {
      signal?: AbortSignal;
      onProgress?: (p: unknown) => void;
      transfer?: Transferable[];
    } = {},
  ): Promise<Awaited<ReturnType<H[M]>>> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      });
      opts.signal?.addEventListener('abort', () => {
        this.worker.postMessage({ id, cancel: true } satisfies Req);
      });
      this.worker.postMessage({ id, method, args } satisfies Req, {
        transfer: opts.transfer ?? [],
      });
    });
  }
}

/**
 * Yield to the worker's event loop so cancel messages can be delivered, but
 * only once per `sliceMs` (nested setTimeout is clamped to 4 ms, which would
 * dominate a per-page loop).
 */
export function makeYielder(sliceMs = 8): (signal: AbortSignal) => Promise<void> {
  let last = performance.now();
  return async (signal) => {
    if (performance.now() - last >= sliceMs) {
      await new Promise((r) => setTimeout(r, 0));
      last = performance.now();
    }
    if (signal.aborted) throw new AbortedError();
  };
}
