// Save state machine (M1-22, §4.2): idle → saving → verifying → writing →
// done / error / cancelled. Pure; the save pipeline (save.ts) feeds it events
// and SaveStatus renders it. Cancelling is possible until the write commits.

export type SaveErrorKind =
  | 'permission-denied'
  | 'missing'
  | 'file-changed'
  | 'verify-failed'
  | 'needs-rewrite'
  | 'write-failed';

export type SavePhase =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'verifying' }
  | { phase: 'writing' }
  | { phase: 'done'; appended: number }
  | { phase: 'error'; kind: SaveErrorKind }
  | { phase: 'cancelled' };

export type SaveEvent =
  | { type: 'start' }
  | { type: 'verifying' }
  | { type: 'writing' }
  | { type: 'written'; appended: number }
  | { type: 'nothing-to-save' }
  | { type: 'fail'; kind: SaveErrorKind }
  | { type: 'cancel' };

export const IDLE: SavePhase = { phase: 'idle' };

const ACTIVE = new Set(['saving', 'verifying', 'writing']);

export const isActive = (s: SavePhase): boolean => ACTIVE.has(s.phase);

export function transition(state: SavePhase, event: SaveEvent): SavePhase {
  switch (event.type) {
    case 'start':
      return isActive(state) ? state : { phase: 'saving' };
    case 'verifying':
      return state.phase === 'saving' ? { phase: 'verifying' } : state;
    case 'writing':
      return state.phase === 'saving' || state.phase === 'verifying' ? { phase: 'writing' } : state;
    case 'written':
      return state.phase === 'writing' ? { phase: 'done', appended: event.appended } : state;
    case 'nothing-to-save':
      return state.phase === 'saving' || state.phase === 'verifying'
        ? { phase: 'done', appended: 0 }
        : state;
    case 'fail':
      return isActive(state) ? { phase: 'error', kind: event.kind } : state;
    case 'cancel':
      return isActive(state) ? { phase: 'cancelled' } : state;
  }
}
