// M7-06: where a sticky note's pop-up window sits, at every rotation and zoom.
import { describe, expect, it } from 'vitest';
import {
  POPUP_MIN,
  POPUP_SIZE,
  clampToPage,
  defaultPopupRect,
  leader,
  moved,
  popupFromView,
  popupToView,
  rectToView,
  resized,
  type DeviceRect,
  type PageFrame,
} from '../../src/features/annotate/notes/popupGeometry';

const A4 = { width: 595, height: 842 };
const frame = (rotation: number, scale = 1): PageFrame => ({ ...A4, rotation, scale });
const rect = (x: number, y: number, width: number, height: number): DeviceRect => ({
  origin: { x, y },
  size: { width, height },
});

describe('popup geometry', () => {
  it('unrotated: the window is the rect, its top-left scaled, its size unscaled (NoZoom)', () => {
    expect(popupToView(rect(100, 200, 240, 168), frame(0, 2))).toEqual({
      left: 200,
      top: 400,
      width: 240,
      height: 168,
    });
  });

  it('round-trips through view space at every rotation and zoom', () => {
    const r = rect(120, 300, 200, 150);
    for (const rotation of [0, 1, 2, 3])
      for (const scale of [0.5, 1, 1.75]) {
        const f = frame(rotation, scale);
        const back = popupFromView(popupToView(r, f), f);
        expect(back.origin.x).toBeCloseTo(120);
        expect(back.origin.y).toBeCloseTo(300);
        expect(back.size).toEqual({ width: 200, height: 150 });
      }
  });

  it('turned a quarter: the page top-left is the view top-right', () => {
    // A note at the device top-left corner shows at the view's top-right.
    const v = rectToView(rect(0, 0, 20, 20), frame(1));
    expect(v).toEqual({ left: 842 - 20, top: 0, width: 20, height: 20 });
    expect(rectToView(rect(0, 0, 20, 10), frame(3)).top).toBe(595 - 20);
  });

  it('a new window opens right of the note, level with it, inside the page', () => {
    const note = rect(100, 100, 20, 20);
    const r = defaultPopupRect(note, frame(0));
    expect(r).toEqual(rect(132, 100, POPUP_SIZE.width, POPUP_SIZE.height));
    // No room on the right: on the left.
    const edge = defaultPopupRect(rect(560, 100, 20, 20), frame(0));
    expect(edge.origin.x).toBe(560 - 12 - POPUP_SIZE.width);
    // Near the bottom: lifted into the page.
    expect(defaultPopupRect(rect(100, 830, 10, 10), frame(0)).origin.y).toBe(
      842 - POPUP_SIZE.height,
    );
  });

  it('a new window on a turned page opens right of the note on screen', () => {
    const f = frame(1);
    const note = rect(100, 600, 20, 20);
    const icon = rectToView(note, f);
    const win = popupToView(defaultPopupRect(note, f), f);
    expect(win.left).toBe(icon.left + icon.width + 12);
    expect(win.top).toBe(icon.top);
  });

  it('clamps into the page; at a tiny zoom it sits at the top-left edge', () => {
    expect(clampToPage({ left: 500, top: -5, width: 240, height: 168 }, frame(0))).toMatchObject({
      left: 595 - 240,
      top: 0,
    });
    expect(
      clampToPage({ left: 50, top: 50, width: 240, height: 168 }, frame(0, 0.25)),
    ).toMatchObject({
      left: 0,
      top: 210.5 - 168,
    });
  });

  it('the leader runs from the note centre to the window edge, none when they overlap', () => {
    const icon = { left: 0, top: 0, width: 20, height: 20 };
    expect(leader(icon, { left: 50, top: 0, width: 100, height: 100 })).toEqual({
      x1: 10,
      y1: 10,
      x2: 50,
      y2: 10,
    });
    expect(leader(icon, { left: 5, top: 5, width: 100, height: 100 })).toBeNull();
  });

  it('moves stay in the page; resizes keep the minimum', () => {
    const f = frame(0);
    const box = { left: 100, top: 100, width: 240, height: 168 };
    expect(moved(box, 1000, -1000, f)).toMatchObject({ left: 595 - 240, top: 0 });
    expect(resized(box, -500, -500, f)).toMatchObject(POPUP_MIN);
    expect(resized(box, 1000, 20, f)).toMatchObject({ width: 595 - 100, height: 188 });
  });
});
