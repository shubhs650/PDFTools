import { describe, expect, it } from 'vitest';
import {
  AUTO_SCROLL_MAX_PX,
  clampLeft,
  dropIndex,
  edgeSpeed,
  shiftFor,
  type TabSlot,
} from '../../src/app/tabDrag';

// M11-04 (ADR-028 D-50): the geometry of dragging a file tab along the strip.

// Four tabs of different widths, side by side from x = 4.
const SLOTS: TabSlot[] = [
  { left: 4, width: 100 },
  { left: 104, width: 60 },
  { left: 164, width: 140 },
  { left: 304, width: 80 },
];

describe('dropIndex', () => {
  it('passes a neighbour once its leading edge crosses the neighbour’s centre', () => {
    // Tab 1 (104–164) moving right: tab 2's centre is 234, tab 3's 344.
    expect(dropIndex(SLOTS, 1, 104)).toBe(1);
    expect(dropIndex(SLOTS, 1, 173)).toBe(1); // right edge 233
    expect(dropIndex(SLOTS, 1, 175)).toBe(2); // right edge 235
    expect(dropIndex(SLOTS, 1, 285)).toBe(3); // right edge 345
  });

  it('moves left past each neighbour whose centre its left edge crosses', () => {
    // Tab 2 (164–304) moving left: tab 1's centre 134, tab 0's centre 54.
    expect(dropIndex(SLOTS, 2, 135)).toBe(2);
    expect(dropIndex(SLOTS, 2, 133)).toBe(1);
    expect(dropIndex(SLOTS, 2, 55)).toBe(1);
    expect(dropIndex(SLOTS, 2, 53)).toBe(0);
  });

  it('held against either end of the row, reaches that end (whatever the widths)', () => {
    for (let from = 0; from < SLOTS.length; from++) {
      expect(dropIndex(SLOTS, from, clampLeft(SLOTS, from, 9999))).toBe(SLOTS.length - 1);
      expect(dropIndex(SLOTS, from, clampLeft(SLOTS, from, -9999))).toBe(0);
      // At rest it stays.
      expect(dropIndex(SLOTS, from, SLOTS[from]?.left ?? 0)).toBe(from);
    }
  });

  it('is a step function: the same position always gives the same answer', () => {
    const answers = Array.from({ length: 400 }, (_, x) => dropIndex(SLOTS, 0, x));
    for (let x = 1; x < answers.length; x++)
      expect(answers[x] ?? 0).toBeGreaterThanOrEqual(answers[x - 1] ?? 0);
  });

  it('keeps an unknown index where it is', () => {
    expect(dropIndex(SLOTS, 9, 50)).toBe(9);
  });
});

describe('shiftFor', () => {
  it('slides the passed tabs towards where the dragged tab came from', () => {
    // 0 dragged to 2: tabs 1 and 2 slide left by its width.
    expect([0, 1, 2, 3].map((j) => shiftFor(j, 0, 2, 100))).toEqual([0, -100, -100, 0]);
    // 3 dragged to 1: tabs 1 and 2 slide right.
    expect([0, 1, 2, 3].map((j) => shiftFor(j, 3, 1, 80))).toEqual([0, 80, 80, 0]);
    // Not moved: nothing slides.
    expect([0, 1, 2, 3].map((j) => shiftFor(j, 2, 2, 140))).toEqual([0, 0, 0, 0]);
  });
});

describe('clampLeft', () => {
  it('keeps the dragged tab inside the row', () => {
    expect(clampLeft(SLOTS, 1, -50)).toBe(4);
    expect(clampLeft(SLOTS, 1, 500)).toBe(384 - 60);
    expect(clampLeft(SLOTS, 1, 200)).toBe(200);
  });
});

describe('edgeSpeed', () => {
  it('scrolls only near the ends, faster towards them, at most the maximum', () => {
    expect(edgeSpeed(300, 0, 600)).toBe(0);
    expect(edgeSpeed(30, 0, 600)).toBeLessThan(0);
    expect(edgeSpeed(5, 0, 600)).toBeLessThan(edgeSpeed(30, 0, 600));
    expect(edgeSpeed(-40, 0, 600)).toBe(-AUTO_SCROLL_MAX_PX);
    expect(edgeSpeed(580, 0, 600)).toBeGreaterThan(0);
    expect(edgeSpeed(900, 0, 600)).toBe(AUTO_SCROLL_MAX_PX);
  });

  it('does not scroll a row too short to have a middle', () => {
    expect(edgeSpeed(10, 0, 60)).toBe(0);
  });
});
