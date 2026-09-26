// Open state machine (M1-13), one per file being opened. Pure transitions;
// openDocument.ts drives it and the tab strip shows it. M2-03 adds the
// password step (D-19, §7.12): PDFium says "password" → ask → open again.
import type { OpenErrorKind } from './errors';

export type OpenPhase =
  | { phase: 'reading' }
  | { phase: 'opening' }
  /** Waiting for the open password; `retry` once a password was given and refused. */
  | { phase: 'password'; retry: boolean }
  | { phase: 'ready'; docId: string }
  | { phase: 'duplicate'; docId: string }
  /** The user cancelled the password prompt: no tab, no error. */
  | { phase: 'cancelled' }
  | { phase: 'error'; kind: OpenErrorKind };

export type OpenEvent =
  | { type: 'read' }
  | { type: 'needs-password'; retry: boolean }
  | { type: 'password-given' }
  | { type: 'cancelled' }
  | { type: 'opened'; docId: string }
  | { type: 'duplicate'; docId: string }
  | { type: 'failed'; kind: OpenErrorKind };

export const INITIAL: OpenPhase = { phase: 'reading' };

export function isFinal(s: OpenPhase): boolean {
  return (
    s.phase === 'ready' || s.phase === 'duplicate' || s.phase === 'cancelled' || s.phase === 'error'
  );
}

export function transition(s: OpenPhase, e: OpenEvent): OpenPhase {
  if (isFinal(s)) return s; // final states never change
  switch (e.type) {
    case 'read':
      return s.phase === 'reading' ? { phase: 'opening' } : s;
    case 'duplicate':
      return s.phase === 'reading' ? { phase: 'duplicate', docId: e.docId } : s;
    case 'needs-password':
      return s.phase === 'opening' ? { phase: 'password', retry: e.retry } : s;
    case 'password-given':
      return s.phase === 'password' ? { phase: 'opening' } : s;
    case 'cancelled':
      return s.phase === 'password' ? { phase: 'cancelled' } : s;
    case 'opened':
      return s.phase === 'opening' ? { phase: 'ready', docId: e.docId } : s;
    case 'failed':
      return { phase: 'error', kind: e.kind };
  }
}
