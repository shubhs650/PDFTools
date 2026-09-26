import { describe, expect, it } from 'vitest';
import {
  IDLE,
  isActive,
  transition,
  type SaveEvent,
  type SavePhase,
} from '../../src/features/save/saveMachine';

const run = (events: SaveEvent[], from: SavePhase = IDLE): SavePhase =>
  events.reduce(transition, from);

describe('save state machine (M1-22)', () => {
  it('idle → saving → verifying → writing → done', () => {
    expect(
      run([
        { type: 'start' },
        { type: 'verifying' },
        { type: 'writing' },
        { type: 'written', appended: 42 },
      ]),
    ).toEqual({ phase: 'done', appended: 42 });
  });

  it('nothing to save ends in done with 0 bytes', () => {
    expect(run([{ type: 'start' }, { type: 'nothing-to-save' }])).toEqual({
      phase: 'done',
      appended: 0,
    });
  });

  it('errors and cancellation only from an active phase', () => {
    expect(run([{ type: 'start' }, { type: 'fail', kind: 'permission-denied' }])).toEqual({
      phase: 'error',
      kind: 'permission-denied',
    });
    expect(run([{ type: 'start' }, { type: 'verifying' }, { type: 'cancel' }])).toEqual({
      phase: 'cancelled',
    });
    expect(run([{ type: 'cancel' }])).toEqual(IDLE);
    expect(run([{ type: 'fail', kind: 'missing' }])).toEqual(IDLE);
  });

  it('a second start while active is ignored; a new save can start after done/error/cancel', () => {
    const saving = run([{ type: 'start' }, { type: 'verifying' }]);
    expect(transition(saving, { type: 'start' })).toBe(saving);
    for (const end of [
      { phase: 'done', appended: 1 },
      { phase: 'error', kind: 'write-failed' },
      { phase: 'cancelled' },
    ] as SavePhase[]) {
      expect(transition(end, { type: 'start' })).toEqual({ phase: 'saving' });
    }
  });

  it('out-of-order events leave the state unchanged', () => {
    expect(run([{ type: 'writing' }])).toEqual(IDLE);
    expect(run([{ type: 'start' }, { type: 'written', appended: 1 }])).toEqual({ phase: 'saving' });
    expect(isActive({ phase: 'writing' })).toBe(true);
    expect(isActive({ phase: 'done', appended: 0 })).toBe(false);
  });
});
