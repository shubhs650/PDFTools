// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { offlineStore, onMessage } from '../../src/features/offline/offline';

const msg = (data: unknown) => {
  onMessage({ data });
};

beforeEach(() => {
  offlineStore.setState({
    phase: 'preparing',
    progress: 0,
    priority: 0,
    update: 'none',
    explain: false,
  });
});

describe('service worker messages → status bar state (M1-25)', () => {
  it('progress counts core and background files together, then "ready"', () => {
    msg({ type: 'precache-progress', kind: 'core', done: 5, total: 10 });
    expect(offlineStore.getState().progress).toBeCloseTo(0.5);
    msg({ type: 'precache-progress', kind: 'core', done: 10, total: 10 });
    msg({ type: 'precache-progress', kind: 'background', done: 0, total: 5 });
    expect(offlineStore.getState().progress).toBeCloseTo(10 / 15);
    msg({ type: 'precache-done' });
    expect(offlineStore.getState()).toMatchObject({ phase: 'ready', progress: 1 });
  });

  it('a status reply with everything cached is "ready" at once (later visits)', () => {
    msg({ type: 'status', done: 12, total: 12 });
    expect(offlineStore.getState().phase).toBe('ready');
  });

  it('on-demand fetches drive the spinner count', () => {
    msg({ type: 'priority-fetch', pending: 1 });
    expect(offlineStore.getState().priority).toBe(1);
    msg({ type: 'priority-fetch', pending: 0 });
    expect(offlineStore.getState().priority).toBe(0);
  });

  it('a failed background precache is reported; unknown messages are ignored', () => {
    msg({ type: 'something-else' });
    msg(null);
    expect(offlineStore.getState().phase).toBe('preparing');
    msg({ type: 'precache-failed' });
    expect(offlineStore.getState().phase).toBe('failed');
  });
});
