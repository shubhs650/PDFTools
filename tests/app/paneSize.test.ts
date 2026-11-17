import { describe, expect, it } from 'vitest';
import {
  PANE_RESIZE_STEP,
  PANE_WIDTH_MAX,
  PANE_WIDTH_MIN,
  clampPaneWidth,
  widthForDrag,
  widthForKey,
} from '../../src/app/paneSize';

// M11-10 (ADR-028 D-56): one splitter for the left pane (on its right edge) and the
// Properties pane (on its left edge).

describe('clampPaneWidth', () => {
  it('keeps a width within 160–480 px, in whole pixels', () => {
    expect(clampPaneWidth(10)).toBe(PANE_WIDTH_MIN);
    expect(clampPaneWidth(9999)).toBe(PANE_WIDTH_MAX);
    expect(clampPaneWidth(250.4)).toBe(250);
    expect(clampPaneWidth(Number.NaN)).toBeNaN();
  });
});

describe('widthForKey', () => {
  it('moves the left pane splitter with the arrows: right widens', () => {
    expect(widthForKey('ArrowRight', 260, 'left')).toBe(260 + PANE_RESIZE_STEP);
    expect(widthForKey('ArrowLeft', 260, 'left')).toBe(260 - PANE_RESIZE_STEP);
  });

  it('moves the Properties pane splitter with the arrows: left widens', () => {
    expect(widthForKey('ArrowLeft', 260, 'right')).toBe(260 + PANE_RESIZE_STEP);
    expect(widthForKey('ArrowRight', 260, 'right')).toBe(260 - PANE_RESIZE_STEP);
  });

  it('goes to the limits with Home and End and never past them', () => {
    for (const side of ['left', 'right'] as const) {
      expect(widthForKey('Home', 300, side)).toBe(PANE_WIDTH_MIN);
      expect(widthForKey('End', 300, side)).toBe(PANE_WIDTH_MAX);
    }
    expect(widthForKey('ArrowRight', PANE_WIDTH_MAX, 'left')).toBe(PANE_WIDTH_MAX);
    expect(widthForKey('ArrowLeft', PANE_WIDTH_MIN, 'left')).toBe(PANE_WIDTH_MIN);
    expect(widthForKey('ArrowLeft', PANE_WIDTH_MAX, 'right')).toBe(PANE_WIDTH_MAX);
    expect(widthForKey('ArrowRight', PANE_WIDTH_MIN, 'right')).toBe(PANE_WIDTH_MIN);
  });

  it('ignores other keys', () => {
    expect(widthForKey('ArrowUp', 260, 'left')).toBeNull();
    expect(widthForKey('Enter', 260, 'right')).toBeNull();
  });
});

describe('widthForDrag', () => {
  it('follows the pointer: right widens the left pane and narrows the Properties pane', () => {
    expect(widthForDrag(260, 60, 'left')).toBe(320);
    expect(widthForDrag(260, 60, 'right')).toBe(200);
    expect(widthForDrag(260, -60, 'right')).toBe(320);
  });

  it('stops at the limits', () => {
    expect(widthForDrag(260, 1000, 'left')).toBe(PANE_WIDTH_MAX);
    expect(widthForDrag(260, 1000, 'right')).toBe(PANE_WIDTH_MIN);
  });
});

describe('panesChanged', () => {
  it('is true only for a pane shown, hidden or resized', async () => {
    const { createAppStore } = await import('../../src/app/store/appStore');
    const { panesChanged } = await import('../../src/app/panePlace');
    const s = createAppStore();
    const a = s.getState();
    s.getState().setTool('hand');
    expect(panesChanged(a, s.getState())).toBe(false);
    for (const change of [
      () => {
        s.getState().toggleLeftPane();
      },
      () => {
        s.getState().setLeftPaneWidth(300);
      },
      () => {
        s.getState().setProperties(true);
      },
      () => {
        s.getState().setPropertiesWidth(300);
      },
    ]) {
      const before = s.getState();
      change();
      expect(panesChanged(before, s.getState())).toBe(true);
    }
  });
});
