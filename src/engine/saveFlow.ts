// Save flow core (M1-21, ADR-005 decision 2): Render worker save → Work
// worker verification → keep-all fallback → result. A save is reported as
// ready to write only after original + tail, reopened by the Work worker,
// shows the Render worker's state. The main thread only orchestrates and
// passes bytes along (rule 1); dependencies are injected so the flow is
// unit-tested without workers.
import type { DocDigest } from '../workers/render/save/digest';
import type { MismatchReason, VerifyResult } from '../workers/work/verifySave';
import { RpcError } from './errors';

export interface IncrementalTail {
  tail: ArrayBuffer;
  mode: 'narrow' | 'keep-all';
  kept: number[];
  baseLength: number;
  expected: DocDigest | null;
}

/** Content-free record of a fallback (rule 10). */
export interface SaveFallbackLog {
  code: `save-fallback:${MismatchReason}`;
  objectCount: number;
  size: number;
}

export interface SaveFlowDeps {
  saveIncremental(docId: string, keepAll: boolean): Promise<IncrementalTail>;
  verify(
    docId: string,
    piece: ArrayBuffer,
    expected: DocDigest,
    signal?: AbortSignal,
  ): Promise<VerifyResult>;
  commit(docId: string, tailLength: number): Promise<{ baseLength: number }>;
  /** Hands the committed piece to the Work worker (applied lazily, ADR-001 B11). */
  refreshWork(docId: string, piece: ArrayBuffer): Promise<void>;
  logFallback(entry: SaveFallbackLog): void;
}

export interface PreparedSave {
  docId: string;
  /** Bytes to append to the file as last saved. */
  tail: ArrayBuffer;
  /** Length of the file the tail appends to. */
  baseLength: number;
  mode: 'narrow' | 'keep-all';
  /** True when the narrow tail failed verification and keep-all was used. */
  fellBack: boolean;
}

export class SaveVerifyError extends RpcError {
  readonly reason: MismatchReason;

  constructor(reason: MismatchReason) {
    super('save-verify-failed', `The saved file did not verify (${reason})`);
    this.reason = reason;
  }
}

export interface PrepareOptions {
  signal?: AbortSignal;
  /** Test seam (e2e hook, unit tests): alters the first tail before it is verified. */
  tamper?: (tail: ArrayBuffer) => ArrayBuffer;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

/**
 * Builds and verifies the next incremental tail. Resolves null when nothing
 * changed. Never writes anything: the caller writes `tail`, then calls `finishSave`.
 */
export async function prepareSave(
  docId: string,
  deps: SaveFlowDeps,
  opts: PrepareOptions = {},
): Promise<PreparedSave | null> {
  const { signal } = opts;
  let r = await deps.saveIncremental(docId, false);
  if (r.tail.byteLength === 0 || !r.expected) return null;
  throwIfAborted(signal);
  const first = opts.tamper ? opts.tamper(r.tail) : r.tail;
  let v = await deps.verify(docId, first, r.expected, signal);
  let fellBack = false;
  if (!v.ok) {
    if (r.mode === 'keep-all' && !opts.tamper) throw new SaveVerifyError(v.reason);
    deps.logFallback({
      code: `save-fallback:${v.reason}`,
      objectCount: r.kept.length,
      size: first.byteLength,
    });
    throwIfAborted(signal);
    r = await deps.saveIncremental(docId, true);
    if (!r.expected) throw new SaveVerifyError(v.reason);
    v = await deps.verify(docId, r.tail, r.expected, signal);
    if (!v.ok) throw new SaveVerifyError(v.reason);
    fellBack = true;
  }
  throwIfAborted(signal);
  return { docId, tail: r.tail, baseLength: r.baseLength, mode: r.mode, fellBack };
}

/** After `tail` was written: it becomes the save base; the Work worker gets it too. */
export async function finishSave(prepared: PreparedSave, deps: SaveFlowDeps): Promise<number> {
  const { baseLength } = await deps.commit(prepared.docId, prepared.tail.byteLength);
  await deps.refreshWork(prepared.docId, prepared.tail);
  return baseLength;
}
