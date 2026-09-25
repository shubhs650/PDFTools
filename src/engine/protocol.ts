// Wire protocol and API typing shared by /src/engine (callers) and /src/workers
// (hosts). One API spec per worker describes every method's arguments, result
// and progress payload, so both sides are checked by the compiler.

import type { RpcErrorData } from './errors';

/** One method of a worker API. */
export interface MethodSpec<A, R, P = never> {
  args: A;
  result: R;
  progress: P;
}

/**
 * A worker API: method name → MethodSpec, e.g.
 * `interface RenderApi { open: MethodSpec<{ bytes: ArrayBuffer }, { docId: string }> }`.
 */
export type ApiSpec<T> = { [K in keyof T]: MethodSpec<unknown, unknown, unknown> };

export type ArgsOf<T, K extends keyof T> =
  T[K] extends MethodSpec<infer A, unknown, unknown> ? A : never;
export type ResultOf<T, K extends keyof T> =
  T[K] extends MethodSpec<unknown, infer R, unknown> ? R : never;
export type ProgressOf<T, K extends keyof T> =
  T[K] extends MethodSpec<unknown, unknown, infer P> ? P : never;

export type Request =
  { t: 'call'; id: number; method: string; args: unknown } | { t: 'cancel'; id: number };

export type Response =
  | { t: 'ok'; id: number; value: unknown }
  | { t: 'err'; id: number; error: RpcErrorData }
  | { t: 'progress'; id: number; progress: unknown };

/** The subset of Worker / MessagePort / DedicatedWorkerGlobalScope we use. */
export interface RpcPort {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (ev: Event) => void): void;
  start?(): void;
}

/**
 * Marks a value to be sent with a transfer list (zero-copy), e.g.
 * `return new Transfer({ bytes }, [bytes])` from a handler.
 */
export class Transfer<T> {
  readonly value: T;
  readonly list: Transferable[];

  constructor(value: T, list: Transferable[]) {
    this.value = value;
    this.list = list;
  }
}

/** Progress updates are sent at most this often (ARCHITECTURE §3.1). */
export const PROGRESS_INTERVAL_MS = 100;
/** Jobs longer than this must report progress (CLAUDE.md rule 2). */
export const PROGRESS_REQUIRED_AFTER_MS = 300;
