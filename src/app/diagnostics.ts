// Local, content-free diagnostics (CLAUDE.md rule 10). Entries hold an error
// code and stack frames only: no document text, file names or annotation text.
// Nothing is sent anywhere; the opt-in error report (M2) will show these to the
// user before anything leaves the device.
import { toErrorData, type RpcErrorData } from '../engine/errors';

export interface DiagnosticEntry extends RpcErrorData {
  at: number;
  where: string;
  /** Counts only (e.g. a save fallback's object count and tail size), never content. */
  counts?: Record<string, number>;
}

/** Where an error boundary sits (diagnostics only, never shown). */
export const BOUNDARY = { app: 'app', document: 'document' } as const;
export type BoundaryName = (typeof BOUNDARY)[keyof typeof BOUNDARY];

const MAX = 50;
const entries: DiagnosticEntry[] = [];

export function recordError(where: string, err: unknown): DiagnosticEntry {
  const entry = { ...toErrorData(err), at: Date.now(), where };
  entries.push(entry);
  if (entries.length > MAX) entries.shift();
  return entry;
}

export function diagnostics(): readonly DiagnosticEntry[] {
  return entries;
}

/** A notable event that is not an error (e.g. a save fallback, M1-21): a code and counts only. */
export function recordEvent(
  where: string,
  code: string,
  counts: Record<string, number>,
): DiagnosticEntry {
  const entry: DiagnosticEntry = { code, message: code, at: Date.now(), where, counts };
  entries.push(entry);
  if (entries.length > MAX) entries.shift();
  return entry;
}
