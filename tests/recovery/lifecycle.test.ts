import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Debouncer,
  INITIAL,
  SNAPSHOT_DELAY_MS,
  transition,
  type Effect,
  type SnapshotEvent,
  type SnapshotState,
} from '../../src/features/recovery/lifecycle';

function run(events: SnapshotEvent[], from: SnapshotState = INITIAL) {
  let state = from;
  const effects: Effect[] = [];
  for (const e of events) {
    const r = transition(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

describe('snapshot lifecycle (M1-24)', () => {
  it('nothing happens before the first edit', () => {
    expect(run([{ type: 'due' }, { type: 'written' }, { type: 'clear' }])).toEqual({
      state: INITIAL,
      effects: [],
    });
  });

  it('edit → wait → write → stored', () => {
    const r = run([{ type: 'edit' }, { type: 'due' }, { type: 'written' }]);
    expect(r.effects).toEqual(['schedule', 'write']);
    expect(r.state).toMatchObject({ phase: 'idle', stored: true });
  });

  it('edits while writing write again afterwards', () => {
    const r = run([{ type: 'edit' }, { type: 'due' }, { type: 'edit' }, { type: 'written' }]);
    expect(r.effects).toEqual(['schedule', 'write', 'schedule']);
    expect(r.state).toMatchObject({ phase: 'waiting', stored: true });
  });

  it('a save (clear) discards a stored snapshot and cancels a waiting one', () => {
    const stored = run([{ type: 'edit' }, { type: 'due' }, { type: 'written' }]).state;
    expect(run([{ type: 'clear' }], stored).effects).toEqual(['discard']);
    const waiting = run([{ type: 'edit' }, { type: 'due' }, { type: 'written' }, { type: 'edit' }]);
    expect(run([{ type: 'clear' }], waiting.state)).toEqual({
      state: INITIAL,
      effects: ['cancel-timer', 'discard'],
    });
    expect(run([{ type: 'edit' }, { type: 'clear' }]).effects).toEqual([
      'schedule',
      'cancel-timer',
    ]);
  });

  it('a save during a write discards once the write finished (no stale snapshot)', () => {
    const r = run([{ type: 'edit' }, { type: 'due' }, { type: 'clear' }, { type: 'written' }]);
    expect(r).toEqual({ state: INITIAL, effects: ['schedule', 'write', 'discard'] });
  });

  it('a failed write is retried after the next quiet period', () => {
    const r = run([{ type: 'edit' }, { type: 'due' }, { type: 'failed' }]);
    expect(r.effects).toEqual(['schedule', 'write', 'schedule']);
    expect(r.state.phase).toBe('waiting');
  });
});

describe('Debouncer (fake timers)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once, SNAPSHOT_DELAY_MS after the last schedule, per key', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const d = new Debouncer(SNAPSHOT_DELAY_MS, (k) => fired.push(k));
    d.schedule('a');
    vi.advanceTimersByTime(4000);
    d.schedule('a'); // another edit: restart
    d.schedule('b');
    vi.advanceTimersByTime(4999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(['a', 'b']);
    expect(d.pending('a')).toBe(false);
  });

  it('cancel stops a pending fire', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const d = new Debouncer(100, (k) => fired.push(k));
    d.schedule('a');
    d.cancel('a');
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });
});
