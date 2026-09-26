// Crash-recovery snapshot lifecycle per document (M1-24, §4.3, D-05). Pure:
// `transition` returns the next state and the effects the wiring performs
// (recovery.ts). Nothing is written before the first edit; a snapshot is
// written ~5 s after the last edit; a save or a close without saving clears it.

export const SNAPSHOT_DELAY_MS = 5000;

export interface SnapshotState {
  phase: 'idle' | 'waiting' | 'writing';
  /** A snapshot of this document is in OPFS. */
  stored: boolean;
  /** An edit arrived while writing: write again afterwards. */
  rerun: boolean;
  /** Saved or closed while writing: discard once the write finished. */
  discardAfterWrite: boolean;
}

export type SnapshotEvent =
  | { type: 'edit' }
  | { type: 'due' }
  | { type: 'written' }
  | { type: 'failed' }
  /** The document was saved (nothing unsaved) or closed: the snapshot is not needed. */
  | { type: 'clear' };

export type Effect = 'schedule' | 'cancel-timer' | 'write' | 'discard';

export const INITIAL: SnapshotState = {
  phase: 'idle',
  stored: false,
  rerun: false,
  discardAfterWrite: false,
};

export function transition(
  s: SnapshotState,
  e: SnapshotEvent,
): { state: SnapshotState; effects: Effect[] } {
  switch (e.type) {
    case 'edit':
      if (s.phase === 'writing')
        return { state: { ...s, rerun: true, discardAfterWrite: false }, effects: [] };
      return { state: { ...s, phase: 'waiting' }, effects: ['schedule'] };
    case 'due':
      if (s.phase !== 'waiting') return { state: s, effects: [] };
      return { state: { ...s, phase: 'writing', rerun: false }, effects: ['write'] };
    case 'written': {
      if (s.phase !== 'writing') return { state: s, effects: [] };
      if (s.discardAfterWrite) return { state: INITIAL, effects: ['discard'] };
      if (s.rerun) {
        return {
          state: { ...s, phase: 'waiting', stored: true, rerun: false },
          effects: ['schedule'],
        };
      }
      return { state: { ...s, phase: 'idle', stored: true }, effects: [] };
    }
    case 'failed':
      if (s.phase !== 'writing') return { state: s, effects: [] };
      if (s.discardAfterWrite) return { state: INITIAL, effects: s.stored ? ['discard'] : [] };
      // Try again after the next quiet period.
      return { state: { ...s, phase: 'waiting', rerun: false }, effects: ['schedule'] };
    case 'clear':
      if (s.phase === 'writing')
        return { state: { ...s, rerun: false, discardAfterWrite: true }, effects: [] };
      return {
        state: INITIAL,
        effects: [
          ...(s.phase === 'waiting' ? (['cancel-timer'] as const) : []),
          ...(s.stored ? (['discard'] as const) : []),
        ],
      };
  }
}

/** Per-key trailing debounce: `fire(key)` runs `delayMs` after the last `schedule(key)`. */
export class Debouncer {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly delayMs: number;
  private readonly fire: (key: string) => void;

  constructor(delayMs: number, fire: (key: string) => void) {
    this.delayMs = delayMs;
    this.fire = fire;
  }

  schedule(key: string): void {
    this.cancel(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.fire(key);
      }, this.delayMs),
    );
  }

  cancel(key: string): void {
    const t = this.timers.get(key);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(key);
  }

  pending(key: string): boolean {
    return this.timers.has(key);
  }
}
