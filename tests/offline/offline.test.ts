// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_MESSAGE_MS,
  checkForUpdates,
  offlineStore,
  onMessage,
} from '../../src/features/offline/offline';

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
    check: null,
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

describe('Help → Check for Updates (M1-28)', () => {
  const reg = (over: Partial<ServiceWorkerRegistration>) =>
    ({
      update: () => Promise.resolve(),
      installing: null,
      waiting: null,
      ...over,
    }) as unknown as ServiceWorkerRegistration;

  it('reports up to date when nothing new installs', async () => {
    expect(await checkForUpdates(reg({}), () => true)).toBe('current');
    expect(offlineStore.getState()).toMatchObject({ check: 'current', update: 'none' });
  });

  it('a new waiting version is "found" and shows Update ready (never applied here)', async () => {
    const waiting = {} as ServiceWorker;
    expect(await checkForUpdates(reg({ waiting }), () => true)).toBe('found');
    expect(offlineStore.getState()).toMatchObject({ check: 'found', update: 'ready' });
  });

  it('the very first install is not an update', async () => {
    const waiting = {} as ServiceWorker;
    expect(await checkForUpdates(reg({ waiting }), () => false)).toBe('current');
  });

  it('a failed check (offline) and a browser without a service worker say so', async () => {
    const failing = reg({ update: () => Promise.reject(new Error('offline')) });
    expect(await checkForUpdates(failing, () => true)).toBe('failed');
    expect(await checkForUpdates(undefined)).toBe('unavailable');
    expect(offlineStore.getState().check).toBe('unavailable');
  });

  it('the message clears after a few seconds', async () => {
    vi.useFakeTimers();
    try {
      await checkForUpdates(reg({}), () => true);
      vi.advanceTimersByTime(CHECK_MESSAGE_MS);
      expect(offlineStore.getState().check).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
