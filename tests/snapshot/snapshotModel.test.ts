// M6-09 (ADR-021 D-38 e): Snapshot resolution, the dragged rectangle and the
// keyboard rectangle. Pure.
import { describe, expect, it } from 'vitest';
import {
  MAX_SNAPSHOT_SIDE,
  nudgeRect,
  snapshotPixels,
  snapshotRect,
  snapshotScale,
  startRect,
} from '../../src/features/snapshot/snapshotModel';

const rect = (x: number, y: number, width: number, height: number) => ({
  origin: { x, y },
  size: { width, height },
});

describe('snapshot resolution', () => {
  it('is twice the screen: zoom × device pixel ratio × 2', () => {
    expect(snapshotScale(rect(0, 0, 200, 100), 1, 1)).toBe(2);
    expect(snapshotScale(rect(0, 0, 200, 100), 1.5, 2)).toBe(6);
    expect(snapshotPixels(rect(0, 0, 200, 100), 6, 0)).toEqual({ width: 1200, height: 600 });
  });

  it('caps the longer side at 4,096 px', () => {
    const a0 = rect(0, 0, 3370, 2384);
    const s = snapshotScale(a0, 4, 2);
    expect(s).toBeCloseTo(MAX_SNAPSHOT_SIDE / 3370, 10);
    expect(snapshotPixels(a0, s, 0)).toEqual({ width: 4096, height: 2898 });
  });

  it('swaps the sides for a quarter turn; never below 1 px; a device ratio below 1 counts as 1', () => {
    expect(snapshotPixels(rect(0, 0, 200, 100), 2, 1)).toEqual({ width: 200, height: 400 });
    expect(snapshotPixels(rect(0, 0, 0.1, 0.1), 1, 0)).toEqual({ width: 1, height: 1 });
    expect(snapshotScale(rect(0, 0, 10, 10), 1, 0.5)).toBe(2);
  });
});

describe('the dragged rectangle', () => {
  it('normalised from any corner and kept on the page', () => {
    expect(snapshotRect({ x: 300, y: 200 }, { x: 100, y: 50 }, 595, 842)).toEqual(
      rect(100, 50, 200, 150),
    );
    expect(snapshotRect({ x: -20, y: 800 }, { x: 50, y: 900 }, 595, 842)).toEqual(
      rect(0, 800, 50, 42),
    );
  });

  it('a click (under 4 pt either way) is not a snapshot', () => {
    expect(snapshotRect({ x: 10, y: 10 }, { x: 12, y: 200 }, 595, 842)).toBeNull();
    expect(snapshotRect({ x: 10, y: 10 }, { x: 10, y: 10 }, 595, 842)).toBeNull();
  });
});

describe('the keyboard rectangle', () => {
  it('starts in the middle of the page; moves and resizes within it', () => {
    const r = startRect(600, 800);
    expect(r).toEqual(rect(225, 350, 150, 100));
    expect(nudgeRect(r, 10, -10, false, 600, 800)).toEqual(rect(235, 340, 150, 100));
    expect(nudgeRect(r, 1000, 1000, false, 600, 800)).toEqual(rect(450, 700, 150, 100));
    expect(nudgeRect(r, -1000, 0, true, 600, 800).size.width).toBe(4);
    expect(nudgeRect(r, 1000, 1000, true, 600, 800).size).toEqual({ width: 375, height: 450 });
  });
});
