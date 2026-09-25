// Errors that cross the worker boundary (ARCHITECTURE §3.1, CLAUDE.md rule 10).
//
// Only `{ code, message, stack }` crosses. Messages of `RpcError`s are written
// by us and must never contain document content (page text, file names,
// annotation text). Any other error is reduced to its class name and stack
// frames, because its message may quote content (e.g. a parser error).

export type ErrorCode =
  | 'aborted'
  | 'worker-lost'
  | 'unknown-method'
  | 'internal'
  // Feature codes are added by the workers that raise them (e.g. 'needs-password').
  | (string & {});

export interface RpcErrorData {
  code: ErrorCode;
  message: string;
  stack?: string;
}

/** An error we raise on purpose. `message` must be free of document content. */
export class RpcError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

/** The call was cancelled (AbortSignal or `job.cancel()`). */
export class AbortError extends RpcError {
  constructor() {
    super('aborted', 'The operation was cancelled');
    this.name = 'AbortError';
  }
}

/** The worker died or was terminated with calls still pending. */
export class WorkerLostError extends RpcError {
  constructor(worker: string) {
    super('worker-lost', `The ${worker} worker stopped`);
    this.name = 'WorkerLostError';
  }
}

/** Stack frames only: the first line of a V8/SpiderMonkey stack repeats the message. */
function framesOnly(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const frames = stack.split('\n').filter((l) => /^\s+at\s|@/.test(l));
  return frames.length ? frames.join('\n') : undefined;
}

export function toErrorData(err: unknown): RpcErrorData {
  const stack = err instanceof Error ? framesOnly(err.stack) : undefined;
  const base =
    err instanceof RpcError
      ? { code: err.code, message: err.message }
      : { code: 'internal', message: err instanceof Error ? err.name : typeof err };
  return stack ? { ...base, stack } : base;
}

export function fromErrorData(data: RpcErrorData): RpcError {
  if (data.code === 'aborted') return new AbortError();
  const err = new RpcError(data.code, data.message);
  if (data.stack) err.stack = `RpcError: ${data.message}\n${data.stack}`;
  return err;
}

export function isAbortError(err: unknown): err is AbortError {
  return err instanceof RpcError && err.code === 'aborted';
}
