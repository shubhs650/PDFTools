// Open state machine (M1-13), one per file being opened. Pure transitions;
// openDocument.ts drives it and the tab strip shows it.
import type { OpenErrorKind } from './errors';

export type OpenPhase =
  | { phase: 'reading' }
  | { phase: 'opening' }
  | { phase: 'ready'; docId: string }
  | { phase: 'duplicate'; docId: string }
  | { phase: 'error'; kind: OpenErrorKind };

export type OpenEvent =
  | { type: 'read' }
  | { type: 'opened'; docId: string }
  | { type: 'duplicate'; docId: string }
  | { type: 'failed'; kind: OpenErrorKind };

export const INITIAL: OpenPhase = { phase: 'reading' };

export function isFinal(s: OpenPhase): boolean {
  return s.phase === 'ready' || s.phase === 'duplicate' || s.phase === 'error';
}

export function transition(s: OpenPhase, e: OpenEvent): OpenPhase {
  if (isFinal(s)) return s; // final states never change
  switch (e.type) {
    case 'read':
      return s.phase === 'reading' ? { phase: 'opening' } : s;
    case 'duplicate':
      return s.phase === 'reading' ? { phase: 'duplicate', docId: e.docId } : s;
    case 'opened':
      return s.phase === 'opening' ? { phase: 'ready', docId: e.docId } : s;
    case 'failed':
      return { phase: 'error', kind: e.kind };
  }
}
