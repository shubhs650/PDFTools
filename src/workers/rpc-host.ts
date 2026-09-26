// Worker side of the typed RPC (ARCHITECTURE §3.1). A worker module calls
// `serve(self, handlers)` once. Each call gets an AbortSignal (cancel messages
// abort it), a throttled progress reporter, and zero-copy results via
// `new Transfer(value, list)`.

import { AbortError, RpcError, toErrorData } from '../engine/errors';
import {
  PROGRESS_INTERVAL_MS,
  PROGRESS_REQUIRED_AFTER_MS,
  Transfer,
  type ApiSpec,
  type ArgsOf,
  type ProgressOf,
  type Request,
  type Response,
  type ResultOf,
  type RpcPort,
} from '../engine/protocol';

export interface JobContext<P> {
  readonly signal: AbortSignal;
  /** Reports progress; sent at most every 100 ms (latest value wins). */
  progress(value: P): void;
  /**
   * Sends a progress message at once and in order, never dropped: for results
   * streamed in batches whose rate the job limits itself (search, ADR-006:
   * batches at least 50 ms apart). Don't mix with `progress` in one job.
   */
  stream(value: P): void;
  /** Throws AbortError if the call was cancelled. */
  throwIfAborted(): void;
}

export type Handlers<Api extends ApiSpec<Api>> = {
  [K in keyof Api]: (
    args: ArgsOf<Api, K>,
    ctx: JobContext<ProgressOf<Api, K>>,
  ) =>
    | ResultOf<Api, K>
    | Transfer<ResultOf<Api, K>>
    | Promise<ResultOf<Api, K> | Transfer<ResultOf<Api, K>>>;
};

export interface ServeOptions {
  /** Called when a job ran longer than 300 ms without reporting progress (rule 2). */
  onSlowWithoutProgress?: (method: string, ms: number) => void;
  now?: () => number;
}

/** Throttle with a trailing edge: at most one emit per interval, last value kept. */
export function createThrottle<T>(
  intervalMs: number,
  emit: (value: T) => void,
  now: () => number = () => performance.now(),
): { push(value: T): void; flush(): void; cancel(): void } {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | undefined;
  const fire = (): void => {
    timer = undefined;
    if (!pending) return;
    const { value } = pending;
    pending = undefined;
    last = now();
    emit(value);
  };
  return {
    push(value) {
      pending = { value };
      const wait = last + intervalMs - now();
      if (wait <= 0) {
        if (timer !== undefined) clearTimeout(timer);
        fire();
      } else {
        timer ??= setTimeout(fire, wait);
      }
    },
    flush() {
      if (timer !== undefined) clearTimeout(timer);
      fire();
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

const defaultSlowWarning = (method: string, ms: number): void => {
  if (import.meta.env.DEV) {
    console.error(
      `[rpc] ${method} ran ${String(Math.round(ms))} ms without reporting progress (CLAUDE.md rule 2)`,
    );
  }
};

export function serve<Api extends ApiSpec<Api>>(
  port: RpcPort,
  handlers: Handlers<Api>,
  options: ServeOptions = {},
): void {
  const now = options.now ?? (() => performance.now());
  const onSlow = options.onSlowWithoutProgress ?? defaultSlowWarning;
  const live = new Map<number, AbortController>();
  const send = (msg: Response, transfer: Transferable[] = []): void => {
    port.postMessage(msg, transfer);
  };

  port.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as Request;
    if (msg.t === 'cancel') {
      live.get(msg.id)?.abort();
      return;
    }
    const { id, method } = msg;
    const ac = new AbortController();
    live.set(id, ac);
    const started = now();
    // An object, so the compiler doesn't narrow it to `false` across the closure.
    const state = { reported: false };
    const throttle = createThrottle<unknown>(
      PROGRESS_INTERVAL_MS,
      (progress) => {
        if (!ac.signal.aborted) send({ t: 'progress', id, progress });
      },
      now,
    );
    const ctx: JobContext<unknown> = {
      signal: ac.signal,
      progress: (value) => {
        state.reported = true;
        throttle.push(value);
      },
      stream: (value) => {
        state.reported = true;
        if (!ac.signal.aborted) send({ t: 'progress', id, progress: value });
      },
      throwIfAborted: () => {
        if (ac.signal.aborted) throw new AbortError();
      },
    };

    void (async () => {
      try {
        const handler = (handlers as Record<string, unknown>)[method];
        if (typeof handler !== 'function') {
          throw new RpcError('unknown-method', `Unknown method ${method}`);
        }
        const out: unknown = await (handler as (a: unknown, c: JobContext<unknown>) => unknown)(
          msg.args,
          ctx,
        );
        throttle.cancel();
        if (ac.signal.aborted) return; // the caller already rejected
        if (out instanceof Transfer) send({ t: 'ok', id, value: out.value }, out.list);
        else send({ t: 'ok', id, value: out });
      } catch (err) {
        throttle.cancel();
        if (ac.signal.aborted) return;
        send({ t: 'err', id, error: toErrorData(err) });
      } finally {
        live.delete(id);
        const ms = now() - started;
        if (ms > PROGRESS_REQUIRED_AFTER_MS && !state.reported && !ac.signal.aborted)
          onSlow(method, ms);
      }
    })();
  });
  port.start?.();
}

/**
 * Yields to the worker's event loop so cancel messages get delivered, at most
 * once per `sliceMs` (nested setTimeout is clamped to 4 ms, which would
 * dominate a per-page loop), then throws if the job was cancelled.
 */
export function createYielder(sliceMs = 8): (signal: AbortSignal) => Promise<void> {
  let last = performance.now();
  return async (signal) => {
    if (performance.now() - last >= sliceMs) {
      await new Promise((r) => setTimeout(r, 0));
      last = performance.now();
    }
    if (signal.aborted) throw new AbortError();
  };
}
