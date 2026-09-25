import { describe, expect, it } from 'vitest';
import {
  WORK_RESPAWN_BYTES,
  shouldRespawnRender,
  shouldRespawnWork,
} from '../../src/engine/workerLifecycle';

describe('Work worker respawn policy (ADR-004 decision 4)', () => {
  const MB = 1024 * 1024;
  it('respawns only when idle and above the threshold (≈256 MB)', () => {
    expect(WORK_RESPAWN_BYTES).toBe(256 * MB);
    expect(shouldRespawnWork({ wasmBytes: 300 * MB, pendingJobs: 0, evicted: false })).toBe(true);
    expect(shouldRespawnWork({ wasmBytes: 300 * MB, pendingJobs: 1, evicted: false })).toBe(false);
    expect(shouldRespawnWork({ wasmBytes: 200 * MB, pendingJobs: 0, evicted: false })).toBe(false);
  });
  it('respawns after an eviction whatever the memory, but never mid-job', () => {
    expect(shouldRespawnWork({ wasmBytes: 20 * MB, pendingJobs: 0, evicted: true })).toBe(true);
    expect(shouldRespawnWork({ wasmBytes: 20 * MB, pendingJobs: 2, evicted: true })).toBe(false);
  });
  it('honours a custom threshold', () => {
    expect(
      shouldRespawnWork({
        wasmBytes: 70 * MB,
        pendingJobs: 0,
        evicted: false,
        thresholdBytes: 64 * MB,
      }),
    ).toBe(true);
  });
});

describe('Render worker respawn policy', () => {
  it('only when no document is open', () => {
    expect(shouldRespawnRender({ openDocuments: 1, wasmBytes: 900 * 1024 * 1024 })).toBe(false);
    expect(shouldRespawnRender({ openDocuments: 0, wasmBytes: 900 * 1024 * 1024 })).toBe(true);
    expect(shouldRespawnRender({ openDocuments: 0, wasmBytes: 10 * 1024 * 1024 })).toBe(false);
  });
});
